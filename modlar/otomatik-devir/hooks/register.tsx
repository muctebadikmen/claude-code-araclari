import type { EngineInterface, Register } from 'claude-code'

import type { OtomatikDevirChat } from '../types'

// otomatik-devir v2: a single-chat handoff. Off by default; `/devir ac` turns it
// on for THIS chat. At the threshold the model is told to wind down and write a
// continuation prompt to a file; once the file is written (after the latest
// delivery) the main turn's end compacts the chat and submits the file's text.
// Background agents and shells are not tracked: they live in the same process
// and report after the compaction. It never opens a new chat, never blocks or
// vetoes anything, and on any error it logs to the debug log and does nothing.

const PLUGIN = 'otomatik-devir'
export const DEFAULT_THRESHOLD = 60
export const MIN_THRESHOLD = 20
export const MAX_THRESHOLD = 90
export const WARN_THRESHOLD = 80 // at or above: Claude's own auto-compaction may come first
export const MIN_GAP = 15 // after a handoff or give-up: the next needs floor + MIN_GAP too
export const REDELIVER_STEP = 10 // mid-turn re-delivery when the fill moved this far since the last
export const MAX_DELIVERIES = 3 // deliveries per wind-down inside running turns
export const MAX_RESENDS = 1 // prompt re-sends when a turn ended without the file
export const END_NOTE_TOOLS = 3 // after the "end your turn" note: this many main tool results...
export const END_NOTE_MS = 10 * 60_000 // ...or this long, then the mod aborts the turn
export const MAX_COMPACT_FAILS = 3
export const COMPACT_RETRY_MS = 30_000 // an idle compaction failure retries after this × failures
export const ABORT_WAIT_MS = 5000 // after the mod's abort: re-check for its turn end this often...
export const ABORT_CHECKS = 6 // ...this many times, then drive the handoff itself
export const KEEP_DONE = 3 // used continuation files kept per folder

const storeKey = (sid: string): string => `sohbet:${sid}`

/** `<session root>/.workflow/devir/<session id>.md` */
export const handoffFile = (root: string, sid: string): string =>
  `${root.replace(/\/+$/, '')}/.workflow/devir/${sid}.md`

const dirOf = (file: string): string => file.slice(0, file.lastIndexOf('/'))

// Texts the model reads (English) and the person reads (Turkish).

export const windDownText = (file: string): string =>
  "Context handoff point reached. Do not start new tasks or new sub-agents. Update the project's state/progress files. " +
  'Then write a complete, paste-ready continuation prompt (use the my-skill-handoff skill if available) to the file ' +
  `${file}; list any sub-agents or background work still running in it (their results arrive after the handoff). ` +
  'After writing it, end your turn. The conversation is then compacted in place and continues from that prompt.'

export const RESEND_PREFIX =
  'Reminder (otomatik-devir): the continuation prompt file is missing, empty or older than this request. '

export const RESUME_NOTE =
  'otomatik-devir: the context handoff was cancelled. Ignore the earlier handoff instruction (do not write the continuation prompt file) and continue the work normally; new tasks and sub-agents are allowed again.'

export const END_TURN_NOTE =
  'otomatik-devir: the continuation prompt file is written. End your turn now so the handoff can run; do not start further work.'

export const COMPACT_INSTRUCTIONS =
  'Automatic context handoff (otomatik-devir). Write a short but useful summary: the current task and goal, the paths of the plan/state/progress files, ' +
  'what was just done and the immediate next step. The full continuation prompt follows right after this compaction; do not reproduce it.'

export const CONTINUE_PREFIX =
  'Automatic continuation after a context handoff (otomatik-devir): the conversation was just compacted. Continue the work from the prompt below.'

export const continuationText = (text: string): string => `${CONTINUE_PREFIX}\n\n${text}`

export const USAGE = 'Kullanım: /devir [ac [eşik] | esik <20-90> | kapat | simdi]'
export const TOAST_DONE = 'Bağlam temizlendi, iş devam ediyor'
export const TOAST_GAVE_UP =
  "Devir bu sefer olmadı (devam prompt'u yazılmadı ya da sohbet sıkıştırılamadı); iş sürüyor, eşik yeniden kuruldu."
export const toastUndelivered = (file: string): string =>
  `Sohbet sıkıştırıldı ama devam prompt'u gönderilemedi: prompt kutusuna kondu, göndermek için Enter. Dosya: ${file}`
const WARN_HIGH = ` Uyarı: %${WARN_THRESHOLD} ve üstünde Claude'un kendi sıkıştırması önce gelebilir.`

// The chat record ($.store, keyed by session id: survives compaction, reloads, restarts).

type Chat = OtomatikDevirChat

const freshChat = (): Chat => ({ isOn: false, threshold: DEFAULT_THRESHOLD, phase: 'idle' })

const WIND_DOWN_RESET: Partial<Chat> = { startedAt: undefined, file: undefined, deliveredAt: undefined, deliveredPercent: undefined }
const COUNTS_RESET: Partial<Chat> = { deliveries: 0, resends: 0, endNoteAt: undefined, toolsSinceEndNote: 0, compactFails: 0 }

export const isThreshold = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= MIN_THRESHOLD && n <= MAX_THRESHOLD

const asChat = (value: unknown): Chat | undefined => {
  if (typeof value !== 'object' || value === null || typeof (value as Chat).isOn !== 'boolean') return undefined
  const v = value as Chat
  const chat: Chat = { ...freshChat(), ...v, threshold: isThreshold(v.threshold) ? v.threshold : DEFAULT_THRESHOLD }
  // Older records: `paused` is idle now. A wind-down with no delivery on record (just
  // begun, or left by an older version) starts over: no file written before the next delivery counts.
  if (chat.phase !== 'winding') chat.phase = 'idle'
  else if (chat.deliveredAt === undefined) Object.assign(chat, COUNTS_RESET)
  return chat
}

const load = async ($: EngineInterface, sid: string): Promise<Chat | undefined> => asChat(await $.store.get(storeKey(sid)))

/** Every write is a load + merge + set, one at a time: a parallel write never brings back an older record. */
let saving: Promise<unknown> = Promise.resolve()
const save = ($: EngineInterface, sid: string, patch: Partial<Chat>): Promise<Chat> => {
  const run = saving.then(async () => {
    const next: Chat = { ...((await load($, sid)) ?? freshChat()), ...patch }
    await $.store.set(storeKey(sid), next)
    return next
  })
  saving = run.catch(() => undefined)
  return run
}

const parseThreshold = (raw: string | undefined): number | undefined => {
  if (raw === undefined || raw === '') return undefined
  const n = Number(raw.replace(/^%/, ''))
  return isThreshold(n) ? n : Number.NaN
}

// Module state (a reload starts it over; the record above is the truth).

// The main loop's running turn: set only by its turn.start and turn.step, cleared by its own turn.complete.
let isTurnRunning = false
let runningTurnId: string | undefined
let endedTurnId: string | undefined // the latest main turn whose end was heard
let abortedTurnId: string | undefined // the turn the mod aborted: its end is the handoff, not an Esc
let claimed = new Set<string>() // claimed deliveries and end notes: parallel results deliver once
let isBeginning = false
let isFinishing = false
let epoch = 0 // bumped by `/devir kapat`: a finish begun before it does nothing more
/** The continuation while the mod's own compaction runs: the first prompt to enter carries it. */
let pending: { sid: string; text: string; isUsed: boolean; isHandedOver?: boolean } | undefined
let registeredSid: string | undefined

const claim = (key: string): boolean => !claimed.has(key) && claimed.add(key).has(key)

const debug = ($: EngineInterface, error: unknown): void => {
  try { $.ui.log(`${PLUGIN}: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' }) } catch { /* nothing else to do */ }
}

const safely = async ($: EngineInterface, work: () => Promise<unknown>): Promise<void> => {
  try {
    await work()
  } catch (error) {
    debug($, error)
  }
}

/** Work that must not run inside the dispatch the turn waits on. */
const later = ($: EngineInterface, work: () => Promise<unknown>, ms = 50): void => {
  $.clock.after(ms, () => void safely($, work))
}

const contextPercent = async ($: EngineInterface): Promise<number | undefined> => {
  const { context } = await $.session.usage()
  if (typeof context.percent === 'number') return context.percent
  if (typeof context.tokens === 'number' && context.window > 0) return Math.round((context.tokens / context.window) * 100)
  return undefined
}

/** The wind-down's own path once it began (a /cd or worktree move does not change it). */
const fileOf = async ($: EngineInterface, sid: string, chat?: Chat): Promise<string> =>
  chat?.file ?? handoffFile(await $.session.root(), sid)

/** The handoff file's text when written after `since` (the latest delivery); else undefined. */
const readFresh = async ($: EngineInterface, file: string, since: number | undefined): Promise<string | undefined> => {
  if (since === undefined) return undefined
  try {
    const stat = await $.fs.stat(file)
    if (stat.kind !== 'file' || stat.mtimeMs < since - 1000) return undefined
    const text = (await $.fs.read(file)).trim()
    return text === '' ? undefined : text
  } catch {
    return undefined
  }
}

const ensureCommand = async ($: EngineInterface): Promise<void> => {
  const sid = await $.session.id()
  if (registeredSid === sid) return
  registeredSid = sid
  await $.command.register({
    name: 'devir',
    description: 'Bu sohbette otomatik devir: durum, ac [eşik], esik <n>, kapat, simdi',
    argumentHint: '[ac [eşik] | esik <20-90> | kapat | simdi]',
    immediate: true,
  })
}

/** The status line (Turkish), only where it is on. */
const refreshStatus = async ($: EngineInterface, percent?: number): Promise<void> => {
  const chat = await load($, await $.session.id())
  if (chat?.isOn !== true) return $.ui.status(undefined)
  if (chat.phase === 'winding') return $.ui.status('Devir: işler bitiriliyor…')
  $.ui.status(`Devir açık · eşik %${chat.threshold} · şu an %${percent ?? (await contextPercent($)) ?? 0}`)
}

// Wind-down, delivery, finish.

/** Records one delivery of the wind-down message; false when a parallel caller took it. */
const claimDelivery = async ($: EngineInterface, sid: string, chat: Chat, extra: Partial<Chat> = {}): Promise<boolean> => {
  if (!claim(`${chat.startedAt}:${chat.deliveries ?? 0}`)) return false
  const percent = await contextPercent($).catch(() => undefined)
  await save($, sid, { deliveredAt: await $.clock.now(), deliveredPercent: percent, deliveries: (chat.deliveries ?? 0) + 1, ...extra })
  return true
}

/** Tells the model, once, that the handoff no longer stands (a running turn hears it at a tool result). */
const submitResumeNote = async ($: EngineInterface, sid: string): Promise<void> => {
  if ((await load($, sid))?.isResumeNoteDue !== true) return
  await save($, sid, { isResumeNoteDue: false })
  await $.prompt.submit({ text: RESUME_NOTE })
}

/** The wind-down did not work out: back to idle, re-armed above the current fill; the model resumes. */
const giveUp = async ($: EngineInterface, sid: string): Promise<void> => {
  const chat = await load($, sid)
  if (chat?.isOn !== true || chat.phase !== 'winding') return
  const percent = await contextPercent($).catch(() => undefined)
  const isNoteDue = chat.deliveredAt !== undefined
  await save($, sid, { phase: 'idle', ...WIND_DOWN_RESET, ...COUNTS_RESET, floor: percent ?? chat.threshold, isResumeNoteDue: isNoteDue })
  $.ui.toast(TOAST_GAVE_UP, { timeoutMs: 10_000 })
  await refreshStatus($)
  if (isNoteDue && !isTurnRunning) later($, () => submitResumeNote($, sid))
}

/** Submits the wind-down message as a prompt (it runs once the session is idle). */
const submitWindDown = async ($: EngineInterface, sid: string, isResend: boolean): Promise<void> => {
  const chat = await load($, sid)
  if (chat?.isOn !== true || chat.phase !== 'winding' || (!isResend && chat.deliveredAt !== undefined)) return
  if (!(await claimDelivery($, sid, chat, isResend ? { resends: (chat.resends ?? 0) + 1 } : {}))) return
  const text = windDownText(await fileOf($, sid, chat))
  const got = await $.prompt.submit({ text: isResend ? RESEND_PREFIX + text : text })
  if (got.drop !== undefined) {
    debug($, `wind-down prompt dropped: ${got.drop}`)
    await giveUp($, sid)
  }
}

/** Starts the wind-down: the message goes into the running turn, or as a prompt when idle. */
const beginWindDown = async ($: EngineInterface, sid: string): Promise<void> => {
  if (isBeginning) return
  isBeginning = true
  try {
    const chat = await load($, sid)
    if (chat?.isOn !== true || chat.phase === 'winding') return
    const file = handoffFile(await $.session.root(), sid)
    claimed.clear()
    await save($, sid, { phase: 'winding', ...WIND_DOWN_RESET, ...COUNTS_RESET, startedAt: await $.clock.now(), file, isResumeNoteDue: false })
    await safely($, () => $.fs.write(`${dirOf(file)}/.gitignore`, '*\n'))
    $.ui.toast("Devir başladı: iş toparlanıyor, devam prompt'u yazılacak.")
    await refreshStatus($)
    if (!isTurnRunning) later($, () => submitWindDown($, sid, false))
  } finally {
    isBeginning = false
  }
}

/** Idle at max(threshold, floor + gap): begin. */
const checkThreshold = async ($: EngineInterface, sid: string, given?: number): Promise<void> => {
  const chat = await load($, sid)
  if (chat?.isOn !== true || chat.phase !== 'idle' || isBeginning) return
  const percent = given ?? (await contextPercent($))
  if (percent === undefined) return
  if (chat.floor !== undefined && percent < chat.floor) await save($, sid, { floor: percent })
  const floor = Math.min(chat.floor ?? Number.NEGATIVE_INFINITY, percent)
  if (percent >= Math.max(chat.threshold, floor + MIN_GAP)) await beginWindDown($, sid)
}

/** Aborts the main turn that goes on past the end note; its end (turn.complete, isAborted) runs the handoff. */
const abortTurn = ($: EngineInterface, sid: string, turnId: string, started: number): void => {
  abortedTurnId = turnId
  const isCancelled = (): boolean => abortedTurnId !== turnId || epoch !== started // `/devir kapat` since
  later($, async () => {
    if (isCancelled()) return
    try {
      await $.turn.abort({ turnId })
    } catch (error) {
      abortedTurnId = undefined
      return debug($, error)
    }
    // An aborted run's end is heard (its turn.complete clears abortedTurnId). While the
    // turn still counts as running, check again; after ABORT_CHECKS, drive the handoff here.
    const check = async (tries: number): Promise<void> => {
      if (isCancelled()) return
      if (runningTurnId === turnId && tries < ABORT_CHECKS) return later($, () => check(tries + 1), ABORT_WAIT_MS)
      if (runningTurnId === turnId) {
        isTurnRunning = false
        runningTurnId = undefined
      } else if (runningTurnId !== undefined) return // another turn runs: its end hands off
      await afterTurn($, sid, false)
    }
    later($, () => check(1), ABORT_WAIT_MS)
  })
}

/** What a main-loop tool result carries for the model, at the tool boundary of a running turn. */
const midTurnNote = async ($: EngineInterface, sid: string): Promise<string | undefined> => {
  const started = epoch
  let chat = await load($, sid)
  if (chat === undefined) return undefined
  if (chat.isResumeNoteDue === true) {
    await save($, sid, { isResumeNoteDue: false })
    return RESUME_NOTE
  }
  if (!chat.isOn) return undefined
  await checkThreshold($, sid)
  chat = await load($, sid)
  if (chat?.phase !== 'winding') return undefined
  const file = await fileOf($, sid, chat)
  if ((await readFresh($, file, chat.deliveredAt)) === undefined) {
    // Not delivered yet, or the fill moved far since: more work (capped), or a compaction
    // dropped the message (a drop always re-delivers; it needs the fill to fall each time).
    const percent = await contextPercent($).catch(() => undefined)
    const last = chat.deliveredPercent
    if (chat.deliveredAt !== undefined && last === undefined && percent !== undefined) {
      await save($, sid, { deliveredPercent: percent }) // delivered while the fill was unknown: this is the baseline
      return undefined
    }
    const isMoved = percent !== undefined && last !== undefined && Math.abs(percent - last) >= REDELIVER_STEP
    const isDrop = isMoved && percent < last
    const isDue = chat.deliveredAt === undefined || isDrop || (isMoved && (chat.deliveries ?? 0) < MAX_DELIVERIES)
    return isDue && (await claimDelivery($, sid, chat)) ? windDownText(file) : undefined
  }
  // The file is written but the turn goes on: one note per turn, then the turn is ended for it.
  const now = await $.clock.now()
  if (chat.endNoteAt === undefined) {
    if (!claim(`end:${chat.deliveredAt}:${runningTurnId}`)) return undefined
    await save($, sid, { endNoteAt: now, toolsSinceEndNote: 0 })
    return END_TURN_NOTE
  }
  const tools = (chat.toolsSinceEndNote ?? 0) + 1
  await save($, sid, { toolsSinceEndNote: tools })
  const isOverdue = tools >= END_NOTE_TOOLS || now - chat.endNoteAt >= END_NOTE_MS
  if (isOverdue && runningTurnId !== undefined && abortedTurnId !== runningTurnId) abortTurn($, sid, runningTurnId, started)
  return undefined
}

/** Keeps the used file as `<sid>.done-<time>.md`, and only the newest KEEP_DONE of those. */
const archive = async ($: EngineInterface, file: string, text: string): Promise<void> => {
  const stamp = new Date(await $.clock.now()).toISOString().replace(/[:.]/g, '-')
  const done = file.replace(/\.md$/, `.done-${stamp}.md`)
  const isMoved = await $.process.run(['mv', file, done]).then(r => r.exitCode === 0, () => false)
  if (!isMoved) await $.fs.write(done, text).then(() => $.fs.write(file, ''))
  const dir = dirOf(file)
  const old = (await $.fs.list(dir))
    .filter(entry => /\.done-.+\.md$/.test(entry.name))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
    .slice(KEEP_DONE)
  if (old.length > 0) await $.process.run(['rm', '-f', ...old.map(entry => `${dir}/${entry.name}`)])
}

/** Compacts between turns, then submits the continuation (unless a prompt that entered first carried it). */
const finish = async ($: EngineInterface, sid: string, text: string): Promise<void> => {
  if (isFinishing) return
  isFinishing = true
  const started = epoch
  try {
    const chat = await load($, sid)
    if (chat?.isOn !== true || chat.phase !== 'winding') return
    const file = await fileOf($, sid, chat)
    const before = await contextPercent($).catch(() => undefined)
    pending = { sid, text, isUsed: false }
    // `/compact` run as if typed: `$.session.compact` is refused in the desktop app's
    // SDK sessions ("not available in a headless (-p / SDK) session"); the command works there.
    try {
      await $.command.run({ command: 'compact', args: COMPACT_INSTRUCTIONS })
    } catch (error) {
      pending = undefined
      debug($, error)
      if (isTurnRunning) return // a turn started meanwhile: its end tries again, not counted
      // Failed while idle (the summary request erred): retry after a wait, bounded, then give up.
      const fails = ((await load($, sid))?.compactFails ?? 0) + 1
      if (fails >= MAX_COMPACT_FAILS) return giveUp($, sid)
      await save($, sid, { compactFails: fails })
      return later($, () => afterTurn($, sid, false), COMPACT_RETRY_MS * fails)
    }
    const handed = pending
    pending = undefined
    const isUsed = handed?.isUsed === true
    // `/devir kapat` during the compaction wins: nothing more.
    const now = await load($, sid)
    if (epoch !== started || now?.isOn !== true || now.phase !== 'winding') return
    await save($, sid, { phase: 'idle', ...WIND_DOWN_RESET, ...COUNTS_RESET, floor: before ?? now.threshold, handoffs: (now.handoffs ?? 0) + 1 })
    if (handed !== undefined) handed.isHandedOver = isUsed // a prompt carrying it that is dropped later re-sends it
    if (!isUsed) {
      const got = await $.prompt.submit({ text: continuationText(text), asUser: true }).catch(error => {
        debug($, error)
        return { drop: 'rejected' }
      })
      if (got.drop !== undefined) {
        // The file stays where it is; the person sends it from the prompt box.
        await safely($, () => $.prompt.fill({ text: continuationText(text) }))
        return $.ui.toast(toastUndelivered(file), { timeoutMs: 30_000 })
      }
    }
    await safely($, () => archive($, file, text))
    $.ui.toast(TOAST_DONE, { timeoutMs: 8000 })
    await refreshStatus($)
  } finally {
    isFinishing = false
  }
}

/** After a main turn ended: hand off when the file is fresh, else re-send once, else give up. */
const afterTurn = async ($: EngineInterface, sid: string, isPersonAbort: boolean): Promise<void> => {
  const chat = await load($, sid)
  if (chat?.isOn !== true) return
  if (chat.phase !== 'winding') return checkThreshold($, sid)
  if (isPersonAbort || isTurnRunning) return
  if (chat.deliveredAt === undefined) return submitWindDown($, sid, false)
  const text = await readFresh($, await fileOf($, sid, chat), chat.deliveredAt)
  if (text !== undefined) return finish($, sid, text)
  if ((chat.resends ?? 0) < MAX_RESENDS) return submitWindDown($, sid, true)
  await giveUp($, sid)
}

// /devir

const devirCommand = async ($: EngineInterface, args: string): Promise<string> => {
  const [verb = '', value] = args.trim().split(/\s+/)
  const sid = await $.session.id()
  const chat = (await load($, sid)) ?? freshChat()
  const percent = await contextPercent($).catch(() => undefined)
  const warn = (n: number): string => (n >= WARN_THRESHOLD ? WARN_HIGH : '')

  switch (verb.toLowerCase()) {
    case '': {
      if (!chat.isOn) return `Devir bu sohbette kapalı (şu an %${percent ?? 0}). Açmak için: /devir ac [eşik]`
      const phase = chat.phase === 'winding' ? `işler bitiriliyor · dosya: ${await fileOf($, sid, chat)}` : 'izleniyor'
      return `Devir açık · eşik %${chat.threshold} · şu an %${percent ?? 0} · aşama: ${phase}`
    }
    case 'ac':
    case 'aç': {
      const n = parseThreshold(value)
      if (Number.isNaN(n)) return `Eşik ${MIN_THRESHOLD}-${MAX_THRESHOLD} arasında bir tam sayı olmalı. ${USAGE}`
      const threshold = n ?? chat.threshold
      await save($, sid, { isOn: true, threshold })
      if (!chat.isOn) $.ui.toast(`Devir açıldı (eşik %${threshold})`)
      await refreshStatus($, percent)
      return `Devir bu sohbette açık · eşik %${threshold} · şu an %${percent ?? 0}. Kapatmak için: /devir kapat${warn(threshold)}`
    }
    case 'esik':
    case 'eşik': {
      const n = parseThreshold(value)
      if (n === undefined || Number.isNaN(n)) return `Kullanım: /devir esik <${MIN_THRESHOLD}-${MAX_THRESHOLD}>`
      await save($, sid, { threshold: n })
      await refreshStatus($, percent)
      const off = chat.isOn ? '' : ' (devir kapalı; açmak için /devir ac)'
      return `Bu sohbetin devir eşiği %${n}${off}.${warn(n)}`
    }
    case 'kapat': {
      epoch += 1
      pending = undefined
      abortedTurnId = undefined
      const wasWinding = chat.phase === 'winding'
      const isNoteDue = wasWinding && chat.deliveredAt !== undefined
      await save($, sid, { isOn: false, phase: 'idle', ...WIND_DOWN_RESET, ...COUNTS_RESET, isResumeNoteDue: isNoteDue })
      if (chat.isOn) $.ui.toast('Devir kapatıldı')
      $.ui.status(undefined)
      return wasWinding ? 'Devir bu sohbette kapatıldı; süren devir iptal edildi.' : 'Devir bu sohbette kapatıldı.'
    }
    case 'simdi':
    case 'şimdi': {
      if (!chat.isOn) return 'Devir bu sohbette kapalı. Önce: /devir ac [eşik]'
      if (chat.phase === 'winding') return 'Devir zaten sürüyor: işler bitiriliyor.'
      await beginWindDown($, sid)
      return "Devir başlatıldı: devam prompt'u yazılınca sohbet sıkıştırılıp iş aynı sohbette sürecek."
    }
    default:
      return USAGE
  }
}

// Hooks.

const resetModule = (): void => {
  isTurnRunning = false
  runningTurnId = undefined
  endedTurnId = undefined
  abortedTurnId = undefined
  claimed = new Set()
  pending = undefined
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    resetModule()
    registeredSid = undefined
    await safely($, async () => {
      await ensureCommand($)
      await refreshStatus($)
    })
    return next(e)
  })

  // A /clear ends the session (no session.start follows): drop its line.
  on('session.end', async ($, e, next) => {
    resetModule()
    await safely($, async () => $.ui.status(undefined))
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    await safely($, async () => {
      await ensureCommand($)
      const sid = await $.session.id()
      if ((await load($, sid))?.isOn !== true) return
      await checkThreshold($, sid, e.context.percent)
      await refreshStatus($, e.context.percent)
    })
    return result
  })

  // A new main turn while winding gets its own end note and count (an Esc'd turn's do not carry over).
  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      isTurnRunning = true
      runningTurnId = e.turnId
      await safely($, async () => {
        await ensureCommand($)
        const sid = await $.session.id()
        const chat = await load($, sid)
        if (chat?.phase === 'winding' && chat.endNoteAt !== undefined) await save($, sid, { endNoteAt: undefined, toolsSinceEndNote: 0 })
      })
    }
    return next(e)
  })

  // Each model request of the main loop: the running turn is known even when the
  // mod (re)loaded inside it, after its turn.start.
  on('turn.step', async function* ($, e, next) {
    if (e.agentId === undefined && e.turnId !== endedTurnId) {
      isTurnRunning = true
      runningTurnId = e.turnId
    }
    return yield* next(e)
  })

  // The main turn's end (subagents' turns are ignored); the work runs after the turn settled.
  // A person's Esc does nothing; the mod's own abort is the handoff's turn end.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    endedTurnId = e.turnId
    if (runningTurnId === undefined || runningTurnId === e.turnId) {
      isTurnRunning = false // a late end of an older turn leaves the running one alone
      runningTurnId = undefined
    }
    const isOwnAbort = abortedTurnId !== undefined && abortedTurnId === e.turnId
    if (isOwnAbort) abortedTurnId = undefined
    later($, async () => afterTurn($, await $.session.id(), e.isAborted && !isOwnAbort))
    return result
  })

  // The mid-turn channel: a main-loop tool result's `context` is read by the
  // model right after that result, inside the running turn.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    try {
      if (next.origin.plugin !== 'engine' || e.agentId !== undefined || result.deny !== undefined) return result
      if (next.signal.aborted) return result // a call cut by an abort: its turn is over
      const note = await midTurnNote($, await $.session.id())
      return note === undefined ? result : ({ ...result, context: [...(result.context ?? []), note] } as typeof result)
    } catch (error) {
      debug($, error)
      return result
    }
  }).catch(($, e, next) => next(e))

  // The first prompt to enter while the mod's compaction runs carries the
  // continuation; a due resume note rides on the next prompt too. Both are
  // taken only for a prompt that enters: a dropped one hands them back.
  on('prompt.submit', async ($, e, next) => {
    const context: string[] = []
    let carried: typeof pending
    let sid = ''
    await safely($, async () => {
      if ((e.origin.kind === 'plugin' && e.origin.name === PLUGIN) || e.command !== undefined) return
      sid = await $.session.id()
      if (pending !== undefined && !pending.isUsed && pending.sid === sid) {
        carried = pending
        carried.isUsed = true // held while it enters, so a parallel prompt does not carry it too
        context.push(continuationText(carried.text))
      }
      const chat = await load($, sid)
      if (chat?.isResumeNoteDue === true) {
        await save($, sid, { isResumeNoteDue: false })
        context.push(RESUME_NOTE)
      }
    })
    const result = await next(context.length === 0 ? e : { ...e, context: [...(e.context ?? []), ...context] })
    if (result.drop !== undefined && context.length > 0) {
      await safely($, async () => {
        if (context.includes(RESUME_NOTE)) await save($, sid, { isResumeNoteDue: true })
        if (carried === undefined) return
        if (pending === carried) carried.isUsed = false // the mod's finish still submits it
        else if (carried.isHandedOver === true) later($, () => $.prompt.submit({ text: continuationText(carried!.text), asUser: true }))
      })
    }
    return result
  }).catch(($, e, next) => next(e))

  on('command.run', { command: 'devir' }, async ($, e) => {
    try {
      return { text: await devirCommand($, e.args) }
    } catch (error) {
      debug($, error)
      return { text: 'Devir: bir hata oldu (ayrıntı hata ayıklama günlüğünde).' }
    }
  })
}
