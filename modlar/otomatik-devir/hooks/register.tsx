import type { EngineInterface, Register } from 'claude-code'

import type { OtomatikDevirChat } from '../types'

// otomatik-devir v2: a single-chat handoff. Off by default; `/devir ac` turns it
// on for THIS chat. At the threshold the model is told to wind down and write a
// continuation prompt to a file; once a main turn ends with that file written
// and no sub-agent or background work running, the chat is compacted and the
// file's text submitted. It never opens a new chat, never blocks or vetoes
// anything, and on any error it logs to the debug log and does nothing.

const PLUGIN = 'otomatik-devir'
export const DEFAULT_THRESHOLD = 60
export const MIN_THRESHOLD = 20
export const MAX_THRESHOLD = 90
/** At or above this, Claude's own auto-compaction may come first: `/devir ac` warns. */
export const WARN_THRESHOLD = 80
/** After a handoff the next one needs the fill this many points over the lowest fill since. */
export const MIN_GAP = 15
/** A paused chat re-arms once the fill is this far under its threshold. */
export const REARM_MARGIN = 10
/** Re-sends of the wind-down message when a turn ends without the file. */
export const MAX_RESENDS = 1
/** Refused compactions per wind-down before it pauses. */
export const MAX_COMPACT_FAILS = 3
/** The light re-check while the wind-down waits on work. */
export const WAIT_TICK_MS = 45_000
/** Waiting on sub-agents longer than this pauses the handoff. */
export const MAX_WAIT_MS = 60 * 60_000
/** Background shells are waited on this long after the wind-down began, then ignored. */
export const SHELL_WAIT_MS = 10 * 60_000
/** Used continuation files kept per folder. */
export const KEEP_DONE = 3

const storeKey = (sid: string): string => `sohbet:${sid}`

/** `<session root>/.workflow/devir/<session id>.md` */
export const handoffFile = (root: string, sid: string): string =>
  `${root.replace(/\/+$/, '')}/.workflow/devir/${sid}.md`

const dirOf = (file: string): string => file.slice(0, file.lastIndexOf('/'))

// ---------------------------------------------------------------------------
// Texts the model reads (English) and the person reads (Turkish)
// ---------------------------------------------------------------------------

export const windDownText = (file: string): string =>
  'Context handoff point reached. Do not start new tasks or new sub-agents. Let running sub-agents/background work finish ' +
  "and handle their results. Update the project's state/progress files. Then write a complete, paste-ready continuation " +
  `prompt (use the my-skill-handoff skill if available) to the file ${file}. After writing it, end your turn.`

export const RESEND_PREFIX = 'Reminder (otomatik-devir): the continuation prompt file is still missing or empty. '

export const RESUME_NOTE =
  'otomatik-devir: the context handoff was cancelled or paused. Ignore the earlier handoff instruction (do not write the continuation prompt file) and continue the work normally; new tasks and sub-agents are allowed again.'

export const END_TURN_NOTE =
  'otomatik-devir: the continuation prompt file is written. If no sub-agent or background work is still running, end your turn now so the handoff can run.'

export const nudgeText = (file: string): string =>
  `otomatik-devir: the sub-agents/background work have finished. Handle their results, make sure the continuation prompt file ${file} is up to date, then end your turn.`

export const COMPACT_INSTRUCTIONS =
  'Automatic context handoff (otomatik-devir). Write a short but useful summary: the current task and goal, the paths of the plan/state/progress files, ' +
  'what was just done and the immediate next step. The full continuation prompt follows right after this compaction; do not reproduce it.'

export const CONTINUE_PREFIX =
  'Automatic continuation after a context handoff (otomatik-devir): the conversation was just compacted. Continue the work from the prompt below.'

export const continuationText = (text: string): string => `${CONTINUE_PREFIX}\n\n${text}`

export const USAGE = 'Kullanım: /devir [ac [eşik] | esik <20-90> | kapat | simdi]'
export const TOAST_DONE = 'Bağlam temizlendi, iş devam ediyor'
export const TOAST_MISSING = "Devir duraklatıldı: devam prompt'u dosyası yazılmadı. Yeniden denemek için /devir simdi."
export const TOAST_WAIT = 'Devir duraklatıldı: alt ajanlar 60 dakikadır bitmedi. Yeniden denemek için /devir simdi.'
export const TOAST_COMPACT = 'Devir duraklatıldı: sohbet sıkıştırılamadı. Yeniden denemek için /devir simdi.'
export const TOAST_DROPPED = 'Devir duraklatıldı: devir mesajı gönderilemedi. Yeniden denemek için /devir simdi.'
export const toastUndelivered = (file: string): string =>
  `Sohbet sıkıştırıldı ama devam prompt'u gönderilemedi. Dosya: ${file}. Göndermek için /devir simdi (ya da prompt kutusundakini gönderin).`
const WARN_HIGH = ` Uyarı: %${WARN_THRESHOLD} ve üstünde Claude'un kendi sıkıştırması önce gelebilir.`

// ---------------------------------------------------------------------------
// The chat record ($.store, keyed by session id: survives compaction, reloads, restarts)
// ---------------------------------------------------------------------------

type Chat = OtomatikDevirChat

const freshChat = (): Chat => ({ isOn: false, threshold: DEFAULT_THRESHOLD, phase: 'idle' })

const WIND_DOWN_RESET: Partial<Chat> = {
  startedAt: undefined,
  file: undefined,
  isDelivered: false,
  resends: 0,
  waitingSince: undefined,
  workSeenAt: undefined,
  isNudged: false,
  isEndReminded: false,
  compactFails: 0,
}

export const isThreshold = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= MIN_THRESHOLD && n <= MAX_THRESHOLD

const asChat = (value: unknown): Chat | undefined => {
  if (typeof value !== 'object' || value === null) return undefined
  const v = value as Partial<Chat>
  if (typeof v.isOn !== 'boolean') return undefined
  return {
    ...freshChat(),
    ...v,
    threshold: isThreshold(v.threshold) ? v.threshold : DEFAULT_THRESHOLD,
    phase: v.phase === 'winding' || v.phase === 'paused' ? v.phase : 'idle',
  }
}

const load = async ($: EngineInterface, sid: string): Promise<Chat | undefined> => asChat(await $.store.get(storeKey(sid)))

const save = async ($: EngineInterface, sid: string, patch: Partial<Chat>): Promise<Chat> => {
  const next: Chat = { ...((await load($, sid)) ?? freshChat()), ...patch }
  await $.store.set(storeKey(sid), next)
  return next
}

const parseThreshold = (raw: string | undefined): number | undefined => {
  if (raw === undefined || raw === '') return undefined
  const n = Number(raw.replace(/^%/, ''))
  return isThreshold(n) ? n : Number.NaN
}

// ---------------------------------------------------------------------------
// Module state (a reload starts it over; the record above is the truth)
// ---------------------------------------------------------------------------

type Work = { id: string; type: string; status: string }

let isTurnRunning = false
let lastTurnStartAt = 0
/** Background work the main loop's last Stop listed. */
let stopWork: readonly Work[] = []
/** The wind-down (its startedAt) whose delivery is claimed: one per wind-down (and per compaction). */
let deliveringFor: number | undefined
/** The wind-down whose "end your turn" reminder is claimed. */
let remindedFor: number | undefined
let isBeginning = false
let isFinishing = false
/** Bumped by `/devir kapat`: a finish that began before it does nothing more. */
let epoch = 0
/** The continuation while the mod's own compaction runs: the first prompt to enter carries it. */
let pending: { sid: string; text: string; isUsed: boolean } | undefined
let waitTimer: { cancel: () => void } | undefined
let emptyTicks = 0
let registeredSid: string | undefined

const debug = ($: EngineInterface, error: unknown): void => {
  try {
    $.ui.log(`${PLUGIN}: ${error instanceof Error ? error.message : String(error)}`, { to: 'debug' })
  } catch {
    // nothing else to do
  }
}

/** Work that must not run inside the dispatch the turn waits on. */
const later = ($: EngineInterface, work: () => Promise<void>): void => {
  $.clock.after(50, () => {
    work().catch(error => debug($, error))
  })
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

const isLive = (status: string): boolean => status === 'running' || status === 'pending'

/**
 * What the handoff waits on: sub-agents pending, running or waiting (a waiting
 * one still owes a result), workflows the last main Stop listed in flight, and
 * background shells for SHELL_WAIT_MS after the wind-down began.
 */
export const runningWork = async ($: EngineInterface, chat: Chat): Promise<string[]> => {
  const agents = (await $.agent.list()).filter(a => isLive(a.status) || a.status === 'waiting').map(a => a.id)
  const isShellWaited = (await $.clock.now()) - (chat.startedAt ?? 0) < SHELL_WAIT_MS
  const tasks = stopWork.filter(t => isLive(t.status) && (t.type === 'workflow' || (t.type === 'shell' && isShellWaited)))
  return [...agents, ...tasks.map(t => t.id)]
}

/** The handoff file's text when it was written after the wind-down began; else undefined. */
const readFresh = async ($: EngineInterface, file: string, since: number | undefined): Promise<string | undefined> => {
  try {
    const stat = await $.fs.stat(file)
    if (stat.kind !== 'file' || (since !== undefined && stat.mtimeMs < since - 1000)) return undefined
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

// ---------------------------------------------------------------------------
// Status line (Turkish), only where it is on
// ---------------------------------------------------------------------------

const statusText = (chat: Chat, percent: number | undefined): string => {
  if (chat.phase === 'winding') return chat.waitingSince === undefined ? 'Devir: işler bitiriliyor…' : 'Devir: alt ajanlar bekleniyor…'
  if (chat.undeliveredFile !== undefined) return "Devir: devam prompt'u gönderilemedi · /devir simdi"
  if (chat.phase === 'paused') return 'Devir duraklatıldı · /devir simdi'
  return `Devir açık · eşik %${chat.threshold} · şu an %${percent ?? 0}`
}

const refreshStatus = async ($: EngineInterface, percent?: number): Promise<void> => {
  const chat = await load($, await $.session.id())
  if (chat?.isOn !== true) return $.ui.status(undefined)
  $.ui.status(statusText(chat, percent ?? (await contextPercent($))))
}

// ---------------------------------------------------------------------------
// Wind-down, delivery, finish
// ---------------------------------------------------------------------------

const stopWaitTimer = (): void => {
  waitTimer?.cancel()
  waitTimer = undefined
  emptyTicks = 0
}

/** Tells the model, once, that the handoff no longer stands (as a prompt; a running turn hears it at a tool result). */
const submitResumeNote = async ($: EngineInterface, sid: string): Promise<void> => {
  if ((await load($, sid))?.isResumeNoteDue !== true) return
  await save($, sid, { isResumeNoteDue: false })
  await $.prompt.submit({ text: RESUME_NOTE })
}

const pause = async ($: EngineInterface, sid: string, toast: string, extra: Partial<Chat> = {}): Promise<void> => {
  stopWaitTimer()
  const chat = await load($, sid)
  const isNoteDue = chat?.phase === 'winding' && chat.isDelivered === true
  await save($, sid, { phase: 'paused', ...WIND_DOWN_RESET, isResumeNoteDue: isNoteDue, ...extra })
  $.ui.toast(toast, { timeoutMs: 10_000 })
  await refreshStatus($)
  if (isNoteDue && !isTurnRunning) later($, () => submitResumeNote($, sid))
}

/** Submits the wind-down message as a prompt (it runs once the session is idle). */
const submitWindDown = async ($: EngineInterface, sid: string, isResend: boolean): Promise<void> => {
  const chat = await load($, sid)
  if (chat?.isOn !== true || chat.phase !== 'winding') return
  // A turn started meanwhile and a tool result already carried it.
  if (!isResend && (chat.isDelivered === true || deliveringFor === chat.startedAt)) return
  deliveringFor = chat.startedAt
  await save($, sid, { isDelivered: true, resends: (chat.resends ?? 0) + (isResend ? 1 : 0) })
  const text = windDownText(await fileOf($, sid, chat))
  const got = await $.prompt.submit({ text: isResend ? RESEND_PREFIX + text : text })
  if (got.drop !== undefined) {
    await save($, sid, { isDelivered: false })
    await pause($, sid, TOAST_DROPPED)
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
    await save($, sid, { phase: 'winding', ...WIND_DOWN_RESET, startedAt: await $.clock.now(), file, undeliveredFile: undefined })
    try {
      await $.fs.write(`${dirOf(file)}/.gitignore`, '*\n')
    } catch (error) {
      debug($, error)
    }
    $.ui.toast("Devir başladı: süren işler bitiriliyor, devam prompt'u yazılacak.")
    await refreshStatus($)
    if (!isTurnRunning) later($, () => submitWindDown($, sid, false))
  } finally {
    isBeginning = false
  }
}

/** Idle at max(threshold, floor + gap): begin. A paused chat re-arms well under its threshold. */
const checkThreshold = async ($: EngineInterface, sid: string, given?: number): Promise<void> => {
  const chat = await load($, sid)
  if (chat?.isOn !== true || chat.phase === 'winding' || isBeginning) return
  const percent = given ?? (await contextPercent($))
  if (percent === undefined) return
  if (chat.floor !== undefined && percent < chat.floor) await save($, sid, { floor: percent })
  if (chat.phase === 'paused') {
    if (chat.undeliveredFile === undefined && percent < chat.threshold - REARM_MARGIN) await save($, sid, { phase: 'idle' })
    return
  }
  const floor = Math.min(chat.floor ?? Number.NEGATIVE_INFINITY, percent)
  if (percent >= Math.max(chat.threshold, floor + MIN_GAP)) await beginWindDown($, sid)
}

/** What a main-loop tool result carries for the model, if anything. */
const midTurnNote = async ($: EngineInterface, sid: string): Promise<string | undefined> => {
  let chat = await load($, sid)
  if (chat === undefined) return undefined
  if (chat.isResumeNoteDue === true) {
    await save($, sid, { isResumeNoteDue: false })
    return RESUME_NOTE
  }
  if (!chat.isOn) return undefined
  await checkThreshold($, sid)
  chat = await load($, sid)
  if (chat?.phase !== 'winding' || chat.startedAt === undefined) return undefined
  const startedAt = chat.startedAt
  if (chat.isDelivered !== true) {
    if (deliveringFor === startedAt) return undefined
    deliveringFor = startedAt
    await save($, sid, { isDelivered: true })
    return windDownText(await fileOf($, sid, chat))
  }
  // The file is written but the turn goes on: one reminder to end it.
  if (chat.isEndReminded === true || remindedFor === startedAt) return undefined
  if ((await readFresh($, await fileOf($, sid, chat), startedAt)) === undefined) return undefined
  if ((await runningWork($, chat)).length > 0 || remindedFor === startedAt) return undefined
  remindedFor = startedAt
  await save($, sid, { isEndReminded: true })
  return END_TURN_NOTE
}

/** Keeps the used file as `<sid>.done-<time>.md`, and only the newest KEEP_DONE of those. */
const archive = async ($: EngineInterface, file: string, text: string): Promise<void> => {
  const stamp = new Date(await $.clock.now()).toISOString().replace(/[:.]/g, '-')
  const done = file.replace(/\.md$/, `.done-${stamp}.md`)
  let isMoved = false
  try {
    isMoved = (await $.process.run(['mv', file, done])).exitCode === 0
  } catch (error) {
    debug($, error)
  }
  if (!isMoved) {
    await $.fs.write(done, text)
    await $.fs.write(file, '')
  }
  const dir = dirOf(file)
  const old = (await $.fs.list(dir))
    .filter(entry => /\.done-.+\.md$/.test(entry.name))
    .sort((a, b) => b.mtimeMs - a.mtimeMs || b.name.localeCompare(a.name))
    .slice(KEEP_DONE)
  if (old.length > 0) await $.process.run(['rm', '-f', ...old.map(entry => `${dir}/${entry.name}`)])
}

/** Compacts between turns, then submits the continuation prompt (unless a prompt that entered first carried it). */
const finish = async ($: EngineInterface, sid: string, text: string): Promise<void> => {
  if (isFinishing) return
  isFinishing = true
  const started = epoch
  try {
    stopWaitTimer()
    const chat = await load($, sid)
    if (chat?.isOn !== true || chat.phase !== 'winding') return
    const file = await fileOf($, sid, chat)
    const before = await contextPercent($).catch(() => undefined)
    pending = { sid, text, isUsed: false }
    let compacted: Awaited<ReturnType<EngineInterface['session']['compact']>>
    try {
      compacted = await $.session.compact({ instructions: COMPACT_INSTRUCTIONS })
    } catch (error) {
      // A turn started meanwhile: the next main turn end tries again (bounded).
      pending = undefined
      debug($, error)
      const fails = (chat.compactFails ?? 0) + 1
      if (fails >= MAX_COMPACT_FAILS) await pause($, sid, TOAST_COMPACT)
      else await save($, sid, { compactFails: fails })
      return
    }
    const isUsed = pending?.isUsed === true
    pending = undefined
    if (compacted.skip !== undefined) {
      debug($, `compaction skipped: ${compacted.skip}`)
      return pause($, sid, TOAST_COMPACT)
    }
    // `/devir kapat` during the compaction wins: nothing more.
    const now = await load($, sid)
    if (epoch !== started || now?.isOn !== true || now.phase !== 'winding') return
    await save($, sid, {
      phase: 'idle',
      ...WIND_DOWN_RESET,
      floor: before ?? now.threshold,
      handoffs: (now.handoffs ?? 0) + 1,
    })
    if (!isUsed) {
      const got = await $.prompt.submit({ text: continuationText(text), asUser: true }).catch(error => {
        debug($, error)
        return { drop: 'rejected' }
      })
      if (got.drop !== undefined) {
        await save($, sid, { phase: 'paused', undeliveredFile: file })
        await $.prompt.fill({ text: continuationText(text) }).catch(error => debug($, error))
        $.ui.toast(toastUndelivered(file), { timeoutMs: 20_000 })
        return refreshStatus($)
      }
    }
    await archive($, file, text).catch(error => debug($, error))
    $.ui.toast(TOAST_DONE, { timeoutMs: 8000 })
    await refreshStatus($)
  } finally {
    isFinishing = false
  }
}

/** The light re-check while the wind-down waits on work. It never compacts: it gives the model a turn. */
const waitTick = async ($: EngineInterface, sid: string): Promise<void> => {
  const chat = await load($, sid)
  if (chat?.isOn !== true || chat.phase !== 'winding') return stopWaitTimer()
  const now = await $.clock.now()
  if (chat.waitingSince !== undefined && now - chat.waitingSince >= MAX_WAIT_MS) return pause($, sid, TOAST_WAIT)
  if ((await runningWork($, chat)).length > 0) {
    emptyTicks = 0
    await save($, sid, { workSeenAt: now })
    return
  }
  if (isTurnRunning || isFinishing) {
    emptyTicks = 0
    return
  }
  emptyTicks += 1
  // The work ended and no turn picked its results up: ask for one (once).
  if (emptyTicks < 2) return
  stopWaitTimer()
  if (chat.isNudged === true) return
  await save($, sid, { isNudged: true })
  await $.prompt.submit({ text: nudgeText(await fileOf($, sid, chat)) })
}

const startWaitTimer = ($: EngineInterface, sid: string): void => {
  if (waitTimer !== undefined) return
  waitTimer = $.clock.every(WAIT_TICK_MS, () => {
    waitTick($, sid).catch(error => debug($, error))
  })
}

/** After a main turn ended: deliver, wait, re-send, pause or finish. */
const afterTurn = async ($: EngineInterface, isAborted: boolean): Promise<void> => {
  const sid = await $.session.id()
  const chat = await load($, sid)
  if (chat?.isOn !== true) return
  if (chat.phase !== 'winding') return checkThreshold($, sid)
  if (isAborted || isTurnRunning) return
  if (chat.isDelivered !== true) return submitWindDown($, sid, false)
  const text = await readFresh($, await fileOf($, sid, chat), chat.startedAt)
  const now = await $.clock.now()
  if ((await runningWork($, chat)).length > 0) {
    await save($, sid, { workSeenAt: now, waitingSince: chat.waitingSince ?? now })
    await refreshStatus($)
    return startWaitTimer($, sid)
  }
  // Work was seen after this turn began: its results may not be handled yet.
  if (chat.workSeenAt !== undefined && chat.workSeenAt >= lastTurnStartAt) return startWaitTimer($, sid)
  if (text !== undefined) return finish($, sid, text)
  if ((chat.resends ?? 0) < MAX_RESENDS) return submitWindDown($, sid, true)
  await pause($, sid, TOAST_MISSING)
}

// ---------------------------------------------------------------------------
// /devir
// ---------------------------------------------------------------------------

const PHASE_TR: Record<Chat['phase'], string> = {
  idle: 'izleniyor',
  winding: 'işler bitiriliyor',
  paused: 'duraklatıldı (/devir simdi ile yeniden dene)',
}

/** `/devir simdi` after a continuation could not be submitted: send it now. */
const resendContinuation = async ($: EngineInterface, sid: string, file: string): Promise<string> => {
  const text = await readFresh($, file, undefined)
  await save($, sid, { phase: 'idle', undeliveredFile: undefined })
  if (text === undefined) return `Devam prompt'u dosyası bulunamadı: ${file}`
  const got = await $.prompt.submit({ text: continuationText(text), asUser: true })
  if (got.drop !== undefined) {
    await save($, sid, { phase: 'paused', undeliveredFile: file })
    return `Devam prompt'u yine gönderilemedi. Dosya: ${file}`
  }
  await archive($, file, text).catch(error => debug($, error))
  await refreshStatus($)
  return "Devam prompt'u gönderildi."
}

const devirCommand = async ($: EngineInterface, args: string): Promise<string> => {
  const [verb = '', value] = args.trim().split(/\s+/)
  const sid = await $.session.id()
  const chat = (await load($, sid)) ?? freshChat()
  const percent = await contextPercent($).catch(() => undefined)
  const warn = (n: number): string => (n >= WARN_THRESHOLD ? WARN_HIGH : '')

  switch (verb.toLowerCase()) {
    case '': {
      if (!chat.isOn) return `Devir bu sohbette kapalı (şu an %${percent ?? 0}). Açmak için: /devir ac [eşik]`
      const wait = chat.phase === 'winding' && chat.waitingSince !== undefined ? ' · alt ajanlar bekleniyor' : ''
      const file = chat.phase === 'winding' ? ` · dosya: ${await fileOf($, sid, chat)}` : ''
      return `Devir açık · eşik %${chat.threshold} · şu an %${percent ?? 0} · aşama: ${PHASE_TR[chat.phase]}${wait}${file}`
    }
    case 'ac':
    case 'aç': {
      const n = parseThreshold(value)
      if (Number.isNaN(n)) return `Eşik ${MIN_THRESHOLD}-${MAX_THRESHOLD} arasında bir tam sayı olmalı. ${USAGE}`
      const threshold = n ?? chat.threshold
      await save($, sid, { isOn: true, threshold, ...(chat.phase === 'paused' && !chat.undeliveredFile ? { phase: 'idle' } : {}) })
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
      return (chat.isOn ? `Bu sohbetin devir eşiği %${n}.` : `Bu sohbetin devir eşiği %${n} (devir kapalı; açmak için /devir ac).`) + warn(n)
    }
    case 'kapat': {
      epoch += 1
      pending = undefined
      stopWaitTimer()
      const wasWinding = chat.phase === 'winding'
      await save($, sid, {
        isOn: false,
        phase: 'idle',
        ...WIND_DOWN_RESET,
        undeliveredFile: undefined,
        isResumeNoteDue: wasWinding && chat.isDelivered === true,
      })
      if (chat.isOn) $.ui.toast('Devir kapatıldı')
      $.ui.status(undefined)
      return wasWinding ? 'Devir bu sohbette kapatıldı; süren devir iptal edildi.' : 'Devir bu sohbette kapatıldı.'
    }
    case 'simdi':
    case 'şimdi': {
      if (!chat.isOn) return 'Devir bu sohbette kapalı. Önce: /devir ac [eşik]'
      if (chat.undeliveredFile !== undefined) {
        // A command hook may not submit (it would wait on itself): right after it.
        const file = chat.undeliveredFile
        later($, async () => $.ui.toast(await resendContinuation($, sid, file)))
        return "Devam prompt'u gönderiliyor."
      }
      if (chat.phase === 'winding') return 'Devir zaten sürüyor: işler bitiriliyor.'
      await beginWindDown($, sid)
      return "Devir başlatıldı: süren işler bitirilecek, devam prompt'u yazılınca sohbet sıkıştırılıp iş sürecek."
    }
    default:
      return USAGE
  }
}

// ---------------------------------------------------------------------------
// Hooks
// ---------------------------------------------------------------------------

const resetModule = (): void => {
  isTurnRunning = false
  stopWork = []
  deliveringFor = undefined
  remindedFor = undefined
  pending = undefined
  stopWaitTimer()
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    resetModule()
    registeredSid = undefined
    try {
      await ensureCommand($)
      await refreshStatus($)
      const sid = await $.session.id()
      const chat = await load($, sid)
      if (chat?.isOn === true && chat.phase === 'winding' && chat.waitingSince !== undefined) startWaitTimer($, sid)
    } catch (error) {
      debug($, error)
    }
    return next(e)
  })

  // A /clear ends the session (no session.start follows): drop its line and timers.
  on('session.end', async ($, e, next) => {
    resetModule()
    try {
      $.ui.status(undefined)
    } catch (error) {
      debug($, error)
    }
    return next(e)
  })

  on('session.measure', async ($, e, next) => {
    const result = await next(e)
    try {
      await ensureCommand($)
      const sid = await $.session.id()
      if ((await load($, sid))?.isOn === true) {
        await checkThreshold($, sid, e.context.percent)
        await refreshStatus($, e.context.percent)
      }
    } catch (error) {
      debug($, error)
    }
    return result
  })

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined) {
      isTurnRunning = true
      try {
        lastTurnStartAt = await $.clock.now()
        await ensureCommand($)
      } catch (error) {
        debug($, error)
      }
    }
    return next(e)
  })

  // Records the main loop's in-flight background work; never blocks.
  on('classic.Stop', async ($, e, next) => {
    if (e.agent_id === undefined) stopWork = e.background_tasks ?? []
    return next(e)
  }).catch(($, e, next) => next(e))

  // The main turn's end: subagents' turns are ignored; the work runs after the turn settled.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    isTurnRunning = false
    later($, () => afterTurn($, e.isAborted))
    return result
  })

  // Claude's own (or the person's) compaction during a wind-down drops the
  // message: the next main tool result carries it again. Observes only.
  on('session.compact', async ($, e, next) => {
    const result = await next(e)
    try {
      if (e.agentId === undefined && e.trigger !== 'plugin' && e.trigger !== 'precompute' && result.skip === undefined) {
        const sid = await $.session.id()
        const chat = await load($, sid)
        if (chat?.isOn === true && chat.phase === 'winding' && chat.isDelivered === true) {
          deliveringFor = undefined
          remindedFor = undefined
          await save($, sid, { isDelivered: false, isEndReminded: false })
          if (!isTurnRunning) later($, () => submitWindDown($, sid, false))
        }
      }
    } catch (error) {
      debug($, error)
    }
    return result
  }).catch(($, e, next) => next(e))

  // The mid-turn channel: a main-loop tool result's `context` is read by the
  // model right after that result, inside the running turn.
  on('tool.call', async ($, e, next) => {
    const result = await next(e)
    try {
      if (next.origin.plugin !== 'engine' || e.agentId !== undefined || result.deny !== undefined) return result
      isTurnRunning = true
      const note = await midTurnNote($, await $.session.id())
      if (note === undefined) return result
      return { ...result, context: [...(result.context ?? []), note] } as typeof result
    } catch (error) {
      debug($, error)
      return result
    }
  }).catch(($, e, next) => next(e))

  // The first prompt to enter while the mod's compaction runs carries the
  // continuation; a due resume note rides on the next prompt too.
  on('prompt.submit', async ($, e, next) => {
    const context: string[] = []
    try {
      const isOwn = e.origin.kind === 'plugin' && e.origin.name === PLUGIN
      const sid = await $.session.id()
      if (!isOwn && e.command === undefined) {
        if (pending !== undefined && !pending.isUsed && pending.sid === sid) {
          pending.isUsed = true
          context.push(continuationText(pending.text))
        }
        const chat = await load($, sid)
        if (chat?.isResumeNoteDue === true) {
          await save($, sid, { isResumeNoteDue: false })
          context.push(RESUME_NOTE)
        }
        if (chat?.undeliveredFile !== undefined && e.text.startsWith(CONTINUE_PREFIX)) {
          await save($, sid, { phase: 'idle', undeliveredFile: undefined })
        }
      }
    } catch (error) {
      debug($, error)
    }
    return next(context.length === 0 ? e : { ...e, context: [...(e.context ?? []), ...context] })
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
