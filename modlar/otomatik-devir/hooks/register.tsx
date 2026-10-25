import { atom, read, update } from 'claude-code'
import type { AgentInfo, EngineInterface, Register, ToolCallArgs } from 'claude-code'

import type { OtomatikDevirConv, OtomatikDevirPhase } from '../types'

// ---------------------------------------------------------------------------
// Settings ($.store, across sessions) and the per-conversation record ($.state)
// ---------------------------------------------------------------------------

const conv = atom({ plugin: 'otomatik-devir', key: 'conv' } as const, null)

const SKILL = 'my-skill-handoff'
const DEFAULT_THRESHOLD = 60

// Claude desktop's session tools: the continuation runs in a new chat nested
// under this one (Decision 9: no detach).
const START_SESSION = 'mcp__ccd_session__start_session'
const HAND_OFF = 'mcp__ccd_session__hand_off_to_session'
const TITLE_LIMIT = 59
const CONTINUE_SUFFIX = ' (devam)'
const CONTINUE_BACKGROUND =
  "Önceki sohbet bağlam eşiğine ulaştı; iş otomatik devirle bu yeni sohbete aktarıldı. Bu prompt, kaldığı yerden sürdürülecek iştir: önce onu oku, sonra devam et."

// Subagents in these states still owe the main loop a result (Decision 15:
// `waiting` never ends by itself, so it is not waited on).
const ACTIVE_AGENT: ReadonlySet<AgentInfo['status']> = new Set(['pending', 'running'])

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

// The v0.4/v0.5 scheduled tasks, deleted once by the v1 cleanup (S11).
const DELETE_TASK = 'mcp__scheduled-tasks__delete_scheduled_task'
const LIST_TASKS = 'mcp__scheduled-tasks__list_scheduled_tasks'
const GET_SESSION = 'mcp__ccd_session_mgmt__get_session'
// Exactly the mod's own task ids (any folder's): the v0.4 pair `-a`/`-b` and
// the v0.5 generations `-<gen>a`/`-<gen>b`, so a person's own
// `otomatik-devir-...` task is left alone.
const OWN_TASK = /^otomatik-devir-[0-9a-f]{8}-(?:[1-9]\d*)?[ab]$/

const isOwnTask = (id: unknown): id is string => typeof id === 'string' && OWN_TASK.test(id)

// Durable store keys (S2): the running handoff, and the handed-off flag that
// keeps a second child from ever starting for this session.
export const HANDED_PREFIX = 'devredildi:'
export const RUN_PREFIX = 'devir:'
export const CLEANUP_FLAG = 'temizlik-v1'
const CLEANUP_LOCK = 'temizlik-kilit'
export const DRAIN_TIMEOUT_MS = 30 * 60 * 1000
export const MAX_HANDOFF_BLOCKS = 4
// Blocks with timeoutText per handoff, and with fileMissingText per turn when the gate is closed.
const MAX_TIMEOUT_BLOCKS = 2
const MAX_MISSING_BLOCKS = 2

/** The per-session handoff file: `<cwd>/.workflow/handoff/<sid>.md`. */
export const handoffFile = (cwd: string, sid: string): string =>
  `${cwd.replace(/\/+$/, '')}/.workflow/handoff/${sid}.md`

// ---------------------------------------------------------------------------
// Texts the model reads (Contract)
// ---------------------------------------------------------------------------

/** How the handoff file gets written: the skill's inline auto mode, or the built-in steps. */
const writeStep = (file: string, hasSkill: boolean): string =>
  hasSkill
    ? `Skill aracıyla /${SKILL} becerisini \`auto ${file}\` argümanıyla çalıştır (alt ajan yok, soru yok); devir dosyasını o yazar.`
    : `Devir notunu ${file} dosyasına yaz (klasör yoksa oluştur): hedef, yapılanlar, kalanlar, alınan kararlar ve dikkat edilecekler; durdurulan işler varsa "Yeniden çalıştır:" altında. En sona \`## Devam prompt'u\` başlığını koy ve altına yeni sohbetin ilk mesajı olacak devam prompt'unu düz metin olarak yaz.`

const NO_NEW_WORK =
  "Yeni alt ajan, Workflow, alt ajana mesaj ya da yeni bir iş BAŞLATMA (mod bunları reddeder); çalışan alt ajanların ve Workflow'ların sonuçlarını geldikçe işle."

const START_CALL = `${START_SESSION} aracını bir kez çağır: initiation "user_asked", context "fresh", background = bu sohbetin neden devredildiğini anlatan en az 80 karakter; prompt'u mod devir dosyasından doldurur. cwd, model, effort ve permission_mode verme. Kullanıcı otomatik devri açtı; bu çağrı onun isteğidir. Çağrı reddedilirse yeniden deneme, own_initiative ya da proposal_id ile kart açma: ne yapacağını mod söyler. Başarılı olunca bu sohbete yalnızca yeni sohbetin açıldığını söyleyen tek bir satır yaz.`

/**
 * (a) The threshold tripped inside a turn the person typed: finish, start
 * nothing new, write the file, then start the nested child before this turn ends.
 */
export const inTurnHandoff = (threshold: number, file: string, hasSkill = true): string =>
  `Bağlam %${threshold}${dative(threshold)} ulaştı (bağlam sınırı): otomatik devir bu turda yapılacak. Elindeki adımı güvenli bir noktada tamamla (yarım dosya bırakma). ${NO_NEW_WORK} Çalışan iş varken turu bitirmeye çalışırsan mod seni bekletir. Her şey bitince: ${writeStep(file, hasSkill)} Dosya yazılınca turu bitirmeden ${START_CALL}`

/**
 * (b) The threshold tripped in a turn no person typed (a notification, an
 * auto-resume): the app refuses start_session there, so the file is written
 * now and the person's next typed message opens the chat.
 */
export const closedTurnHandoff = (threshold: number, file: string, hasSkill = true): string =>
  `Bağlam %${threshold}${dative(threshold)} ulaştı (bağlam sınırı) ve bu tur kullanıcının yazdığı bir tur değil: yeni sohbet bu turda açılamaz. Elindeki adımı güvenli bir noktada tamamla. ${NO_NEW_WORK} Her şey bitince: ${writeStep(file, hasSkill)} ${START_SESSION} ve ${HAND_OFF} çağırma, kart açma: yeni sohbet kullanıcının bir sonraki mesajıyla açılır. Dosyayı yazınca turu bitir.`

/** Context on the person's typed message while a handoff waits for it (S8). */
export const nextMessageNote = (file: string, isFileReady: boolean, hasSkill = true): string =>
  `otomatik-devir: bağlam eşiği geçildi; devir bu mesajla, bu turda yapılacak. Kullanıcının bu mesajındaki isteği bu sohbette YAPMA: yeni sohbetin ilk işi o olacak (mod onu devam prompt'unun altına ekler). ` +
  (isFileReady
    ? `Devir dosyası hazır (${file}); yeniden yazma.`
    : `${NO_NEW_WORK} Her şey bitince: ${writeStep(file, hasSkill)}`) +
  ` Sonra turu bitirmeden ${START_CALL}`

type Running = { id: string; description: string }[]

const runningList = (running: Running): string =>
  running.map(work => `${work.id} (${work.description})`).join(', ')

/** Stop block while subagents or Workflows run: wait inside the turn (Decision 3). */
export const waitText = (running: Running): string =>
  `otomatik-devir: turu henüz bitirme; çalışan işler var: ${runningList(running)}. Sonuçlarını bu turun içinde bekle: Bash aracıyla \`perl -e 'select(undef,undef,undef,120)'\` çalıştır (120 saniye; tek bir bekleme en çok 5 dakika olsun), gelen sonuçları işle ve hiçbiri çalışmıyorsa turu yeniden bitirmeyi dene. Yeni alt ajan ya da Workflow başlatma.`

/** Stop block once the drain ran 30 minutes (Decision 4). */
export const timeoutText = (running: Running): string =>
  `otomatik-devir: çalışan işler 30 dakikadır bitmedi: ${runningList(running)}. Her birini TaskStop aracıyla durdur ve devir dosyasında "Yeniden çalıştır:" altında listele (kimlik, açıklama, neyin yeniden çalıştırılacağı). Sonra devri tamamla.`

/** Stop block when the handoff file is missing, empty or older than this handoff. */
export const fileMissingText = (file: string, isOpenTurn: boolean): string =>
  `otomatik-devir: devir dosyası yok ya da bu devirden eski: ${file}. Turu bitirmeden önce dosyayı yaz (/${SKILL} \`auto ${file}\`, ya da hedef/yapılanlar/kalanlar/kararlar/dikkat ve en sonda \`## Devam prompt'u\`). ` +
  (isOpenTurn
    ? `Sonra turu bitirmeden ${START_SESSION} aracını initiation "user_asked" ve context "fresh" ile bir kez çağır.`
    : `${START_SESSION} çağırma: yeni sohbet kullanıcının bir sonraki mesajıyla açılır. Dosyayı yazınca turu bitir.`)

/** Stop block in an open typed turn once the file is written. */
export const START_NOW = `otomatik-devir: devir dosyası hazır. Turu bitirme: şimdi ${START_CALL}`

export const DRAIN_DENY =
  'otomatik-devir: devir sürüyor; yeni alt ajan, Workflow ya da alt ajana mesaj başlatılamaz. Çalışan işlerin sonuçlarını işle ve devri tamamla.'

export const READY_BAND = 'Devir hazır: bir sonraki mesajınla yeni sohbet açılacak.'

const MACHINE_TURN_DENY = `otomatik-devir: bu tur kullanıcının yazdığı bir tur değil; yeni sohbet bu turda açılamaz. Yeniden deneme, kart açma: kullanıcının bir sonraki mesajı yeni sohbeti açacak. Devir dosyasını yazdıysan turu bitir.`
const CARD_DENY = `otomatik-devir: devir için kart açma (own_initiative, proposal_id); ${START_SESSION} aracını initiation "user_asked" ile çağır.`
const HAND_OFF_DENY = `otomatik-devir: devir için ${HAND_OFF} kullanma; devir dosyasını yaz ve ${START_SESSION} aracını initiation "user_asked" ile çağır.`
const REMOVED_VERB = "v1.0'da kaldırıldı; tek mod otomatik. Kapatmak için: /devir kapat"
const USAGE = 'Kullanım: /devir [esik <n> | dene <n> | simdi | kapat | ac]'

type SelfSettings = { effort?: string; model?: string; permissionMode?: string }
type Settings = { threshold: number; isEnabled: boolean }

const isThreshold = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 99

const readSettings = async ($: EngineInterface): Promise<Settings> => {
  const [esik, acik] = await Promise.all([$.store.get('esik'), $.store.get('acik')])

  return {
    threshold: isThreshold(esik) ? esik : DEFAULT_THRESHOLD,
    isEnabled: acik !== false,
  }
}

/** The threshold this chat trips at: its own `/devir dene` value, else the global `esik`. */
const thresholdOf = (settings: Settings, held: OtomatikDevirConv | null): number =>
  held?.testThreshold ?? settings.threshold

/** Context fill as a whole percentage, or undefined before the first response. */
const contextPercent = async ($: EngineInterface): Promise<number | undefined> => {
  const { context } = await $.session.usage()
  if (typeof context.percent === 'number') return context.percent
  if (typeof context.tokens === 'number' && context.window > 0) {
    return Math.round((context.tokens / context.window) * 100)
  }

  return undefined
}

const isDrainPhase = (phase: OtomatikDevirPhase): boolean => phase === 'handoff_running' || phase === 'ready'

const statusText = (
  settings: Settings,
  percent: number | undefined,
  held: OtomatikDevirConv | null,
  running: number,
): string => {
  if (!settings.isEnabled) return 'Devir: kapalı'
  if (held?.phase === 'ready') return 'Devir hazır'
  if (held?.phase === 'handoff_running' && running > 0) return `Devir: ${running} alt ajan bitiyor`

  return `Devir: %${percent ?? 0} / eşik %${thresholdOf(settings, held)}${
    held?.testThreshold !== undefined ? ' (bu sohbet)' : ''
  }`
}

const refreshStatus = async ($: EngineInterface, percent?: number): Promise<void> => {
  const settings = await readSettings($)
  const held = await currentConv($)
  const running = held.phase === 'handoff_running' ? (await activeAgents($)).length : 0
  $.ui.status(statusText(settings, percent ?? (await contextPercent($)), held, running))
}

// ---------------------------------------------------------------------------
// Durable state (S2): `devir:<sid>` while a handoff runs, `devredildi:<sid>`
// once its child started. $.state is lost on a reload; the store is not.
// ---------------------------------------------------------------------------

type RunRecord = { handoffId: string; file: string; handoffAt: number; phase: 'handoff_running' | 'ready' }
type HandedRecord = { handoffId: string; startedId: string; file: string; at: number }

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const nonEmpty = (value: unknown): string | undefined =>
  typeof value === 'string' && value.trim() !== '' ? value.trim() : undefined

/** The handed-off flag of this session, when its child already started. */
const handedOf = async ($: EngineInterface, sid: string): Promise<HandedRecord | undefined> => {
  const got = record(await $.store.get(`${HANDED_PREFIX}${sid}`).catch(() => undefined))
  if (got === undefined) return undefined

  return {
    handoffId: nonEmpty(got.handoffId) ?? '',
    startedId: nonEmpty(got.startedId) ?? '',
    file: nonEmpty(got.file) ?? '',
    at: typeof got.at === 'number' ? got.at : 0,
  }
}

const runOf = async ($: EngineInterface, sid: string): Promise<RunRecord | undefined> => {
  const got = record(await $.store.get(`${RUN_PREFIX}${sid}`).catch(() => undefined))
  const handoffId = nonEmpty(got?.handoffId)
  const file = nonEmpty(got?.file)
  if (got === undefined || handoffId === undefined || file === undefined) return undefined
  if (got.phase !== 'handoff_running' && got.phase !== 'ready') return undefined

  return { handoffId, file, handoffAt: typeof got.handoffAt === 'number' ? got.handoffAt : 0, phase: got.phase }
}

// Mirrors whether this session's handoff drains (handoff_running or ready);
// the guards' `.catch` reads it when the hook itself failed (S4).
let isDraining = false

/**
 * Writes this session's record to the store after a claim or a phase change:
 * `devir:<sid>` while it drains, deleted otherwise (`done` writes
 * `devredildi:<sid>` itself, before this runs).
 */
const syncStore = async ($: EngineInterface, sid: string): Promise<void> => {
  const held = await read($, conv)
  if (held === null || held.sid !== sid) return
  isDraining = isDrainPhase(held.phase)
  const key = `${RUN_PREFIX}${sid}`
  if (isDraining && held.handoffId !== undefined && held.file !== undefined) {
    const run: RunRecord = {
      handoffId: held.handoffId,
      file: held.file,
      handoffAt: held.handoffAt ?? 0,
      phase: held.phase as RunRecord['phase'],
    }
    await $.store.set(key, run)
  } else {
    await $.store.delete(key).catch(() => undefined)
  }
}

/** The record of this sid, rebuilt from the store when $.state has none (a reload). */
const restoreConv = async ($: EngineInterface, sid: string): Promise<OtomatikDevirConv> => {
  const handed = await handedOf($, sid)
  if (handed !== undefined) {
    return { sid, phase: 'done', handoffId: handed.handoffId, startedId: handed.startedId, file: handed.file }
  }
  const run = await runOf($, sid)
  if (run !== undefined) {
    return {
      sid,
      phase: run.phase,
      handoffId: run.handoffId,
      file: run.file,
      handoffAt: run.handoffAt,
      isGateClosed: true,
    }
  }

  return { sid, phase: 'idle' }
}

/** The record of the conversation now running; a new session id restores it from the store. */
const currentConv = async ($: EngineInterface): Promise<OtomatikDevirConv> => {
  const sid = await $.session.id()
  const held = await read($, conv)
  if (held !== null && held.sid === sid) {
    isDraining = isDrainPhase(held.phase)

    return held
  }
  const restored = await restoreConv($, sid)
  await update($, conv, () => restored)
  isDraining = isDrainPhase(restored.phase)

  return restored
}

const patchConv = async (
  $: EngineInterface,
  sid: string,
  patch: Partial<OtomatikDevirConv>,
): Promise<void> => {
  await update($, conv, (held): OtomatikDevirConv =>
    held !== null && held.sid === sid ? { ...held, ...patch } : { sid, phase: 'idle', ...patch },
  )
  if (patch.phase !== undefined || patch.handoffId !== undefined) await syncStore($, sid)
}

const setPhase = ($: EngineInterface, sid: string, phase: OtomatikDevirPhase) =>
  patchConv($, sid, { phase })

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
  if (isClaimed && (patch.phase !== undefined || patch.handoffId !== undefined)) await syncStore($, sid)

  return isClaimed
}

// ---------------------------------------------------------------------------
// Due and claim (S3)
// ---------------------------------------------------------------------------

/**
 * The trip is due: the mod is on, this session never handed off, and either
 * `/devir simdi` forced it or the fill reached this chat's threshold.
 */
const isDue = async ($: EngineInterface, held: OtomatikDevirConv): Promise<{ threshold: number } | undefined> => {
  const settings = await readSettings($)
  if (!settings.isEnabled) return undefined
  if ((await handedOf($, held.sid)) !== undefined) return undefined
  const threshold = thresholdOf(settings, held)
  if (held.isForced === true) return { threshold }
  const percent = await contextPercent($)
  if (percent === undefined || percent < threshold) return undefined

  return { threshold }
}

const newHandoffId = (sid: string, now: number): string => `${sid.slice(0, 8)}-${now.toString(36)}`

/**
 * Starts a handoff: `handoff_running` with a new id, its time and file, and the
 * gate closed unless the person typed the running turn. Returns the claimed
 * record, or undefined when another caller won (or `may` refused).
 */
const claimHandoff = async (
  $: EngineInterface,
  sid: string,
  may: (held: OtomatikDevirConv) => boolean,
  extra: Partial<OtomatikDevirConv> = {},
): Promise<OtomatikDevirConv | undefined> => {
  const now = await $.clock.now()
  const file = handoffFile(await $.session.cwd(), sid)
  const isClaimed = await claim($, sid, may, {
    phase: 'handoff_running',
    handoffId: newHandoffId(sid, now),
    handoffAt: now,
    file,
    isGateClosed: !isPersonTurn,
    isForced: false,
    starting: undefined,
    notedTurn: undefined,
    ...extra,
  })
  if (!isClaimed) return undefined
  later($, () => noteSelf($, sid))
  const held = await read($, conv)

  return held !== null && held.sid === sid ? held : undefined
}

/** The handoff file's text, when it was written for this handoff (not before `since`). */
const readFresh = async ($: EngineInterface, file: string | undefined, since: number | undefined) => {
  if (file === undefined) return undefined
  try {
    const stat = await $.fs.stat(file)
    if (stat.kind !== 'file' || (since !== undefined && stat.mtimeMs < since)) return undefined
    const body = (await $.fs.read(file)).trim()

    return body === '' ? undefined : body
  } catch {
    return undefined
  }
}

const isFresh = async ($: EngineInterface, file: string | undefined, since: number | undefined) =>
  (await readFresh($, file, since)) !== undefined

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

type SelfSession = SelfSettings & { id?: string; title?: string }

/** This chat's own desktop session: its id (local_...), title, effort, model and permission mode. */
const selfSession = async ($: EngineInterface): Promise<SelfSession> => {
  try {
    const got = await $.tool.call({ tool: GET_SESSION, session_id: 'self' })
    if (got.deny !== undefined || got.isError === true || got.text === undefined) return {}
    const info = JSON.parse(got.text) as Record<string, unknown>

    return {
      id: nonEmpty(info.sessionId),
      title: nonEmpty(info.title),
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

// Who typed the running main turn. prompt.submit's `origin` (engine-stamped,
// a closed set) is read for the turn it starts and kept until that turn ends;
// a turn no prompt.submit of a person opened (a task notification, a
// continuation) is not the person's.
let isPersonTurn = false
let isNextTurnPerson = false
let runningTurnId: string | undefined

/**
 * The person's own message: Enter at the terminal, the Remote Control bridge,
 * or the SDK host's turn (Claude desktop writes the person's composer message
 * to the engine as its SDK host). Every other origin is a machine's.
 */
const PERSON_ORIGINS: ReadonlySet<string> = new Set(['composer', 'bridge', 'sdk'])

/** A person's own submission: a person origin, not one the engine marks isMeta. */
const isPersonSubmit = (e: { origin: { kind: string }; isMeta?: true }): boolean =>
  PERSON_ORIGINS.has(e.origin.kind) && e.isMeta !== true

/** Notes the continuation title and this chat's settings for the start_session call. */
const noteSelf = async ($: EngineInterface, sid: string): Promise<void> => {
  const self = await selfSession($)
  await patchConv($, sid, {
    title: continueTitle(self.title),
    selfId: self.id,
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

// ---------------------------------------------------------------------------
// The drain (S4): while a handoff drains, no new subagent, Workflow or agent
// message starts, whoever asks (a subagent, another plugin, the model).
// ---------------------------------------------------------------------------

const DRAIN_TOOLS: ReadonlySet<string> = new Set(['Agent', 'Task', 'Workflow', 'SendMessage'])

/** A call the drain refuses: SendMessage to another session (`local_...`) is not agent work. */
const isDrainCall = (call: { tool: string; to?: unknown }): boolean =>
  DRAIN_TOOLS.has(call.tool) &&
  !(call.tool === 'SendMessage' && typeof call.to === 'string' && call.to.startsWith('local_'))

const isDrainingNow = async ($: EngineInterface): Promise<boolean> =>
  isDrainPhase((await currentConv($)).phase)

/**
 * S6: the model's own start_session during the handoff. A session that
 * handed off never starts a second child; outside a handoff the call passes
 * untouched. Only a typed turn (`user_asked`) may start it, only once the
 * file is written, and the prompt is the file (plus the person's message).
 * The child stays nested under this chat (Decision 9).
 */
const watchModelStart = async (
  $: EngineInterface,
  call: { tool: string } & Record<string, unknown>,
  next: ToolNext,
) => {
  const sid = await $.session.id()
  const handed = await handedOf($, sid)
  if (handed !== undefined) {
    return { deny: `otomatik-devir: bu sohbet zaten devredildi (${handed.startedId}); ikinci kez açma.` }
  }
  const held = await currentConv($)
  if (!isDrainPhase(held.phase)) return next(call as unknown as ToolCallArgs)
  if (call.initiation === 'own_initiative' || call.proposal_id !== undefined) return { deny: CARD_DENY }
  if (!isPersonTurn) {
    await patchConv($, sid, { isGateClosed: true })

    return { deny: MACHINE_TURN_DENY }
  }
  const file = held.file ?? handoffFile(await $.session.cwd(), sid)
  const text = await readFresh($, file, held.handoffAt)
  if (text === undefined) return { deny: `otomatik-devir: önce devir dosyasını yaz: ${file}` }
  const isClaimed = await claim($, sid, h => isDrainPhase(h.phase) && h.starting === undefined, {
    starting: runningTurnId ?? 'start',
  })
  if (!isClaimed) return { deny: 'otomatik-devir: devam sohbeti şu an açılıyor; ikinci kez açma.' }
  const title = held.title ?? nonEmpty(call.title) ?? continueTitle(undefined)
  const message = held.pendingMessage
  const input: { tool: string } & Record<string, unknown> = {
    ...call,
    initiation: 'user_asked',
    context: 'fresh',
    title,
    background:
      typeof call.background === 'string' && call.background.length >= 80 ? call.background : CONTINUE_BACKGROUND,
    prompt:
      text +
      (message !== undefined && message.trim() !== ''
        ? `\n\n## Kullanıcının son mesajı (yeni sohbetin ilk işi)\n${message}`
        : ''),
  }
  let result: Awaited<ReturnType<ToolNext>>
  try {
    result = await next(input as unknown as ToolCallArgs)
  } catch (error) {
    await patchConv($, sid, { starting: undefined })
    throw error
  }
  if (result.deny !== undefined || result.isError === true) {
    await patchConv($, sid, { starting: undefined, isGateClosed: true })

    return result
  }
  const id = startedId(result) ?? title
  const handedNow: HandedRecord = {
    handoffId: held.handoffId ?? '',
    startedId: id,
    file,
    at: await $.clock.now(),
  }
  await $.store.set(`${HANDED_PREFIX}${sid}`, handedNow)
  // `done` deletes `devir:<sid>` (syncStore).
  await patchConv($, sid, { phase: 'done', startedId: id, starting: undefined, isForced: false })
  later($, async () => {
    $.ui.toast(`Devam yeni sohbette: ${title}`, { timeoutMs: 15000 })
    await refreshStatus($).catch(() => undefined)
  })

  return result
}

/**
 * S5: after a main-loop tool result. Idle and due: claim, and the instruction
 * rides on this result's `context` (in-turn when the person typed the turn,
 * else the closed-turn text). A closed-gate handoff in a machine turn gets its
 * closed-turn text once per turn.
 */
const tripMidTurn = async ($: EngineInterface): Promise<string | undefined> => {
  const held = await currentConv($)
  if (held.phase === 'idle') {
    const due = await isDue($, held)
    if (due === undefined) return undefined
    const claimed = await claimHandoff(
      $,
      held.sid,
      h => h.phase === 'idle',
      isPersonTurn ? {} : { notedTurn: runningTurnId },
    )
    if (claimed?.file === undefined) return undefined
    const hasSkill = await hasHandoffSkill($)
    $.ui.toast(
      isPersonTurn
        ? 'Devir başlıyor: bu turun içinde yapılacak.'
        : 'Devir başlıyor: yeni sohbet bir sonraki mesajınla açılacak.',
    )

    return isPersonTurn
      ? inTurnHandoff(due.threshold, claimed.file, hasSkill)
      : closedTurnHandoff(due.threshold, claimed.file, hasSkill)
  }
  if (
    held.phase === 'handoff_running' &&
    held.isGateClosed === true &&
    !isPersonTurn &&
    runningTurnId !== undefined &&
    held.notedTurn !== runningTurnId
  ) {
    const turn = runningTurnId
    const isClaimed = await claim($, held.sid, h => h.phase === 'handoff_running' && h.notedTurn !== turn, {
      notedTurn: turn,
    })
    if (!isClaimed || held.file === undefined) return undefined
    const settings = await readSettings($)

    return closedTurnHandoff(thresholdOf(settings, held), held.file, await hasHandoffSkill($))
  }

  return undefined
}

export const register: Register = on => {
  // (a) The mid-turn channel: a tool result's `context` is read by the model
  // right after that result, inside the running turn.
  on('tool.call', async ($, e, next) => {
    const call = e as unknown as { tool: string; agentId?: string; to?: unknown } & Record<string, unknown>
    type Out = Awaited<ReturnType<typeof next>>
    // S4 first, before the origin and subagent returns: the drain holds for
    // every caller.
    if (isDrainCall(call) && (await isDrainingNow($))) return { deny: DRAIN_DENY } as Out
    // Only the model's own calls (the engine's call site): another plugin's
    // $.tool.call drops `context`, and its start_session is not the handoff.
    if (next.origin.plugin !== 'engine') return next(e)
    if (call.agentId !== undefined) return next(e)
    if (call.tool === HAND_OFF) {
      // A fork through hand_off_to_session is not the handoff's path.
      if (await isDrainingNow($)) return { deny: HAND_OFF_DENY } as Out

      return next(e)
    }
    if (call.tool === START_SESSION) {
      return watchModelStart($, call, next as unknown as ToolNext) as ReturnType<typeof next>
    }
    const result = await next(e)
    if (result.deny !== undefined) return result
    const note = await tripMidTurn($)
    if (note === undefined) return result

    return { ...result, context: [...(result.context ?? []), note] } as typeof result
  }).catch(($, e, next) =>
    next.called ? next(e) : isDraining && DRAIN_TOOLS.has(e.tool) ? { deny: DRAIN_DENY } : next(e),
  )

  // S4 at the spawn itself: also a workflow's `agent()` calls and resumes.
  on('agent.spawn', async ($, e, next) => ((await isDrainingNow($)) ? { deny: DRAIN_DENY } : next(e))).catch(
    ($, e, next) => (next.called ? next(e) : isDraining ? { deny: DRAIN_DENY } : next(e)),
  )
}
