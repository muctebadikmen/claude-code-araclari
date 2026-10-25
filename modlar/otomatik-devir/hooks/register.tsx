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
const ACTIVE_AGENT: ReadonlySet<AgentInfo['status']> = new Set(['pending', 'running', 'waiting'])
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
/** The start_session step: in this turn, once, with the user's standing request named. */
const startStep = (prompt: string): string =>
  ` Devam prompt'u hazır olunca, turu bitirmeden, bu turun içinde ${START_SESSION} aracını bir kez çağır: initiation "user_asked", context "fresh", prompt = ${prompt}, background = bu sohbetin neden devredildiğini anlatan en az 80 karakter. Kullanıcı "/devir otomatik" ile eşikte sormadan yeni sohbete geçilmesini istedi; bu çağrı onun isteğidir. cwd, model, effort ve permission_mode verme: yeni sohbet bunları bu oturumdan alır. Çağrı reddedilirse yeniden deneme, own_initiative ya da proposal_id ile kart açma: ne yapacağını mod araç sonucunda söyler. Başarılı olunca bu sohbete yalnızca yeni sohbetin açıldığını söyleyen tek bir satır yaz.`
const DELETE_TASK = 'mcp__scheduled-tasks__delete_scheduled_task'
const LIST_TASKS = 'mcp__scheduled-tasks__list_scheduled_tasks'
const GET_SESSION = 'mcp__ccd_session_mgmt__get_session'
const OWN_TASK = /^otomatik-devir-[0-9a-f]{8}-(?:[1-9]\d*)?[ab]$/
const isOwnTask = (id: unknown): id is string => typeof id === 'string' && OWN_TASK.test(id)
type SelfSettings = { effort?: string; model?: string; permissionMode?: string }
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
    // v0.5 chain default: a run of the mod's own task is part of the chain,
    // otomatik whatever the store says (the off switch still holds).
    mode: mod === 'otomatik' || isChainRun ? 'otomatik' : 'sor',
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
/**
 * `$.tool.call` for a tool the saved MCP typings may not declare yet (they list
 * the tools connected when the mod was last saved): the input goes through
 * loosely typed.
 */
const callTool = ($: EngineInterface, input: { tool: string } & Record<string, unknown>) =>
  $.tool.call(input as unknown as ToolCallArgs)

type SelfSession = SelfSettings & { id?: string; title?: string; taskId?: string }

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

/**
 * This chat's own desktop session: its id (local_...), title, scheduled-task
 * linkage, effort, model and permission mode; each unknown on failure.
 */
const selfSession = async ($: EngineInterface): Promise<SelfSession> => {
  try {
    const got = await $.tool.call({ tool: GET_SESSION, session_id: 'self' })
    if (got.deny !== undefined || got.isError === true || got.text === undefined) return {}
    const info = JSON.parse(got.text) as Record<string, unknown>
    const linked = info.scheduledTask as { taskId?: unknown; id?: unknown } | undefined

    return {
      id: nonEmpty(info.sessionId),
      title: nonEmpty(info.title),
      taskId: nonEmpty(info.scheduledTaskId) ?? nonEmpty(linked?.taskId) ?? nonEmpty(linked?.id),
      effort: nonEmpty(info.effort),
      model: nonEmpty(info.model),
      permissionMode: nonEmpty(info.permissionMode),
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
/** The new session's id from a start_session result, when it started one. */
const startedId = (result: { deny?: string; isError?: boolean; text?: string }): string | undefined =>
  result.deny !== undefined || result.isError === true
    ? undefined
    : /\b(local_[A-Za-z0-9-]+)/.exec(result.text ?? '')?.[1]

/** Whether this surface has Claude desktop's start_session tool (none in a terminal). */
const hasStartTool = async ($: EngineInterface): Promise<boolean> =>
  (await $.tool.list().catch(() => [])).some(tool => tool.name === START_SESSION)
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
// The main loop's turn is running (turn.start .. turn.complete).
let isTurnRunning = false
// Since when no main turn has run (clock ms); undefined while one runs.
let idleSince: number | undefined
// One handoff guard per loaded module.
let isGuarding = false
// Who typed the running main turn. prompt.submit's `origin` (engine-stamped,
// a closed set) is read for the turn it starts and kept until that turn ends;
// a turn no prompt.submit of a person opened (a mod's own message, a task
// notification, a continuation) is not the person's.
let isPersonTurn = false
let isNextTurnPerson = false
let runningTurnId: string | undefined
// The main turn in which the model started this handoff's chat.
let startedInTurn: string | undefined
// What the gate (or the app's R1 refusal) said of the running main turn:
// true = start_session may run, false = it may not; undefined = not known,
// the prompt's origin stands in.
let gateOpen: boolean | undefined

/**
 * The person's own message: Enter at the terminal, the Remote Control bridge,
 * or the SDK host's turn (Claude desktop writes the person's composer message
 * to the engine as its SDK host). Every other origin is a machine's.
 */
const PERSON_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge', 'sdk'])

/** A person's own submission: a person origin, not one the engine marks isMeta (review H1). */
const isPersonSubmit = (e: { origin: { kind: string }; isMeta?: true }): boolean =>
  PERSON_ORIGINS.has(e.origin.kind) && e.isMeta !== true
/** Notes the continuation title and this chat's id for the model's start_session call. */
const noteSelf = async ($: EngineInterface, sid: string): Promise<void> => {
  const self = await selfSession($)
  await patchConv($, sid, {
    title: continueTitle(self.title),
    selfId: self.id,
    selfTaskId: self.taskId,
    effort: self.effort,
    model: self.model,
    permissionMode: self.permissionMode,
  })
}
type ToolNext = (input: ToolCallArgs) => Promise<{
  deny?: string
  isError?: true
  text?: string
  context?: readonly string[]
}>
const watchModelStart = async (
  $: EngineInterface,
  call: { tool: string } & Record<string, unknown>,
  next: ToolNext,
) => {
  const record = await read($, conv)
  const sid = await $.session.id()
  if (
    record !== null &&
    record.sid === sid &&
    record.phase === 'done' &&
    record.startedId !== undefined &&
    startedInTurn !== undefined &&
    startedInTurn === runningTurnId &&
    call.proposal_id === undefined
  ) {
    return { deny: `otomatik-devir: devam sohbeti bu turda zaten açıldı (${record.startedId}); ikinci kez açma.` }
  }
  const isStart = call.initiation !== 'own_initiative'
  if (isStart) {
    const isClaimed = await claim(
      $,
      sid,
      h => h.phase === 'handoff_running' && h.starting === undefined,
      { starting: runningTurnId ?? 'start' },
    )
    if (!isClaimed) {
      return { deny: 'otomatik-devir: devam sohbeti şu an açılıyor ya da açıldı; ikinci kez açma.' }
    }
  }
  const input: { tool: string } & Record<string, unknown> = { ...call }
  if (input.proposal_id === undefined) {
    input.context = 'fresh'
    if (input.title === undefined && held.title !== undefined) input.title = held.title
    if (typeof input.background !== 'string' || input.background.length < 80) {
      input.background = CONTINUE_BACKGROUND
    }
  }
  let result: Awaited<ReturnType<ToolNext>>
  try {
    result = await next(input as unknown as ToolCallArgs)
  } catch (error) {
    if (isStart) await patchConv($, sid, { starting: undefined })
    throw error
  }
  const prompt = typeof input.prompt === 'string' ? input.prompt : undefined
  const title = typeof input.title === 'string' ? input.title : (held.title ?? 'Devam')
  const isRefused = result.deny !== undefined || result.isError === true
  if (isStart && !isRefused) {
    const id = startedId(result)
    startedInTurn = runningTurnId
    await patchConv($, sid, { phase: 'done', startedId: id ?? title, starting: undefined })
const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
