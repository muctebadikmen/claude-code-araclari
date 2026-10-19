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
// Bounds on the wait for the handoff prompt (see `nudge`): completed turns
// without it, idle time with no subagent left, and total time per request.
const MAX_WAIT_TURNS = 6
const GUARD_IDLE_MS = 5 * 60 * 1000
const GUARD_LIMIT_MS = 30 * 60 * 1000

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

/** What the agent runs once everything has finished: the skill, or the fallback steps. */
const handoffStep = (hasSkill: boolean): string =>
  hasSkill
    ? `/${SKILL} becerisini çalıştır (Skill aracıyla) ve devam prompt'unu yanıtının en sonunda tek bir kod bloğu içinde ver.`
    : FALLBACK_PROMPT

/**
 * The ONE message sent when the threshold is crossed: finish what runs, start
 * nothing new, then hand off. Intermediate replies must not end in a code
 * block, so a notification turn is never read as the handoff reply.
 */
export const handoffMessage = (threshold: number, hasSkill = true): string =>
  `Bağlam %${threshold}${dative(threshold)} ulaştı (bağlam sınırı). Şu an çalışan her işi bitir: çalışan subagent'ların ve arka plan görevlerinin sonuçlarını geldikçe işle, elindeki adımı güvenli bir noktada tamamla (yarım dosya bırakma). Yeni görev, yeni subagent, yeni arka plan işi ya da yeni bir iş BAŞLATMA. Çalışan işler sürerken turunu bitirebilirsin; devam prompt'u hazır olana kadar yanıtlarını kod bloğuyla bitirme. Çalışan her şey bittiğinde devri yap: ${handoffStep(hasSkill)}`

/** The one reminder when no handoff prompt came in time. */
export const reminderText = (hasSkill = true): string =>
  `Hatırlatma (bağlam sınırı): yeni iş başlatmayı bırak, devri şimdi yap. ${handoffStep(hasSkill)}`

// otomatik mode (v0.4): the instruction rides INSIDE a turn the person typed,
// as context the model reads (a tool result's `context`, or the typed prompt's
// `context`), and the model itself opens the continuation chat in that same
// turn. The app lets start_session "user_asked" run only while such a turn is
// open; a mod's own message turn never passes.

/** The start_session step: in this turn, once, with the user's standing request named. */
const startStep = (prompt: string): string =>
  ` Devam prompt'u hazır olunca, turu bitirmeden, bu turun içinde ${START_SESSION} aracını bir kez çağır: initiation "user_asked", context "fresh", prompt = ${prompt}, background = bu sohbetin neden devredildiğini anlatan en az 80 karakter. Kullanıcı "/devir otomatik" ile eşikte sormadan yeni sohbete geçilmesini istedi; bu çağrı onun isteğidir. cwd, model, effort ve permission_mode verme: yeni sohbet bunları bu oturumdan alır. Çağrı reddedilirse yeniden deneme, own_initiative ya da proposal_id ile kart açma: ne yapacağını mod araç sonucunda söyler. Başarılı olunca bu sohbete yalnızca yeni sohbetin açıldığını söyleyen tek bir satır yaz.`

/**
 * (a) The threshold tripped inside a turn the person typed: finish, start
 * nothing new, hand off, then start the new chat before this turn ends.
 */
export const inTurnHandoff = (threshold: number, hasSkill = true, canStart = true, held?: string): string =>
  `Bağlam %${threshold}${dative(threshold)} ulaştı (bağlam sınırı) ve otomatik devir açık: devir bu turda yapılacak. Elindeki adımı güvenli bir noktada tamamla (yarım dosya bırakma), çalışan ön plan işlerinin sonuçlarını işle. Yeni görev, yeni subagent, yeni arka plan işi ya da yeni bir iş BAŞLATMA. Sonra devri yap: ${
    held === undefined
      ? handoffStep(hasSkill)
      : "Devam prompt'u zaten hazır (aşağıda); devir becerisini yeniden çalıştırma."
  }` +
  (canStart
    ? `${startStep(held === undefined ? "devam prompt'unun metni" : "aşağıdaki devam prompt'u")} ${WAIT_THEN_BLOCK}`
    : '') +
  (held === undefined ? '' : `\n\nDevam prompt'u:\n\n${held}`)

// Running work in (b): its results must come in before the handoff, or they
// land in the old chat after the new one started (review M4).
const WAIT_RUNNING =
  "Çalışan subagent'ların ve arka plan işlerinin sonuçlarını geldikçe işle ve bitmelerini bekle; yeni görev, yeni subagent ya da arka plan işi BAŞLATMA."
const WAIT_THEN_BLOCK = `Çalışan bir arka plan işini beklemek için turu bitirmen gerekirse ${START_SESSION} aracını sonraki turlarda çağırma; devam prompt'unu yanıtının en sonunda tek bir kod bloğu olarak ver, yeni sohbeti mod açar.`

/**
 * (b) No typed turn was open when the threshold tripped: the handoff runs in
 * the person's next typed message, which the new chat takes over. With a
 * `held` prompt (one already written), the skill does not run again.
 */
export const nextMessageHandoff = (
  threshold: number,
  hasSkill = true,
  canStart = true,
  held?: string,
  gate?: { plan?: ScheduledPlan },
): string =>
  `Bağlam %${threshold} eşiğini geçti ve kullanıcı "/devir otomatik" ile otomatik devri açtı: devir bu mesajla, bu turda yapılacak. Kullanıcının bu mesajındaki isteği bu sohbette YAPMA; yeni sohbetin ilk işi o olacak. ${WAIT_RUNNING}` +
  (held === undefined
    ? ` Devri yap: ${gate === undefined ? handoffStep(hasSkill) : writeStep(hasSkill, gate.plan)} Devam prompt'una kullanıcının bu mesajını sıradaki iş olarak ekle.`
    : ` Devam prompt'u zaten hazır (aşağıda); devir becerisini yeniden çalıştırma; altına kullanıcının bu mesajını sıradaki iş olarak ekle.`) +
  (gate !== undefined
    ? gateStep(gate.plan)
    : canStart
      ? `${startStep(
          held === undefined
            ? "devam prompt'unun metni (kullanıcının bu mesajı dahil)"
            : 'aşağıdaki devam prompt\'u ve altına kullanıcının bu mesajı',
        )} ${WAIT_THEN_BLOCK}`
      : ' Bu sohbete devam prompt\'undan başka bir şey yazma.') +
  (held === undefined ? '' : `\n\nDevam prompt'u:\n\n${held}`)

// (s) otomatik with no typed turn open (a task notification, the mod's own
// message, an auto-resume): start_session user_asked is refused there, but a
// run of an ad-hoc scheduled task starts a new top-level chat at once, no
// click, same cwd and model (probe 2026-10-19). The model makes the calls (the
// probed shape); the mod names the file and the tasks, fills the task fields,
// refuses deletes and updates, and hands the model the settings to copy over.
const CREATE_TASK = 'mcp__scheduled-tasks__create_scheduled_task'
const RUN_TASK = 'mcp__scheduled-tasks__run_scheduled_task'
const UPDATE_TASK = 'mcp__scheduled-tasks__update_scheduled_task'
const DELETE_TASK = 'mcp__scheduled-tasks__delete_scheduled_task'
const LIST_TASKS = 'mcp__scheduled-tasks__list_scheduled_tasks'
const LIST_RUNS = 'mcp__scheduled-tasks__list_task_runs'
const GET_SESSION = 'mcp__ccd_session_mgmt__get_session'
const SET_EFFORT = 'mcp__ccd_session_mgmt__set_session_effort'
const SET_MODEL = 'mcp__ccd_session_mgmt__set_session_model'
const SET_PERMISSION = 'mcp__ccd_session_mgmt__set_session_permission_mode'
const SEND_MESSAGE = 'mcp__ccd_session_mgmt__send_message'
const TASK_PREFIX = 'otomatik-devir-'
// Exactly the mod's own task ids (any folder's): the v0.4 pair `-a`/`-b` and
// the v0.5 generations `-<gen>a`/`-<gen>b`, so a person's own
// `otomatik-devir-...` task is left alone (re-review N9).
const OWN_TASK = /^otomatik-devir-[0-9a-f]{8}-(?:[1-9]\d*)?[ab]$/
// A create under the free id the app suggests when one is taken (re-review N10).
const OWN_TASK_RETRY = /^(otomatik-devir-[0-9a-f]{8}-(?:[1-9]\d*)?[ab])-\d+$/

const isOwnTask = (id: unknown): id is string => typeof id === 'string' && OWN_TASK.test(id)

/** The generation of one of the mod's task ids: 0 for the v0.4 pair `-a`/`-b`. */
const genOf = (id: string): number => Number(/-(\d*)[ab]$/.exec(id)?.[1] || 0)

/** Both ids of the pair a task id belongs to. */
const pairOf = (id: string): [string, string] => {
  const base = id.slice(0, -1)

  return [`${base}a`, `${base}b`]
}
// In the project, not the mod's store: the run starts in this same folder, so
// its Read needs no approval nobody is there to give, and $.fs reads it back.
const DEVAM_FILE = '.workflow/otomatik-devir-devam.md'
const MAX_RUN_TRIES = 2

/** FNV-1a (32 bit) of the folder, 8 hex digits: stable per cwd, kebab-case safe. */
const cwdHash = (cwd: string): string => {
  let hash = 0x811c9dc5
  for (let i = 0; i < cwd.length; i++) {
    hash ^= cwd.charCodeAt(i)
    hash = Math.imul(hash, 0x01000193) >>> 0
  }

  return hash.toString(16).padStart(8, '0')
}

export type ScheduledPlan = { file: string; ids: readonly [string, string] }

const folderOf = (cwd: string): string => (cwd.length > 1 ? cwd.replace(/[\\/]+$/, '') : cwd)
const tagOf = (cwd: string): string => `${TASK_PREFIX}${cwdHash(folderOf(cwd))}`

/** A generation's two task ids for a folder tag: `-<gen>a`, `-<gen>b` (v0.5). */
const genIds = (tag: string, gen: number): [string, string] => [`${tag}-${gen}a`, `${tag}-${gen}b`]

/**
 * This folder's prompt file and its two tasks (created once, never deleted):
 * the v0.4 pair `-a`/`-b`, or with `gen` that generation's `-<gen>a`/`-<gen>b`.
 */
export const scheduledPlan = (cwd: string, gen?: number): ScheduledPlan => {
  const tag = tagOf(cwd)

  return {
    file: `${folderOf(cwd)}/${DEVAM_FILE}`,
    ids: gen === undefined ? [`${tag}-a`, `${tag}-b`] : genIds(tag, gen),
  }
}

/**
 * The v0.4 tasks' static prompt; in v0.5 the real prompt the dispatcher sends
 * into the new run with send_message after its bootstrap turn.
 */
export const taskPrompt = (file: string): string =>
  `Önceki sohbet bağlam eşiğine ulaştı; devam prompt'u ${file} dosyasında: önce onu oku, sonra devam et.`

/**
 * The first line of the real prompt the mod sends into a new run (v0.5 live
 * check, bug 4): the app labels the message with the sending chat (often an
 * unrelated relay chat), so the run is told what it is.
 */
export const RELAYED_LINE =
  'otomatik-devir: bu mesaj, otomatik devrin devamıdır ve başka bir sohbet tarafından iletildi; gönderen sohbetin adı ve konusu bu işle ilgili değildir.'

/** The message the mod sends into a new run after its bootstrap turn. */
export const chainMessage = (file: string): string => `${RELAYED_LINE}\n${taskPrompt(file)}`

/**
 * The v0.5 tasks' static prompt: a tiny first turn with no tool call (no
 * approval card, whatever mode the run starts in). The dispatcher then syncs
 * effort, model and permission mode and sends the real prompt, so the work
 * runs from the second turn with the chain's settings.
 */
export const BOOTSTRAP_PROMPT = 'otomatik-devir açılışı: yalnızca `hazır` yaz ve dur.'

const fileStep = (file: string): string =>
  ` Devam prompt'unu ${file} dosyasına yaz (dosyayı baştan yaz, klasör yoksa oluştur); yanıtının sonuna kod bloğu olarak koyma.`

const scheduledSteps = (plan: ScheduledPlan): string =>
  `${fileStep(plan.file)} Sonra yeni sohbeti zamanlanmış görevle aç (tıklama gerekmez):${runSteps(plan)}`

const runSteps = ({ ids: [a, b] }: ScheduledPlan): string =>
  ` 1) ${GET_SESSION} aracını session_id "self" ile çağır ve scheduledTaskId'ye bak. 2) ${LIST_TASKS} ile "${a}" ve "${b}" görevlerine bak; olmayan her birini ${CREATE_TASK} ile yalnızca taskId vererek oluştur (prompt, başlık ve ayarları mod doldurur; zamanlama verme). 3) Bu oturumun scheduledTaskId'si olmayan görevi seç (önce "${a}") ve ${RUN_TASK} ile çalıştır; "çalışıyor" diye reddedilirse diğeri bu oturumun görevi değilse onu bir kez dene. Görevleri asla silme (${DELETE_TASK} devam sohbetlerini arşivler) ve güncelleme. Çalışma başlayınca mod, araç sonucunda yeni sohbetin ayarlarını nasıl eşitleyeceğini söyler: onu yap, sonra bu sohbete yalnızca yeni sohbetin açıldığını söyleyen tek bir satır yaz. Görev yolu olmazsa yeniden deneme, ${START_SESSION} çağırma: devam prompt'unu yanıtının en sonunda tek bir kod bloğu olarak ver, yeni sohbeti mod açar. Çalışan bir arka plan işini beklemek için turu bitirmen gerekirse bu adımları sonraki bir turda yap; o zamana kadar yanıtlarını kod bloğuyla bitirme.`

/**
 * (s) The handoff through a scheduled task: finish, start nothing new, hand
 * off into the prompt file, then run this folder's free task. With a `held`
 * prompt (one already written), the skill does not run again.
 */
export const scheduledHandoff = (
  threshold: number,
  hasSkill: boolean,
  plan: ScheduledPlan,
  held?: string,
): string =>
  `Bağlam %${threshold}${dative(threshold)} ulaştı (bağlam sınırı) ve otomatik devir açık: devir zamanlanmış görev yoluyla, tıklamasız yapılacak. Elindeki adımı güvenli bir noktada tamamla (yarım dosya bırakma), çalışan işlerin sonuçlarını geldikçe işle. Yeni görev, yeni subagent, yeni arka plan işi ya da yeni bir iş BAŞLATMA. Çalışan her şey bittiğinde devri yap: ` +
  (held !== undefined
    ? "Devam prompt'u zaten hazır (aşağıda); devir becerisini yeniden çalıştırma."
    : hasSkill
      ? `/${SKILL} becerisini çalıştır (Skill aracıyla).`
      : 'Bu sohbetin devam notunu yaz: hedef, yapılanlar, kalanlar, alınan kararlar ve dikkat edilecekler. .workflow/HANDOFF.md dosyasına kaydet (klasör yoksa oluştur).') +
  scheduledSteps(plan) +
  (held === undefined ? '' : `\n\nDevam prompt'u:\n\n${held}`)

// The start gate's ground truth (review H1): the read-only list_start_targets
// lists this computer's repositories only while the app would let
// start_session "user_asked" through in this turn (probe 2026-10-19: filled in
// a typed turn, {} in a task-notification turn). It is {} too for a person
// with no repository at all, so an empty answer counts as "closed" only once a
// filled one was seen (the store's REPOS_SEEN); until then the prompt's origin
// decides, and the app's refusal text (R1) switches to (s) in the same turn.
const GATE = 'mcp__ccd_session__list_start_targets'
const HAND_OFF = 'mcp__ccd_session__hand_off_to_session'
const REPOS_SEEN = 'depoGoruldu'
const R1 = /Start sessions only on the user's own words/

/** The skill (or the fallback notes) when the prompt goes to the file, not a code block. */
const writeStep = (hasSkill: boolean, plan?: ScheduledPlan): string =>
  plan === undefined
    ? handoffStep(hasSkill)
    : hasSkill
      ? `/${SKILL} becerisini çalıştır (Skill aracıyla).`
      : 'Bu sohbetin devam notunu yaz: hedef, yapılanlar, kalanlar, alınan kararlar ve dikkat edilecekler. .workflow/HANDOFF.md dosyasına kaydet (klasör yoksa oluştur).'

/** The gate step: write the prompt (to the file when (s) may follow), then ask the gate. */
const gateStep = (plan?: ScheduledPlan): string =>
  (plan === undefined
    ? " Devam prompt'u hazır olunca, turu bitirmeden, bu turun içinde"
    : `${fileStep(plan.file)} Sonra, turu bitirmeden, bu turun içinde`) +
  ` önce ${GATE} aracını çağır (salt okunur): mod, sonucunda yeni sohbeti bu turda nasıl açacağını söyler (${START_SESSION} ya da zamanlanmış görev); onu yap. ${HAND_OFF} kullanma. Çalışan bir arka plan işini beklemek için turu bitirmen gerekirse bu adımları sonraki bir turda yap; o zamana kadar yanıtlarını kod bloğuyla bitirme.`

/**
 * otomatik in Claude desktop: the threshold tripped mid-turn, in any turn.
 * Whether this turn may start_session is the gate's to say (GATE), not the
 * prompt's origin: the model asks it once the prompt is ready, and the mod's
 * note on that result names the path, (a) start_session or (s) a task run.
 */
export const gatedHandoff = (
  threshold: number,
  hasSkill: boolean,
  plan?: ScheduledPlan,
  held?: string,
): string =>
  `Bağlam %${threshold}${dative(threshold)} ulaştı (bağlam sınırı) ve otomatik devir açık: devir bu turda, tıklamasız yapılacak. Elindeki adımı güvenli bir noktada tamamla (yarım dosya bırakma), çalışan işlerin sonuçlarını geldikçe işle. Yeni görev, yeni subagent, yeni arka plan işi ya da yeni bir iş BAŞLATMA. Çalışan her şey bittiğinde devri yap: ` +
  (held === undefined
    ? writeStep(hasSkill, plan)
    : "Devam prompt'u zaten hazır (aşağıda); devir becerisini yeniden çalıştırma.") +
  gateStep(plan) +
  (held === undefined ? '' : `\n\nDevam prompt'u:\n\n${held}`)

/**
 * otomatik in a run chat with the chain on (v0.5 live check, bug 2): the app
 * refuses the gate in unattended runs, so there is no gate step. The prompt
 * comes as the reply's last code block; at the turn's end the mod leaves it
 * to the relay (startChain).
 */
export const runChatHandoff = (threshold: number, hasSkill: boolean, held?: string): string =>
  `Bağlam %${threshold}${dative(threshold)} ulaştı (bağlam sınırı) ve otomatik devir açık: devir bu turda, tıklamasız yapılacak. Elindeki adımı güvenli bir noktada tamamla (yarım dosya bırakma), çalışan işlerin sonuçlarını geldikçe işle. Yeni görev, yeni subagent, yeni arka plan işi ya da yeni bir iş BAŞLATMA. Çalışan her şey bittiğinde devri yap: ` +
  (held === undefined
    ? handoffStep(hasSkill)
    : "Devam prompt'u zaten hazır (aşağıda); devir becerisini yeniden çalıştırma, onu yanıtının en sonunda tek bir kod bloğu içinde ver.") +
  ` Bu sohbet zamanlanmış bir görevin çalışması: ${GATE}, ${START_SESSION} ve görev araçlarını çağırma; yeni sohbeti açık bir sohbetteki mod (aktarıcı) açar. Çalışan bir arka plan işini beklemek için turu bitirmen gerekirse o zamana kadar yanıtlarını kod bloğuyla bitirme.` +
  (held === undefined ? '' : `\n\nDevam prompt'u:\n\n${held}`)

/** The gate is open: (a), start_session in this turn. */
export const gateOpenNote = (plan?: ScheduledPlan): string =>
  `otomatik-devir: bu tur kullanıcının yazdığı tur; yeni sohbeti şimdi aç.${startStep(
    plan === undefined ? "devam prompt'unun metni" : `${plan.file} dosyasına yazdığın devam prompt'unun metni`,
  )}`

/** The gate is closed: (s), a task run, in this turn. */
export const gateClosedNote = (plan: ScheduledPlan): string =>
  `otomatik-devir: bu tur kullanıcının yazdığı bir tur değil; ${START_SESSION} burada reddedilir, çağırma. Yeni sohbeti zamanlanmış görevle aç (tıklama gerekmez); devam prompt'u ${plan.file} dosyasında olmalı:${runSteps(plan)}`

/** The gate is closed and (s) is out: the prompt as a code block, the mod takes it on. */
export const GATE_NONE = `otomatik-devir: bu turda yeni sohbet açılamaz; ${START_SESSION} çağırma. Devam prompt'unu yanıtının en sonunda tek bir kod bloğu olarak ver; devamını mod üstlenir.`

/** start_session refused with R1 (the turn was not the person's): (s) in the same turn. */
export const refusedToScheduled = (plan: ScheduledPlan): string =>
  `otomatik-devir: ${START_SESSION} reddedildi (bu tur kullanıcının yazdığı tur sayılmadı). Yeniden deneme, kart açma; yeni sohbeti bu turda zamanlanmış görevle aç: start_session'a verdiğin devam prompt'unu kullan.${scheduledSteps(plan)}`

const R1_IN_SCHEDULED = `otomatik-devir: ${START_SESSION} bu turda açılmaz; yeniden deneme. Talimattaki zamanlanmış görev adımlarını izle.`

/** The model raised its own card while (s) can still start the chat with no click (re-review N4). */
export const cardToScheduled = (plan: ScheduledPlan): string =>
  `otomatik-devir: kart açma (own_initiative); yeni sohbet zamanlanmış görevle tıklamasız açılır. Kart için yazdığın devam prompt'unu kullan.${scheduledSteps(plan)}`

/**
 * (b) rode on a message that was not the person's (an app wake-up reads
 * `sdk` too): the gate or R1 says so. The handoff waits for the next typed
 * message again (re-review N3).
 */
export const NOT_PERSON_NOTE = `otomatik-devir: bu mesaj kullanıcının yazdığı bir mesaj değil; bu turda yeni sohbet açılamaz. ${START_SESSION} çağırma, kart açma: devir kullanıcının bir sonraki mesajıyla yapılacak. Devam prompt'unu bu turda yazdıysan yanıtının en sonunda tek bir kod bloğu olarak ver; yazmadıysan devir adımlarını bırak ve bu mesajın isteğini bu sohbette normal şekilde yap.`

type SelfSettings = { effort?: string; model?: string; permissionMode?: string }

const named = (value: string | undefined, field: string): string =>
  value === undefined ? `bu oturumun ${field} değeri (${GET_SESSION} "self")` : `"${value}"`

/**
 * After the run started: copy this chat's effort (and model when it differs)
 * to the new one. Effort applies from its next turn, so its first turn runs at
 * the task's default. Never the permission mode: raising one always shows a
 * card (v0.5 review H1); the run keeps its task's saved mode.
 */
export const syncText = (id: string | undefined, self: SelfSettings, file?: string): string => {
  const target = id === undefined ? `yeni sohbet (kimliği ${LIST_RUNS} ile bul)` : `"${id}"`

  return (
    `otomatik-devir: devam sohbeti açıldı${id === undefined ? '' : ` (${id})`}; eski sohbet açık kalır. Ayarlarını bu sohbetinkine eşitle: ${SET_EFFORT} aracını session_id ${target}, effort ${named(self.effort, 'effort')} ile çağır (ilk turu görevin varsayılan effort'uyla çalışır; ayar sonraki turundan geçerli olur). ${GET_SESSION} ile o oturuma bak: model ${named(self.model, 'model')} değilse ${SET_MODEL} ile eşitle. İzin modunu değiştirme (${SET_PERMISSION} çağırma): yeni sohbet görevin kayıtlı moduyla çalışır. Oturum birkaç saniyede görünür; bulunamazsa bir kez daha dene. Görevleri silme.` +
    // v0.5 tasks open with the bootstrap turn: the work starts with this message.
    (file === undefined
      ? ''
      : ` Ayarlar bitince ${SEND_MESSAGE} aracını session_id ${target}, message "${taskPrompt(file)}" ile çağır (yeni sohbetin ilk turu yalnızca "hazır" yazar; asıl iş bu mesajla başlar).`) +
    ' Sonra bu sohbete yalnızca yeni sohbetin açıldığını söyleyen tek bir satır yaz.'
  )
}

// v0.5 endless chain: the notes the mod puts on the gate's result (or on a
// refused start) when the gate is closed and the chain path takes over.

/** A regular chat: the mod itself runs the task, syncs the settings and sends the prompt. */
export const OWN_DISPATCH_NOTE = `otomatik-devir: yeni sohbeti mod zamanlanmış görevle açıyor (tıklama gerekmez; ayarları ve devam mesajını mod verir). Görev araçlarını ve ${START_SESSION} aracını çağırma; bu sohbete yalnızca devrin yapıldığını söyleyen tek bir satır yaz ve turu bitir.`

/** A run chat (it can never run a task): the request goes to the relay. */
export const RELAY_NOTE = `otomatik-devir: bu sohbet zamanlanmış bir görevin çalışması; buradan görev çalıştırılamaz. Devam isteği açık bir sohbetteki moda (aktarıcı) bırakıldı: yeni sohbeti o açar, ayarları eşitler ve devam mesajını gönderir. Görev araçlarını ve ${START_SESSION} aracını çağırma; bu sohbete yalnızca devrin istendiğini söyleyen tek bir satır yaz ve turu bitir.`

/** The chain may take a hop here: a run chat only in otomatik mode, where a relay serves (v0.5 review M7). */
const isChainOn = async ($: EngineInterface): Promise<boolean> =>
  !isRunChat || (await $.store.get('mod').catch(() => undefined)) === 'otomatik'

/** The note for the chain's outcome: the mod or the relay opens the chat, or (b) waits. */
const chainNote = (outcome: 'started' | 'deferred'): string =>
  outcome === 'deferred' ? CHAIN_WAIT_NOTE : isRunChat ? RELAY_NOTE : OWN_DISPATCH_NOTE

/** The gate was asked before the prompt file was written for this handoff. */
export const fileFirstNote = (file: string): string =>
  `otomatik-devir: bu devrin devam prompt'u ${file} dosyasında yok. Önce onu yaz (dosyayı baştan yaz), sonra ${GATE} aracını yeniden çağır.`

/**
 * Pre-provisioning (v0.5): in a turn the person typed, with Auto or Bypass on,
 * the model creates this folder's next task pair, so the app saves the mode
 * with them (only such a turn's create keeps it).
 */
export const provisionNote = ([a, b]: readonly [string, string]): string =>
  `otomatik-devir: devir zinciri için bu turda iki zamanlanmış görev oluştur (izin modu yalnızca kullanıcının yazdığı bir turda görevle saklanır): ${CREATE_TASK} aracını taskId "${a}" ile, sonra taskId "${b}" ile çağır; prompt ve description için "-" ver, zamanlama verme (başlığı, prompt'u ve ayarları mod doldurur). Görevleri çalıştırma, silme ya da güncelleme. Sonra kullanıcının isteğine kaldığın yerden devam et; bu adımı yanıtında anlatma.`

const RUN_RETRY =
  "otomatik-devir: görev çalıştırılamadı. Diğer görev bu oturumun görevi değilse onu bir kez dene; o da olmazsa yeniden deneme: devam prompt'unu yanıtının en sonunda tek bir kod bloğu olarak ver, yeni sohbeti mod açar."
const RUN_GIVE_UP =
  "otomatik-devir: görev yolu olmadı. Yeniden deneme, start_session çağırma: devam prompt'unu yanıtının en sonunda tek bir kod bloğu olarak ver, yeni sohbeti mod açar."

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
const lastFencedBlock = (text: string, mustEnd = false): string | undefined => {
  let last: string | undefined
  // Nothing but blank lines follows the last non-empty block.
  let isAtEnd = false
  let open: { char: string; size: number; lines: string[] } | undefined
  const close = (): void => {
    const body = open?.lines.join('\n').trim() ?? ''
    if (body !== '') {
      last = body
      isAtEnd = true
    }
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
        isAtEnd = false
      } else if (line.trim() !== '') {
        isAtEnd = false
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

  return mustEnd && !isAtEnd ? undefined : last
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

/** Submits a message the model reads as a turn of its own; throws when it is dropped. */
const sendToAgent = async ($: EngineInterface, text: string): Promise<void> => {
  const sent = await $.prompt.submit({ text, asUser: true })
  if (sent.drop !== undefined) throw new Error(`prompt dropped: ${sent.drop}`)
}

/** The record patch every new handoff starts from. */
const freshHandoff = (now: number): Partial<OtomatikDevirConv> => ({
  phase: 'handoff_running',
  grace: false,
  handoffAt: now,
  handoffTurns: 0,
  isReminded: false,
  isRetried: false,
  heldPrompt: undefined,
  startPrompt: undefined,
  startedId: undefined,
  scheduledTried: false,
  runTries: 0,
  instructedTurn: undefined,
  instructNext: false,
  starting: undefined,
  pendingMessage: undefined,
  isForced: false,
  isGivenUp: false,
  carryFrom: undefined,
  chainTried: false,
  chainUntil: undefined,
})

/** The held prompt with the person's (b) message under it, when it is not in there yet (review M7). */
const withMessage = (prompt: string, message?: string): string =>
  message === undefined || message.trim() === '' || prompt.includes(message.trim())
    ? prompt
    : `${prompt}\n\nSıradaki iş (kullanıcının son mesajı):\n${message.trim()}`

/**
 * Sends the ONE handoff message at once, subagents running or not: it tells
 * the agent to finish what runs, start nothing new, then hand off. The reply
 * may take several turns (subagent results arrive as notification turns);
 * turn.complete waits for a turn ending in the handoff prompt, the guard
 * bounds the wait. `force` (/devir simdi) starts from any phase but a running
 * handoff; otherwise only from idle or warned.
 */
const sendHandoffRequest = async ($: EngineInterface, sid: string, force = false): Promise<void> => {
  const now = await $.clock.now()
  // One handoff at a time: a turn end and /devir simdi racing cannot both send.
  // Clearing `grace` keeps the handoff turn's end from being eaten by the grace
  // branch of turn.complete.
  const isClaimed = await claim(
    $,
    sid,
    held => (force ? held.phase !== 'handoff_running' : held.phase === 'idle' || held.phase === 'warned'),
    { ...freshHandoff(now), via: 'message' },
  )
  if (!isClaimed) return
  const [settings, hasSkill, active] = await Promise.all([
    readSettings($),
    hasHandoffSkill($),
    activeAgents($),
  ])
  $.ui.toast('Devir başlıyor…')
  if (active.length > 0) $.ui.status(`Devir: ${active.length} subagent bitiyor`)
  try {
    await sendToAgent($, handoffMessage(settings.threshold, hasSkill))
  } catch (error) {
    // No handoff turn will come: do not leave the phase at handoff_running,
    // where the next unrelated turn would be parsed as the handoff.
    await setPhase($, sid, 'done')
    $.ui.log(`otomatik-devir: devir başlatılamadı: ${String(error)}`, { to: 'debug' })

    return
  }
  idleSince = isTurnRunning ? undefined : now
  guardHandoff($, sid)
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

/** The new session's id from a start_session result, when it started one. */
const startedId = (result: { deny?: string; isError?: boolean; text?: string }): string | undefined =>
  result.deny !== undefined || result.isError === true
    ? undefined
    : /\b(local_[A-Za-z0-9-]+)/.exec(result.text ?? '')?.[1]

/** Whether this surface has Claude desktop's start_session tool (none in a terminal). */
const hasStartTool = async ($: EngineInterface): Promise<boolean> =>
  (await $.tool.list().catch(() => [])).some(tool => tool.name === START_SESSION)

/**
 * The last fallback in Claude desktop: a card (`own_initiative`) for a new
 * top-level sibling chat with the continuation prompt as its brief; the
 * person's click starts it. The mod never calls `user_asked` or `proposal_id`
 * itself: from a mod's call, after the turn, the app always refuses them.
 * Resolves undefined when the session tools are missing; throws on failure.
 */
const proposeCard = async (
  $: EngineInterface,
  prompt: string,
): Promise<{ title: string; selfId?: string } | undefined> => {
  if (!(await hasStartTool($))) return undefined
  const self = await selfSession($)
  const title = continueTitle(self.title)
  const proposed = await callTool($, {
    tool: START_SESSION,
    initiation: 'own_initiative',
    context: 'fresh',
    title,
    prompt,
    background: CONTINUE_BACKGROUND,
  })
  if (proposed.deny !== undefined) throw new Error(`start_session denied: ${proposed.deny}`)
  if (proposed.isError === true) throw new Error(`start_session failed: ${proposed.text ?? ''}`)
  if (!/task_id: task_[A-Za-z0-9]+/.test(proposed.text ?? '')) {
    throw new Error(`start_session gave no task id: ${proposed.text ?? ''}`)
  }

  return { title, selfId: self.id }
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
 * Continues in a new sibling chat by the card (see proposeCard); this chat
 * stays as it is (not cleared, not archived). Without the session tools, or
 * on failure: clipboard + toast.
 */
const switchChat = async (
  $: EngineInterface,
  sid: string,
  prompt: string,
  surface?: RenderSurface,
): Promise<void> => {
  // Only one switch per prompt: a double press of [Geç] (or Geç racing the
  // otomatik fallback) must not raise two cards.
  const isClaimed = await claim($, sid, held => held.phase === 'awaiting_choice', {
    phase: 'done',
  })
  if (!isClaimed) return
  let card: { title: string; selfId?: string } | undefined
  try {
    card = await proposeCard($, prompt)
  } catch (error) {
    $.ui.log(`otomatik-devir: yeni sohbet açılamadı: ${String(error)}`, { to: 'debug' })
  }
  if (card !== undefined) {
    await patchConv($, sid, { phase: 'done', proposalTitle: card.title })
    $.ui.toast('Devam kartı hazır: karta tıklayınca yeni sohbet açılır.', { timeoutMs: 15000 })
    if (card.selfId === undefined) {
      $.ui.log('otomatik-devir: oturum kimliği yok, kart izlenmiyor', { to: 'debug' })
    } else {
      watchProposal($, card.title, card.selfId)
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

const isOtomatikVia = (held: OtomatikDevirConv): boolean => held.via === 'turn' || held.via === 'scheduled'

/**
 * (re-review N1, N2) An otomatik handoff whose instruction went out
 * (`instructedTurn`) and whose chat is not started, that the guard moved to
 * `deferred` or a give-up ended: the model may still be doing it (it may end
 * its turn to wait on background work the guard cannot see), so its late gate
 * call, task run or start still counts. A `deferred` no instruction went out
 * for (deferHandoff, a dropped (b) message) is not late.
 */
const isLate = (held: OtomatikDevirConv): boolean =>
  isOtomatikVia(held) &&
  held.instructedTurn !== undefined &&
  held.starting === undefined &&
  held.startedId === undefined &&
  (held.phase === 'deferred' || (held.phase === 'done' && held.isGivenUp === true))

/**
 * Claims a late handoff back to handoff_running for the model's call running
 * now (the turn it runs in becomes the instructed one); the record as claimed,
 * or undefined. `orGivenUp` false: a deferred record only.
 */
const reopenLate = async (
  $: EngineInterface,
  held: OtomatikDevirConv,
  sid: string,
  orGivenUp = true,
): Promise<OtomatikDevirConv | undefined> => {
  if (held.sid !== sid || !isLate(held) || (!orGivenUp && held.phase !== 'deferred')) return undefined
  const settings = await readSettings($)
  if (!settings.isEnabled || settings.mode !== 'otomatik') return undefined
  const patch: Partial<OtomatikDevirConv> = {
    phase: 'handoff_running',
    isGivenUp: false,
    instructNext: false,
    instructedTurn: runningTurnId ?? held.instructedTurn,
    handoffTurns: 0,
  }
  const isClaimed = await claim(
    $,
    sid,
    h => isLate(h) && h.phase === held.phase && h.handoffAt === held.handoffAt,
    patch,
  )
  if (!isClaimed) return undefined
  $.ui.log('otomatik-devir: geciken devir adımı yeniden izleniyor', { to: 'debug' })

  return { ...held, ...patch }
}

/** The running turn is the one a (b) claim opened: its message was taken for the person's. */
const isMessageTurn = (held: OtomatikDevirConv): boolean =>
  held.carryFrom !== undefined && held.via === 'turn' && held.instructedTurn === runningTurnId

/**
 * (re-review N3) The gate (or R1) says the (b) message was not the person's:
 * back to deferred, with the carry-over flags as they were before that
 * message claimed it and any prompt held; no card.
 */
const revertMessageClaim = async (
  $: EngineInterface,
  sid: string,
  held: OtomatikDevirConv,
  prompt?: string,
): Promise<void> => {
  gateOpen = false
  await patchConv($, sid, {
    phase: 'deferred',
    via: 'turn',
    isReminded: held.carryFrom?.isReminded ?? held.isReminded,
    carryFrom: undefined,
    pendingMessage: undefined,
    instructNext: false,
    starting: undefined,
    startPrompt: undefined,
    heldPrompt: prompt ?? held.heldPrompt,
  })
}

/**
 * otomatik, no typed turn open: hold the handoff for the person's next typed
 * message (prompt.submit below) instead of sending a message turn of its own.
 */
const deferHandoff = async ($: EngineInterface, sid: string, force = false): Promise<boolean> => {
  const isClaimed = await claim(
    $,
    sid,
    held =>
      force
        ? held.phase !== 'handoff_running' && held.phase !== 'deferred'
        : held.phase === 'idle' || held.phase === 'warned',
    { ...freshHandoff(await $.clock.now()), phase: 'deferred', via: 'turn', isForced: force },
  )
  if (isClaimed) {
    $.ui.toast('Devir: bağlam eşiği aşıldı; yeni sohbet bir sonraki mesajınla açılacak.', {
      timeoutMs: 15000,
    })
  }

  return isClaimed
}

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

/**
 * (a) Inside a turn the person typed (checked by the caller), the threshold
 * is crossed: claim the handoff and return the instruction the model reads
 * after this tool's result; undefined when nothing is due.
 */
const tripInTurn = async ($: EngineInterface): Promise<string | undefined> => {
  const due = await tripDue($)
  if (due === undefined || due.isDeferred) return undefined
  const isClaimed = await claim(
    $,
    due.sid,
    now => now.phase === 'idle' || now.phase === 'warned',
    { ...freshHandoff(await $.clock.now()), via: 'turn', instructedTurn: runningTurnId },
  )
  if (!isClaimed) return undefined
  const [hasSkill, canStart] = await Promise.all([hasHandoffSkill($), hasStartTool($)])
  if (canStart) later($, () => noteSelf($, due.sid))
  $.ui.toast('Devir başlıyor: bu turun içinde yapılacak.')

  return inTurnHandoff(due.threshold, hasSkill, canStart)
}

type Due = { sid: string; threshold: number; isDeferred: boolean; heldPrompt?: string }

/**
 * otomatik, enabled, and either idle or warned with the fill at the
 * threshold, or a handoff already deferred (due whatever the fill): the trip
 * is due.
 */
const tripDue = async ($: EngineInterface): Promise<Due | undefined> => {
  const held = await read($, conv)
  const isDeferred = held !== null && held.phase === 'deferred'
  if (held !== null && !isDeferred && held.phase !== 'idle' && held.phase !== 'warned') return undefined
  const settings = await readSettings($)
  if (!settings.isEnabled || settings.mode !== 'otomatik') return undefined
  if (!isDeferred) {
    const percent = await contextPercent($)
    if (percent === undefined || percent < settings.threshold) return undefined
  }

  return {
    sid: await $.session.id(),
    threshold: settings.threshold,
    isDeferred,
    heldPrompt: isDeferred ? (held?.heldPrompt ?? undefined) : undefined,
  }
}

const toolNames = async ($: EngineInterface): Promise<ReadonlySet<string>> =>
  new Set((await $.tool.list().catch(() => [])).map(tool => tool.name))

const SCHEDULED_NEEDED = [CREATE_TASK, RUN_TASK, LIST_TASKS, GET_SESSION] as const

/**
 * Mid-turn, the threshold is crossed (or a deferred handoff waits). In Claude
 * desktop with the gate tool: one gated instruction in any turn, the gate
 * picks (a) or (s) (a deferred handoff is taken only in a person's turn, so a
 * machine turn does not use up its one carry-over). Without the gate tool:
 * the prompt's origin picks, as before.
 */
const tripMidTurn = async ($: EngineInterface): Promise<string | undefined> => {
  const due = await tripDue($)
  if (due === undefined) return undefined
  const tools = await toolNames($)
  if (tools.has(GATE) && tools.has(START_SESSION)) {
    if (due.isDeferred && !isPersonTurn) return undefined
    return tripGated($, due, SCHEDULED_NEEDED.every(name => tools.has(name)))
  }
  if (due.isDeferred) {
    // No gate tool (an older app): a deferred handoff rides a person's turn
    // too, carry-over flags kept (re-review N5). The terminal (no start tool)
    // keeps waiting for the next typed message, as before.
    if (!isPersonTurn || !tools.has(START_SESSION)) return undefined
    if (!(await claimDeferred($, due))) return undefined
    const hasSkill = await hasHandoffSkill($)
    later($, () => noteSelf($, due.sid))
    $.ui.toast('Devir başlıyor: bu turun içinde yapılacak.')

    return inTurnHandoff(due.threshold, hasSkill, true, due.heldPrompt)
  }

  return isPersonTurn ? tripInTurn($) : tripScheduled($)
}

/** Claims a deferred handoff for an instruction in the running turn; the carry-over flags are kept (review M5). */
const claimDeferred = async ($: EngineInterface, due: Due): Promise<boolean> =>
  claim($, due.sid, held => held.phase === 'deferred', {
    phase: 'handoff_running',
    grace: false,
    handoffAt: await $.clock.now(),
    handoffTurns: 0,
    startPrompt: undefined,
    starting: undefined,
    instructNext: false,
    instructedTurn: runningTurnId,
  })

/** Claims the handoff for the gated instruction; from deferred, the carry-over flags are kept (review M5). */
const tripGated = async ($: EngineInterface, due: Due, canRun: boolean): Promise<string | undefined> => {
  // v0.5 live check, bug 2: the app refuses the gate in a run, so a run chat
  // skips it; the prompt block at the turn's end goes to the relay.
  const isRelayed = isRunChat && chainCapable && isRoleKnown && (await isChainOn($))
  const relayed = { via: 'scheduled' as const, scheduledTried: true, runTries: 0 }
  const isClaimed = due.isDeferred
    ? await claimDeferred($, due)
    : await claim($, due.sid, held => held.phase === 'idle' || held.phase === 'warned', {
        ...freshHandoff(await $.clock.now()),
        via: 'turn',
        instructedTurn: runningTurnId,
        ...(isRelayed ? relayed : {}),
      })
  if (!isClaimed) return undefined
  if (isRelayed && due.isDeferred) await patchConv($, due.sid, relayed)
  const [hasSkill, cwd] = await Promise.all([hasHandoffSkill($), $.session.cwd()])
  later($, () => noteSelf($, due.sid))
  $.ui.toast('Devir başlıyor: yeni sohbet bu turda açılacak.')
  if (isRelayed) return runChatHandoff(due.threshold, hasSkill, due.heldPrompt)

  return gatedHandoff(due.threshold, hasSkill, canRun ? scheduledPlan(cwd) : undefined, due.heldPrompt)
}

/** Whether Claude desktop's scheduled-task and session tools are here (none in a terminal). */
const hasScheduledTools = async ($: EngineInterface): Promise<boolean> => {
  const names = await toolNames($)

  return SCHEDULED_NEEDED.every(name => names.has(name))
}

/**
 * (s) Inside a turn no person typed (checked by the caller), the threshold is
 * crossed: claim the handoff for the scheduled-task path and return the
 * instruction the model reads after this tool's result; undefined when
 * nothing is due or the tools are missing (then (b) at the turn's end).
 */
const tripScheduled = async ($: EngineInterface): Promise<string | undefined> => {
  const due = await tripDue($)
  if (due === undefined || due.isDeferred || !(await hasScheduledTools($))) return undefined
  const isClaimed = await claim(
    $,
    due.sid,
    now => now.phase === 'idle' || now.phase === 'warned',
    {
      ...freshHandoff(await $.clock.now()),
      via: 'scheduled',
      scheduledTried: true,
      instructedTurn: runningTurnId,
    },
  )
  if (!isClaimed) return undefined
  const [hasSkill, cwd] = await Promise.all([hasHandoffSkill($), $.session.cwd()])
  later($, () => noteSelf($, due.sid))
  $.ui.toast('Devir başlıyor: yeni sohbet zamanlanmış görevle açılacak.')

  return scheduledHandoff(due.threshold, hasSkill, scheduledPlan(cwd))
}

/**
 * (s) by the mod's own message, when no tool call is left to carry it (the
 * turn already ended): such a turn cannot start_session, but it can run a
 * task. `held` is a prompt already written. The record must already stand at
 * handoff_running, via `scheduled`.
 */
const sendScheduled = async ($: EngineInterface, sid: string, held?: string): Promise<void> => {
  const [settings, hasSkill, cwd, record] = await Promise.all([
    readSettings($),
    hasHandoffSkill($),
    $.session.cwd(),
    read($, conv),
  ])
  // v0.5: with the chain, a prompt already written needs no model turn (the
  // mod or the relay opens the chat); without one, the model writes it and
  // asks the gate, whose closed answer hands the hop to the chain.
  const isChain = chainCapable && isRoleKnown && record?.sid === sid && record.chainTried !== true
  if (isChain && held !== undefined) {
    await noteSelf($, sid).catch(() => undefined)
    if ((await startChain($, sid, held)) !== undefined) return
  }
  later($, () => noteSelf($, sid))
  await patchConv($, sid, { instructNext: true, instructedTurn: undefined })
  const plan = await planFor($, cwd)
  try {
    await sendToAgent(
      $,
      isChain && held === undefined
        ? isRunChat && (await isChainOn($))
          ? runChatHandoff(settings.threshold, hasSkill)
          : gatedHandoff(settings.threshold, hasSkill, plan)
        : scheduledHandoff(settings.threshold, hasSkill, plan, held),
    )
  } catch (error) {
    $.ui.log(`otomatik-devir: zamanlanmış devir mesajı gitmedi: ${String(error)}`, { to: 'debug' })
    await afterScheduled($, sid, held)

    return
  }
  idleSince = isTurnRunning ? undefined : await $.clock.now()
  guardHandoff($, sid)
}

/** (s) from idle or warned (or any phase but a running or held one, `force`): claim, then send. */
const startScheduled = async ($: EngineInterface, sid: string, force = false): Promise<void> => {
  const isClaimed = await claim(
    $,
    sid,
    held =>
      force
        ? held.phase !== 'handoff_running' && held.phase !== 'deferred'
        : held.phase === 'idle' || held.phase === 'warned',
    { ...freshHandoff(await $.clock.now()), via: 'scheduled', scheduledTried: true },
  )
  if (!isClaimed) return
  $.ui.toast('Devir başlıyor: yeni sohbet zamanlanmış görevle açılacak.')
  await sendScheduled($, sid)
}

/**
 * (s) did not start a chat: the next fallback, (b) on the person's next typed
 * message (with the prompt, when there is one, held for it). Without the
 * session tools: clipboard + toast.
 */
const afterScheduled = async ($: EngineInterface, sid: string, prompt?: string): Promise<void> => {
  if (await hasStartTool($)) {
    await patchConv($, sid, {
      phase: 'deferred',
      via: 'turn',
      heldPrompt: prompt,
      startPrompt: undefined,
      isRetried: true,
      scheduledTried: true,
      instructNext: false,
      starting: undefined,
    })
    $.ui.toast('Zamanlanmış görev yolu olmadı; yeni sohbet bir sonraki mesajınla açılacak.', {
      timeoutMs: 15000,
    })

    return
  }
  if (prompt === undefined) {
    await setPhase($, sid, 'done')
    $.ui.toast("Devir: devam prompt'u bulunamadı.")

    return
  }
  await patchConv($, sid, { phase: 'awaiting_choice', prompt, bandHidden: true })
  await switchChat($, sid, prompt)
}

/** The prompt file, when it was written for this handoff (not before `since`). */
const readDevamFile = async ($: EngineInterface, since?: number): Promise<string | undefined> => {
  try {
    const { file } = scheduledPlan(await $.session.cwd())
    const stat = await $.fs.stat(file)
    if (stat.kind !== 'file' || (since !== undefined && stat.mtimeMs < since)) return undefined
    const body = (await $.fs.read(file)).trim()

    return body === '' ? undefined : body
  } catch {
    return undefined
  }
}

/**
 * (b) The person typed a message while the handoff is deferred: claim it and
 * return the instruction attached to that message; undefined when none.
 */
const tripAtMessage = async ($: EngineInterface, message: string): Promise<string | undefined> => {
  const held = await read($, conv)
  if (held === null || held.phase !== 'deferred') return undefined
  const settings = await readSettings($)
  if (!settings.isEnabled || settings.mode !== 'otomatik') return undefined
  const sid = await $.session.id()
  const now = await $.clock.now()
  // isReminded / isRetried carry over: each carry-over to a typed message is once.
  // The message is kept for any fallback built from the held prompt (M7); the
  // turn it opens is the instructed one (H2, set at turn.start).
  const isClaimed = await claim($, sid, h => h.phase === 'deferred', {
    phase: 'handoff_running',
    via: 'turn',
    grace: false,
    handoffAt: now,
    handoffTurns: 0,
    startPrompt: undefined,
    starting: undefined,
    pendingMessage: message,
    instructNext: true,
    instructedTurn: undefined,
    carryFrom: { isReminded: held.isReminded === true },
  })
  if (!isClaimed) return undefined

  return messageNote($, sid, settings.threshold, held.heldPrompt)
}

/** The (b) instruction for a typed message: gated in Claude desktop, start_session-only otherwise. */
const messageNote = async (
  $: EngineInterface,
  sid: string,
  threshold: number,
  held?: string,
): Promise<string> => {
  const [hasSkill, tools, cwd] = await Promise.all([hasHandoffSkill($), toolNames($), $.session.cwd()])
  const canStart = tools.has(START_SESSION)
  if (canStart) later($, () => noteSelf($, sid))
  if (!canStart || !tools.has(GATE)) return nextMessageHandoff(threshold, hasSkill, canStart, held)
  const plan = SCHEDULED_NEEDED.every(name => tools.has(name)) ? scheduledPlan(cwd) : undefined

  return nextMessageHandoff(threshold, hasSkill, canStart, held, { plan })
}

/**
 * (H2) The person types while an otomatik handoff runs and the turn that got
 * the instruction has ended: that turn's handoff did not land, and this
 * message's turn would otherwise run with no instruction (its reply is not
 * read as the prompt). The first time, the (b) instruction rides on it (the
 * one carry-over); the second time, the handoff gives up.
 */
const reattachAtMessage = async ($: EngineInterface, message: string): Promise<string | undefined> => {
  const held = await read($, conv)
  const sid = await $.session.id()
  if (
    held === null ||
    held.sid !== sid ||
    held.phase !== 'handoff_running' ||
    (held.via !== 'turn' && held.via !== 'scheduled') ||
    held.instructNext === true ||
    held.instructedTurn === undefined ||
    held.starting !== undefined
  ) {
    return undefined
  }
  const settings = await readSettings($)
  if (!settings.isEnabled || settings.mode !== 'otomatik') return undefined
  if (held.isReminded === true) {
    // Work the instruction let the model wait for still runs: not a miss yet,
    // the message passes as typed and its late result still counts (re-review N2).
    if ((await activeAgents($)).length > 0) return undefined
    const isGivenUp = await claim($, sid, h => h.phase === 'handoff_running', {
      phase: 'done',
      isGivenUp: true,
    })
    if (isGivenUp) $.ui.toast("Devir: devam prompt'u bulunamadı.")

    return undefined
  }
  const ready = held.heldPrompt ?? held.startPrompt
  const isClaimed = await claim(
    $,
    sid,
    h =>
      h.phase === 'handoff_running' &&
      h.instructedTurn === held.instructedTurn &&
      h.isReminded !== true &&
      h.starting === undefined,
    {
      via: 'turn',
      isReminded: true,
      handoffAt: await $.clock.now(),
      handoffTurns: 0,
      runTries: 0,
      heldPrompt: ready,
      startPrompt: undefined,
      pendingMessage: message,
      instructNext: true,
      instructedTurn: undefined,
      carryFrom: { isReminded: false },
    },
  )
  if (!isClaimed) return undefined
  $.ui.toast('Devir: yeni sohbet bu mesajınla açılacak.')

  return messageNote($, sid, settings.threshold, ready)
}

type ToolNext = (input: ToolCallArgs) => Promise<{
  deny?: string
  isError?: true
  text?: string
  context?: readonly string[]
}>

/**
 * The model's own start_session during this mod's otomatik handoff: the
 * fields the continuation needs are made sure of (fresh, the title, a
 * background of 80+; the worktree is the app's default, review M3), one start
 * at a time (claimed before the call, review M6), a second start in the same
 * turn is refused, and the outcome is recorded: started (any result that is
 * not a refusal, its id only for the move to top level, review H3), a card
 * the model raised (watched), the person's own "no" (kept for /devir gec,
 * review L5), the gate's refusal R1 (the turn was not the person's: (s) in
 * this same turn, review H1), or another refusal (the prompt kept for the
 * fallback).
 */
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
  if (record !== null && record.sid === sid && record.phase === 'handoff_running' && record.via === 'relay') {
    // v0.5: the mod (or the relay) is opening the chat by a task run.
    return { deny: `otomatik-devir: yeni sohbeti mod zamanlanmış görevle açıyor; ${START_SESSION} çağırma, kart açma.` }
  }
  // A start of a handoff the guard deferred still counts (re-review N1).
  const held =
    record !== null && record.phase === 'deferred'
      ? ((await reopenLate($, record, sid, false)) ?? record)
      : record
  if (held === null || held.sid !== sid || held.phase !== 'handoff_running' || !isOtomatikVia(held)) {
    return next(call as unknown as ToolCallArgs)
  }
  if (call.initiation === 'own_initiative' && call.proposal_id === undefined) {
    // The app's R1 text says "propose the session instead"; while (s) can
    // still start the chat with no click, the card waits (re-review N4).
    const isRunLeft = held.via === 'scheduled' && (held.runTries ?? 0) < MAX_RUN_TRIES
    const canSwitch = !isRunLeft && held.scheduledTried !== true && (await hasScheduledTools($))
    if (isRunLeft || canSwitch) {
      const proposed = typeof call.prompt === 'string' ? call.prompt : undefined
      if (canSwitch) {
        await patchConv($, sid, {
          via: 'scheduled',
          scheduledTried: true,
          runTries: 0,
          heldPrompt: proposed ?? held.heldPrompt,
          startPrompt: undefined,
        })
      }

      return { deny: cardToScheduled(scheduledPlan(await $.session.cwd())) }
    }
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
    later($, async () => {
      // Started from this chat it nests under it: move it to top level. With
      // no id in the result, find it among the sessions this chat started.
      if (id !== undefined) {
        await detachSession($, id)
      } else {
        $.ui.log('otomatik-devir: start_session sonucunda oturum kimliği yok; list_sessions ile aranıyor', {
          to: 'debug',
        })
        const selfId = held.selfId ?? (await selfSession($)).id
        if (selfId !== undefined) watchProposal($, title, selfId)
      }
      $.ui.toast(`Devam yeni sohbette: ${title}`, { timeoutMs: 15000 })
      await refreshStatus($).catch(() => undefined)
    })

    return result
  }
  if (!isRefused && input.initiation === 'own_initiative') {
    // The model raised the card itself: watch it as the mod's own.
    await patchConv($, sid, { phase: 'done', proposalTitle: title })
    later($, async () => {
      const selfId = held.selfId ?? (await selfSession($)).id
      if (selfId !== undefined) watchProposal($, title, selfId)
    })

    return result
  }
  if (isStart) await patchConv($, sid, { starting: undefined })
  if (!isRefused) return result
  // v0.5 review M6: in a run chat the app's own refusal ("nobody has opened
  // this scheduled run") is not the person's "no": the chain takes the hop.
  const isAppDeny = isRunChat && UNOPENED.test(result.deny ?? result.text ?? '')
  if (isAppDeny && held.chainTried !== true) {
    const chained = await startChain($, sid, prompt ?? held.heldPrompt)
    if (chained !== undefined) {
      return { ...result, context: [...(result.context ?? []), chainNote(chained)] }
    }
  }
  if (result.deny !== undefined && !isAppDeny) {
    // The person's "no" on the permission card (or a hook's): no card on top.
    const ready = prompt ?? held.heldPrompt
    await patchConv(
      $,
      sid,
      ready === undefined ? { phase: 'done' } : { phase: 'awaiting_choice', prompt: ready, bandHidden: true },
    )
    $.ui.toast(
      ready === undefined
        ? 'Yeni sohbet açılmadı (reddedildi).'
        : 'Yeni sohbet açılmadı (reddedildi); istersen /devir gec ile kartı aç.',
      { timeoutMs: 15000 },
    )

    return result
  }
  if (R1.test(result.text ?? '')) {
    gateOpen = false
    // v0.5: the chain takes the hop with the prompt the model gave the start.
    const chained = held.chainTried === true ? undefined : await startChain($, sid, prompt ?? held.heldPrompt)
    if (chained !== undefined) {
      return { ...result, context: [...(result.context ?? []), chainNote(chained)] }
    }
    if (held.via === 'scheduled') {
      return { ...result, context: [...(result.context ?? []), R1_IN_SCHEDULED] }
    }
    if (held.scheduledTried !== true && (await hasScheduledTools($))) {
      const plan = scheduledPlan(await $.session.cwd())
      await patchConv($, sid, {
        via: 'scheduled',
        scheduledTried: true,
        runTries: 0,
        heldPrompt: prompt ?? held.heldPrompt,
        startPrompt: undefined,
      })

      return { ...result, context: [...(result.context ?? []), refusedToScheduled(plan)] }
    }
    if (isMessageTurn(held)) {
      // (s) is out and the (b) message was not the person's: wait for theirs.
      await revertMessageClaim($, sid, held, prompt)

      return { ...result, context: [...(result.context ?? []), NOT_PERSON_NOTE] }
    }
  }
  if (prompt !== undefined) await patchConv($, sid, { startPrompt: prompt })

  return {
    ...result,
    context: [
      ...(result.context ?? []),
      'otomatik-devir: yeni sohbet açılamadı. Yeniden deneme, kart açma; turu tek satırla bitir: devamını mod üstlenir.',
    ],
  }
}

/**
 * The model's gate call (GATE): any filled answer is remembered (REPOS_SEEN);
 * during an otomatik handoff, the mod's note on the result names the path for
 * this turn: (a) when open, (s) when closed, the prompt as a code block when
 * closed and (s) is out. Unreadable, or empty before any filled answer was
 * seen: the prompt's origin decides (R1 still switches to (s)).
 */
const watchGate = async (
  $: EngineInterface,
  call: { tool: string } & Record<string, unknown>,
  next: ToolNext,
) => {
  const result = await next(call as unknown as ToolCallArgs)
  if (result.deny !== undefined) return result
  // v0.5 live check, bug 2: an error ("Starting sessions requires a user at
  // the keyboard; this session runs unattended…") is the gate's "closed".
  const isFailed = result.isError === true
  const count = isFailed ? 0 : repoCount(result.text)
  if (count !== undefined && count > 0) await $.store.set(REPOS_SEEN, true).catch(() => undefined)
  const record = await read($, conv)
  const sid = await $.session.id()
  // The gate call of a handoff the guard deferred or gave up still counts (re-review N1, N2).
  const held =
    record !== null && record.phase !== 'handoff_running'
      ? ((await reopenLate($, record, sid)) ?? record)
      : record
  if (
    held === null ||
    held.sid !== sid ||
    held.phase !== 'handoff_running' ||
    (held.via !== 'turn' && held.via !== 'scheduled') ||
    held.starting !== undefined ||
    (held.via === 'scheduled' && (held.runTries ?? 0) > 0)
  ) {
    return result
  }
  const isKnown =
    isFailed ||
    (count !== undefined && (count > 0 || (await $.store.get(REPOS_SEEN).catch(() => undefined)) === true))
  // A run chat is (a) only on the gate's own word, never on the prompt's
  // origin: an unopened run auto-denies start_session (v0.5 review M6).
  const isOpen = isKnown ? (count ?? 0) > 0 : isPersonTurn && !(isRunChat && chainCapable && isRoleKnown)
  if (isKnown) gateOpen = isOpen
  const tools = await toolNames($)
  const canRun = SCHEDULED_NEEDED.every(name => tools.has(name))
  const plan = canRun ? await planFor($, await $.session.cwd()) : undefined
  let note: string
  if (isOpen && tools.has(START_SESSION)) {
    await patchConv($, sid, { via: 'turn' })
    note = gateOpenNote(plan)
  } else if (chainCapable && isRoleKnown && held.chainTried !== true && (await isChainOn($))) {
    // v0.5: the chain takes the hop, once the prompt file is this handoff's.
    gateOpen = false
    const chained = await startChain($, sid, held.heldPrompt)
    note = chained !== undefined ? chainNote(chained) : fileFirstNote(scheduledPlan(await $.session.cwd()).file)
  } else if (plan !== undefined && (held.via === 'scheduled' || held.scheduledTried !== true)) {
    await patchConv($, sid, { via: 'scheduled', scheduledTried: true, runTries: 0 })
    note = gateClosedNote(plan)
  } else if (isMessageTurn(held)) {
    // Closed in the turn a (b) claim opened, (s) out: the message was not the
    // person's (an app wake-up reads `sdk`), so (b) is not used up (re-review N3).
    await revertMessageClaim($, sid, held)
    note = NOT_PERSON_NOTE
  } else {
    gateOpen = false
    note = GATE_NONE
  }

  return { ...result, context: [...(result.context ?? []), note] }
}

/** How many repositories list_start_targets lists for this computer; undefined when unreadable. */
const repoCount = (text: string | undefined): number | undefined => {
  if (text === undefined) return undefined
  try {
    const info = JSON.parse(text) as { thisComputer?: { repositories?: unknown } }
    const repos = info?.thisComputer?.repositories
    if (Array.isArray(repos)) return repos.length
    if (repos !== null && typeof repos === 'object') return Object.keys(repos).length
  } catch {
    // not JSON: read the field from the text below
  }
  const field = /"repositories"\s*:\s*([[{])\s*(\S)/.exec(text)
  if (field === null) return undefined

  return (field[1] === '{' && field[2] === '}') || (field[1] === '[' && field[2] === ']') ? 0 : 1
}

const SCHEDULED_TOOLS: ReadonlySet<string> = new Set([CREATE_TASK, RUN_TASK, UPDATE_TASK, DELETE_TASK])

/**
 * The mod's own tasks are never deleted (a delete archives every chat the
 * task started) nor updated (the prompt is static), by anyone whose call
 * passes this hook: the model, a subagent, another plugin (re-review N8). It
 * needs no `context`, so another plugin's call is denied too.
 */
const taskGuard = (call: { tool: string } & Record<string, unknown>): { deny: string } | undefined => {
  if (!isOwnTask(call.taskId)) return undefined
  if (call.tool === DELETE_TASK) {
    return { deny: 'otomatik-devir: bu görev silinmez; silmek, görevin açtığı devam sohbetlerini arşivler.' }
  }
  if (call.tool === UPDATE_TASK) {
    return { deny: "otomatik-devir: bu görev güncellenmez; prompt'u sabittir, yalnızca çalıştır." }
  }

  return undefined
}

/**
 * The model's scheduled-task calls on this mod's tasks (`otomatik-devir-...`):
 * never deleted (a delete archives every chat the task started) nor updated
 * (the prompt is static); a create of this folder's two gets the static
 * prompt, no schedule, no completion notices to this chat; a run during the
 * (s) handoff is bounded (not this chat's own task, at most two tries, once
 * started no more) and its outcome recorded: started (phase done, the
 * settings to copy handed to the model) or refused (try the other once, then
 * the prompt as a code block for the fallback).
 */
const watchScheduled = async (
  $: EngineInterface,
  call: { tool: string } & Record<string, unknown>,
  next: ToolNext,
) => {
  const taskId = call.taskId
  const guarded = taskGuard(call)
  if (guarded !== undefined) return guarded
  if (call.tool === CREATE_TASK && typeof taskId === 'string') {
    // A create retried under the app's suggested free id ("...-a-2") would
    // make a task outside the pair, with the default prompt and notices (N10).
    const base = OWN_TASK_RETRY.exec(taskId)?.[1]
    if (base !== undefined && isThisFolder(base, await $.session.cwd())) {
      return { deny: `otomatik-devir: "${base}" görevi zaten var; yeni görev oluşturma, onu ${RUN_TASK} ile çalıştır.` }
    }
  }
  if (!isOwnTask(taskId)) return next(call as unknown as ToolCallArgs)
  const cwd = await $.session.cwd()
  const plan = scheduledPlan(cwd)
  if (call.tool === CREATE_TASK) {
    if (!isThisFolder(taskId, cwd)) return next(call as unknown as ToolCallArgs)
    const gen = genOf(taskId)
    // Ad-hoc: no schedule. The envelope (tool, tool_use_id...) stays the engine's.
    const { cronExpression: _cron, fireAt: _at, ...rest } = call
    // One create at a time: parallel creates must not lose each other's record (v0.5 review M3).
    return serialCreate(async () => {
      const result = await next({
        ...rest,
        title: taskTitle(cwd, taskId),
        description: TASK_DESCRIPTION,
        // v0.4 pair: the read-the-file prompt; v0.5 generations: the bootstrap turn.
        prompt: gen === 0 ? taskPrompt(plan.file) : BOOTSTRAP_PROMPT,
        notifyOnCompletion: false,
      } as unknown as ToolCallArgs)
      if (gen > 0 && isCalled(result)) await noteCreated($, cwd, taskId, result.text)

      return result
    })
  }
  // run_scheduled_task
  const record = await read($, conv)
  const sid = await $.session.id()
  // v0.5 review M1: the mod (or the relay) owns this hop; the model's own run would open a second chat.
  if (
    record !== null &&
    record.sid === sid &&
    record.via === 'relay' &&
    (record.phase === 'handoff_running' || (record.phase === 'done' && record.startedId !== undefined))
  ) {
    return { deny: 'otomatik-devir: yeni sohbeti mod zamanlanmış görevle açıyor ya da açtı; görevi çalıştırma.' }
  }
  // A run during any otomatik handoff counts (the model may run the task
  // without asking the gate first): recorded as (s) once it runs.
  if (record === null || record.sid !== sid || !isOtomatikVia(record)) {
    return next(call as unknown as ToolCallArgs)
  }
  if (record.phase === 'done' && record.startedId !== undefined) {
    return { deny: `otomatik-devir: devam sohbeti zaten açıldı (${record.startedId}); ikinci kez çalıştırma.` }
  }
  // A late run of a handoff the guard deferred or gave up is still this
  // handoff's (re-review N1, N2): tracked, so (b) does not open a second chat.
  const held =
    record.phase === 'handoff_running' ? record : ((await reopenLate($, record, sid)) ?? record)
  if (held.phase !== 'handoff_running') return next(call as unknown as ToolCallArgs)
  if (held.selfTaskId === taskId) {
    return {
      deny: `otomatik-devir: bu sohbet "${taskId}" görevinin çalışması; diğer görevi (${pairOf(taskId).find(id => id !== taskId) ?? ''}) çalıştır.`,
    }
  }
  const tries = (held.runTries ?? 0) + 1
  if (tries > MAX_RUN_TRIES) return { deny: RUN_GIVE_UP }
  // One run at a time (parallel calls in one message, review M6).
  const isClaimed = await claim(
    $,
    sid,
    h => h.phase === 'handoff_running' && h.starting === undefined && (h.runTries ?? 0) === tries - 1,
    { runTries: tries, starting: 'run', via: 'scheduled', scheduledTried: true },
  )
  if (!isClaimed) return { deny: 'otomatik-devir: görev şu an çalıştırılıyor ya da çalıştı; ikinci kez çalıştırma.' }
  let result: Awaited<ReturnType<ToolNext>>
  try {
    result = await next(call as unknown as ToolCallArgs)
  } catch (error) {
    await patchConv($, sid, { starting: undefined })
    throw error
  }
  if (result.deny !== undefined || result.isError === true) await patchConv($, sid, { starting: undefined })
  if (result.deny !== undefined) return result
  if (result.isError === true) {
    return {
      ...result,
      context: [...(result.context ?? []), tries < MAX_RUN_TRIES ? RUN_RETRY : RUN_GIVE_UP],
    }
  }
  const id = startedId(result)
  // A start_session after this run in the same turn is a second chat (re-review N6).
  startedInTurn = runningTurnId
  await patchConv($, sid, { phase: 'done', startedId: id ?? taskId, starting: undefined })
  later($, async () => {
    $.ui.toast(`Devam yeni sohbette (zamanlanmış görev ${taskId}).`, { timeoutMs: 15000 })
    await refreshStatus($).catch(() => undefined)
  })

  return {
    ...result,
    context: [...(result.context ?? []), syncText(id, held, genOf(taskId) > 0 ? plan.file : undefined)],
  }
}

/**
 * No handoff prompt in time: the first time, one short reminder (and the
 * counters start over); the second time, give up as before (done + toast).
 * Never more than one reminder, so the wait always ends.
 */
const nudge = async ($: EngineInterface, sid: string): Promise<'reminded' | 'gave_up' | 'none'> => {
  const now = await $.clock.now()
  const record = await read($, conv)
  const isOtomatik = record?.via === 'turn' || record?.via === 'scheduled'
  if (record !== null && record.sid === sid && isOtomatik) {
    // otomatik: no reminder message turn. The first miss carries the handoff
    // over to the person's next typed message; the second gives up below.
    const isCarried = await claim(
      $,
      sid,
      held => held.phase === 'handoff_running' && held.isReminded !== true,
      { phase: 'deferred', isReminded: true, handoffTurns: 0, handoffAt: now },
    )
    if (isCarried) {
      $.ui.toast("Devir: devam prompt'u gelmedi; bir sonraki mesajınla yeniden denenecek.")

      return 'reminded'
    }
  }
  const isReminderDue =
    !isOtomatik &&
    (await claim(
      $,
      sid,
      held => held.phase === 'handoff_running' && held.isReminded !== true,
      { isReminded: true, handoffTurns: 0, handoffAt: now },
    ))
  if (isReminderDue) {
    idleSince = isTurnRunning ? undefined : now
    try {
      await sendToAgent($, reminderText(await hasHandoffSkill($)))
      $.ui.toast("Devir: devam prompt'u gelmedi, hatırlatma gönderildi.")

      return 'reminded'
    } catch (error) {
      $.ui.log(`otomatik-devir: hatırlatma gönderilemedi: ${String(error)}`, { to: 'debug' })
      // No reminder turn will come: fall through and give up now.
    }
  }
  // otomatik: a late gate call or task run of this handoff still counts (re-review N1, N2).
  const isGivenUp = await claim($, sid, held => held.phase === 'handoff_running', {
    phase: 'done',
    ...(isOtomatik ? { isGivenUp: true } : {}),
  })
  if (!isGivenUp) return 'none'
  $.ui.toast("Devir: devam prompt'u bulunamadı.")
  await refreshStatus($).catch(() => undefined)

  return 'gave_up'
}

/**
 * (re-review N1) A machine turn ends while a handoff the guard deferred (or
 * one a non-person (b) message gave back, N3) has no prompt yet: its reply's
 * last code block is the late prompt. (s) next when it was not tried, else
 * held for the person's next typed message; never the card from here.
 */
const takeLatePrompt = async (
  $: EngineInterface,
  held: OtomatikDevirConv,
  answer: string,
  isSkipped: boolean,
): Promise<void> => {
  if (isSkipped || !isLate(held) || held.phase !== 'deferred' || held.heldPrompt !== undefined) return
  const prompt = lastFencedBlock(answer, true)
  if (prompt === undefined) return
  const same = (h: OtomatikDevirConv): boolean =>
    h.phase === 'deferred' && h.handoffAt === held.handoffAt && h.heldPrompt === undefined
  if (held.scheduledTried !== true && (await hasScheduledTools($))) {
    const isClaimed = await claim($, held.sid, same, {
      phase: 'handoff_running',
      via: 'scheduled',
      scheduledTried: true,
      heldPrompt: prompt,
      startPrompt: undefined,
      handoffAt: await $.clock.now(),
      handoffTurns: 0,
      runTries: 0,
    })
    if (isClaimed) later($, () => sendScheduled($, held.sid, prompt))

    return
  }
  if (await claim($, held.sid, same, { heldPrompt: prompt })) {
    $.ui.toast("Devam prompt'u hazır: yeni sohbet bir sonraki mesajınla açılacak.", { timeoutMs: 15000 })
  }
}

/**
 * Bounds a handoff that gets no more turns: every 5 s while `sid` stands at
 * handoff_running and no main turn runs, it shows "N subagent bitiyor" and
 * nudges after GUARD_IDLE_MS idle with no subagent left, or GUARD_LIMIT_MS
 * since the request (or the reminder) in any case. Stops with the phase.
 */
const guardHandoff = ($: EngineInterface, sid: string): void => {
  if (isGuarding) return
  isGuarding = true
  let timer: Timer | undefined
  let isTicking = false
  const stop = (): void => {
    timer?.cancel()
    isGuarding = false
  }
  const tick = async (): Promise<void> => {
    const held = await read($, conv)
    if (held === null || held.sid !== sid || held.phase !== 'handoff_running') return stop()
    if ((await $.session.id()) !== sid) return stop()
    // v0.5: the mod or the relay owns the hop, bounded by its deadline (review M5): past it, (b).
    if (held.via === 'relay') {
      const until = held.chainUntil
      if (until === undefined || (await $.clock.now()) < until) return
      stop()
      const isClaimed = await claim(
        $,
        sid,
        h => h.phase === 'handoff_running' && h.via === 'relay' && h.chainUntil === until,
        { phase: 'deferred', via: 'turn' },
      )
      if (isClaimed) await afterScheduled($, sid, await readDevamFile($, held.handoffAt))
      return
    }
    if (isTurnRunning) return
    const now = await $.clock.now()
    idleSince ??= now
    const active = (await activeAgents($)).length
    $.ui.status(active > 0 ? `Devir: ${active} subagent bitiyor` : "Devir: devam prompt'u bekleniyor")
    const isIdleTooLong = active === 0 && now - idleSince >= GUARD_IDLE_MS
    const isTooLong = now - (held.handoffAt ?? now) >= GUARD_LIMIT_MS
    if (!isIdleTooLong && !isTooLong) return
    if ((await nudge($, sid)) !== 'reminded') stop()
  }
  timer = $.clock.every(WATCH_MS, () => {
    if (isTicking) return
    isTicking = true
    tick()
      .catch(error => {
        stop()
        $.ui.log(`otomatik-devir: devir bekçisi durdu: ${String(error)}`, { to: 'debug' })
      })
      .finally(() => {
        isTicking = false
      })
  })
}

// ---------------------------------------------------------------------------
// v0.5 endless chain: own dispatch, relay, bootstrap, pre-provisioning
// ---------------------------------------------------------------------------
//
// A run session (a chat a scheduled task started) can never call
// run_scheduled_task (app rule). So every hop is dispatched by a regular
// session: the old chat's own mod when it is a regular chat ($.tool.call), or
// the relay, any live regular session with the mod loaded, for a run chat
// (its request waits in the shared $.store). The task's prompt is a tiny
// bootstrap turn; the dispatcher then syncs effort/model/permission mode and
// sends the real prompt with send_message, so the work runs with the chain's
// settings from the second turn on.

// The tools the chain needs (Claude desktop); without them v0.4 runs as before.
const CHAIN_NEEDED = [CREATE_TASK, RUN_TASK, LIST_TASKS, GET_SESSION, SEND_MESSAGE, SET_EFFORT] as const
// $.store keys (one JSON file shared by every session of the mod).
const RELAY_LOCK = 'aktarici'
const REQ_PREFIX = 'istek:'
const PAIR_PREFIX = 'zincir:'
const PROVISION_PREFIX = 'hazirlik:'
// One-shot guard of a request (`<id>@<at>`): written once its task run started,
// checked before any dispatch and before a re-post (review M2).
const DONE_PREFIX = 'gonderildi:'
// A task's permission mode as a run of it showed it (get_session "self") or
// the task list did: the mode the app starts its runs in (review H1).
const MODE_PREFIX = 'gorevModu:'
// The one-time setup hint was shown for this folder (one toast per folder).
const HINT_PREFIX = 'ipucu:'
const RELAY_TICK_MS = 5000
// A relay whose heartbeat is older than this is gone: another session takes over.
const RELAY_STALE_MS = 30 * 1000
// Write, wait, read back: the store has no compare-and-set, so a claim (of the
// relay lock or of a request) holds only if it is still ours after this.
const SETTLE_MS = 500
const CLAIM_STALE_MS = 2 * 60 * 1000
const REQUEST_TTL_MS = 30 * 60 * 1000
const REQUEST_RETRY_MS = 30 * 1000
const MAX_REQUEST_TRIES = 3
// A relay's dispatch of one request: past this it lets the lock go and the
// request goes back to the queue (review H2).
const DISPATCH_LIMIT_MS = 3 * 60 * 1000
// One hop the mod dispatches itself: past this, (b) (review M5).
const HOP_LIMIT_MS = 10 * 60 * 1000
// A partner task with a turn running is waited for this long (review M9).
const BUSY_LIMIT_MS = 10 * 60 * 1000
// Each settings call and the send: never an unbounded wait before the prompt (review H1).
const CALL_LIMIT_MS = 60 * 1000
const SYNC_POLL_MS = 2000
const SYNC_TRIES = 15
// An open ask holds off other chats in the folder only this long, and only
// until the asking session's turn ends (v0.5 live check, bug 3).
const ASK_TTL_MS = 10 * 60 * 1000
// "Not saved" results per folder and day before pre-provisioning stops asking (review H3).
const MAX_PROVISION_MISSES = 2
const MAX_GEN = 12
// The modes the app keeps with a task created in a person's own turn, and
// the only ones a relay may dispatch in (no dialog, review H2).
const SAVABLE_MODES: ReadonlySet<string> = new Set(['auto', 'bypassPermissions'])
const EFFORTS: ReadonlySet<string> = new Set(['low', 'medium', 'high', 'xhigh', 'max'])
const BUSY = /already (?:has a run|running)|in progress/i
const DELIVERED = /\bdelivery:\s*(?:delivered|queued)\b/i
const NOT_DELIVERED = /\bnot\s+(?:been\s+)?delivered\b|could not deliver|cannot deliver|wasn't delivered/i
// The app's auto-deny inside a scheduled run nobody opened (task-settings Q4).
const UNOPENED = /nobody has opened this scheduled run/i

/** A folder's active task pair (the newest generation the mod dispatches). */
type ChainPair = { gen: number; ids: [string, string]; savedMode: string | null; model?: string }
/** A pair the model was asked to create in a person's turn. */
type Provision = {
  gen: number
  ids: [string, string]
  mode: string
  model?: string
  at: number
  state: 'asked' | 'done' | 'failed'
  /** 'unknown': the create result had no mode sentence the mod knows (never a miss). */
  created: Record<string, 'saved' | 'unsaved' | 'unknown'>
  /** The asking session; its claim on the ask ends at `until` (its turn's end, or ASK_TTL_MS). */
  by?: string
  until?: number
  /** "Not saved" pairs on `missDay` (UTC date); at MAX_PROVISION_MISSES no more asks that day. */
  misses?: number
  missDay?: string
}
/** A run chat's handoff request, one-shot: pending → claimed (one relay) → done | failed. */
export type ChainRequest = {
  id: string
  cwd: string
  file: string
  /** The requester's own task: never the one dispatched. */
  taskId?: string
  model?: string
  effort?: string
  permissionMode?: string
  at: number
  state: 'pending' | 'claimed' | 'done' | 'failed'
  by?: string
  claimedAt?: number
  beatAt?: number
  runId?: string
  sent?: boolean
  tries?: number
  retryAt?: number
  reason?: string
}

// This session's role, from get_session "self" (scheduledTaskId = a run).
let chainCapable = false
let isRoleKnown = false
let isRunChat = false
let isChainRun = false
let selfInfo: SelfSession = {}
// A run's own mode was noted once this session (its task's saved mode).
let isModeNoted = false
// A machine's input joined (or opened) the running main turn (it does not qualify to save a mode).
let turnHadMachine = false
// Pre-provisioning is asked at most once per session.
let isProvisionAsked = false
// The folder whose ask this session holds until its turn ends (v0.5 live check, bug 3).
let askedCwd: string | undefined
let relayTimer: Timer | undefined
let requestTimer: Timer | undefined
let isRelayTicking = false
let isProcessing = false
// A dispatch past its deadline has not settled yet: this session is no relay until it does (H2).
let isStuck = false
// Requests this module claimed and is dispatching, and those whose run it started.
const inFlight = new Set<string>()
const dispatched = new Set<string>()
// Creates of the mod's tasks, one at a time (review M3).
let createQueue: Promise<unknown> = Promise.resolve()

const serialCreate = <T,>(work: () => Promise<T>): Promise<T> => {
  const run = createQueue.then(work, work)
  createQueue = run.catch(() => undefined)

  return run
}

const record = (value: unknown): Record<string, unknown> | undefined =>
  value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined

const asPair = (value: unknown): ChainPair | undefined => {
  const got = record(value)
  const ids = got?.ids
  return Array.isArray(ids) && ids.length === 2 && ids.every(isOwnTask) && typeof got?.gen === 'number'
    ? (got as unknown as ChainPair)
    : undefined
}

const asProvision = (value: unknown): Provision | undefined => {
  const got = record(value)
  return got !== undefined && typeof got.gen === 'number' && Array.isArray(got.ids)
    ? (got as unknown as Provision)
    : undefined
}

const asRequest = (value: unknown): ChainRequest | undefined => {
  const got = record(value)
  return got !== undefined && typeof got.id === 'string' && typeof got.state === 'string' && typeof got.at === 'number'
    ? (got as unknown as ChainRequest)
    : undefined
}

const asLock = (value: unknown): { id: string; at: number } | undefined => {
  const got = record(value)
  return typeof got?.id === 'string' && typeof got.at === 'number' ? (got as { id: string; at: number }) : undefined
}

const hashOf = (cwd: string): string => cwdHash(folderOf(cwd))
const pairKey = (cwd: string): string => `${PAIR_PREFIX}${hashOf(cwd)}`
const provisionKey = (cwd: string): string => `${PROVISION_PREFIX}${hashOf(cwd)}`
const isThisFolder = (id: string, cwd: string): boolean => id.startsWith(`${tagOf(cwd)}-`)
const markKey = (req: { id: string; at: number }): string => `${DONE_PREFIX}${req.id}@${req.at}`
const dayOf = (ms: number): string => new Date(ms).toISOString().slice(0, 10)
const isSavable = (mode: unknown): mode is string => typeof mode === 'string' && SAVABLE_MODES.has(mode)

// The create result's mode sentence (v0.5 live check, bug 1). Saved, as the
// app says it: "This task was saved in Bypass permissions mode because this
// session is in it: …" (Auto: "… saved in Auto mode …"); not saved: "This
// session's permission mode was not saved with this task".
const MODE_NOT_SAVED =
  /\bpermission mode\b[^.]*?\b(?:(?:was|is|has)\s+not\s+(?:been\s+)?|(?:wasn't|isn't|hasn't been)\s+)(?:saved|kept)\b/i
const MODE_SAVED_IN = /\btask was saved in ([^.:]*?)\s+mode\b/i
const MODE_SAVED_OLD = /\bpermission mode\b[^.]*\b(?:was|is|has been)\s+(?:saved|kept)\b/i

/**
 * Whether the app says it kept the session's permission mode with the new
 * task: true on its "saved in Bypass permissions/Auto mode" sentence, false
 * on its "not saved" one, undefined on any other wording (unknown: never a
 * miss, and the pair is not dispatched on it) (review M8).
 */
export const savedFrom = (text: string | undefined): boolean | undefined => {
  if (text === undefined) return undefined
  if (MODE_NOT_SAVED.test(text)) return false
  const savedIn = MODE_SAVED_IN.exec(text)?.[1]
  if (savedIn !== undefined) return /\b(?:bypass|auto)\b/i.test(savedIn) ? true : undefined
  return MODE_SAVED_OLD.test(text) ? true : undefined
}

const isCalled = (result: { deny?: string; isError?: boolean }): boolean =>
  result.deny === undefined && result.isError !== true

/**
 * This session's role (a run or not) and settings; unknown until get_session
 * answers. A run of the mod's own task notes its mode once: the app starts a
 * run in its task's saved mode only, so this is that task's mode (review H1).
 */
const refreshRole = async ($: EngineInterface): Promise<void> => {
  const self = await selfSession($)
  if (self.id === undefined) return
  selfInfo = self
  isRoleKnown = true
  isRunChat = self.taskId !== undefined
  isChainRun = isOwnTask(self.taskId)
  if (!isChainRun || isModeNoted || self.permissionMode === undefined || self.taskId === undefined) return
  isModeNoted = true
  if ((await $.store.get('mod').catch(() => undefined)) !== 'otomatik') return
  const key = `${MODE_PREFIX}${self.taskId}`
  if (record(await $.store.get(key).catch(() => undefined))?.mode === self.permissionMode) return
  await $.store.set(key, { mode: self.permissionMode, at: await $.clock.now() }).catch(() => undefined)
}

const refreshChainTools = async ($: EngineInterface): Promise<boolean> => {
  const names = await toolNames($)
  chainCapable = CHAIN_NEEDED.every(name => names.has(name))

  return chainCapable
}

/** The folder's active pair, if one was recorded. */
const readPair = async ($: EngineInterface, cwd: string): Promise<ChainPair | undefined> =>
  asPair(await $.store.get(pairKey(cwd)).catch(() => undefined))

/** The plan the model's own task steps use: the chain's pair in Claude desktop, else the v0.4 pair. */
const planFor = async ($: EngineInterface, cwd: string): Promise<ScheduledPlan> => {
  if (!chainCapable) return scheduledPlan(cwd)
  const pair = await readPair($, cwd)

  return { file: scheduledPlan(cwd).file, ids: pair?.ids ?? genIds(tagOf(cwd), 1) }
}

/** The mode both tasks of a pair start their runs in, when it is Auto or Bypass (a run's own word beats the create result). */
const pairMode = async ($: EngineInterface, pair: ChainPair): Promise<string | undefined> => {
  const seen = await Promise.all(
    pair.ids.map(async id => record(await $.store.get(`${MODE_PREFIX}${id}`).catch(() => undefined))?.mode),
  )
  const modes = seen.map(mode => (typeof mode === 'string' ? mode : (pair.savedMode ?? undefined)))

  return modes.every(isSavable) ? modes[0] : undefined
}

/** Task id → permission mode, where the task list names one (its JSON fields). */
const modesFromList = (text: string | undefined): Map<string, string> => {
  const modes = new Map<string, string>()
  try {
    const got: unknown = JSON.parse(text ?? '')
    const list = Array.isArray(got) ? got : record(got)?.tasks
    if (!Array.isArray(list)) return modes
    for (const item of list) {
      const task = record(item)
      const id = nonEmpty(task?.taskId) ?? nonEmpty(task?.id)
      const mode = nonEmpty(task?.permissionMode)
      if (id !== undefined && mode !== undefined) modes.set(id, mode)
    }
  } catch {
    // not JSON: no modes
  }

  return modes
}

/**
 * A pair a hop may use (review H1): the app starts its runs in Auto or
 * Bypass, because the create said the mode was saved, a run of it showed the
 * mode, or (with `mayList`) the task list shows one set in the app. The mod
 * never sets a run's permission mode (raising a mode always shows a card), so
 * any other pair would wait on a card nobody sees.
 */
const readyPair = async (
  $: EngineInterface,
  cwd: string,
  own: string | undefined,
  mayList: boolean,
): Promise<ChainPair | undefined> => {
  const stored = await readPair($, cwd)
  if (stored !== undefined && stored.gen > 0) {
    const mode = await pairMode($, stored)
    if (mode !== undefined) return { ...stored, savedMode: mode }
  }
  if (isOwnTask(own) && genOf(own) > 0 && isThisFolder(own, cwd)) {
    const mine: ChainPair = { gen: genOf(own), ids: pairOf(own), savedMode: null }
    const mode = await pairMode($, mine)
    if (mode !== undefined) return { ...mine, savedMode: mode }
  }
  if (!mayList) return undefined
  const listed = await callTool($, { tool: LIST_TASKS }).catch(() => undefined)
  if (listed === undefined || !isCalled(listed)) return undefined
  const modes = modesFromList(listed.text)
  let best: ChainPair | undefined
  for (const [id, mode] of modes) {
    if (!isOwnTask(id) || !isThisFolder(id, cwd) || genOf(id) === 0 || !id.endsWith('a')) continue
    const ids = pairOf(id)
    if (!isSavable(mode) || !isSavable(modes.get(ids[1]))) continue
    if (best === undefined || genOf(id) > best.gen) best = { gen: genOf(id), ids, savedMode: mode }
  }
  if (best === undefined) return undefined
  const at = await $.clock.now()
  for (const id of best.ids) await $.store.set(`${MODE_PREFIX}${id}`, { mode: modes.get(id), at })
  await $.store.set(pairKey(cwd), best)

  return best
}

/** The one-time setup, said once per folder (review H1). */
export const SETUP_HINT =
  "Devir zinciri: bu klasörde izin modu kayıtlı görev çifti yok, bu yüzden yeni sohbet bir sonraki mesajınla açılacak. Bir kez yapılacak ayar: bu klasördeki normal bir sohbette Auto ya da Bypass modundayken herhangi bir mesaj yazın (mod kayıtlı çifti o turda oluşturur) ya da uygulamada Zamanlanmış görevler'de otomatik-devir görevlerini düzenleyip izin modunu bir kez seçin."

const hintOnce = async ($: EngineInterface, cwd: string): Promise<void> => {
  const key = `${HINT_PREFIX}${hashOf(cwd)}`
  if ((await $.store.get(key).catch(() => undefined)) !== undefined) return
  await $.store.set(key, await $.clock.now()).catch(() => undefined)
  $.ui.toast(SETUP_HINT, { timeoutMs: 30000 })
}

/**
 * Puts `model: <model>` into a task's SKILL.md frontmatter (the app reads it
 * at every run when the task record has no model), unless one is there.
 * Only the model line: the file holds no permission or effort key.
 */
const writeModelLine = async ($: EngineInterface, id: string, model: string | undefined): Promise<void> => {
  if (model === undefined) return
  try {
    const home = await $.env.get('HOME')
    if (home === undefined) return
    const path = `${home}/.claude/scheduled-tasks/${id}/SKILL.md`
    const text = await $.fs.read(path)
    if (!text.startsWith('---')) return
    const end = text.indexOf('\n---', 3)
    if (end < 0) return
    const head = text.slice(0, end)
    if (/^model:/m.test(head)) return
    await $.fs.write(path, `${head}\nmodel: ${model}${text.slice(end)}`)
  } catch (error) {
    $.ui.log(`otomatik-devir: ${id} model satırı yazılamadı: ${String(error)}`, { to: 'debug' })
  }
}

const taskTitle = (cwd: string, id: string): string => {
  const folder = folderOf(cwd).split(/[\\/]/).filter(part => part !== '').at(-1) ?? cwd
  const gen = genOf(id)

  return `Otomatik devir · ${folder} · ${gen === 0 ? '' : gen}${id.endsWith('a') ? 'A' : 'B'}`
}

const TASK_DESCRIPTION = 'Bağlam eşiğinde devredilen sohbetin devamı (otomatik-devir).'

type ToolResult = { deny?: string; isError?: boolean; text?: string }

/** A tool call that gives up after CALL_LIMIT_MS (the call itself may still finish). */
const boundedCall = async (
  $: EngineInterface,
  input: { tool: string } & Record<string, unknown>,
): Promise<ToolResult & { isTimeout?: true }> =>
  Promise.race([
    callTool($, input).catch(error => ({ isError: true as const, text: String(error) })),
    $.clock.sleep(CALL_LIMIT_MS).then(() => ({ isError: true as const, isTimeout: true as const, text: 'zaman aşımı' })),
  ])

const runIds = (text: string | undefined): string[] => [...(text ?? '').matchAll(/\b(local_[A-Za-z0-9-]+)/g)].map(m => m[1] ?? '')

/** The task's run sessions listed now (newest first). */
const listRuns = async ($: EngineInterface, taskId: string): Promise<string[]> => {
  const runs = await callTool($, { tool: LIST_RUNS, taskId }).catch(() => undefined)

  return runs === undefined || !isCalled(runs) ? [] : runIds(runs.text)
}

/**
 * The new run's session id: from the run result, or the first listed run that
 * was not there before the run (review L1); undefined when none shows up.
 */
const runIdOf = async (
  $: EngineInterface,
  ran: { text?: string },
  taskId: string,
  before: readonly string[],
): Promise<string | undefined> => {
  const direct = runIds(ran.text)[0]
  if (direct !== undefined) return direct
  for (let i = 0; i < 3; i++) {
    const fresh = (await listRuns($, taskId)).find(id => !before.includes(id))
    if (fresh !== undefined) return fresh
    await $.clock.sleep(SYNC_POLL_MS)
  }

  return undefined
}

/** get_session of the new run, polled until it is listed ("appears a few seconds later"). */
const waitSession = async (
  $: EngineInterface,
  id: string,
  beat: () => Promise<void>,
): Promise<Record<string, unknown> | undefined> => {
  for (let i = 0; i < SYNC_TRIES; i++) {
    const got = await boundedCall($, { tool: GET_SESSION, session_id: id })
    if (isCalled(got) && got.text !== undefined) {
      try {
        const info = record(JSON.parse(got.text))
        if (info !== undefined) return info
      } catch {
        // not yet: poll again
      }
    }
    await beat()
    await $.clock.sleep(SYNC_POLL_MS)
  }

  return undefined
}

type Dispatched = {
  isStarted: boolean
  runId?: string
  isSent?: boolean
  error?: string
  /** Every candidate task had a turn running (review M9). */
  isBusy?: boolean
  /** No pair whose runs start in Auto or Bypass (review H1). */
  isUnready?: boolean
  /** Already dispatched (its one-shot mark), or another dispatcher owns the run now. */
  isDuplicate?: boolean
}

/**
 * One hop, done by a regular session (this chat's own mod or the relay): run
 * a free task of a ready pair (never the requester's own; the other on a
 * refusal), then on the new run effort and model where they differ (never the
 * permission mode: it is the task's saved one), then the real prompt by
 * send_message. In that order, so the prompt's turn runs with the chain's
 * settings (effort applies from the next turn on). `beforeRun` may stop it
 * (one-shot guard); `onRun` says whether this dispatcher still owns the hop.
 */
export const dispatchChain = async (
  $: EngineInterface,
  req: ChainRequest,
  hooks: {
    mayList?: boolean
    beforeRun?: () => Promise<boolean>
    onRun?: (runId: string | undefined) => Promise<boolean>
    beat?: () => Promise<void>
  },
): Promise<Dispatched> => {
  const beat = hooks.beat ?? (async () => undefined)
  const pair = await readyPair($, req.cwd, req.taskId, hooks.mayList !== false)
  if (pair === undefined) return { isStarted: false, isUnready: true, error: 'izin modu kayıtlı görev çifti yok' }
  const ids = pair.ids.filter(id => id !== req.taskId)
  if (hooks.beforeRun !== undefined && !(await hooks.beforeRun())) return { isStarted: false, isDuplicate: true }
  let runId: string | undefined
  let taskId: string | undefined
  let error = ''
  let isBusy = ids.length > 0
  for (const id of ids) {
    const before = await listRuns($, id)
    const ran = await callTool($, { tool: RUN_TASK, taskId: id })
    if (isCalled(ran)) {
      taskId = id
      runId = await runIdOf($, ran, id, before)
      break
    }
    error = ran.deny ?? ran.text ?? 'çalıştırılamadı'
    if (!BUSY.test(error)) isBusy = false
  }
  if (taskId === undefined) return { isStarted: false, error, isBusy }
  if (hooks.onRun !== undefined && !(await hooks.onRun(runId))) {
    return { isStarted: true, runId, isDuplicate: true, error: 'devir başka yoldan sürüyor' }
  }
  if (runId === undefined) return { isStarted: true, error: 'yeni oturumun kimliği yok' }
  const info = await waitSession($, runId, beat)
  const sets: ({ tool: string } & Record<string, unknown>)[] = []
  if (req.effort !== undefined && EFFORTS.has(req.effort) && nonEmpty(info?.effort) !== req.effort) {
    sets.push({ tool: SET_EFFORT, session_id: runId, effort: req.effort })
  }
  if (req.model !== undefined && nonEmpty(info?.model) !== req.model) {
    sets.push({ tool: SET_MODEL, session_id: runId, model: req.model })
  }
  for (const set of sets) {
    const done = await boundedCall($, set)
    if (!isCalled(done)) {
      $.ui.log(`otomatik-devir: ${set.tool} (${runId}) olmadı: ${done.deny ?? done.text ?? ''}`, { to: 'debug' })
    }
    await beat()
  }
  const message = chainMessage(req.file)
  for (let i = 0; i < 2; i++) {
    const sent = await boundedCall($, { tool: SEND_MESSAGE, session_id: runId, message })
    const said = sent.deny ?? sent.text ?? ''
    // Delivered only when the result says so (review M4); sent again only
    // on an explicit "not delivered", never after a timeout (review L2).
    if (isCalled(sent) && DELIVERED.test(said)) return { isStarted: true, runId, isSent: true }
    error = said === '' ? 'gönderilemedi' : said
    if (!NOT_DELIVERED.test(said)) break
    await beat()
    await $.clock.sleep(SYNC_POLL_MS)
  }

  return { isStarted: true, runId, isSent: false, error }
}

const NOT_SENT_TOAST = (runId: string, file: string): string =>
  `Devam sohbeti açıldı (${runId}) ama devam mesajı gitmedi: o sohbete "${file} dosyasını oku ve devam et" yaz.`

/** The chain parked the hop for (b): the prompt file is ready, the next typed message opens the chat. */
export const CHAIN_WAIT_NOTE = `otomatik-devir: yeni sohbet bu turda açılamaz (izin modu kayıtlı görev çifti yok); devam prompt'u dosyada hazır, yeni sohbet kullanıcının bir sonraki mesajıyla açılır. Görev araçlarını ve ${START_SESSION} aracını çağırma; bu sohbete yalnızca devrin bir sonraki mesajla yapılacağını söyleyen tek bir satır yaz ve turu bitir.`

/**
 * The gate is closed (or the start was refused): the chain takes the hop if
 * the prompt file holds this handoff's prompt (written here from `prompt`
 * when it does not). A run chat leaves a request for the relay; a regular
 * chat dispatches it itself when this folder has a ready pair, else the hop
 * waits for (b) ('deferred', with the one-time setup hint). Undefined: the
 * caller goes on with the v0.4 path.
 */
const startChain = async ($: EngineInterface, sid: string, prompt?: string): Promise<'started' | 'deferred' | undefined> => {
  if (!chainCapable || !isRoleKnown) return undefined
  const held = await read($, conv)
  if (held === null || held.sid !== sid || held.phase !== 'handoff_running' || held.chainTried === true) return undefined
  // No relay serves in sor mode (review M7): a run chat's request would only wait.
  if (!(await isChainOn($))) return undefined
  const cwd = await $.session.cwd()
  const { file } = scheduledPlan(cwd)
  let fresh = await readDevamFile($, held.handoffAt)
  if (fresh === undefined && prompt !== undefined && prompt.trim() !== '') {
    try {
      await $.fs.write(file, `${prompt.trim()}\n`)
      fresh = prompt.trim()
    } catch (error) {
      $.ui.log(`otomatik-devir: devam dosyası yazılamadı: ${String(error)}`, { to: 'debug' })
    }
  }
  if (fresh === undefined) return undefined
  const isReady = isRunChat || (await readyPair($, cwd, undefined, true)) !== undefined
  const now = await $.clock.now()
  const isClaimed = await claim(
    $,
    sid,
    h => h.phase === 'handoff_running' && h.chainTried !== true && h.starting === undefined,
    isReady
      ? {
          via: 'relay',
          chainTried: true,
          chainUntil: now + (isRunChat ? REQUEST_TTL_MS + 2 * CLAIM_STALE_MS + RELAY_STALE_MS : HOP_LIMIT_MS),
        }
      : { chainTried: true },
  )
  if (!isClaimed) return undefined
  if (!isReady) {
    await afterScheduled($, sid, fresh)
    await hintOnce($, cwd)

    return 'deferred'
  }
  if (isRunChat) {
    await postRequest($, sid, file, held)
    $.ui.toast('Devir: istek aktarıcıya bırakıldı; yeni sohbeti açık bir sohbetteki mod açacak.')
  } else {
    later($, () => ownDispatch($, sid, file))
    $.ui.toast('Devir başlıyor: yeni sohbeti mod zamanlanmış görevle açıyor.')
  }
  // The hop's deadline (review M5): the guard falls back to (b) past it.
  guardHandoff($, sid)

  return 'started'
}

/** The record still waits on this chain hop: running, or parked by its deadline with (b) unused. */
const isHopOpen = (h: OtomatikDevirConv, until: number | undefined): boolean =>
  h.chainUntil === until &&
  ((h.phase === 'handoff_running' && h.via === 'relay') ||
    (h.phase === 'deferred' && h.instructNext !== true && h.pendingMessage === undefined))

/**
 * A regular chat's own hop: a busy partner is waited for within the hop's
 * deadline; on another failure the model runs the task itself (the v0.4 (s)
 * message), with the prompt held.
 */
const ownDispatch = async ($: EngineInterface, sid: string, file: string): Promise<void> => {
  const held = await read($, conv)
  if (held === null || held.sid !== sid || held.via !== 'relay' || held.phase !== 'handoff_running') return
  const until = held.chainUntil
  const req: ChainRequest = {
    id: sid,
    cwd: await $.session.cwd(),
    file,
    model: held.model ?? selfInfo.model,
    effort: held.effort ?? selfInfo.effort,
    permissionMode: held.permissionMode ?? selfInfo.permissionMode,
    at: await $.clock.now(),
    state: 'claimed',
  }
  let out: Dispatched
  for (;;) {
    try {
      out = await dispatchChain($, req, {
        onRun: async runId => {
          // Only while this hop is still open: past its deadline a (b) may have opened a chat.
          const isMine = await claim($, sid, h => isHopOpen(h, until), {
            phase: 'done',
            via: 'relay',
            startedId: runId ?? 'zamanlanmış görev',
            starting: undefined,
          })
          if (isMine) {
            startedInTurn = runningTurnId
            $.ui.toast(`Devam yeni sohbette (${runId ?? 'zamanlanmış görev'}).`, { timeoutMs: 15000 })
          }

          return isMine
        },
      })
    } catch (error) {
      out = { isStarted: false, error: String(error) }
    }
    if (out.isStarted || out.isBusy !== true) break
    const now = await $.clock.now()
    if (until === undefined || now + REQUEST_RETRY_MS >= until) break
    await $.clock.sleep(REQUEST_RETRY_MS)
    const still = await read($, conv)
    if (still === null || still.sid !== sid || still.phase !== 'handoff_running' || still.via !== 'relay') return
  }
  if (out.isStarted) {
    if (out.isDuplicate === true) return
    if (out.isSent !== true) $.ui.toast(NOT_SENT_TOAST(out.runId ?? '?', file), { timeoutMs: 30000 })
    await refreshStatus($).catch(() => undefined)

    return
  }
  $.ui.log(`otomatik-devir: mod görevi çalıştıramadı (${out.error ?? ''}); model deneyecek`, { to: 'debug' })
  // Fallback: the model's own task run (v0.4 (s)), with the prompt held.
  const prompt = await readDevamFile($)
  const isClaimed = await claim($, sid, h => h.phase === 'handoff_running' && h.via === 'relay', {
    via: 'scheduled',
    scheduledTried: true,
    runTries: 0,
    heldPrompt: prompt,
    startPrompt: undefined,
  })
  if (isClaimed) await sendScheduled($, sid, prompt)
}

/** A run chat's request for the relay, then the watch on its outcome. */
const postRequest = async (
  $: EngineInterface,
  sid: string,
  file: string,
  held: OtomatikDevirConv,
): Promise<void> => {
  const req: ChainRequest = {
    id: sid,
    cwd: await $.session.cwd(),
    file,
    taskId: selfInfo.taskId ?? held.selfTaskId,
    model: held.model ?? selfInfo.model,
    effort: held.effort ?? selfInfo.effort,
    permissionMode: held.permissionMode ?? selfInfo.permissionMode,
    at: await $.clock.now(),
    state: 'pending',
  }
  await $.store.set(`${REQ_PREFIX}${sid}`, req)
  watchRequest($, sid, req)
}

/**
 * The requester (a run chat) waits for its request: a run id (or the
 * request's one-shot mark) means the next chat exists (done); a failure, or
 * no relay before the request expires, falls back to (b), the person's next
 * typed message in this chat.
 */
const watchRequest = ($: EngineInterface, sid: string, posted: ChainRequest): void => {
  requestTimer?.cancel()
  const key = `${REQ_PREFIX}${sid}`
  let isTicking = false
  // Once a relay claimed it, a vanished request is never posted again (no second hop).
  let seenClaimedAt: number | undefined
  let timer: Timer | undefined
  const stop = (): void => {
    timer?.cancel()
    if (requestTimer === timer) requestTimer = undefined
  }
  const finish = async (runId: string | undefined, isWaiting: boolean): Promise<void> => {
    stop()
    if (isWaiting) {
      const id = runId ?? 'zamanlanmış görev'
      await patchConv($, sid, { phase: 'done', startedId: id, starting: undefined })
      $.ui.toast(`Devam yeni sohbette (aktarıcı açtı: ${id}).`, { timeoutMs: 15000 })
    }
    await $.store.delete(key)
  }
  const tick = async (): Promise<void> => {
    const req = asRequest(await $.store.get(key))
    const held = await read($, conv)
    const isWaiting = held !== null && held.sid === sid && held.phase === 'handoff_running' && held.via === 'relay'
    const now = await $.clock.now()
    const mark = record(await $.store.get(markKey(posted)))
    if (mark !== undefined) return finish(nonEmpty(mark.runId) ?? req?.runId, isWaiting)
    if (req === undefined) {
      if (!isWaiting) return stop()
      // Lost from the shared file before any relay took it (two sessions
      // writing at once): post it again. After a claim, never: wait for the
      // mark until the claim would be stale, then (b).
      if (seenClaimedAt === undefined) {
        await $.store.set(key, posted)
        return
      }
      if (now - seenClaimedAt <= 2 * CLAIM_STALE_MS) return
      stop()
      await afterScheduled($, sid, await readDevamFile($, held?.handoffAt))
      return
    }
    if (req.state !== 'pending') seenClaimedAt = now
    if (req.runId !== undefined || req.state === 'done') {
      if (isWaiting) {
        const id = req.runId ?? 'zamanlanmış görev'
        await patchConv($, sid, { phase: 'done', startedId: id, starting: undefined })
        $.ui.toast(`Devam yeni sohbette (aktarıcı açtı: ${id}).`, { timeoutMs: 15000 })
      }
      if (req.state === 'done') {
        stop()
        await $.store.delete(key)
      }
      return
    }
    const isLost =
      req.state === 'failed' ||
      (req.state === 'pending' && now - req.at > REQUEST_TTL_MS + RELAY_STALE_MS) ||
      (req.state === 'claimed' && now - (req.beatAt ?? req.claimedAt ?? req.at) > 2 * CLAIM_STALE_MS)
    if (!isLost) return
    stop()
    await $.store.delete(key)
    if (isWaiting) await afterScheduled($, sid, await readDevamFile($, held?.handoffAt))
  }
  timer = $.clock.every(WATCH_MS, () => {
    if (isTicking) return
    isTicking = true
    tick()
      .catch(error => $.ui.log(`otomatik-devir: istek izleme: ${String(error)}`, { to: 'debug' }))
      .finally(() => {
        isTicking = false
      })
  })
  requestTimer = timer
}

/**
 * Every RELAY_TICK_MS in a regular desktop session: the relay election (a
 * lock with a heartbeat; a stale one is taken over) and, while this session
 * is the relay, the request queue. Only a session in Auto or Bypass may be
 * the relay (its task runs and settings calls raise no dialog, review H2),
 * only in otomatik mode, and the lock is written only while a request waits
 * (review M7).
 */
const relayTick = async ($: EngineInterface): Promise<void> => {
  if (!chainCapable || !isRoleKnown || isRunChat || isStuck) return
  const settings = await readSettings($)
  if (!settings.isEnabled || settings.mode !== 'otomatik') return
  const me = await $.session.id()
  const lock = asLock(await $.store.get(RELAY_LOCK))
  if (!isSavable(selfInfo.permissionMode)) {
    if (lock?.id === me) await $.store.delete(RELAY_LOCK)
    return
  }
  const now = await $.clock.now()
  if (lock !== undefined && lock.id !== me && now - lock.at < RELAY_STALE_MS) return
  const keys = (await $.store.keys()).filter(key => key.startsWith(REQ_PREFIX))
  const waiting = await Promise.all(keys.map(async key => asRequest(await $.store.get(key))))
  if (!waiting.some(req => req !== undefined && (req.state === 'pending' || req.state === 'claimed'))) return
  await $.store.set(RELAY_LOCK, { id: me, at: now })
  if (lock?.id !== me) {
    await $.clock.sleep(SETTLE_MS)
    if (asLock(await $.store.get(RELAY_LOCK))?.id !== me) return
    $.ui.log(
      lock === undefined ? 'otomatik-devir: bu sohbet aktarıcı' : `otomatik-devir: aktarıcı devralındı (${lock.id})`,
      { to: 'debug' },
    )
  }
  if (isProcessing) return
  isProcessing = true
  processRequests($, me)
    .catch(error => $.ui.log(`otomatik-devir: aktarıcı: ${String(error)}`, { to: 'debug' }))
    .finally(() => {
      isProcessing = false
    })
}

/**
 * The relay's pass over the requests: each pending one is claimed once (and
 * only while this session still holds the lock), checked against its one-shot
 * mark, then dispatched within DISPATCH_LIMIT_MS.
 */
const processRequests = async ($: EngineInterface, me: string): Promise<void> => {
  const keys = (await $.store.keys()).filter(key => key.startsWith(REQ_PREFIX) || key.startsWith(DONE_PREFIX))
  // relayTick has just read the lock back; from the second request on, it is read again.
  let isFirst = true
  for (const key of keys) {
    const now = await $.clock.now()
    if (key.startsWith(DONE_PREFIX)) {
      const at = record(await $.store.get(key))?.at
      if (typeof at === 'number' && now - at > 2 * REQUEST_TTL_MS) await $.store.delete(key)
      continue
    }
    // Another session took the lock meanwhile: its pass, not this one's (H2).
    if (!isFirst && asLock(await $.store.get(RELAY_LOCK))?.id !== me) return
    isFirst = false
    const req = asRequest(await $.store.get(key))
    if (req === undefined) continue
    const mark = markKey(req)
    if ((req.state === 'done' || req.state === 'failed') && now - req.at > REQUEST_TTL_MS) {
      // The requester never came back for it.
      await $.store.delete(key)
      continue
    }
    if (
      req.state === 'claimed' &&
      (req.by !== me || !inFlight.has(mark)) &&
      now - (req.beatAt ?? req.claimedAt ?? req.at) > CLAIM_STALE_MS
    ) {
      // Its relay died mid-hop (this one too, before a reload, L5). Never
      // dispatched twice: with a run it is done, without one it fails.
      await $.store.set(key, req.runId !== undefined ? { ...req, state: 'done' } : { ...req, state: 'failed', reason: 'aktarıcı yarıda kaldı' })
      continue
    }
    if (req.state !== 'pending' || req.id === me || now - req.at > REQUEST_TTL_MS) continue
    if (req.retryAt !== undefined && now < req.retryAt) continue
    // Re-posted or reverted after its run started: done, not dispatched again (M2).
    const marked = record(await $.store.get(mark))
    if (marked !== undefined || dispatched.has(mark)) {
      await $.store.set(key, { ...req, state: 'done', runId: nonEmpty(marked?.runId) ?? req.runId })
      continue
    }
    await $.store.set(key, { ...req, state: 'claimed', by: me, claimedAt: now, beatAt: now })
    await $.clock.sleep(SETTLE_MS)
    const mine = asRequest(await $.store.get(key))
    if (mine === undefined || mine.state !== 'claimed' || mine.by !== me || mine.claimedAt !== now) continue
    inFlight.add(mark)
    let current: ChainRequest = mine
    const save = async (patch: Partial<ChainRequest>): Promise<void> => {
      current = { ...current, ...patch, beatAt: await $.clock.now() }
      await $.store.set(key, current)
    }
    const isOurs = async (): Promise<boolean> => {
      const live = asRequest(await $.store.get(key))
      return live !== undefined && live.state === 'claimed' && live.by === me && live.claimedAt === current.claimedAt
    }
    const work = dispatchChain($, mine, {
      beforeRun: async () => !dispatched.has(mark) && (await $.store.get(mark)) === undefined,
      onRun: async runId => {
        dispatched.add(mark)
        await $.store.set(mark, { at: await $.clock.now(), by: me, ...(runId === undefined ? {} : { runId }) })
        if (await isOurs()) {
          await save({ runId })
          return true
        }
        // Back in the queue after the deadline and not taken yet: this run is its hop.
        const live = asRequest(await $.store.get(key))
        if (live === undefined || live.state !== 'pending') return false
        current = { ...live, state: 'claimed', by: me, claimedAt: await $.clock.now(), runId }
        await save({})
        return true
      },
      beat: async () => {
        if (await isOurs()) await save({})
      },
    }).catch((error): Dispatched => ({ isStarted: false, error: String(error) }))
    const out = await Promise.race([work, $.clock.sleep(DISPATCH_LIMIT_MS).then(() => undefined)])
    if (out === undefined) {
      // Past the deadline (a dialog, a hung call): let the lock go and put
      // the request back, unless its run started; no relay until it settles.
      isStuck = true
      void work.then(async late => {
        isStuck = false
        inFlight.delete(mark)
        if (late.isStarted && late.isDuplicate !== true && (await isOurs())) {
          await save({ state: 'done', sent: late.isSent === true, reason: late.error })
        }
      }).catch(error => $.ui.log(`otomatik-devir: geciken gönderim: ${String(error)}`, { to: 'debug' }))
      const marked = record(await $.store.get(mark))
      if (marked !== undefined) {
        await save({ state: 'done', runId: nonEmpty(marked.runId) ?? current.runId })
      } else if (await isOurs()) {
        const { by: _by, claimedAt: _at, ...rest } = current
        await $.store.set(key, { ...rest, state: 'pending', tries: (mine.tries ?? 0) + 1, retryAt: (await $.clock.now()) + REQUEST_RETRY_MS, reason: 'süre doldu' })
      }
      if (asLock(await $.store.get(RELAY_LOCK))?.id === me) await $.store.delete(RELAY_LOCK)
      return
    }
    inFlight.delete(mark)
    if (out.isDuplicate === true) {
      if (!out.isStarted) await save({ state: 'done' })
      continue
    }
    if (out.isStarted) {
      await save({ state: 'done', sent: out.isSent === true, reason: out.error })
      if (out.isSent !== true) $.ui.toast(NOT_SENT_TOAST(out.runId ?? '?', mine.file), { timeoutMs: 30000 })
      continue
    }
    if (out.isUnready === true) {
      await save({ state: 'failed', reason: out.error })
      await hintOnce($, mine.cwd)
      continue
    }
    const retryAt = (await $.clock.now()) + REQUEST_RETRY_MS
    // A busy partner is waited for (M9); another failure counts a try.
    const isWait = out.isBusy === true && retryAt < mine.at + BUSY_LIMIT_MS
    if (isWait || (mine.tries ?? 0) + 1 < MAX_REQUEST_TRIES) {
      const { by: _by, claimedAt: _at, ...rest } = current
      current = { ...rest, state: 'pending', tries: (mine.tries ?? 0) + (isWait ? 0 : 1), retryAt, reason: out.error }
      await $.store.set(key, current)
    } else {
      await save({ state: 'failed', reason: out.error })
    }
  }
}

/** Starts (again) this session's relay timer; a run chat's tick does nothing. */
const startRelay = ($: EngineInterface): void => {
  relayTimer?.cancel()
  relayTimer = $.clock.every(RELAY_TICK_MS, () => {
    if (isRelayTicking) return
    isRelayTicking = true
    relayTick($)
      .catch(error => $.ui.log(`otomatik-devir: aktarıcı seçimi: ${String(error)}`, { to: 'debug' }))
      .finally(() => {
        isRelayTicking = false
      })
  })
}

/**
 * Pre-provisioning: in a turn the person typed (no machine input joined or
 * opened it, no agent still running, not a run chat) with Auto or Bypass on,
 * while this folder has no pair ready in that mode, the model is asked once
 * to create the next generation; the create results say whether the app kept
 * the mode. After MAX_PROVISION_MISSES "not saved" pairs in a day it stops
 * asking until the next day or `/devir otomatik` (review H3).
 */
const provisionCheck = async ($: EngineInterface): Promise<string | undefined> => {
  if (!chainCapable || isProvisionAsked || !isPersonTurn || turnHadMachine || !isRoleKnown || isRunChat) return undefined
  const mode = selfInfo.permissionMode
  if (!isSavable(mode)) return undefined
  const settings = await readSettings($)
  if (!settings.isEnabled || settings.mode !== 'otomatik') return undefined
  const held = await read($, conv)
  const sid = await $.session.id()
  if (held !== null && held.sid === sid && (held.phase === 'handoff_running' || held.phase === 'deferred')) {
    return undefined
  }
  if ((await activeAgents($)).length > 0) return undefined
  const cwd = await $.session.cwd()
  const pair = await readPair($, cwd)
  if (pair !== undefined && pair.gen > 0 && (await pairMode($, pair)) === mode) {
    isProvisionAsked = true
    return undefined
  }
  const now = await $.clock.now()
  const pending = asProvision(await $.store.get(provisionKey(cwd)))
  const today = dayOf(now)
  const misses = pending?.missDay === today ? (pending.misses ?? 0) : 0
  if (misses >= MAX_PROVISION_MISSES) return undefined
  // Another chat's open ask holds off this one only until its turn ends or
  // ASK_TTL_MS passes, never for hours (v0.5 live check, bug 3).
  const isHeldElsewhere =
    pending !== undefined &&
    pending.state === 'asked' &&
    pending.mode === mode &&
    pending.by !== sid &&
    now < Math.min(pending.until ?? Number.POSITIVE_INFINITY, pending.at + ASK_TTL_MS)
  if (isHeldElsewhere) return undefined
  // An ask nothing came of is asked again with the same ids, not a new generation.
  const isUnused = pending !== undefined && pending.state === 'asked' && Object.keys(pending.created ?? {}).length === 0
  const gen = isUnused ? pending.gen : Math.max(pair?.gen ?? 0, pending?.gen ?? 0) + 1
  if (gen > MAX_GEN) return undefined
  isProvisionAsked = true
  const ids = genIds(tagOf(cwd), gen)
  const ask: Provision = {
    gen,
    ids,
    mode,
    model: selfInfo.model,
    at: now,
    state: 'asked',
    created: {},
    by: sid,
    until: now + ASK_TTL_MS,
    misses,
    missDay: today,
  }
  await $.store.set(provisionKey(cwd), ask)
  askedCwd = cwd

  return provisionNote(ids)
}

/** At the asking session's turn end its claim on the ask ends: other chats may ask again (bug 3). */
const releaseAsk = async ($: EngineInterface): Promise<void> => {
  const cwd = askedCwd
  askedCwd = undefined
  if (cwd === undefined) return
  const sid = await $.session.id()
  const pending = asProvision(await $.store.get(provisionKey(cwd)))
  if (pending === undefined || pending.state !== 'asked' || pending.by !== sid) return
  await $.store.set(provisionKey(cwd), { ...pending, until: await $.clock.now() })
}

/**
 * A create of one of this folder's v0.5 ids went through: the model line
 * goes into its SKILL.md; for a provisioned pair, once both exist, the pair
 * becomes the folder's active one (saved mode, or null when the app said
 * "not saved": such a pair is never dispatched, and it counts a miss).
 */
const noteCreated = async ($: EngineInterface, cwd: string, id: string, text: string | undefined): Promise<void> => {
  const pending = asProvision(await $.store.get(provisionKey(cwd)))
  later($, () => writeModelLine($, id, pending?.model ?? selfInfo.model))
  if (pending === undefined || !pending.ids.includes(id) || pending.state !== 'asked') return
  const said = savedFrom(text)
  if (said === undefined) {
    $.ui.log(`otomatik-devir: ${id} oluşturma sonucunda bilinen bir izin modu cümlesi yok: ${text ?? ''}`, { to: 'debug' })
  }
  const created = {
    ...pending.created,
    [id]: said === true ? ('saved' as const) : said === false ? ('unsaved' as const) : ('unknown' as const),
  }
  if (!pending.ids.every(each => created[each] !== undefined)) {
    await $.store.set(provisionKey(cwd), { ...pending, created })
    return
  }
  const isSaved = pending.ids.every(each => created[each] === 'saved')
  // Only the app's own "not saved" is a miss; an unknown wording is not (bug 1).
  const isMiss = pending.ids.some(each => created[each] === 'unsaved')
  const next: ChainPair = { gen: pending.gen, ids: pending.ids, savedMode: isSaved ? pending.mode : null, model: pending.model }
  const active = await readPair($, cwd)
  // A pair the app kept the mode with beats one it did not.
  if (active === undefined || isSaved || active.savedMode === null) await $.store.set(pairKey(cwd), next)
  const today = dayOf(await $.clock.now())
  const misses = (pending.missDay === today ? (pending.misses ?? 0) : 0) + (isMiss ? 1 : 0)
  await $.store.set(provisionKey(cwd), { ...pending, created, state: 'done', misses, missDay: today })
  $.ui.log(`otomatik-devir: görev çifti ${pending.ids.join(', ')} hazır (mod ${isSaved ? pending.mode : isMiss ? 'saklanmadı' : 'bilinmiyor'})`, {
    to: 'debug',
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
    isPersonTurn = false
    isNextTurnPerson = false
    runningTurnId = undefined
    startedInTurn = undefined
    gateOpen = undefined
    turnHadMachine = false
    isProvisionAsked = false
    askedCwd = undefined
    isModeNoted = false
    isRoleKnown = false
    isRunChat = false
    isChainRun = false
    selfInfo = {}
    // A new session: the previous one's request watch is moot here.
    requestTimer?.cancel()
    requestTimer = undefined
    await currentConv($)
    await refreshStatus($)
    // v0.5: in Claude desktop, learn whether this chat is a run (get_session
    // "self"), and keep the relay timer; it acts only in a regular chat.
    if (await refreshChainTools($)) {
      later($, () => refreshRole($))
      startRelay($)
    } else {
      relayTimer?.cancel()
      relayTimer = undefined
    }

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
        // A deferred handoff is moot once the fill is under the threshold
        // again, unless the person asked for it (/devir simdi, review L2).
        if (held !== null && held.phase === 'deferred' && held.isForced !== true) {
          await claim($, held.sid, now => now.phase === 'deferred' && now.isForced !== true, {
            phase: 'idle',
            heldPrompt: undefined,
          })
        }
      }
    }

    return next(e)
  })

  // Who typed the turn about to start (or the one running, for a message
  // typed into it). (b): while a handoff is deferred, the person's next typed
  // message carries the handoff instruction as context; no message of the
  // mod's own is sent. A slash command typed is left alone (it runs as typed).
  on('prompt.submit', async ($, e, next) => {
    const isPerson = isPersonSubmit(e)
    if (e.turnId !== undefined) {
      // Typed over a running turn: the app counts that turn as the person's
      // from then on; if the message waits, it opens the next turn too.
      if (isPerson && e.turnId === runningTurnId) isPersonTurn = true
      if (isPerson) isNextTurnPerson = true
      // A machine's input joined the running turn: the app no longer counts
      // it as the person's alone, so a create here would not keep the mode.
      if (!isPerson && e.turnId === runningTurnId) turnHadMachine = true

      return next(e)
    }
    isNextTurnPerson = isPerson
    if (!isPerson || e.command !== undefined) return next(e)
    const note = (await tripAtMessage($, e.text)) ?? (await reattachAtMessage($, e.text))
    if (note === undefined) return next(e)
    const out = await next({ ...e, context: [...(e.context ?? []), note] })
    if (out.drop !== undefined) {
      // Dropped beneath: no turn carries the instruction; hold it again (L1).
      const sid = await $.session.id()
      await claim($, sid, h => h.phase === 'handoff_running' && h.instructNext === true, {
        phase: 'deferred',
        instructNext: false,
      })
    }

    return out
  })

  // (a) The mid-turn channel: a tool result's `context` is read by the model
  // right after that result, inside the running turn. When the threshold is
  // crossed during a turn the person typed (otomatik), the handoff instruction
  // rides on the next main-loop tool result; in any other turn, the (s)
  // instruction does. The model's own start_session calls of the handoff are
  // watched (watchModelStart), and its scheduled-task calls (watchScheduled).
  on('tool.call', async ($, e, next) => {
    const call = e as unknown as { tool: string; agentId?: string } & Record<string, unknown>
    // Before the origin and subagent checks: a subagent's or another plugin's
    // delete would archive the continuation chats too (re-review N8).
    const guarded = taskGuard(call)
    if (guarded !== undefined) return guarded as Awaited<ReturnType<typeof next>>
    // Only the model's own calls (the engine's call site): another plugin's
    // $.tool.call drops `context`, and its start_session is not the handoff (M1).
    if (next.origin.plugin !== 'engine') return next(e)
    if (call.agentId !== undefined) return next(e)
    if (call.tool === START_SESSION) {
      return watchModelStart($, call, next as unknown as ToolNext) as ReturnType<typeof next>
    }
    if (call.tool === GATE) {
      return watchGate($, call, next as unknown as ToolNext) as ReturnType<typeof next>
    }
    if (call.tool === HAND_OFF) {
      // A fork through hand_off_to_session is not tracked (nested, a second
      // chat): during the handoff, the instruction's path only (M2).
      const held = await read($, conv)
      if (
        held !== null &&
        held.sid === (await $.session.id()) &&
        held.phase === 'handoff_running' &&
        (held.via === 'turn' || held.via === 'scheduled' || held.via === 'relay')
      ) {
        return {
          deny: `otomatik-devir: devir için ${HAND_OFF} kullanma; talimattaki yolu izle (${GATE}, sonra ${START_SESSION} ya da zamanlanmış görev).`,
        } as Awaited<ReturnType<typeof next>>
      }

      return next(e)
    }
    if (SCHEDULED_TOOLS.has(call.tool)) {
      return watchScheduled($, call, next as unknown as ToolNext) as ReturnType<typeof next>
    }
    const result = await next(e)
    if (result.deny !== undefined) return result
    // The gate picks (a) or (s) where it exists; else (a) in a turn the person
    // typed, (s) in any other.
    // The handoff first; otherwise, in a qualifying typed turn, the v0.5 pre-provisioning.
    const note = (await tripMidTurn($)) ?? (await provisionCheck($))
    if (note === undefined) return result

    return { ...result, context: [...(result.context ?? []), note] } as typeof result
  })

  on('turn.start', async ($, e, next) => {
    if ((e as { agentId?: string }).agentId === undefined) {
      isTurnRunning = true
      idleSince = undefined
      runningTurnId = e.turnId
      isPersonTurn = isNextTurnPerson
      isNextTurnPerson = false
      gateOpen = undefined
      // A turn no person opened is a machine's for the app, even once the
      // person types into it: it never saves a mode (v0.5 review H3).
      turnHadMachine = !isPersonTurn
      // v0.5: the role and settings (a mode changed in the menu) fresh for this turn.
      if (await refreshChainTools($)) later($, () => refreshRole($))
      // The turn a (b) message (or the mod's (s) message) opens is the one
      // its instruction is for (H2).
      const held = await read($, conv)
      if (held !== null && held.phase === 'handoff_running' && held.instructNext === true) {
        await claim($, held.sid, h => h.phase === 'handoff_running' && h.instructNext === true, {
          instructNext: false,
          instructedTurn: e.turnId,
        })
      }
    }

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    isTurnRunning = false
    // The gate's word (or R1's) on this turn beats the prompt's origin (H1).
    const wasPersonTurn = gateOpen ?? isPersonTurn
    isPersonTurn = false
    gateOpen = undefined
    runningTurnId = undefined
    idleSince = await $.clock.now()
    await releaseAsk($).catch(() => undefined)
    const settings = await readSettings($)
    const percent = await contextPercent($)
    $.ui.status(statusText(settings, percent))
    let held = await currentConv($)

    if (held.grace === true) {
      await patchConv($, held.sid, { grace: false })

      return result
    }

    if (held.phase === 'handoff_running') {
      // v0.5: the hop is the mod's (or the relay's) now; its outcome sets the phase.
      if (held.via === 'relay') return result
      if (e.isAborted) {
        await setPhase($, held.sid, 'done')
        $.ui.toast('Devir iptal edildi.')

        return result
      }
      // The handoff reply ends in its code block (the skill and the fallback
      // both print it last); a turn that does not is an intermediate one.
      // In-turn (otomatik): the prompt of a refused start_session, or the one
      // held for this message, stands in when the reply no longer ends in it.
      // otomatik (H2): a person's turn that did not get the instruction (the
      // person kept working after it) is not read for the prompt; machine
      // turns are (results of work the instructed turn waited on).
      const isInstructed =
        held.instructedTurn === undefined ? wasPersonTurn : held.instructedTurn === e.turnId
      const mayParse =
        (held.via !== 'turn' && held.via !== 'scheduled') || !wasPersonTurn || isInstructed
      let prompt = held.startPrompt ?? (mayParse ? lastFencedBlock(e.answer, true) : undefined)
      if (prompt === undefined && mayParse && e.answer.trim() === '') {
        const last = (await $.session.messages()).filter(m => m.role === 'assistant').at(-1)
        prompt = last === undefined ? undefined : lastFencedBlock(last.text, true)
      }
      // (s): a started run set the phase to done already. A refused run, or
      // the prompt given as a code block, ends (s): on to (b), with the prompt
      // from the reply, the file or the one held. Any other turn is an
      // intermediate one, counted below.
      if (held.via === 'scheduled' && (prompt !== undefined || (held.runTries ?? 0) > 0)) {
        const ready =
          prompt ??
          (await readDevamFile($, held.handoffAt)) ??
          (held.heldPrompt === undefined ? undefined : withMessage(held.heldPrompt, held.pendingMessage))
        // v0.5: a run chat's own run is always refused; the chain (relay or
        // the mod) takes the hop first, (b) only after that.
        later($, async () => {
          if (ready !== undefined && (await startChain($, held.sid, ready)) !== undefined) return
          await afterScheduled($, held.sid, ready)
        })

        return result
      }
      // The held prompt stands in for the instructed turn, with the person's
      // (b) message under it (M7).
      prompt ??=
        held.via === 'turn' && isInstructed && held.heldPrompt !== undefined
          ? withMessage(held.heldPrompt, held.pendingMessage)
          : undefined
      if (prompt === undefined) {
        // A notification turn (a subagent reporting back) or a turn that ended
        // while work still runs: not a failure. Count it; past MAX_WAIT_TURNS,
        // one reminder (otomatik: one carry-over), then give up (see nudge).
        const turns = (held.handoffTurns ?? 0) + 1
        await patchConv($, held.sid, { handoffTurns: turns })
        const active = (await activeAgents($)).length
        $.ui.status(active > 0 ? `Devir: ${active} subagent bitiyor` : "Devir: devam prompt'u bekleniyor")
        if (turns >= MAX_WAIT_TURNS) {
          later($, async () => {
            await nudge($, held.sid)
          })
        } else {
          guardHandoff($, held.sid)
        }

        return result
      }
      if (held.via === 'turn' && settings.mode === 'otomatik') {
        // The prompt is here but no chat was started in a typed turn: (s)
        // next, once, by the mod's message with the prompt held (no typed
        // turn is needed to run a task).
        if (held.scheduledTried !== true && (await hasScheduledTools($))) {
          await patchConv($, held.sid, {
            via: 'scheduled',
            scheduledTried: true,
            heldPrompt: prompt,
            startPrompt: undefined,
            handoffAt: await $.clock.now(),
            handoffTurns: 0,
            runTries: 0,
          })
          const ready = prompt
          later($, () => sendScheduled($, held.sid, ready))

          return result
        }
        // Without (s), written in a machine turn (a subagent's result came
        // in): (b) once, the person's next typed message starts it. Otherwise
        // the last fallback: the card, or the clipboard where there are no
        // session tools.
        if (!wasPersonTurn && held.isRetried !== true && (await hasStartTool($))) {
          await patchConv($, held.sid, {
            phase: 'deferred',
            heldPrompt: prompt,
            isRetried: true,
            startPrompt: undefined,
          })
          $.ui.toast("Devam prompt'u hazır: yeni sohbet bir sonraki mesajınla açılacak.", {
            timeoutMs: 15000,
          })

          return result
        }
        await patchConv($, held.sid, { phase: 'awaiting_choice', prompt, bandHidden: true })
        const text = prompt
        later($, () => switchChat($, held.sid, text))

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
    if (held.phase === 'deferred') {
      if (settings.mode === 'otomatik') {
        await takeLatePrompt($, held, e.answer, wasPersonTurn || e.isAborted)

        return result
      }
      // Switched to sor while deferred: a ready prompt goes to the band; with
      // none, the handoff starts over the sor way (below).
      if (held.heldPrompt !== undefined) {
        await patchConv($, held.sid, {
          phase: 'awaiting_choice',
          prompt: held.heldPrompt,
          bandHidden: false,
          heldPrompt: undefined,
        })

        return result
      }
      await setPhase($, held.sid, 'idle')
      held = { ...held, phase: 'idle' }
    }
    const isDue =
      held.phase === 'warned' || (held.phase === 'idle' && settings.isEnabled && isCrossed)
    if (isDue && !e.isAborted && settings.isEnabled) {
      const sid = held.sid
      if (settings.mode === 'otomatik') {
        // No typed turn is open any more (it just ended): (s) by the mod's
        // message (a task run needs no typed turn); without the scheduled
        // tools, (b) holds the handoff for the next typed message.
        later($, async () => {
          if (await hasScheduledTools($)) await startScheduled($, sid)
          else await deferHandoff($, sid)
        })
      } else {
        // At once, subagents running or not: the message itself tells the
        // agent to finish them and start nothing new.
        later($, () => sendHandoffRequest($, sid))
      }
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
      case 'otomatik': {
        await $.store.set('mod', 'otomatik')
        // Re-issued: pre-provisioning may ask again today (v0.5 review H3).
        for (const key of await $.store.keys().catch(() => [] as string[])) {
          if (!key.startsWith(PROVISION_PREFIX)) continue
          const pending = asProvision(await $.store.get(key))
          if (pending !== undefined && (pending.misses ?? 0) > 0) await $.store.set(key, { ...pending, misses: 0 })
        }

        return { text: 'Devir modu: otomatik (sormadan geçer).' }
      }
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
        if (settings.mode === 'otomatik') {
          // otomatik: no message turn of the mod's; the next typed message
          // carries the handoff, where the new chat can start without a click.
          if (held.phase === 'deferred') {
            return { text: 'Devir bekliyor: bir sonraki mesajınla bu sohbette yapılacak.' }
          }
          if (await hasScheduledTools($)) {
            later($, () => startScheduled($, held.sid, true))

            return { text: 'Devir başlatılıyor; yeni sohbet zamanlanmış görevle açılacak (otomatik mod).' }
          }
          later($, async () => {
            await deferHandoff($, held.sid, true)
          })

          return { text: 'Devir bir sonraki mesajınla, o turun içinde yapılacak (otomatik mod).' }
        }
        // Asked for by hand: from any other phase (done, awaiting_choice too).
        const waiting = (await activeAgents($)).length
        later($, () => sendHandoffRequest($, held.sid, true))

        return {
          text:
            waiting > 0
              ? `Devir başlatılıyor; ${waiting} subagent bitiyor, yeni iş başlatılmayacak.`
              : 'Devir başlatılıyor.',
        }
      }
      case 'gec': {
        // switchChat only runs from awaiting_choice: say so instead of
        // answering "geçiliyor" and then doing nothing (e.g. after `done`).
        if (held.phase === 'handoff_running') {
          return { text: "Devir hâlâ çalışıyor; devam prompt'u henüz hazır değil." }
        }
        if (held.phase === 'deferred' && held.heldPrompt !== undefined) {
          // A ready prompt held for the next message: the card now, on request.
          const ready = held.heldPrompt
          await patchConv($, held.sid, { phase: 'awaiting_choice', prompt: ready, bandHidden: true })
          later($, () => switchChat($, held.sid, ready))

          return { text: 'Yeni sohbete geçiliyor.' }
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
