import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderSurface } from 'claude-code'

import type { OtomatikDevirConv, OtomatikDevirPhase } from '../types'

// ---------------------------------------------------------------------------
// Settings ($.store, across sessions) and the per-conversation record ($.state)
// ---------------------------------------------------------------------------

const conv = atom({ plugin: 'otomatik-devir', key: 'conv' } as const, null)

const SKILL = 'my-skill-handoff'
const DEFAULT_THRESHOLD = 60

// Used when no `my-skill-handoff` command exists (most people): the mod reads
// the resume prompt from the LAST code block of the reply, so the prompt asks
// for it to come last, alone.
const FALLBACK_PROMPT =
  "Bu sohbetin devam notunu yaz: hedef, yapılanlar, kalanlar, alınan kararlar ve dikkat edilecekler. .workflow/HANDOFF.md dosyasına kaydet (klasör yoksa oluştur). En sonda, yeni sohbete yapıştırılacak devam prompt'unu tek bir kod bloğu içinde ver; ondan sonra başka kod bloğu yazma."

/**
 * Turkish dative suffix for a whole number 1-99 as it is read aloud ("yüzde
 * altmış'a", "yüzde yetmiş'e", "yüzde elli'ye"): vowel harmony and the
 * buffer y follow the last spoken word, so a fixed "'a" is wrong for 70, 50...
 */
const dative = (n: number): string => {
  const units = ['', "'e", "'ye", "'e", "'e", "'e", "'ya", "'ye", "'e", "'a"]
  const tens = ['', "'a", "'ye", "'a", "'a", "'ye", "'a", "'e", "'e", "'a"]
  const unit = n % 10

  return unit !== 0 ? (units[unit] ?? "'a") : (tens[Math.floor(n / 10) % 10] ?? "'a")
}

export const noteText = (threshold: number): string =>
  `Bağlam %${threshold}${dative(threshold)} ulaştı. Şu anki adımı güvenli bir noktada bitir, yarım dosya bırakma, yeni işe başlama ve dur.`

type Mode = 'sor' | 'otomatik'
type Settings = { threshold: number; mode: Mode; isEnabled: boolean }

const readSettings = async ($: EngineInterface): Promise<Settings> => {
  const [esik, mod, acik] = await Promise.all([
    $.store.get('esik'),
    $.store.get('mod'),
    $.store.get('acik'),
  ])
  const threshold =
    typeof esik === 'number' && Number.isInteger(esik) && esik >= 1 && esik <= 99
      ? esik
      : DEFAULT_THRESHOLD

  return {
    threshold,
    mode: mod === 'otomatik' ? 'otomatik' : 'sor',
    isEnabled: acik !== false,
  }
}

/** Context fill as a whole percentage, or undefined before the first response. */
const contextPercent = async ($: EngineInterface): Promise<number | undefined> => {
  const { context } = await $.session.usage()
  if (typeof context.percent === 'number') return context.percent
  if (typeof context.tokens === 'number' && context.window > 0) {
    return Math.round((context.tokens / context.window) * 100)
  }

  return undefined
}

const statusText = (settings: Settings, percent: number | undefined): string =>
  settings.isEnabled
    ? `Devir: %${percent ?? 0} / eşik %${settings.threshold}`
    : 'Devir: kapalı'

const refreshStatus = async ($: EngineInterface, percent?: number): Promise<void> => {
  const settings = await readSettings($)
  $.ui.status(statusText(settings, percent ?? (await contextPercent($))))
}

/** The record of the conversation now running; a new session id starts it over at idle. */
const currentConv = async ($: EngineInterface): Promise<OtomatikDevirConv> => {
  const sid = await $.session.id()
  const held = await read($, conv)
  if (held !== null && held.sid === sid) return held
  const fresh: OtomatikDevirConv = { sid, phase: 'idle' }
  await update($, conv, () => fresh)

  return fresh
}

const patchConv = async (
  $: EngineInterface,
  sid: string,
  patch: Partial<OtomatikDevirConv>,
): Promise<void> => {
  await update($, conv, (held): OtomatikDevirConv =>
    held !== null && held.sid === sid ? { ...held, ...patch } : { sid, phase: 'idle', ...patch },
  )
}

const setPhase = ($: EngineInterface, sid: string, phase: OtomatikDevirPhase) =>
  patchConv($, sid, { phase })

/**
 * Re-arms the trigger in the same conversation: `done` (and, with `orWarned`,
 * `warned`) goes back to `idle`, atomically. Called when the fill is measured
 * under the threshold again (a /compact), or the person changes the threshold
 * or switches the mod on. Without it a finished, aborted or failed handoff left
 * the mod silent until a new session id appeared.
 */
const rearm = async ($: EngineInterface, sid: string, orWarned = false): Promise<boolean> =>
  claim(
    $,
    sid,
    held => held.phase === 'done' || (orWarned && held.phase === 'warned'),
    { phase: 'idle' },
  )

/**
 * Check-and-set in one `update` (ifVersion, retried on a miss): applies `patch`
 * only when `may` allows the record as it stands, and says whether this call
 * won. Two racing callers (parallel tool results, a double press, `/devir simdi`
 * landing beside a turn end) cannot both pass. A record of another sid is
 * left alone.
 */
const claim = async (
  $: EngineInterface,
  sid: string,
  may: (held: OtomatikDevirConv) => boolean,
  patch: Partial<OtomatikDevirConv>,
): Promise<boolean> => {
  let isClaimed = false
  await update($, conv, (held): OtomatikDevirConv | null => {
    if (held !== null && held.sid !== sid) {
      isClaimed = false
      return held
    }
    const now: OtomatikDevirConv = held ?? { sid, phase: 'idle' }
    isClaimed = may(now)
    return isClaimed ? { ...now, ...patch } : held
  })

  return isClaimed
}

// ---------------------------------------------------------------------------
// Handoff steps
// ---------------------------------------------------------------------------

/**
 * The text of the last non-empty fenced code block (``` or ~~~, any length),
 * fence and info string stripped. Line-based, as CommonMark reads fences: a
 * block closes only on a line of the same fence character, at least as long,
 * with nothing after it, so inner shorter fences and ```lang lines stay in the
 * body; an empty block cannot pair a closing fence with the next opening one;
 * a fence left open runs to the end of the text.
 */
const lastFencedBlock = (text: string): string | undefined => {
  let last: string | undefined
  let open: { char: string; size: number; lines: string[] } | undefined
  const close = (): void => {
    const body = open?.lines.join('\n').trim() ?? ''
    if (body !== '') last = body
    open = undefined
  }
  for (const line of text.split(/\r?\n/)) {
    const fence = /^[ \t]*(`{3,}|~{3,})(.*)$/.exec(line)
    const marks = fence?.[1] ?? ''
    const rest = fence?.[2] ?? ''
    const char = marks.charAt(0)
    if (open === undefined) {
      // A backtick fence's info string cannot hold a backtick (CommonMark).
      if (fence !== null && !(char === '`' && rest.includes('`'))) {
        open = { char, size: marks.length, lines: [] }
      }
      continue
    }
    if (fence !== null && char === open.char && marks.length >= open.size && rest.trim() === '') {
      close()
      continue
    }
    open.lines.push(line)
  }
  if (open !== undefined) close()

  return last
}

const hasHandoffSkill = async ($: EngineInterface): Promise<boolean> => {
  try {
    if ((await $.command.list()).some(command => command.name === SKILL)) return true
  } catch {
    // fall through to the file checks
  }
  const home = await $.env.get('HOME')
  const places = [
    home === undefined ? undefined : `${home}/.claude/skills/${SKILL}/SKILL.md`,
    `${await $.session.root()}/.claude/skills/${SKILL}/SKILL.md`,
  ]
  for (const place of places) {
    if (place !== undefined && (await $.fs.exists(place).catch(() => false))) return true
  }

  return false
}

/** Starts the handoff turn: the skill when it exists, else the fallback prompt. */
const startHandoff = async ($: EngineInterface, sid: string): Promise<void> => {
  // One handoff at a time; clearing `grace` keeps the handoff turn's end from
  // being eaten by the grace branch of turn.complete.
  const isClaimed = await claim($, sid, held => held.phase !== 'handoff_running', {
    phase: 'handoff_running',
    grace: false,
  })
  if (!isClaimed) return
  $.ui.toast('Devir başlıyor…')
  if (await hasHandoffSkill($)) {
    try {
      await $.command.run({ command: SKILL })

      return
    } catch {
      $.ui.log(`otomatik-devir: /${SKILL} çalıştırılamadı, yedek prompt gönderiliyor`, {
        to: 'debug',
      })
    }
  }
  try {
    const sent = await $.prompt.submit({ text: FALLBACK_PROMPT, asUser: true })
    if (sent.drop !== undefined) throw new Error(`prompt dropped: ${sent.drop}`)
  } catch (error) {
    // No handoff turn will come: do not leave the phase at handoff_running,
    // where the next unrelated turn would be parsed as the handoff.
    await setPhase($, sid, 'done')
    $.ui.log(`otomatik-devir: devir başlatılamadı: ${String(error)}`, { to: 'debug' })
  }
}

/** Clears the chat and submits the continuation prompt; on failure, clipboard + toast. */
const switchChat = async (
  $: EngineInterface,
  sid: string,
  prompt: string,
  surface?: RenderSurface,
): Promise<void> => {
  // Only one switch per prompt: a double press of [Geç] (or Geç racing the
  // otomatik switch) must not run /clear and submit twice.
  const isClaimed = await claim($, sid, held => held.phase === 'awaiting_choice', {
    phase: 'done',
  })
  if (!isClaimed) return
  let isSubmitted = false
  try {
    await $.command.run({ command: 'clear' })
    const fresh = await $.session.id()
    if (fresh === sid) throw new Error('clear did not start a new conversation')
    // The continuation turn of the fresh chat is exempt from triggering.
    await update($, conv, (): OtomatikDevirConv => ({ sid: fresh, phase: 'idle', grace: true }))
    const sent = await $.prompt.submit({ text: prompt, asUser: true })
    if (sent.drop !== undefined) throw new Error(`prompt dropped: ${sent.drop}`)
    isSubmitted = true
  } catch {
    const copied = await $.ui
      .copy(surface === undefined ? { text: prompt } : { text: prompt, surface })
      .catch(() => ({ isCopied: false as const }))
    $.ui.toast(
      copied.isCopied
        ? "Devam prompt'u panoya kopyalandı. /clear yazıp yeni sohbete yapıştır."
        : "Yeni sohbete yapıştır: devam prompt'u aşağıda.",
      { timeoutMs: 15000 },
    )
    if (!copied.isCopied) $.ui.log(`Yeni sohbete yapıştır:\n${prompt}`)
    // Still in the same conversation (the clear did not happen): keep the
    // prompt claimable so `/devir gec` can try again.
    const now = await $.session.id().catch(() => sid)
    if (now === sid) await patchConv($, sid, { phase: 'awaiting_choice', bandHidden: true })
  }
  if (isSubmitted) await refreshStatus($).catch(() => undefined)
}

/** Work that must not run inside the dispatch the turn waits on. */
const later = ($: EngineInterface, work: () => Promise<void>): void => {
  $.clock.after(50, () => {
    work().catch(error => $.ui.log(`otomatik-devir: ${String(error)}`, { to: 'debug' }))
  })
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'devir',
      description: 'Otomatik devir: durum, esik <n>, otomatik, sor, simdi, kapat, ac, gec',
      argumentHint: '[esik <n> | otomatik | sor | simdi | kapat | ac | gec]',
    })
    await currentConv($)
    await refreshStatus($)

    return next(e)
  })

  // A /clear (or any end) drops this conversation's record.
  on('session.end', async ($, e, next) => {
    await update($, conv, held => (held !== null && held.sid === e.sessionId ? null : held))

    return next(e)
  })

  // Status line on every measured change of the fill.
  // A fill measured under the threshold again (e.g. after /compact) re-arms a
  // `done` record of this conversation.
  on('session.measure', async ($, e, next) => {
    await refreshStatus($, e.context.percent)
    const percent = e.context.percent
    if (percent !== undefined) {
      const settings = await readSettings($)
      if (percent < settings.threshold) {
        const held = await read($, conv)
        if (held !== null && held.phase === 'done') await rearm($, held.sid)
      }
    }

    return next(e)
  })

  // Mid-turn: once a tool result of the main loop is stored, check the fill
  // and, the first time the threshold is crossed, append the hidden note.
  on('session.append', { door: 'tool-result' }, async ($, e, next) => {
    const stored = await next(e)
    if (e.agentId !== undefined) return stored
    const settings = await readSettings($)
    if (!settings.isEnabled) return stored
    const held = await currentConv($)
    if (held.phase !== 'idle' || held.grace === true) return stored
    const percent = await contextPercent($)
    if (percent === undefined || percent < settings.threshold) return stored
    // Parallel tool results run this hook side by side: only the one that
    // moves idle -> warned appends the note, so it is injected once.
    const isClaimed = await claim(
      $,
      held.sid,
      now => now.phase === 'idle' && now.grace !== true,
      { phase: 'warned' },
    )
    if (!isClaimed) return stored
    $.ui.status(statusText(settings, percent))
    // Not awaited: the row joins after the stored tool result, outside this chain.
    void $.session
      .append({ message: { type: 'user', content: [{ type: 'text', text: noteText(settings.threshold) }] } })
      .catch(error => $.ui.log(`otomatik-devir: not eklenemedi: ${String(error)}`, { to: 'debug' }))

    return stored
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    const settings = await readSettings($)
    const percent = await contextPercent($)
    $.ui.status(statusText(settings, percent))
    const held = await currentConv($)

    if (held.grace === true) {
      await patchConv($, held.sid, { grace: false })

      return result
    }

    if (held.phase === 'handoff_running') {
      if (e.isAborted) {
        await setPhase($, held.sid, 'done')
        $.ui.toast('Devir iptal edildi.')

        return result
      }
      let prompt = lastFencedBlock(e.answer)
      if (prompt === undefined) {
        const last = (await $.session.messages()).filter(m => m.role === 'assistant').at(-1)
        prompt = last === undefined ? undefined : lastFencedBlock(last.text)
      }
      if (prompt === undefined) {
        await setPhase($, held.sid, 'done')
        $.ui.toast("Devir: devam prompt'u bulunamadı.")

        return result
      }
      await patchConv($, held.sid, { phase: 'awaiting_choice', prompt, bandHidden: false })
      if (settings.mode === 'otomatik') {
        const text = prompt
        later($, () => switchChat($, held.sid, text))
      }

      return result
    }

    const isCrossed = percent !== undefined && percent >= settings.threshold
    if (held.phase === 'done') {
      // Back to idle once the fill is under the threshold; while it is still
      // over, stay quiet instead of starting the same handoff again every turn.
      if (percent !== undefined && !isCrossed) await rearm($, held.sid)

      return result
    }
    const isDue =
      held.phase === 'warned' || (held.phase === 'idle' && settings.isEnabled && isCrossed)
    if (isDue && !e.isAborted && settings.isEnabled) {
      later($, () => startHandoff($, held.sid))
    }

    return result
  })

  on('command.run', { command: 'devir' }, async ($, e) => {
    const [verb = '', value] = e.args.trim().split(/\s+/)
    const settings = await readSettings($)
    const held = await currentConv($)

    switch (verb.toLowerCase()) {
      case 'esik': {
        const n = Number(value)
        if (!Number.isInteger(n) || n < 1 || n > 99) {
          return { text: 'Kullanım: /devir esik <1-99>' }
        }
        await $.store.set('esik', n)
        // A new threshold is a fresh start: a `warned` or `done` record re-arms.
        await rearm($, held.sid, true)
        await refreshStatus($)

        return { text: `Devir eşiği %${n} olarak ayarlandı.` }
      }
      case 'otomatik':
        await $.store.set('mod', 'otomatik')

        return { text: 'Devir modu: otomatik (sormadan geçer).' }
      case 'sor':
        await $.store.set('mod', 'sor')

        return { text: 'Devir modu: sor.' }
      case 'kapat':
        await $.store.set('acik', false)
        await refreshStatus($)

        return { text: 'Otomatik devir kapatıldı.' }
      case 'ac':
        await $.store.set('acik', true)
        await rearm($, held.sid)
        await refreshStatus($)

        return { text: 'Otomatik devir açıldı.' }
      case 'simdi':
        if (held.phase === 'handoff_running') return { text: 'Devir zaten çalışıyor.' }
        later($, () => startHandoff($, held.sid))

        return { text: 'Devir başlatılıyor.' }
      case 'gec': {
        // switchChat only runs from awaiting_choice: say so instead of
        // answering "geçiliyor" and then doing nothing (e.g. after `done`).
        if (held.phase === 'handoff_running') {
          return { text: "Devir hâlâ çalışıyor; devam prompt'u henüz hazır değil." }
        }
        if (held.phase !== 'awaiting_choice' || held.prompt === undefined) {
          return {
            text: `Geçilecek bekleyen devir yok (aşama: ${held.phase}). Yeni devir için: /devir simdi`,
          }
        }
        const text = held.prompt
        later($, () => switchChat($, held.sid, text))

        return { text: 'Yeni sohbete geçiliyor.' }
      }
      case '': {
        const percent = await contextPercent($)

        return {
          text: `${statusText(settings, percent)} · mod: ${settings.mode} · aşama: ${held.phase}`,
        }
      }
      default:
        return { text: 'Kullanım: /devir [esik <n> | otomatik | sor | simdi | kapat | ac | gec]' }
    }
  })

  // The question band: "Yeni sohbete geçeyim mi?" [Geç] [Bekle]
  //
  // The context indicator lives in the status line ($.ui.status: one line per
  // plugin, no contention); only this question uses the AbovePrompt band,
  // which every mod shares (ilerleme-cubugu draws there too, blast-radius /
  // Silme Kalkanı falls back to it in a narrow terminal).
  //
  // Coexistence contract: nothing to show -> return next(e) untouched;
  // otherwise this row FIRST, then the drawing of the plugins below (next(e)),
  // in a column Box, never swallowed. While a turn runs (isWorking) the row
  // stays hidden: a blast-radius hold is mid-turn and owns the keys then (its
  // own autoFocus, hotkeys 1/2); this question only matters once the handoff
  // turn has ended. Hotkeys are letters (g, b), so digits stay free for others.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.isWorking) return next(e)
    const held = await read($, conv)
    if (
      held === null ||
      held.phase !== 'awaiting_choice' ||
      held.bandHidden === true ||
      held.prompt === undefined
    ) {
      return next(e)
    }

    const below = await next(e)
    const { Box, Button, Text } = $.ui.resolve(e)
    const sid = held.sid
    const prompt = held.prompt

    return (
      <Box flexDirection="column">
        <Box key="devir">
          <Text>Yeni sohbete geçeyim mi? </Text>
          <Button
            key="gec"
            label="Geç"
            hotkey="g"
            variant="primary"
            autoFocus
            onPress={press => {
              later($, () => switchChat($, sid, prompt, press.surface))
            }}
          />
          <Text> </Text>
          <Button
            key="bekle"
            label="Bekle"
            hotkey="b"
            onPress={() => {
              void update($, conv, now =>
                now !== null && now.sid === sid ? { ...now, bandHidden: true } : now,
              )
            }}
          />
        </Box>
        {below ?? null}
      </Box>
    )
  })
}
