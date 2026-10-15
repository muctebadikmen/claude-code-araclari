import { atom, read, update } from 'claude-code'
import type {
  AgentInfo,
  EngineInterface,
  Register,
  RenderSurface,
  Timer,
  ToolCallArgs,
} from 'claude-code'

import type { OtomatikDevirConv, OtomatikDevirPhase } from '../types'

// ---------------------------------------------------------------------------
// Settings ($.store, across sessions) and the per-conversation record ($.state)
// ---------------------------------------------------------------------------

const conv = atom({ plugin: 'otomatik-devir', key: 'conv' } as const, null)

const SKILL = 'my-skill-handoff'
const DEFAULT_THRESHOLD = 60

// Claude desktop's session tools: the continuation runs in a new sibling chat.
const START_SESSION = 'mcp__ccd_session__start_session'
const TITLE_LIMIT = 59
const CONTINUE_SUFFIX = ' (devam)'
const CONTINUE_BACKGROUND =
  "Önceki sohbet bağlam eşiğine ulaştı; iş otomatik devirle bu yeni sohbete aktarıldı. Bu prompt, kaldığı yerden sürdürülecek iştir: önce onu oku, sonra devam et."

// Subagents in these states still owe the main loop a result.
const ACTIVE_AGENT: ReadonlySet<AgentInfo['status']> = new Set(['pending', 'running', 'waiting'])
const WATCH_MS = 5000

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
  `Bağlam %${threshold}${dative(threshold)} ulaştı. Yeni iş ve yeni subagent başlatma. Elindeki adımı güvenli bir noktada bitir (yarım dosya bırakma), çalışan subagent'ların bitmesini bekle, sonuçlarını işle ve dur. Devir notu (/${SKILL}) ardından otomatik başlatılacak.`

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
  // One handoff at a time, and only from idle or warned: the agent watcher and a
  // turn end racing cannot both start it, nor restart a done or awaiting one.
  // Clearing `grace` keeps the handoff turn's end from being eaten by the grace
  // branch of turn.complete.
  const isClaimed = await claim($, sid, held => held.phase === 'idle' || held.phase === 'warned', {
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

/**
 * `$.tool.call` for a tool the saved MCP typings may not declare yet (they list
 * the tools connected when the mod was last saved): the input goes through
 * loosely typed.
 */
const callTool = ($: EngineInterface, input: { tool: string } & Record<string, unknown>) =>
  $.tool.call(input as unknown as ToolCallArgs)

/** This chat's own desktop session: its id (local_...) and title, either unknown on failure. */
const selfSession = async ($: EngineInterface): Promise<{ id?: string; title?: string }> => {
  try {
    const got = await $.tool.call({ tool: 'mcp__ccd_session_mgmt__get_session', session_id: 'self' })
    if (got.deny !== undefined || got.isError === true || got.text === undefined) return {}
    const info = JSON.parse(got.text) as { sessionId?: unknown; title?: unknown }

    return {
      id: typeof info.sessionId === 'string' ? info.sessionId : undefined,
      title: typeof info.title === 'string' && info.title.trim() !== '' ? info.title.trim() : undefined,
    }
  } catch {
    return {}
  }
}

/** This chat's title + " (devam)", kept under 60 characters; "Devam" when unknown. */
const continueTitle = (title: string | undefined): string => {
  if (title === undefined) return 'Devam'
  const room = TITLE_LIMIT - CONTINUE_SUFFIX.length

  return `${title.slice(0, room).trimEnd()}${CONTINUE_SUFFIX}`
}

/** Moves a session this chat started to top level; a failure is only logged. */
const detachSession = async ($: EngineInterface, id: string): Promise<void> => {
  try {
    const detached = await $.tool.call({ tool: 'mcp__ccd_session_mgmt__detach_session', session_id: id })
    if (detached.deny !== undefined || detached.isError === true) {
      throw new Error(detached.deny ?? detached.text ?? 'detach failed')
    }
  } catch (error) {
    $.ui.log(`otomatik-devir: ${id} üst seviyeye taşınamadı: ${String(error)}`, { to: 'debug' })
  }
}

type SiblingChat =
  | { kind: 'started'; title: string }
  | { kind: 'proposed'; title: string; selfId?: string }

/**
 * Starts a new top-level sibling chat (Claude desktop) with the continuation
 * prompt. A turn the mod itself started counts as an automated event, where
 * the app refuses `user_asked`: then the chat is proposed as a card instead
 * (`own_initiative`), which the person starts with a click. Resolves undefined
 * when the session tools are missing; throws when neither call worked.
 */
const startSiblingChat = async (
  $: EngineInterface,
  prompt: string,
): Promise<SiblingChat | undefined> => {
  const tools = await $.tool.list().catch(() => [])
  if (!tools.some(tool => tool.name === START_SESSION)) return undefined
  const self = await selfSession($)
  const title = continueTitle(self.title)
  const ask = (initiation: 'user_asked' | 'own_initiative') =>
    callTool($, {
      tool: START_SESSION,
      initiation,
      context: 'fresh',
      title,
      prompt,
      background: CONTINUE_BACKGROUND,
      use_worktree: false,
    })

  const started = await ask('user_asked')
  const refusal = started.deny ?? (started.isError === true ? (started.text ?? '') : undefined)
  if (refusal === undefined) {
    const id = /session_id: (local_[A-Za-z0-9-]+)/.exec(started.text ?? '')?.[1]
    if (id === undefined) throw new Error(`start_session gave no session id: ${started.text ?? ''}`)
    // Started from this chat it nests under it: move it to top level.
    await detachSession($, id)

    return { kind: 'started', title }
  }
  if (!/own_initiative|Start sessions only/.test(refusal)) {
    throw new Error(`start_session refused: ${refusal}`)
  }

  const proposed = await ask('own_initiative')
  if (proposed.deny !== undefined) throw new Error(`start_session denied: ${proposed.deny}`)
  if (proposed.isError === true) throw new Error(`start_session failed: ${proposed.text ?? ''}`)
  const task = /task_id: (task_[A-Za-z0-9]+)/.exec(proposed.text ?? '')?.[1]
  if (task === undefined) throw new Error(`start_session gave no task id: ${proposed.text ?? ''}`)

  return { kind: 'proposed', title, selfId: self.id }
}

const PROPOSAL_WATCH_MS = 5000
const PROPOSAL_WATCH_LIMIT_MS = 2 * 60 * 60 * 1000

// One proposal watcher per loaded module.
let isWatchingProposal = false

/**
 * Waits (at most two hours) for the person to start the proposed card, then
 * moves that session to top level: the linked session with the card's title
 * that this chat started. Errors only log.
 */
const watchProposal = ($: EngineInterface, title: string, selfId: string): void => {
  if (isWatchingProposal) return
  isWatchingProposal = true
  let timer: Timer | undefined
  let isTicking = false
  let deadline: number | undefined
  const stop = (): void => {
    timer?.cancel()
    isWatchingProposal = false
  }
  const tick = async (): Promise<void> => {
    const now = await $.clock.now()
    deadline ??= now + PROPOSAL_WATCH_LIMIT_MS
    if (now > deadline) return stop()
    const listed = await $.tool.call({ tool: 'mcp__ccd_session_mgmt__list_sessions', linked: true })
    if (listed.deny !== undefined || listed.isError === true || listed.text === undefined) return
    const sessions: unknown = JSON.parse(listed.text)
    if (!Array.isArray(sessions)) return
    const found = (sessions as { sessionId?: unknown; title?: unknown; startedBy?: unknown }[]).find(
      session => session.title === title && session.startedBy === selfId,
    )
    if (found === undefined || typeof found.sessionId !== 'string') return
    stop()
    await detachSession($, found.sessionId)
  }
  timer = $.clock.every(PROPOSAL_WATCH_MS, () => {
    if (isTicking) return
    isTicking = true
    tick()
      .catch(error => $.ui.log(`otomatik-devir: kart izleme: ${String(error)}`, { to: 'debug' }))
      .finally(() => {
        isTicking = false
      })
  })
}

/**
 * Continues in a new sibling chat; this chat stays as it is (not cleared, not
 * archived). Without the session tools, or on failure: clipboard + toast.
 */
const switchChat = async (
  $: EngineInterface,
  sid: string,
  prompt: string,
  surface?: RenderSurface,
): Promise<void> => {
  // Only one switch per prompt: a double press of [Geç] (or Geç racing the
  // otomatik switch) must not start two chats.
  const isClaimed = await claim($, sid, held => held.phase === 'awaiting_choice', {
    phase: 'done',
  })
  if (!isClaimed) return
  let chat: SiblingChat | undefined
  try {
    chat = await startSiblingChat($, prompt)
  } catch (error) {
    $.ui.log(`otomatik-devir: yeni sohbet açılamadı: ${String(error)}`, { to: 'debug' })
  }
  if (chat?.kind === 'started') {
    $.ui.toast(`Devam yeni sohbette: ${chat.title}`, { timeoutMs: 15000 })
    await refreshStatus($).catch(() => undefined)

    return
  }
  if (chat?.kind === 'proposed') {
    await patchConv($, sid, { phase: 'done', proposalTitle: chat.title })
    $.ui.toast('Devam kartı hazır: karta tıklayınca yeni sohbet açılır.', { timeoutMs: 15000 })
    if (chat.selfId === undefined) {
      $.ui.log('otomatik-devir: oturum kimliği yok, kart izlenmiyor', { to: 'debug' })
    } else {
      watchProposal($, chat.title, chat.selfId)
    }
    await refreshStatus($).catch(() => undefined)

    return
  }
  const copied = await $.ui
    .copy(surface === undefined ? { text: prompt } : { text: prompt, surface })
    .catch(() => ({ isCopied: false as const }))
  $.ui.toast(
    copied.isCopied
      ? "Devam prompt'u panoya kopyalandı. Yeni sohbet açıp yapıştır."
      : "Yeni sohbete yapıştır: devam prompt'u aşağıda.",
    { timeoutMs: 15000 },
  )
  if (!copied.isCopied) $.ui.log(`Yeni sohbete yapıştır:\n${prompt}`)
  // No new chat: keep the prompt claimable so `/devir gec` can try again.
  const now = await $.session.id().catch(() => sid)
  if (now === sid) await patchConv($, sid, { phase: 'awaiting_choice', bandHidden: true })
}

/** Work that must not run inside the dispatch the turn waits on. */
const later = ($: EngineInterface, work: () => Promise<void>): void => {
  $.clock.after(50, () => {
    work().catch(error => $.ui.log(`otomatik-devir: ${String(error)}`, { to: 'debug' }))
  })
}

/** Subagents still running (or about to); fails open to none. */
const activeAgents = async ($: EngineInterface): Promise<AgentInfo[]> => {
  try {
    return (await $.agent.list()).filter(agent => ACTIVE_AGENT.has(agent.status))
  } catch (error) {
    $.ui.log(`otomatik-devir: ajan listesi okunamadı: ${String(error)}`, { to: 'debug' })

    return []
  }
}

// One agent watcher per loaded module, whatever number of turns ask for it.
let isWatching = false
// The main loop's turn is running (turn.start .. turn.complete): its end
// starts the handoff itself, so the watcher must not start it mid-turn.
let isTurnRunning = false

/**
 * Polls until no subagent is active, then starts the handoff, as long as the
 * record of `sid` still stands at `warned`. Stops when the phase leaves
 * `warned` or the conversation changes.
 */
const watchAgents = ($: EngineInterface, sid: string): void => {
  if (isWatching) return
  isWatching = true
  let timer: Timer | undefined
  let isTicking = false
  const stop = (): void => {
    timer?.cancel()
    isWatching = false
  }
  const tick = async (): Promise<void> => {
    const held = await read($, conv)
    if (held === null || held.sid !== sid || held.phase !== 'warned') return stop()
    if ((await $.session.id()) !== sid) return stop()
    const active = (await activeAgents($)).length
    if (active > 0) {
      $.ui.status(`Devir: ${active} subagent bekleniyor`)

      return
    }
    stop()
    if (!isTurnRunning) await startHandoff($, sid)
  }
  timer = $.clock.every(WATCH_MS, () => {
    if (isTicking) return
    isTicking = true
    tick()
      .catch(error => {
        stop()
        $.ui.log(`otomatik-devir: ajan bekleme durdu: ${String(error)}`, { to: 'debug' })
      })
      .finally(() => {
        isTicking = false
      })
  })
}

/**
 * Starts the handoff now, or, while subagents run, holds it at `warned` and
 * leaves it to the watcher. Resolves how many subagents it waits for.
 */
const handoffWhenIdle = async ($: EngineInterface, sid: string): Promise<number> => {
  const active = (await activeAgents($)).length
  if (active === 0) {
    later($, () => startHandoff($, sid))

    return 0
  }
  await claim($, sid, held => held.phase === 'idle', { phase: 'warned' })
  $.ui.status(`Devir: ${active} subagent bekleniyor`)
  if (!isWatching) {
    $.ui.toast(`Devir: ${active} subagent bitince başlayacak.`)
    watchAgents($, sid)
  }

  return active
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

  on('turn.start', async ($, e, next) => {
    if ((e as { agentId?: string }).agentId === undefined) isTurnRunning = true

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    isTurnRunning = false
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
      // Running subagents first: the handoff waits for their results.
      later($, async () => {
        await handoffWhenIdle($, held.sid)
      })
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
      case 'simdi': {
        if (held.phase === 'handoff_running') return { text: 'Devir zaten çalışıyor.' }
        // Asked for by hand: any other phase (done, awaiting_choice) re-arms to
        // warned, the one startHandoff and the agent watcher start from.
        await claim($, held.sid, now => now.phase !== 'handoff_running', { phase: 'warned' })
        const waiting = await handoffWhenIdle($, held.sid)

        return {
          text: waiting > 0 ? `${waiting} subagent bitince devir başlayacak.` : 'Devir başlatılıyor.',
        }
      }
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

  // The question band: "Devam prompt'u hazır. Yeni sohbet açayım mı?" [Geç] [Bekle]
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
          <Text>Devam prompt'u hazır. Yeni sohbet açayım mı? </Text>
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
