import { atom, read, update } from 'claude-code'
import type {
  AgentInfo,
  EngineInterface,
  PromptSubmitInput,
  PromptSubmitResult,
  Register,
  ToolCallArgs,
} from 'claude-code'

import type {
  OrkestraAlt,
  OrkestraAna,
  OrkestraAyar,
  OrkestraRecord,
  OrkestraRole,
  OtomatikDevirConv,
  OtomatikDevirPhase,
} from '../types'

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
export const MAX_MISSING_BLOCKS = 2

/** The per-session handoff file: `<cwd>/.workflow/handoff/<sid>.md`. */
export const handoffFile = (cwd: string, sid: string): string =>
  `${cwd.replace(/\/+$/, '')}/.workflow/handoff/${sid}.md`

// ---------------------------------------------------------------------------
// Texts the model reads (Contract)
// ---------------------------------------------------------------------------

/**
 * v1.0.1: the child reads only this handoff's own file, never an older
 * project-wide handoff or state file (a real child once resumed from a
 * 13-hour-stale one).
 */
const RESUME_ONLY = (file: string): string =>
  `devam prompt'u yeni sohbete yalnızca ${file} dosyasını okumasını söylesin; başka bir devir ya da durum dosyasına yönlendirmesin`

/** How the handoff file gets written: the skill's inline auto mode, or the built-in steps. */
const writeStep = (file: string, hasSkill: boolean): string =>
  hasSkill
    ? `Skill aracıyla /${SKILL} becerisini \`auto ${file}\` argümanıyla çalıştır (alt ajan yok, soru yok); devir dosyasını o yazar. Dosyadaki ${RESUME_ONLY(file)}.`
    : `Devir notunu ${file} dosyasına yaz (klasör yoksa oluştur): hedef, yapılanlar, kalanlar, alınan kararlar ve dikkat edilecekler; durdurulan işler varsa "Yeniden çalıştır:" altında. En sona \`## Devam prompt'u\` başlığını koy ve altına yeni sohbetin ilk mesajı olacak devam prompt'unu düz metin olarak yaz; bu ${RESUME_ONLY(file)}.`

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

/**
 * Decision 16: the system-prompt section that tells the model the mod owns the
 * long-chat handoff. The bare id is accepted at runtime (the engine's section
 * check wants only a non-empty, unique id).
 */
export const LONG_CHAT_SECTION_ID = 'otomatik-devir:long-chat'
export const longChatNote = (threshold: number): string =>
  `otomatik-devir bu oturumda açık: devri mod yönetir. Bağlam büyüdü diye kendiliğinden devir yapma, my-skill-handoff çağırma, yeni sohbet ya da devam prompt'u önerme; işe devam et. Bağlam %${threshold}${dative(threshold)} ulaşınca mod talimat verir, o talimata uy. Kullanıcı açıkça devir isterse: /devir simdi.`

/** Stop block while subagents or Workflows run during a handoff (`handoff_running`): wait inside the turn (v1.0.1: only then). */
export const waitText = (running: Running): string =>
  `otomatik-devir: turu henüz bitirme; çalışan işler var: ${runningList(running)}. Sonuçlarını bu turun içinde bekle: Bash aracıyla \`perl -e 'select(undef,undef,undef,120)'\` çalıştır (120 saniye; tek bir bekleme en çok 5 dakika olsun), gelen sonuçları işle ve hiçbiri çalışmıyorsa turu yeniden bitirmeyi dene. Yeni alt ajan ya da Workflow başlatma.`

/** Stop block once the drain ran 30 minutes (Decision 4). */
export const timeoutText = (running: Running): string =>
  `otomatik-devir: çalışan işler 30 dakikadır bitmedi: ${runningList(running)}. Her birini TaskStop aracıyla durdur ve devir dosyasında "Yeniden çalıştır:" altında listele (kimlik, açıklama, neyin yeniden çalıştırılacağı). Sonra devri tamamla.`

/** Stop block when the handoff file is missing, empty or older than this handoff. */
export const fileMissingText = (file: string, isOpenTurn: boolean): string =>
  `otomatik-devir: devir dosyası yok ya da bu devirden eski: ${file}. Turu bitirmeden önce dosyayı yaz (/${SKILL} \`auto ${file}\`, ya da hedef/yapılanlar/kalanlar/kararlar/dikkat ve en sonda \`## Devam prompt'u\`; ${RESUME_ONLY(file)}). ` +
  (isOpenTurn
    ? `Sonra turu bitirmeden ${START_SESSION} aracını initiation "user_asked" ve context "fresh" ile bir kez çağır.`
    : `${START_SESSION} çağırma: yeni sohbet kullanıcının bir sonraki mesajıyla açılır. Dosyayı yazınca turu bitir.`)

/** Stop block in an open typed turn once the file is written. */
export const START_NOW = `otomatik-devir: devir dosyası hazır. Turu bitirme: şimdi ${START_CALL}`

export const DRAIN_DENY =
  'otomatik-devir: devir sürüyor; yeni alt ajan, Workflow ya da alt ajana mesaj başlatılamaz. Çalışan işlerin sonuçlarını işle ve devri tamamla.'

/** Decision 16: the model's own my-skill-handoff call is refused while the mod is on. */
export const SKILL_HANDOFF_DENY =
  'otomatik-devir açık: devri mod yönetir, eşikte kendisi başlatır. Kendiliğinden devir yapma, işe devam et. Kullanıcı devir isterse: /devir simdi.'

/** A typed message that asks for a handoff itself. */
const HANDOFF_ASK = /handoff|devir|yeni (sohbet|chat)|new chat|continue in a new/i

export const READY_BAND = 'Devir hazır: bir sonraki mesajınla yeni sohbet açılacak.'

const MACHINE_TURN_DENY = `otomatik-devir: bu tur kullanıcının yazdığı bir tur değil; yeni sohbet bu turda açılamaz. Yeniden deneme, kart açma: kullanıcının bir sonraki mesajı yeni sohbeti açacak. Devir dosyasını yazdıysan turu bitir.`
const CARD_DENY = `otomatik-devir: devir için kart açma (own_initiative, proposal_id); ${START_SESSION} aracını initiation "user_asked" ile çağır.`
const HAND_OFF_DENY = `otomatik-devir: devir için ${HAND_OFF} kullanma; devir dosyasını yaz ve ${START_SESSION} aracını initiation "user_asked" ile çağır.`
const REMOVED_VERB = "v1.0'da kaldırıldı; tek mod otomatik. Kapatmak için: /devir kapat"
const USAGE = 'Kullanım: /devir [esik <n> | dene <n> | simdi | kapat | ac | otonom [dur | limit <n>]]'

// ---------------------------------------------------------------------------
// v1.1 orkestra modu (Contract): the main chat starts managed sub-chats one
// after another and waits for each; a sub-chat hands off by writing its file.
// ---------------------------------------------------------------------------

/** The prompt-type command that starts a chain (Decision 1), bare and namespaced. */
export const OTONOM_COMMANDS: readonly string[] = ['devir-otonom', 'otomatik-devir:devir-otonom']
/** The first line of the command's rendered body (Decision 17). */
export const OTONOM_MARKER = '<!-- otomatik-devir:otonom -->'
const OTONOM_LINE = /^\s*\/(otomatik-devir:)?devir-otonom\b/

/** Sub-chats per chain (Decision 18): default, and the clamp of `/devir otonom limit <n>`. */
export const DEFAULT_LIMIT = 100
export const LIMIT_MIN = 1
export const LIMIT_MAX = 1000

/** The integer part of `x`, clamped to LIMIT_MIN-LIMIT_MAX (not a number: DEFAULT_LIMIT). */
export const clampLimit = (x: number): number =>
  Number.isNaN(x) ? DEFAULT_LIMIT : Math.min(LIMIT_MAX, Math.max(LIMIT_MIN, Math.trunc(x)))

/** The main chat's system-prompt section (O2); the v1 long-chat note keeps its own id. */
export const ORKESTRA_SECTION_ID = 'otomatik-devir:orkestra'

/** At a relay point with its own context at this fill or more, the main chat ends the chain (O22). */
export const MAIN_FULL_PERCENT = 80

/** How the person starts a chain (store-probe.md `TRIGGER: command`). */
export const START_HINT = '/otomatik-devir:devir-otonom <görev>'

/** The one-line answer of `/devir`, `esik`, `kapat`, `ac` and `simdi` in a normal chat (O20, Decision 22). */
export const NORMAL_INFO =
  'Normal sohbet: burada otomatik devir yok, bu sohbet devredilmez ve buradaki ayar hiçbir zinciri değiştirmez. Zincir için ' +
  START_HINT +
  ' yaz; eşik ve kapatma o zincirin ana ya da alt sohbetinde ayarlanır.'

/** `/devir dene <n>` in a normal chat: kept in this chat for a chain started here later (Decision 20). */
export const normalDeneText = (n: number): string =>
  `Normal sohbet devredilmez. Deneme eşiği %${n} kaydedildi: bu sohbette ${START_HINT} ile başlatılan zincirin alt sohbetleri bunu kullanır.`

/** Appended to the `/devir kapat` reply in a chain (O21). */
export const KAPAT_CHAIN =
  'Bu zincir durur: ana sohbet bir sonraki adımda özet yazar, yeni alt sohbet açılmaz; başka sohbetler etkilenmez.'

/** `/devir esik <n>` in a chain (Decision 22). */
export const chainEsikText = (n: number): string =>
  `Bu zincirin devir eşiği %${n}: ana sohbet ve alt sohbetleri için geçerli; başka sohbetleri etkilemez.`

/** `/devir ac` in a chain: it writes nothing (Decisions 20, 22). */
export const AC_CHAIN_OPEN = 'Bu zincir açık; durdurmak için /devir kapat.'
export const AC_CHAIN_STOPPED = 'Bu zincir durdu ve sürdürülmez; yeni zincir için ' + START_HINT + ' yaz.'

/** The prefix trigger (`orkestra: <görev>`): an undocumented alias of `/devir-otonom`. */
export const ORKESTRA_RE = /^\s*orkestra:\s*/i
/** Store key prefix of an orchestration record (backend `store`). */
export const ORKESTRA_PREFIX = 'orkestra:'
/** `kimlik:<sid>` = this chat's local id (O16). */
export const KIMLIK_PREFIX = 'kimlik:'
/** The managed handoff file's "no remaining work" line (Decision 12). */
export const NONE_LEFT_RE = /^\s*Kalan:\s*yok\s*$/im
/** A child whose id the start_session result did not name. */
export const UNKNOWN_CHILD = 'bilinmiyor'
/** An in-flight start older than this is a crash mid-start (O4). */
export const STARTING_STALE_MS = 120_000
/** Stalled child (O19): checks at least this far apart, this many in a row. */
export const STALL_GAP_MS = 240_000
export const STALL_CYCLES = 2

/** Where the records live (store-probe.md `BACKEND: file`: the store is stale across sessions). */
export const RECORD_BACKEND: 'store' | 'file' = 'file'

const ORKESTRA_DIR = (home: string): string => `${home}/.claude/plugins/data/otomatik-devir/orkestra`

/** An orchestration record's file (backend `file`). */
export const orkestraRecordFile = (home: string, localId: string): string => `${ORKESTRA_DIR(home)}/${localId}.json`

/** The sub-chat title: the task's first line, whitespace collapsed, cut to 40 chars, + ` · n`. */
export const childTitle = (task: string, n: number): string => {
  const head = (task.trim().split(/\r?\n/)[0] ?? '').replace(/\s+/g, ' ').slice(0, 40).trim()

  return `${head === '' ? 'Orkestra' : head} · ${n}`
}

/** The start instruction for the main chat (O1, O1b, O5 `start`). */
export const orkestraStartNote = (title: string): string =>
  `otomatik-devir orkestra: bu sohbet otonom bir zincirin ANA sohbeti. Burada gerçek iş yapma (kod düzenleme, dosya yazma, işi yapan alt ajan yok): işi yönetilen alt sohbetler yapar. Görevi (ya da kullanıcının talimatlarından uyarlanmış kısa bir brifi) alt sohbet 1'in prompt'u olarak ver: ${START_SESSION} aracını bir kez çağır, initiation "user_asked", context "fresh", title "${title}". Sonra otomatik-devir'in notlarına uy (bekle, sıradaki alt sohbeti aç, zincir bitince özet yaz).`

/** The main chat's system-prompt section (O2). */
export const ORKESTRA_SECTION = (task: string): string =>
  `otomatik-devir orkestra modu: bu sohbet otonom bir zincirin ana sohbeti. Burada gerçek iş yapma: işi yönetilen alt sohbetler yapar. Senin işin alt sohbetleri ${START_SESSION} ile açmak, beklemek, sıradakini açmak ve zincir bitince kullanıcıya özet yazmak; mod her adımda ne yapacağını söyler. Kendiliğinden devir yapma. Görev: ${task.slice(0, 1000)}`

/** Stop block while the child runs (O5 `wait`, Decision 6); kept short (O22). */
export const orkestraWaitText = (n: number): string =>
  `otomatik-devir orkestra: alt sohbet ${n} çalışıyor; turu bitirme. Bash aracıyla \`perl -e 'select(undef,undef,undef,300)'\` çalıştır (5 dakika bekler); Bash aracının timeout parametresini 330000 yap (bu bir araç parametresi, kabuk komutu değil). Sonra turu yeniden bitirmeyi dene; başka iş yapma.`

/** The relay to the next child (O5/O6 `relay`; n = the next child); kept short (O22). */
export const orkestraRelayText = (n: number, title: string): string =>
  `otomatik-devir orkestra: alt sohbet ${n - 1} devir dosyasını yazdı. Turu bitirmeden sıradaki alt sohbeti (${n}) aç: ${START_SESSION} aracını bir kez çağır, initiation "user_asked", context "fresh", title "${title}"; prompt tek satır olsun, gerisini mod doldurur (devir dosyası).`

/** Why a chain ended (types/index.d.ts `OrkestraEnd`). */
type EndKind = NonNullable<OrkestraAna['ended']>

/** The chain is over (O5/O6 `end`, O19 `durdu`): the main chat summarises and opens nothing. */
export const orkestraEndText = (
  kind: EndKind,
  n: number,
  report?: string,
  file?: string,
  childId?: string,
  limit?: number,
): string => {
  const reasons: Record<EndKind, string> = {
    bitti: 'zincir bitti, kalan iş yok',
    sinir: `zincir sınır ${limit ?? DEFAULT_LIMIT} alt sohbete ulaştı`,
    durduruldu: 'zincir kullanıcının isteğiyle durduruldu (/devir otonom dur)',
    durdu: `alt sohbet ${n} yanıt vermiyor (${childId ?? UNKNOWN_CHILD}); zincir durdu`,
    kapatildi: 'otomatik devir kapatıldı (/devir kapat); zincir durdu',
    dolu: `ana sohbet dolu (bağlam %${MAIN_FULL_PERCENT} ya da fazlası); zincir burada bitiyor`,
  }
  const where =
    (file === undefined ? '' : ` Kalan iş için son devir dosyası: ${file}.`) +
    (kind === 'dolu'
      ? ` Kullanıcıya söyle: devam etmek için yeni bir sohbette ${START_HINT} yazsın, görev olarak "${file ?? 'son devir dosyası'} dosyasından devam et".`
      : '')
  const what =
    report !== undefined && report.trim() !== ''
      ? ` Son alt sohbetin raporu:\n${report}\n`
      : ` Son alt sohbetin ne yaptığını mcp__ccd_session_mgmt__list_events ile oku (session_id ${childId ?? UNKNOWN_CHILD}).`

  return `otomatik-devir orkestra: ${reasons[kind]}. Bu zincirde ${n} alt sohbet açıldı.${where}${what} Kullanıcıya kısa bir özet yaz (ne yapıldı, ne kaldı); yeni sohbet açma, özeti yazınca turu bitir.`
}

/** The status line and band of a stalled chain (O19). */
export const orkestraStalledBand = (n: number): string => `Orkestra durdu: alt sohbet ${n} yanıt vermiyor`

export const ORKESTRA_END_DENY =
  'otomatik-devir orkestra: zincir bitti; yeni sohbet açma. Kullanıcıya özet yaz ve turu bitir.'

/** Context on a typed message in a live main chat (O7). */
export const orkestraResumeNote = (n: number, state: string): string =>
  `otomatik-devir: orkestra devam ediyor (alt sohbet ${n}: ${state}). Kullanıcının bu mesajındaki işi burada YAPMA: mod onu sıradaki alt sohbete not olarak iletir. otomatik-devir'in notlarına uy: bekle ya da sıradaki alt sohbeti aç.`

/** Appended to every child's prompt (O4). */
export const managedChildNote = (n: number, limit: number): string =>
  `\n\n## otomatik-devir\nBu sohbet otonom bir zincirin yönetilen alt sohbeti (${n}/${limit}). Kullanıcıya soru sorma, onay bekleme: kararları kendin ver ve gerekçesini yaz. Yeni sohbet açma, kendiliğinden devir yapma: bağlam eşiğe ulaşınca mod talimat verir. Çok adımlı işi my-skill-orchestrate becerisiyle alt ajanlara dağıt; model seçimi o becerideki yönlendirmeye göre (varsayılan sonnet). İş bitince sonucu kısaca raporla.`

/** A managed sub-chat's handoff (O12): the file only, the main chat starts the next one. */
export const managedHandoff = (threshold: number, file: string, hasSkill = true): string =>
  `Bağlam %${threshold}${dative(threshold)} ulaştı (bağlam sınırı): bu yönetilen alt sohbet devredilecek. Elindeki adımı güvenli bir noktada tamamla (yarım dosya bırakma). ${NO_NEW_WORK} Her şey bitince: ${writeStep(file, hasSkill)} Dosyanın en üstünde tek satır olsun: iş tamamen bittiyse \`Kalan: yok\`, kalan iş varsa \`Kalan: var\`. ${START_SESSION} ve ${HAND_OFF} çağırma, kart açma: sıradaki sohbeti ana sohbet açar. Dosyayı yazınca turu bitir.`

export const MANAGED_START_DENY =
  'otomatik-devir orkestra: bu yönetilen bir alt sohbet; yeni sohbet açma. Devir dosyasını yaz ve turu bitir; sıradakini ana sohbet açar.'

export const ORKESTRA_PAUSED_BAND = 'Orkestra duraklatıldı: devam etmek için bir mesaj yaz.'
export const ORKESTRA_PAUSED_DENY =
  'otomatik-devir orkestra: zincir duraklatıldı (ana sohbetin turu kapandı); yeni alt sohbet şimdi açılamaz. Turu bitir: kullanıcının bir sonraki mesajı zinciri sürdürür.'

export const orkestraBusyDeny = (n: number): string =>
  `otomatik-devir orkestra: alt sohbet ${n} çalışıyor ya da açılıyor; ikinci kez açma. Bekle: sıradakini ne zaman açacağını mod söyler.`

// O4 answers a start at the chain's limit with orkestraCapDeny(limit), and a
// chain that ended there (`sinir`) with orkestraCapDeny too: it names the verb
// that raises the limit.
export const orkestraCapDeny = (limit: number): string =>
  `otomatik-devir orkestra: zincir sınırına (${limit} alt sohbet) ulaşıldı; yeni sohbet açma. Sınırı kullanıcı /devir otonom limit <n> ile yükseltebilir. Kullanıcıya özet yaz ve turu bitir.`

/** The child's background when the model's own is shorter than 80 chars (O4). */
export const ORKESTRA_BACKGROUND =
  "Otonom bir zincirin (otomatik-devir orkestra modu) yönetilen alt sohbeti: iş ana sohbetten ya da önceki alt sohbetin devir dosyasından devralındı. Prompt'u oku ve işe devam et."

// ---------------------------------------------------------------------------
// Records under BACKEND file (O16, Decision 10): JSON files read and written
// with $.fs. $.fs has no rename, so a reader can catch a file mid-write: an
// existing file that does not parse is read once more at once, and still
// unparsable it is "not readable now" (`torn`), never "missing".
// ---------------------------------------------------------------------------

type FileRead = { kind: 'ok'; value: Record<string, unknown> } | { kind: 'missing' } | { kind: 'torn' }

const readJsonFile = async ($: EngineInterface, path: string | undefined): Promise<FileRead> => {
  if (path === undefined) return { kind: 'missing' }
  for (let attempt = 0; attempt < 2; attempt += 1) {
    let text: string
    try {
      text = await $.fs.read(path)
    } catch {
      return { kind: 'missing' }
    }
    try {
      const got = record(JSON.parse(text))
      if (got !== undefined) return { kind: 'ok', value: got }
    } catch {
      // cut or empty JSON: read it once more
    }
  }

  return { kind: 'torn' }
}

const homeOf = async ($: EngineInterface): Promise<string | undefined> => nonEmpty(await $.env.get('HOME'))

/** Store key prefix of a chain's settings (backend `store`); not `zincir:`, which the v1 cleanup deletes. */
export const ZINCIR_AYAR_PREFIX = 'ayar:'

/** A chain's settings file (backend `file`), keyed by its main chat's local id. */
export const zincirAyarFile = (home: string, localId: string): string => `${ORKESTRA_DIR(home)}/ayar-${localId}.json`

// The last chain settings this engine read or wrote, per chain: a torn read
// returns it, so a chain's `esik`/`limit` never turn into the defaults for one
// measurement (O16). Reset at session.start (O18).
let lastAyar: Record<string, OrkestraAyar> = {}

const toAyar = (got: Record<string, unknown>): OrkestraAyar => ({
  esik: typeof got.esik === 'number' ? got.esik : undefined,
  limit: typeof got.limit === 'number' ? got.limit : undefined,
  isClosed: got.isClosed === true ? true : undefined,
  at: typeof got.at === 'number' ? got.at : 0,
})

/** A chain's settings (Decision 22), or undefined when none were written. */
export const readChainSettings = async ($: EngineInterface, mainLocalId: string): Promise<OrkestraAyar | undefined> => {
  const home = await homeOf($)
  const got = await readJsonFile($, home === undefined ? undefined : zincirAyarFile(home, mainLocalId))
  if (got.kind === 'torn') return lastAyar[mainLocalId]
  if (got.kind === 'missing') return undefined
  const ayar = toAyar(got.value)
  lastAyar[mainLocalId] = ayar

  return ayar
}

/** That chain's limit (Decision 22): its settings' `limit` clamped, unset or invalid the default. */
export const orkestraLimit = async ($: EngineInterface, mainLocalId: string): Promise<number> => {
  const limit = (await readChainSettings($, mainLocalId).catch(() => undefined))?.limit

  return typeof limit === 'number' && Number.isFinite(limit) ? clampLimit(limit) : DEFAULT_LIMIT
}

/** `/devir otonom …` outside a chain (Decision 22: no chain settings, so the default limit). */
const NOT_ORCHESTRATED = `Bu sohbet orkestra modunda değil (sınır ${DEFAULT_LIMIT} alt sohbet). Başlatmak için ${START_HINT} yaz.`

type SelfSettings = { effort?: string; model?: string; permissionMode?: string }
type Settings = { threshold: number; isEnabled: boolean }

const isThreshold = (n: unknown): n is number =>
  typeof n === 'number' && Number.isInteger(n) && n >= 1 && n <= 99

/**
 * This chat's chain settings (Decision 22), from the cached conv role (never
 * `currentConv`): a main chat's own chain, a sub-chat's parent's. A normal
 * chat (role `yok` or unresolved) has none: the default threshold, off.
 */
const readSettings = async ($: EngineInterface): Promise<Settings> => {
  const sid = await $.session.id()
  const held = await read($, conv)
  const chainId =
    held === null || held.sid !== sid
      ? undefined
      : held.role === 'ana'
        ? held.localId
        : held.role === 'alt'
          ? held.parentId
          : undefined
  if (chainId === undefined) return { threshold: DEFAULT_THRESHOLD, isEnabled: false }
  const ayar = await readChainSettings($, chainId).catch(() => lastAyar[chainId])
  const esik = ayar?.esik

  return {
    threshold: isThreshold(esik) ? esik : DEFAULT_THRESHOLD,
    isEnabled: ayar?.isClosed !== true,
  }
}

/** The threshold this chat trips at: its own `/devir dene` value, else its chain's `esik`. */
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

/** This chat's part in a chain, for the status line (O9). */
type OrkestraStatus =
  | { role: 'ana'; main: OrkestraAna; child?: OrkestraAlt; isPaused: boolean }
  | { role: 'alt'; n: number }

/** The main chat's status line (Contract). */
const mainStatusText = ({ main, child, isPaused }: { main: OrkestraAna; child?: OrkestraAlt; isPaused: boolean }) => {
  if (main.ended === 'durdu') return orkestraStalledBand(main.n)
  if (main.ended !== undefined) return `Orkestra bitti (${main.n} alt sohbet)`
  if (isPaused || !main.isHeld) return 'Orkestra duraklatıldı'
  if (main.n === 0) return 'Orkestra: alt sohbet 1 açılıyor'

  return child?.status === 'ready' ? `Orkestra: alt sohbet ${main.n} hazır` : `Orkestra: alt sohbet ${main.n} çalışıyor`
}

const statusText = (
  settings: Settings,
  percent: number | undefined,
  held: OtomatikDevirConv | null,
  running: number,
  orkestra?: OrkestraStatus,
): string => {
  if (orkestra?.role === 'ana') return mainStatusText(orkestra)
  const text = v1StatusText(settings, percent, held, running)

  return orkestra?.role === 'alt' ? `Orkestra alt sohbet ${orkestra.n} · ${text}` : text
}

const v1StatusText = (
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

/** This chat's chain part from its cached role (O9): the main record and child, or the child's number. */
const orkestraStatusOf = async ($: EngineInterface, held: OtomatikDevirConv): Promise<OrkestraStatus | undefined> => {
  if (held.role === 'alt') return { role: 'alt', n: held.childN ?? 1 }
  if (held.role !== 'ana' || held.localId === undefined) return undefined
  const main = await readMain($, held.localId).catch(() => undefined)
  if (main === undefined) return undefined
  const child = main.n >= 1 ? await readChild($, main.childId) : undefined

  return { role: 'ana', main, child, isPaused: held.isPaused === true }
}

const refreshStatus = async ($: EngineInterface, percent?: number): Promise<void> => {
  const held = await currentConv($)
  // O20: a normal chat (cached role `yok` or unresolved) shows nothing.
  if (held.role !== 'ana' && held.role !== 'alt') {
    $.ui.status(undefined)

    return
  }
  const settings = await readSettings($)
  const running = held.phase === 'handoff_running' ? (await activeAgents($)).length : 0
  const orkestra = await orkestraStatusOf($, held)
  $.ui.status(statusText(settings, percent ?? (await contextPercent($)), held, running, orkestra))
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
  // O14: a managed sub-chat's record follows its phase.
  if (held.role === 'alt') await syncChild($, held)
}

/**
 * O14: a managed sub-chat's own record, `working` (idle, handoff_running) or
 * `ready` with its file. A `finished` record stays; `done` (consumed) leaves it.
 */
const syncChild = async ($: EngineInterface, held: OtomatikDevirConv): Promise<void> => {
  if (held.localId === undefined || held.phase === 'done') return
  const base = await childBase($, held)
  if (base === undefined || base.status === 'finished' || base.status === 'cancelled') return
  const isReady = held.phase === 'ready'
  await writeRecord($, held.localId, {
    ...base,
    status: isReady ? 'ready' : 'working',
    file: isReady ? held.file : undefined,
    at: await $.clock.now(),
  })
}

/**
 * A managed sub-chat's own record, else (its first write failed) one rebuilt
 * from conv as `working`; undefined without a local id or parent.
 */
const childBase = async ($: EngineInterface, held: OtomatikDevirConv): Promise<OrkestraAlt | undefined> => {
  if (held.localId === undefined) return undefined
  const own = await readRecord($, held.localId)
  if (own?.role === 'alt') return own
  if (held.parentId === undefined) return undefined

  return {
    role: 'alt',
    parent: held.parentId,
    n: held.childN ?? 1,
    sid: held.sid,
    localId: held.localId,
    status: 'working',
    at: 0,
  }
}

/**
 * O15: a `ready` sub-chat whose parent moved on (a later child, or the chain
 * ended) is consumed: `done`, so its drain lifts.
 */
const consumeChild = async ($: EngineInterface, held: OtomatikDevirConv): Promise<OtomatikDevirConv> => {
  if (held.parentId === undefined) return held
  const parent = await readRecord($, held.parentId).catch(() => undefined)
  if (parent?.role !== 'ana' || !(parent.n > (held.childN ?? 0) || parent.ended !== undefined)) return held
  // O21 over O15 also when the chain settings were not readable now: a main
  // chat that ended `kapatildi` was closed, so its ready child is cancelled.
  if (parent.ended === 'kapatildi') return cancelHandoff($, held.sid, true)
  await setPhase($, held.sid, 'done')
  const now = await read($, conv)

  return now !== null && now.sid === held.sid ? now : held
}

/** The record of this sid, rebuilt from the store when $.state has none (a reload). */
const restoreConv = async ($: EngineInterface, sid: string): Promise<OtomatikDevirConv> => {
  const base = await restoreHandoff($, sid)
  // O16: a reload keeps this chat's orchestration role (its local id and own record).
  const localId = nonEmpty(await $.store.get(`${KIMLIK_PREFIX}${sid}`).catch(() => undefined))
  if (localId === undefined) return base
  const own = await readRecord($, localId).catch(() => undefined)
  if (own === undefined) return { ...base, localId }
  if (own.role === 'ana') {
    return {
      ...base,
      localId,
      role: 'ana',
      childN: own.n,
      isPaused: !own.isHeld && own.ended === undefined ? true : undefined,
    }
  }

  return { ...base, localId, role: 'alt', parentId: own.parent, childN: own.n }
}

const restoreHandoff = async ($: EngineInterface, sid: string): Promise<OtomatikDevirConv> => {
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

/**
 * Cancels this chat's handoff whose child has not started (v1.0.1): back to
 * `idle`, only the handoff fields cleared (O21: the role, ids, chain fields,
 * `/devir dene`, last typed message and noted settings kept), `devir:<sid>`
 * deleted, the drain lifted, the band and status redrawn. `/devir kapat` runs
 * it, and so does any chat that sees its chain closed (`isNoticed`: a toast
 * says so). A finished handoff (`done`, `devredildi:<sid>`) is never undone; a
 * handoff file already written stays on disk. A managed sub-chat whose drain
 * it cancelled records itself `cancelled` (never relayed).
 */
const cancelHandoff = async ($: EngineInterface, sid: string, isNoticed: boolean): Promise<OtomatikDevirConv> => {
  let now: OtomatikDevirConv = { sid, phase: 'idle' }
  let wasDrain = false
  await update($, conv, (held): OtomatikDevirConv | null => {
    if (held !== null && held.sid !== sid) return held
    if (held?.phase === 'done') {
      now = held
      return held
    }
    wasDrain = held !== null && isDrainPhase(held.phase)
    now = {
      ...held,
      sid,
      phase: 'idle',
      handoffId: undefined,
      handoffAt: undefined,
      file: undefined,
      isGateClosed: undefined,
      isForced: undefined,
      starting: undefined,
      pendingMessage: undefined,
      instructNext: undefined,
      instructedTurn: undefined,
      notedTurn: undefined,
    }
    return now
  })
  if (now.phase === 'done') return now
  isDraining = false
  await $.store.delete(`${RUN_PREFIX}${sid}`).catch(() => undefined)
  // O14, O21: the cancelled drain of a managed sub-chat; its main chat ends `kapatildi`.
  if (wasDrain && now.role === 'alt' && now.localId !== undefined) {
    const own = await childBase($, now).catch(() => undefined)
    if (own !== undefined && own.status !== 'finished' && own.status !== 'cancelled') {
      await writeRecord($, own.localId, { ...own, status: 'cancelled', file: undefined, at: await $.clock.now() })
    }
  }
  later($, async () => {
    try {
      $.ui.invalidate('ui.render')
    } catch {
      // the band redraws on the next prop change anyway
    }
    if (isNoticed) $.ui.toast('Otomatik devir kapalı: bu sohbetin devri iptal edildi.')
    await refreshStatus($).catch(() => undefined)
  })

  return now
}

/**
 * The record of the conversation now running; a new session id restores it
 * from the store. A handoff not yet handed off is dropped once the mod is
 * off, in whichever chat turned it off (v1.0.1).
 */
const currentConv = async ($: EngineInterface): Promise<OtomatikDevirConv> => {
  const sid = await $.session.id()
  const held = await read($, conv)
  let now: OtomatikDevirConv
  if (held !== null && held.sid === sid) {
    now = held
  } else {
    now = await restoreConv($, sid)
    const restored = now
    await update($, conv, () => restored)
  }
  // O21 before O15: a closed chain cancels its ready sub-chat (below), never consumes it.
  if (now.phase === 'ready' && now.role === 'alt' && (await readSettings($)).isEnabled) now = await consumeChild($, now)
  isDraining = isDrainPhase(now.phase)
  if (isDraining) {
    // O20: only a managed sub-chat drains; a leftover elsewhere goes silently.
    if ((await roleOf($)) !== 'alt') return cancelHandoff($, sid, false)
    if (!(await readSettings($)).isEnabled) return cancelHandoff($, sid, true)
  }

  return now
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
 * The trip is due: this is a managed sub-chat whose parent chain is live and
 * open, this session never handed off, and either `/devir simdi` forced it or
 * the fill reached this chat's threshold.
 */
const isDue = async ($: EngineInterface, held: OtomatikDevirConv): Promise<{ threshold: number } | undefined> => {
  // O3, O20: only a managed sub-chat hands off by threshold; a normal chat and
  // the main chat never measure for a trip.
  if ((await roleOf($)) !== 'alt') return undefined
  const chainId = await chainIdOf($)
  const parent = chainId === undefined ? undefined : await readRecord($, chainId).catch(() => undefined)
  if (parent?.role !== 'ana' || parent.ended !== undefined) return undefined
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
  // O12: a managed sub-chat only writes its file; the main chat starts the next one.
  const isManaged = (await roleOf($)) === 'alt'
  const isClaimed = await claim($, sid, may, {
    phase: 'handoff_running',
    handoffId: newHandoffId(sid, now),
    handoffAt: now,
    file,
    isGateClosed: isManaged || !isPersonTurn,
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

/**
 * The handoff instruction for this chat (O12): a managed sub-chat writes its
 * file only; else in-turn when the person typed the turn, the closed-turn text otherwise.
 */
const handoffTextFor = (held: OtomatikDevirConv, threshold: number, file: string, hasSkill: boolean): string =>
  held.role === 'alt'
    ? managedHandoff(threshold, file, hasSkill)
    : isPersonTurn
      ? inTurnHandoff(threshold, file, hasSkill)
      : closedTurnHandoff(threshold, file, hasSkill)

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

type SelfSession = SelfSettings & { id?: string; title?: string; parentId?: string }

/** This chat's own desktop session: its id (local_...), parent (local_...), title, effort, model and permission mode. */
const selfSession = async ($: EngineInterface): Promise<SelfSession> => {
  try {
    const got = await $.tool.call({ tool: GET_SESSION, session_id: 'self' })
    if (got.deny !== undefined || got.isError === true || got.text === undefined) return {}
    const info = JSON.parse(got.text) as Record<string, unknown>

    return {
      id: nonEmpty(info.sessionId),
      parentId: nonEmpty(info.parentSessionId),
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

// ---------------------------------------------------------------------------
// Orchestration records, ids and roles (O10, O11, O16). Records are keyed by
// local id (Corrections): the main chat knows its child only by the
// start_session result, the child its parent only by `parentSessionId`.
// Each record has one writer: the main chat its own, a child its own.
// ---------------------------------------------------------------------------

type RecordRead = { kind: 'ok'; rec: OrkestraRecord } | { kind: 'missing' } | { kind: 'torn' }

/** A parsed record; anything else (an O1 tombstone `{ gone }` too) is no record. */
const toRecord = (got: Record<string, unknown>): OrkestraRecord | undefined => {
  if (typeof got.localId !== 'string' || typeof got.n !== 'number') return undefined
  if (got.role === 'ana' && typeof got.task === 'string') return got as unknown as OrkestraAna
  if (got.role === 'alt' && typeof got.parent === 'string') return got as unknown as OrkestraAlt

  return undefined
}

const readRecordState = async ($: EngineInterface, localId: string): Promise<RecordRead> => {
  const home = await homeOf($)
  const got = await readJsonFile($, home === undefined ? undefined : orkestraRecordFile(home, localId))
  if (got.kind !== 'ok') return got
  const rec = toRecord(got.value)

  return rec === undefined ? { kind: 'missing' } : { kind: 'ok', rec }
}

/** The record of `localId`; missing, invalid or not readable now: undefined (O16). */
const readRecord = async ($: EngineInterface, localId: string): Promise<OrkestraRecord | undefined> => {
  const got = await readRecordState($, localId)

  return got.kind === 'ok' ? got.rec : undefined
}

/** Writes the whole record file ($.fs.write creates the folder). */
const writeRecord = async (
  $: EngineInterface,
  localId: string,
  rec: OrkestraRecord | { gone: true; at: number },
): Promise<void> => {
  const home = await homeOf($)
  if (home === undefined) return
  await $.fs.write(orkestraRecordFile(home, localId), JSON.stringify(rec))
}

// The main chat's own record as this engine last read or wrote it: the main
// chat is its only writer, so the copy stays true (prompt.compose and the band
// read it on every render). Reset at session.start.
let ownMain: OrkestraAna | undefined

const readMain = async ($: EngineInterface, localId: string): Promise<OrkestraAna | undefined> => {
  if (ownMain?.localId === localId) return ownMain
  const rec = await readRecord($, localId)
  if (rec?.role !== 'ana') return undefined
  ownMain = rec

  return rec
}

const writeMain = async ($: EngineInterface, rec: OrkestraAna): Promise<void> => {
  await writeRecord($, rec.localId, rec)
  // Cached once written: a failed write leaves the copy true to the file.
  ownMain = rec
}

/** Read, merge, write this main chat's record; undefined when it has none. */
const patchMain = async (
  $: EngineInterface,
  localId: string,
  patch: Partial<OrkestraAna>,
): Promise<OrkestraAna | undefined> => {
  const base = await readMain($, localId)
  if (base === undefined) return undefined
  const rec: OrkestraAna = { ...base, ...patch, at: await $.clock.now() }
  await writeMain($, rec)

  return rec
}

const readChild = async ($: EngineInterface, childId: string | undefined): Promise<OrkestraAlt | undefined> => {
  if (childId === undefined || childId === UNKNOWN_CHILD) return undefined
  const rec = await readRecord($, childId).catch(() => undefined)

  return rec?.role === 'alt' ? rec : undefined
}

/** Writes a chain's settings whole (Decision 22). */
export const writeChainSettings = async ($: EngineInterface, mainLocalId: string, rec: OrkestraAyar): Promise<void> => {
  const home = await homeOf($)
  if (home === undefined) return
  lastAyar[mainLocalId] = rec
  await $.fs.write(zincirAyarFile(home, mainLocalId), JSON.stringify(rec))
}

/** Read, merge, write a chain's settings (a torn or missing read merges over lastAyar). */
export const patchChainSettings = async (
  $: EngineInterface,
  mainLocalId: string,
  patch: Partial<OrkestraAyar>,
): Promise<OrkestraAyar> => {
  const base = (await readChainSettings($, mainLocalId)) ?? lastAyar[mainLocalId]
  const rec: OrkestraAyar = { ...base, ...patch, at: await $.clock.now() }
  await writeChainSettings($, mainLocalId, rec)

  return rec
}

// This engine's one `get_session self` answer per conversation (O16, O17): the
// local id and the parent come from the same call. A failed GET is not kept.
let selfInfo: { sid: string; info: SelfSession } | undefined

const selfOnce = async ($: EngineInterface, sid: string): Promise<SelfSession> => {
  if (selfInfo?.sid === sid) return selfInfo.info
  const info = await selfSession($)
  if (info.id !== undefined) selfInfo = { sid, info }

  return info
}

/** $.state holds this sid's record, rebuilt from the store first (a reload), so a role patch never hides a running handoff. */
const ensureConv = async ($: EngineInterface, sid: string): Promise<void> => {
  const held = await read($, conv)
  if (held !== null && held.sid === sid) return
  const restored = await restoreConv($, sid)
  await update($, conv, now => (now !== null && now.sid === sid ? now : restored))
}

/** This chat's local id: conv, else `kimlik:<sid>`, else `get_session self` (then kept in both). */
const selfLocal = async ($: EngineInterface): Promise<string | undefined> => {
  const sid = await $.session.id()
  await ensureConv($, sid)
  const held = await read($, conv)
  if (held !== null && held.sid === sid && held.localId !== undefined) return held.localId
  const stored = nonEmpty(await $.store.get(`${KIMLIK_PREFIX}${sid}`).catch(() => undefined))
  const id = stored ?? (await selfOnce($, sid)).id
  if (id === undefined) return undefined
  if (stored === undefined) await $.store.set(`${KIMLIK_PREFIX}${sid}`, id).catch(() => undefined)
  await patchConv($, sid, { localId: id })

  return id
}

/**
 * This chat's role (O10), cached in conv. Its own record names it; else the
 * parent from `get_session self` makes it `alt` when the parent's live main
 * record points at this chat (or is starting one), and the child writes its
 * own record. A failed GET or a torn file: `yok` for this call, not cached.
 * Reads conv with `read`, never `currentConv` (O16).
 */
const roleOf = async ($: EngineInterface): Promise<OrkestraRole> => {
  const sid = await $.session.id()
  await ensureConv($, sid)
  const held = await read($, conv)
  if (held !== null && held.sid === sid && held.role !== undefined) return held.role

  return (await resolveRole($, sid)) ?? 'yok'
}

const resolveRole = async ($: EngineInterface, sid: string): Promise<OrkestraRole | undefined> => {
  const localId = await selfLocal($)
  if (localId === undefined) return undefined
  const own = await readRecordState($, localId)
  if (own.kind === 'torn') return undefined
  if (own.kind === 'ok') {
    const rec = own.rec
    await patchConv(
      $,
      sid,
      rec.role === 'ana' ? { role: 'ana', childN: rec.n } : { role: 'alt', parentId: rec.parent, childN: rec.n },
    )

    return rec.role
  }
  const self = await selfOnce($, sid)
  if (self.id === undefined) return undefined
  if (self.parentId === undefined) {
    await patchConv($, sid, { role: 'yok' })

    return 'yok'
  }
  const got = await readRecordState($, self.parentId)
  if (got.kind === 'torn') return undefined
  const parent = got.kind === 'ok' && got.rec.role === 'ana' ? got.rec : undefined
  if (
    parent === undefined ||
    parent.ended !== undefined ||
    !(parent.childId === self.id || parent.childId === UNKNOWN_CHILD || parent.starting === true)
  ) {
    await patchConv($, sid, { role: 'yok' })

    return 'yok'
  }
  const n = parent.starting === true ? parent.n + 1 : parent.n || 1
  const mine: OrkestraAlt = {
    role: 'alt',
    parent: parent.localId,
    n,
    sid,
    localId,
    status: 'working',
    at: await $.clock.now(),
  }
  const held = await read($, conv)
  // O11: a child with no own `/devir dene` inherits the chain's test threshold.
  const inherited =
    held?.testThreshold === undefined && parent.testThreshold !== undefined ? { testThreshold: parent.testThreshold } : {}
  // The role is cached before the record write: a failed write still leaves
  // this chat managed (O13 fails closed; syncChild writes the record later).
  await patchConv($, sid, { role: 'alt', parentId: parent.localId, childN: n, ...inherited })
  await writeRecord($, localId, mine)

  return 'alt'
}

/** This chat's chain (Decision 22): a main chat's own local id, a sub-chat's parent; else none. */
export const chainIdOf = async ($: EngineInterface): Promise<string | undefined> => {
  const role = await roleOf($)
  if (role === 'ana') return selfLocal($)
  if (role !== 'alt') return undefined
  const sid = await $.session.id()
  const held = await read($, conv)
  if (held !== null && held.sid === sid && held.parentId !== undefined) return held.parentId
  const localId = await selfLocal($)
  const own = localId === undefined ? undefined : await readRecord($, localId)

  return own?.role === 'alt' ? own.parent : undefined
}

// ---------------------------------------------------------------------------
// The chain's start (O1) and a typed message in a live main chat (O7), in
// prompt.submit before every v1 return.
// ---------------------------------------------------------------------------

type SubmitNext = (e: PromptSubmitInput) => Promise<PromptSubmitResult>

// Module state of the main chat's Stop and mid-turn notes (O5, O6), reset at
// session.start (O18) and at a new chain.
let orkestraStartBlocks: { n: number; count: number } | undefined
let orkestraNoted: string | undefined
/** `<turn>:<n>` of the end text a tool result already carried (O6): that turn's Stop does not repeat it. */
let orkestraEndTold: string | undefined

const ROLE_ALT_DROP = 'Bu bir alt sohbet; otonom zincir ana sohbette çalışır.'
const LIVE_DROP = 'Bu sohbette otonom zincir zaten çalışıyor (/devir otonom).'
const HANDED_DROP = 'Bu sohbet zaten devredildi; /otomatik-devir:devir-otonom için yeni bir sohbet aç.'
const EMPTY_DROP = 'Görev boş: ' + START_HINT + ' yaz.'
const NO_ID_DROP = 'otomatik-devir: oturum kimliği okunamadı; zincir başlamadı.'
const HANDED_CONTEXT = 'otomatik-devir: bu sohbet zaten devredildi; orkestra için yeni bir sohbet aç ve bunu kullanıcıya söyle.'
const EMPTY_CONTEXT = 'otomatik-devir orkestra: görev boş; kullanıcıya "orkestra:" sonrasına görevi yazmasını söyle.'
const NO_ID_CONTEXT = 'otomatik-devir orkestra: oturum kimliği okunamadı; orkestra başlamadı.'
const CONTINUE_ONLY = /^\s*(devam( et)?|continue)\s*[.!]?\s*$/i

/** Who typed the turn this submission opens (or the running one), as the v1 path notes it. */
const noteTyper = (e: PromptSubmitInput, isPerson: boolean): void => {
  if (e.turnId === undefined) {
    isNextTurnPerson = isPerson
  } else {
    if (isPerson && e.turnId === runningTurnId) isPersonTurn = true
    if (isPerson) isNextTurnPerson = true
  }
}

/** The start trigger (O1, Decision 17): `/devir-otonom` (cmd) or `orkestra:` (pfx), with its task. */
const otonomStart = (e: PromptSubmitInput): { entry: 'cmd' | 'pfx'; task: string } | undefined => {
  if (e.command !== undefined) {
    return OTONOM_COMMANDS.includes(e.command.name) ? { entry: 'cmd', task: e.command.args.trim() } : undefined
  }
  const text = e.text.trimStart()
  if (text.startsWith(OTONOM_MARKER)) {
    // The rendered body: the task is under its `Görev:` line.
    const body = text.slice(OTONOM_MARKER.length)
    const goal = /^\s*Görev:[ \t]*([\s\S]*)$/m.exec(body)

    return { entry: 'cmd', task: (goal?.[1] ?? body).trim() }
  }
  const line = OTONOM_LINE.exec(text)
  if (line !== null) return { entry: 'cmd', task: text.slice(line[0].length).trim() }
  if (ORKESTRA_RE.test(text)) return { entry: 'pfx', task: text.replace(ORKESTRA_RE, '').trim() }

  return undefined
}

const withContext = (e: PromptSubmitInput, note: string): PromptSubmitInput => ({
  ...e,
  context: [...(e.context ?? []), note],
})

/**
 * O7: a typed message in a live main chat holds the chain again; its text goes
 * to the next child as the person's note (unless it only says "devam").
 * Undefined when this chat is no live main chat.
 */
const orkestraTyped = async (
  $: EngineInterface,
  e: PromptSubmitInput,
  next: SubmitNext,
  isPerson: boolean,
): Promise<PromptSubmitResult | undefined> => {
  const sid = await $.session.id()
  const held = await read($, conv)
  if (held === null || held.sid !== sid || held.role !== 'ana' || held.localId === undefined) return undefined
  const main = await readMain($, held.localId)
  if (main === undefined) return undefined
  if (main.ended !== undefined) {
    // O7: a chain that ended while paused gives the next typed message its end text, once.
    if (held.isPaused !== true) return undefined
    await patchConv($, sid, { isPaused: undefined })
    const child = main.n >= 1 ? await readChild($, main.childId) : undefined
    const limit = await orkestraLimit($, main.localId)
    noteTyper(e, isPerson)
    later($, () => refreshStatus($))

    return next(withContext(e, orkestraEndText(main.ended, main.n, child?.report, child?.file, main.childId, limit)))
  }
  // O21: this chain closed: it ends here, nothing resumes.
  if ((await readChainSettings($, main.localId).catch(() => undefined))?.isClosed === true) {
    const child = main.n >= 1 ? await readChild($, main.childId) : undefined
    await patchMain($, main.localId, { ended: 'kapatildi' })
    await patchConv($, sid, { isPaused: undefined })
    noteTyper(e, isPerson)
    later($, () => refreshStatus($))

    return next(withContext(e, orkestraEndText('kapatildi', main.n, child?.report, child?.file, main.childId)))
  }
  const isNote = !CONTINUE_ONLY.test(e.text) && e.text.trim() !== ''
  const pending = isNote
    ? main.pendingMessage === undefined
      ? e.text
      : `${main.pendingMessage}\n\n${e.text}`
    : main.pendingMessage
  await patchMain($, main.localId, { isHeld: true, pendingMessage: pending })
  await patchConv($, sid, { isPaused: undefined })
  const child = main.n >= 1 ? await readChild($, main.childId) : undefined
  noteTyper(e, isPerson)
  later($, () => refreshStatus($))

  return next(withContext(e, orkestraResumeNote(main.n, child?.status ?? 'yok')))
}

/**
 * O1 and O7, before the v1 returns of prompt.submit. Undefined: not the
 * orchestrator's, the v1 path goes on.
 */
const orkestraSubmit = async (
  $: EngineInterface,
  e: PromptSubmitInput,
  next: SubmitNext,
  isPerson: boolean,
): Promise<PromptSubmitResult | undefined> => {
  if (!isPerson) return undefined
  const start = otonomStart(e)
  if (start === undefined) {
    if (e.command !== undefined) return undefined
    try {
      return await orkestraTyped($, e, next, isPerson)
    } catch (error) {
      $.ui.log(`otomatik-devir: orkestra mesajı işlenemedi: ${String(error)}`, { to: 'debug' })

      return undefined
    }
  }
  const { entry, task } = start
  const isCommand = entry === 'cmd'
  const sid = await $.session.id()
  if ((await roleOf($)) === 'alt') {
    if (!isCommand) return undefined
    noteTyper(e, isPerson)

    return { drop: ROLE_ALT_DROP }
  }
  const localId = await selfLocal($)
  const live = localId === undefined ? undefined : await readMain($, localId)
  if (live !== undefined && live.ended === undefined) {
    if (!isCommand) return orkestraTyped($, e, next, isPerson)
    noteTyper(e, isPerson)

    return { drop: LIVE_DROP }
  }
  noteTyper(e, isPerson)
  if ((await handedOf($, sid)) !== undefined) {
    return isCommand ? { drop: HANDED_DROP } : next(withContext(e, HANDED_CONTEXT))
  }
  if (task === '') return isCommand ? { drop: EMPTY_DROP } : next(withContext(e, EMPTY_CONTEXT))
  if (localId === undefined) return isCommand ? { drop: NO_ID_DROP } : next(withContext(e, NO_ID_CONTEXT))
  const now = await $.clock.now()
  const first = childTitle(task, 1)
  let isMainWritten = false
  try {
    await writeChainSettings($, localId, { at: now }) // D22: new chain settings
    const held = await read($, conv)
    await writeMain($, {
      role: 'ana',
      sid,
      localId,
      task,
      title: first.slice(0, -' · 1'.length),
      n: 0,
      isHeld: true,
      testThreshold: held !== null && held.sid === sid ? held.testThreshold : undefined,
      startedAt: now,
      at: now,
    })
    isMainWritten = true
    await patchConv($, sid, { role: 'ana', childN: 0, isPaused: undefined, stalledN: undefined, starting: undefined })
  } catch (error) {
    // Fail closed: no main record, so no body may start child 1.
    $.ui.log(`otomatik-devir: zincir kaydı yazılamadı: ${String(error)}`, { to: 'debug' })
    ownMain = undefined
    // A main record written before the failure goes too (a tombstone), so no
    // later event resolves this chat as a main chat the person was told never started.
    if (isMainWritten) {
      await writeRecord($, localId, { gone: true, at: now }).catch(() => undefined)
      await patchConv($, sid, { role: undefined, childN: undefined }).catch(() => undefined)
    }

    return isCommand ? { drop: NO_ID_DROP } : next(withContext(e, NO_ID_CONTEXT))
  }
  orkestraStartBlocks = undefined
  orkestraNoted = undefined
  orkestraEndTold = undefined
  const note = orkestraStartNote(first)
  const out = await next(isCommand ? withContext(e, note) : { ...withContext(e, note), text: task })
  if (out.drop !== undefined) {
    // Dropped beneath: no chain started; the record goes (a tombstone: $.fs has no delete).
    ownMain = undefined
    await writeRecord($, localId, { gone: true, at: await $.clock.now() })
    await patchConv($, sid, { role: undefined, childN: undefined })
  }
  later($, () => refreshStatus($))

  return out
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
 * Decision 16: a Skill call of my-skill-handoff the model makes on its own
 * (mod on, idle, not the mod's own `auto <file>` call, and the person's latest
 * typed message does not ask for a handoff). Any error here is "no": a skill
 * is never blocked by a failing check.
 */
const isUnaskedSkillHandoff = async ($: EngineInterface, call: Record<string, unknown>): Promise<boolean> => {
  try {
    if (call.tool !== 'Skill' || typeof call.skill !== 'string' || !call.skill.endsWith(SKILL)) return false
    if (typeof call.args === 'string' && call.args.trimStart().startsWith('auto ')) return false
    // O20: only a managed sub-chat's own handoff skill call is refused.
    if ((await roleOf($)) !== 'alt') return false
    if (!(await readSettings($)).isEnabled) return false
    const held = await currentConv($)

    return held.phase === 'idle' && !HANDOFF_ASK.test(held.lastTyped ?? '')
  } catch {
    return false
  }
}

/** A start in flight that is not stale (O4): an older one is a crash mid-start. */
/** The main chat's start_session when the mod's own check failed (O4 fails closed). */
const ORKESTRA_START_FAILED =
  'otomatik-devir orkestra: alt sohbet şu an açılamadı (mod hatası); yeniden deneme. Kullanıcıya söyle ve turu bitir.'

/** This chat's role as cached in conv (no resolution), for the tool.call `.catch` (O13). */
const cachedRole = async ($: EngineInterface): Promise<OrkestraRole | undefined> => {
  const held = await read($, conv)

  return held !== null && held.sid === (await $.session.id()) ? held.role : undefined
}

const isLiveStarting = (main: OrkestraAna, now: number): boolean =>
  main.starting === true && now - (main.startingAt ?? 0) < STARTING_STALE_MS

/**
 * O4: the main chat's start_session. Every refusal of the chain comes first;
 * then one start at a time (a claim on conv), the prompt filled by the mod (the
 * task for child 1, the previous child's file after), and the child recorded.
 * Undefined when this chat has no main record (the v1 flow then runs).
 */
const orkestraStart = async (
  $: EngineInterface,
  call: { tool: string } & Record<string, unknown>,
  next: ToolNext,
): Promise<Awaited<ReturnType<ToolNext>> | undefined> => {
  const sid = await $.session.id()
  const localId = await selfLocal($)
  const main = localId === undefined ? undefined : await readMain($, localId)
  if (localId === undefined || main === undefined) return undefined
  // O21: no new sub-chat once this chain is closed (`ended` is written by O5/O6/O7).
  if (main.ended === undefined && (await readChainSettings($, localId).catch(() => undefined))?.isClosed === true) {
    return { deny: ORKESTRA_END_DENY }
  }
  const limit = await orkestraLimit($, localId)
  if (main.ended !== undefined) return { deny: main.ended === 'sinir' ? orkestraCapDeny(limit) : ORKESTRA_END_DENY }
  if (!main.isHeld) return { deny: ORKESTRA_PAUSED_DENY }
  const now = await $.clock.now()
  if (isLiveStarting(main, now)) return { deny: orkestraBusyDeny(main.n + 1) }
  const child = main.n >= 1 ? await readChild($, main.childId) : undefined
  let file: string | undefined
  if (main.n >= 1) {
    // O21: a cancelled child is never relayed.
    if (child?.status === 'cancelled') return { deny: ORKESTRA_END_DENY }
    if (child?.status !== 'ready') return { deny: orkestraBusyDeny(main.n) }
    file = child.file
    const text = await readFresh($, file, undefined)
    if ((text !== undefined && NONE_LEFT_RE.test(text)) || main.isStopRequested === true) {
      return { deny: ORKESTRA_END_DENY }
    }
    // O22: a full main chat starts no next child (O5/O6 write the end).
    const percent = await contextPercent($)
    if (percent !== undefined && percent >= MAIN_FULL_PERCENT) return { deny: ORKESTRA_END_DENY }
  }
  if (main.n >= limit) return { deny: orkestraCapDeny(limit) }
  const isClaimed = await claim($, sid, h => h.starting === undefined, { starting: 'orkestra' })
  if (!isClaimed) return { deny: orkestraBusyDeny(main.n + 1) }
  try {
    const n = main.n + 1
    let body: string
    if (n === 1) {
      const own = nonEmpty(call.prompt)
      body =
        own === undefined
          ? main.task
          : own.includes(main.task)
            ? own
            : `${own}\n\n## Kullanıcının asıl isteği\n${main.task}`
    } else {
      const text = await readFresh($, file, undefined)
      if (text === undefined) {
        return { deny: `otomatik-devir orkestra: alt sohbet ${main.n} devir dosyası okunamadı: ${file ?? ''}` }
      }
      body = text
    }
    const message = main.pendingMessage
    const prompt =
      body +
      (message !== undefined && message.trim() !== '' ? `\n\n## Kullanıcının notu\n${message}` : '') +
      managedChildNote(n, limit)
    await patchMain($, localId, { starting: true, startingAt: now })
    const title = childTitle(main.task, n)
    const input: { tool: string } & Record<string, unknown> = {
      ...call,
      initiation: 'user_asked',
      context: 'fresh',
      title,
      background:
        typeof call.background === 'string' && call.background.length >= 80 ? call.background : ORKESTRA_BACKGROUND,
      prompt,
    }
    delete input.proposal_id
    const pause = async () => {
      await patchMain($, localId, { starting: undefined, startingAt: undefined, isHeld: false })
      await patchConv($, sid, { isPaused: true })
    }
    let result: Awaited<ReturnType<ToolNext>>
    try {
      result = await next(input as unknown as ToolCallArgs)
    } catch (error) {
      await pause()
      throw error
    }
    if (result.deny !== undefined || result.isError === true) {
      await pause()

      return result
    }
    await patchMain($, localId, {
      n,
      childId: startedId(result) ?? UNKNOWN_CHILD,
      starting: undefined,
      startingAt: undefined,
      stallCount: undefined,
      stallAt: undefined,
      pendingMessage: undefined,
    })
    await patchConv($, sid, { childN: n })
    later($, async () => {
      $.ui.toast(`Orkestra: alt sohbet ${n} açıldı`)
      await refreshStatus($).catch(() => undefined)
    })

    return result
  } finally {
    await patchConv($, sid, { starting: undefined })
  }
}

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
  // O4: the main chat's starts, before the v1 handed-off check.
  const role = await roleOf($)
  if (role === 'ana') {
    const started = await orkestraStart($, call, next)
    if (started !== undefined) return started
  }
  // O20: a normal chat's start passes untouched (role `alt` never gets here, O13).
  if (role !== 'ana' && role !== 'alt') return next(call as unknown as ToolCallArgs)
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
    // A start that threw is refused too (S6): the gate closes, the Stop makes it `ready`.
    await patchConv($, sid, { starting: undefined, isGateClosed: true })
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

    return handoffTextFor(claimed, due.threshold, claimed.file, hasSkill)
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

    return handoffTextFor(held, thresholdOf(settings, held), held.file, await hasHandoffSkill($))
  }

  return undefined
}


// ---------------------------------------------------------------------------
// The Stop guard (S7, probe RESULT M: a mod Stop block keeps the typed turn
// open across blocks, so the model waits and starts the child in that turn).
// ---------------------------------------------------------------------------

// Stop blocks in the running main turn (reset at turn.start), and the
// timeout blocks of one handoff (by its id).
let handoffBlocks = 0
let missingBlocks = 0
let timeoutFor: { id: string; n: number } | undefined

type BackgroundTask = { id: string; type: string; status: string; description: string }

// Decision 21a: the background tasks of this turn's last main-loop Stop, so
// turn.complete's `ready` check sees Workflows ($.agent.list() does not).
// Reset at session.start (O18).
let lastStopTasks: { turnId: string | undefined; tasks: readonly BackgroundTask[] | undefined } | undefined

/**
 * The work the turn waits on (Decision 15): subagents and Workflows running or
 * pending in `background_tasks`; `$.agent.list()` only when the hook got none.
 * Background Bash, Monitor and dev servers are never waited on.
 */
const runningWork = async ($: EngineInterface, tasks: readonly BackgroundTask[] | undefined): Promise<Running> => {
  if (tasks !== undefined) {
    return tasks
      .filter(
        task =>
          (task.type === 'subagent' || task.type === 'workflow') &&
          (task.status === 'running' || task.status === 'pending'),
      )
      .map(task => ({ id: task.id, description: task.description }))
  }

  return (await activeAgents($)).map(agent => ({ id: agent.id, description: agent.description }))
}


// ---------------------------------------------------------------------------
// The main chat's next step (O5, O6, O19): start, wait, relay or end.
// ---------------------------------------------------------------------------

type OrkestraDecision =
  | { kind: 'pass' }
  | { kind: 'start' | 'relay' | 'wait' | 'stalled'; n: number; text: string }
  | { kind: 'end'; n: number; end: EndKind; text: string }

/** The child's `isRunning` from `get_session` (O19); undefined when it cannot tell. */
const childRunning = async ($: EngineInterface, childId: string): Promise<boolean | undefined> => {
  try {
    const got = await callTool($, { tool: GET_SESSION, session_id: childId })
    if (got.deny !== undefined || got.isError === true || got.text === undefined) return undefined
    const isRunning = record(JSON.parse(got.text))?.isRunning

    return typeof isRunning === 'boolean' ? isRunning : undefined
  } catch {
    return undefined
  }
}

/**
 * What the main chat does next, from its record and its child's; undefined
 * outside a live main chat. Decides only: its one write is O19's stall count,
 * under `isCycle` (the Stop's wait cycle).
 */
const orkestraDecision = async (
  $: EngineInterface,
  opts: { isCycle?: boolean } = {},
): Promise<{ decision: OrkestraDecision; main: OrkestraAna } | undefined> => {
  if ((await roleOf($)) !== 'ana') return undefined
  const localId = await selfLocal($)
  const main = localId === undefined ? undefined : await readMain($, localId)
  if (localId === undefined || main === undefined || main.ended !== undefined) return undefined
  const done = (decision: OrkestraDecision) => ({ decision, main })
  const n = main.n
  // O21: this chain closed (`/devir kapat`) or its child cancelled: the chain ends first, paused too.
  const isClosed = (await readChainSettings($, localId).catch(() => undefined))?.isClosed === true
  const last = n >= 1 ? await readChild($, main.childId) : undefined
  if (isClosed || last?.status === 'cancelled') {
    return done({
      kind: 'end',
      n,
      end: 'kapatildi',
      text: orkestraEndText('kapatildi', n, last?.report, last?.file, main.childId),
    })
  }
  if (!main.isHeld) return done({ kind: 'pass' })
  const now = await $.clock.now()
  const isStarting = isLiveStarting(main, now)
  if (n === 0) {
    return done(
      isStarting
        ? { kind: 'wait', n: 1, text: orkestraWaitText(1) }
        : { kind: 'start', n, text: orkestraStartNote(childTitle(main.task, 1)) },
    )
  }
  if (isStarting) return done({ kind: 'wait', n, text: orkestraWaitText(n) })
  const child = last
  const limit = await orkestraLimit($, localId)
  const end = (kind: EndKind) =>
    done({ kind: 'end', n, end: kind, text: orkestraEndText(kind, n, child?.report, child?.file, main.childId, limit) })
  if (child?.status === 'finished') return end('bitti')
  if (child?.status === 'ready') {
    const text = await readFresh($, child.file, undefined)
    if (text !== undefined && NONE_LEFT_RE.test(text)) return end('bitti')
    if (main.isStopRequested === true) return end('durduruldu')
    if (n >= limit) return end('sinir')
    // O22: the main chat's own context is full: the chain ends here (never mid-child).
    const percent = await contextPercent($)
    if (percent !== undefined && percent >= MAIN_FULL_PERCENT) return end('dolu')

    return done({ kind: 'relay', n, text: orkestraRelayText(n + 1, childTitle(main.task, n + 1)) })
  }
  // O19: the child not running, in STALL_CYCLES checks at least STALL_GAP_MS apart.
  if (opts.isCycle === true && main.childId !== undefined && main.childId !== UNKNOWN_CHILD) {
    let stallCount = main.stallCount
    if (now - (main.stallAt ?? 0) >= STALL_GAP_MS) {
      const isRunning = await childRunning($, main.childId)
      if (isRunning === false) {
        stallCount = (stallCount ?? 0) + 1
        await patchMain($, localId, { stallCount, stallAt: now })
      } else if (isRunning === true) {
        stallCount = undefined
        await patchMain($, localId, { stallCount: undefined, stallAt: now })
      }
    }
    if ((stallCount ?? 0) >= STALL_CYCLES) {
      return done({ kind: 'stalled', n, text: orkestraEndText('durdu', n, undefined, child?.file, main.childId) })
    }
  }

  return done({ kind: 'wait', n, text: orkestraWaitText(n) })
}

/** O6: the main chat's start, relay or end rides on a tool result once per (N, kind). */
const orkestraNote = async ($: EngineInterface): Promise<string | undefined> => {
  try {
    const held = await read($, conv)
    if (held === null || held.role !== 'ana') return undefined
    const got = await orkestraDecision($)
    if (got === undefined) return undefined
    const { decision } = got
    if (decision.kind !== 'start' && decision.kind !== 'relay' && decision.kind !== 'end') return undefined
    // A paused chain hears its end only through the next typed message (O7).
    if (decision.kind === 'end' && !got.main.isHeld) return undefined
    const key = `${decision.n}:${decision.kind}`
    if (orkestraNoted === key) return undefined
    orkestraNoted = key
    if (decision.kind === 'end') orkestraEndTold = `${runningTurnId}:${decision.n}`

    return decision.text
  } catch (error) {
    $.ui.log(`otomatik-devir: ${String(error)}`, { to: 'debug' })

    return undefined
  }
}

// ---------------------------------------------------------------------------
// One-time cleanup of v0.4/v0.5 leftovers (S11)
// ---------------------------------------------------------------------------

const OLD_KEY = /^(mod|depoGoruldu|aktarici|kendiKurulum)$/
const OLD_PREFIX = /^(hazirlik|zincir|gorevModu|gonderildi|ipucu|istek|kurulumUyari):/
const LOCK_STALE_MS = 5 * 60 * 1000
// The scheduled-task tools may connect after session.start: retry in this session.
const CLEANUP_RETRY_MS = 60 * 1000
const CLEANUP_TRIES = 3
const OWN_TASK_IN_TEXT = /otomatik-devir-[0-9a-f]{8}-(?:[1-9]\d*)?[ab](?![\w-])/g

/** The mod's own task ids in a task list: its JSON (`taskId ?? id`), else ids named in its text. */
const ownTaskIds = (text: string | undefined): string[] => {
  try {
    const got: unknown = JSON.parse(text ?? '')
    const list = Array.isArray(got) ? got : record(got)?.tasks
    if (Array.isArray(list)) {
      const ids: string[] = []
      for (const item of list) {
        const task = record(item)
        const id = nonEmpty(task?.taskId) ?? nonEmpty(task?.id)
        if (isOwnTask(id) && !ids.includes(id)) ids.push(id)
      }

      return ids
    }
  } catch {
    // not JSON: read the ids from the text
  }

  return [...new Set((text ?? '').match(OWN_TASK_IN_TEXT) ?? [])].filter(isOwnTask)
}

const toolNames = async ($: EngineInterface): Promise<ReadonlySet<string>> =>
  new Set((await $.tool.list().catch(() => [])).map(tool => tool.name))

/**
 * Once per store (session.start, through `later`): old store keys go, then the
 * mod's own scheduled tasks, each only when `$.tool.check` allows the delete
 * with no dialog. The flag is set only when nothing of them is left, so a later
 * session retries; without the task tools nothing could be checked, so no flag
 * either, and this session tries again a minute later (at most 3 tries). A lock
 * keeps two sessions starting together from both running.
 */
const cleanupOnce = async ($: EngineInterface, attempt = 1): Promise<void> => {
  if ((await $.store.get(CLEANUP_FLAG)) !== undefined) return
  const sid = await $.session.id()
  const now = await $.clock.now()
  const isOurs = (lock: Record<string, unknown> | undefined): boolean =>
    lock === undefined ||
    lock.sid === sid ||
    typeof lock.at !== 'number' ||
    now - lock.at > LOCK_STALE_MS
  if (!isOurs(record(await $.store.get(CLEANUP_LOCK)))) return
  await $.store.set(CLEANUP_LOCK, { sid, at: now })
  await $.clock.sleep(100)
  const back = record(await $.store.get(CLEANUP_LOCK))
  if (back !== undefined && back.sid !== sid && !isOurs(back)) return

  for (const key of await $.store.keys().catch(() => [] as string[])) {
    if (OLD_KEY.test(key) || OLD_PREFIX.test(key)) await $.store.delete(key).catch(() => undefined)
  }

  let deleted = 0
  const tools = await toolNames($)
  if (!tools.has(LIST_TASKS) || !tools.has(DELETE_TASK)) {
    await $.store.delete(CLEANUP_LOCK).catch(() => undefined)
    if (attempt < CLEANUP_TRIES) {
      $.clock.after(CLEANUP_RETRY_MS, () => {
        cleanupOnce($, attempt + 1).catch(error => $.ui.log(`otomatik-devir: ${String(error)}`, { to: 'debug' }))
      })
    }

    return
  }
  const listed = await callTool($, { tool: LIST_TASKS })
  if (listed.deny !== undefined || listed.isError === true) return
  for (const taskId of ownTaskIds(listed.text)) {
    const check = await $.tool.check({ tool: DELETE_TASK, input: { taskId } })
    if (check.decision !== 'allow') return
    const gone = await callTool($, { tool: DELETE_TASK, taskId })
    if (gone.deny !== undefined || gone.isError === true) return
    deleted += 1
  }
  await $.store.set(CLEANUP_FLAG, { at: await $.clock.now(), deleted })
  await $.store.delete(CLEANUP_LOCK).catch(() => undefined)
}

/**
 * The band's one row (O7, S10): a paused or stalled main chat, else a ready
 * handoff (never in a managed sub-chat, O12: its status line shows the child).
 */
const bandRow = async ($: EngineInterface, held: OtomatikDevirConv): Promise<string | undefined> => {
  if (held.role === 'ana') {
    if (held.stalledN !== undefined) return orkestraStalledBand(held.stalledN)
    if (held.isPaused !== true || held.localId === undefined) return undefined
    const main = await readMain($, held.localId).catch(() => undefined)

    return main !== undefined && main.ended === undefined ? ORKESTRA_PAUSED_BAND : undefined
  }

  return held.phase === 'ready' && held.role !== 'alt' ? READY_BAND : undefined
}

/** `/devir otonom [dur | limit <n>]` (O8; the limit is the chain's, Decision 22). */
const otonomVerb = async (
  $: EngineInterface,
  held: OtomatikDevirConv,
  sub: string,
  value: string | undefined,
): Promise<string> => {
  const role = await roleOf($)
  const chainId = role === 'ana' || role === 'alt' ? await chainIdOf($) : undefined
  if (sub === 'limit') {
    if (chainId === undefined) return NOT_ORCHESTRATED
    if (value === undefined || !/^\d+$/.test(value)) return USAGE
    const limit = clampLimit(Number(value))
    await patchChainSettings($, chainId, { limit })
    await refreshStatus($).catch(() => undefined)

    return `Orkestra: sınır ${limit} alt sohbet.`
  }
  if (sub !== '' && sub !== 'dur') return USAGE
  if (role === 'ana' && chainId !== undefined) {
    if (sub === 'dur') {
      const main = await patchMain($, chainId, { isStopRequested: true })

      return main === undefined ? NOT_ORCHESTRATED : 'Zincir şu anki alt sohbetten sonra duracak.'
    }
    const main = await readMain($, chainId)
    if (main === undefined) return NOT_ORCHESTRATED
    const limit = await orkestraLimit($, chainId)
    const child = main.n >= 1 ? await readChild($, main.childId) : undefined
    const state = main.ended !== undefined ? `bitti: ${main.ended}` : main.isHeld ? 'tutuluyor' : 'duraklatıldı'

    return `Orkestra: ana sohbet · görev "${main.title}" · alt sohbet ${main.n}/${limit} · alt durum ${child?.status ?? 'yok'} · ${state}`
  }
  if (role === 'alt' && chainId !== undefined) {
    if (sub === 'dur') return 'Bu bir alt sohbet; zinciri ana sohbette /devir otonom dur ile durdur.'
    const localId = await selfLocal($)
    const own = localId === undefined ? undefined : await readRecord($, localId)
    const limit = await orkestraLimit($, chainId)
    const n = own?.role === 'alt' ? own.n : (held.childN ?? 1)
    const status = own?.role === 'alt' ? own.status : 'working'

    return `Orkestra: alt sohbet ${n}/${limit} (ana: ${chainId}) · durum ${status}`
  }

  return NOT_ORCHESTRATED
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'devir',
      description: 'Otomatik devir: durum, esik <n>, dene <n> (yalnızca bu sohbet), simdi, kapat, ac, otonom [dur | limit <n>]',
      argumentHint: '[esik <n> | dene <n> | simdi | kapat | ac | otonom [dur | limit <n>]]',
    })
    isPersonTurn = false
    isNextTurnPerson = false
    runningTurnId = undefined
    handoffBlocks = 0
    missingBlocks = 0
    // O18: no module state leaks from another session (or an older load).
    timeoutFor = undefined
    lastStopTasks = undefined
    orkestraStartBlocks = undefined
    orkestraNoted = undefined
    orkestraEndTold = undefined
    lastAyar = {}
    ownMain = undefined
    selfInfo = undefined
    const held = await currentConv($)
    // O4's claim: a start a reload cut off never cleared it itself.
    if (held.role === 'ana' && held.starting !== undefined) await patchConv($, held.sid, { starting: undefined })
    await refreshStatus($)
    // Also on a reload of a changed module, so the one-time cleanup runs there too.
    later($, () => cleanupOnce($))

    return next(e)
  })

  // Decision 16: while the mod is on and this chat is idle, the system prompt
  // says the mod owns the handoff. Appended last (a `shared` section after a
  // `session` one would skip the hook). No `$.ui.invalidate` event exists for
  // `prompt.compose`: the hook runs on every render, so each one reads the
  // current state.
  on('prompt.compose', async ($, e, next) => {
    const r = await next(e)
    try {
      // currentConv first: after a sid change it restores the cached role readSettings reads.
      const held = await currentConv($)
      const settings = await readSettings($)
      // O2: the main chat's own section (cached role only, never a GET); it never trips, so no long-chat note.
      if (held.role === 'ana') {
        const main = held.localId === undefined ? undefined : await readMain($, held.localId)
        if (!settings.isEnabled || main === undefined || main.ended !== undefined) return r

        return {
          ...r,
          sections: [
            ...r.sections.filter(s => s.id !== ORKESTRA_SECTION_ID && s.id !== LONG_CHAT_SECTION_ID),
            { id: ORKESTRA_SECTION_ID, text: ORKESTRA_SECTION(main.task), scope: 'session' as const },
          ],
        }
      }
      // O2, O20: the long-chat note only in a managed sub-chat; a normal chat gets no section.
      if (held.role !== 'alt' || !settings.isEnabled || held.phase !== 'idle') return r

      return {
        ...r,
        sections: [
          ...r.sections.filter(s => s.id !== LONG_CHAT_SECTION_ID),
          { id: LONG_CHAT_SECTION_ID, text: longChatNote(thresholdOf(settings, held)), scope: 'session' as const },
        ],
      }
    } catch {
      return r
    }
  })

  // O1b: the rendered `/devir-otonom` body also carries the start note (the
  // body alone already names start_session, `user_asked` and `fresh`).
  on('skill.prompt', async ($, e, next) => {
    try {
      if (e.text.includes(OTONOM_MARKER)) {
        const sid = await $.session.id()
        const held = await read($, conv)
        if (held !== null && held.sid === sid && held.role === 'ana' && held.localId !== undefined) {
          const main = await readMain($, held.localId)
          if (main !== undefined && main.n === 0 && main.ended === undefined) {
            return { text: `${e.text}\n\n${orkestraStartNote(childTitle(main.task, 1))}` }
          }
        }
      }
    } catch (error) {
      $.ui.log(`otomatik-devir: ${String(error)}`, { to: 'debug' })
    }

    return next(e)
  })

  // A /clear (or any end) drops this conversation's $.state record; the
  // store keys stay (S2), so a reload restores the handoff.
  on('session.end', async ($, e, next) => {
    await update($, conv, held => (held !== null && held.sid === e.sessionId ? null : held))

    return next(e)
  })

  // Status line on every measured change of the fill.
  on('session.measure', async ($, e, next) => {
    await refreshStatus($, e.context.percent)

    return next(e)
  })

  // S8: who typed the turn about to start (or the one running, for a message
  // typed into it). A typed message while the handoff waits for one (ready, or
  // running with the gate closed), or when it is due now, carries the handoff
  // as context and becomes the new chat's first job. A slash command typed is
  // left alone (it runs as typed).
  on('prompt.submit', async ($, e, next) => {
    const isPerson = isPersonSubmit(e)
    // Decision 16: what the person last typed, to tell their handoff ask from the model's own.
    if (isPerson) {
      try {
        // O7: a person's prompt also clears the stalled band.
        await patchConv($, (await currentConv($)).sid, { lastTyped: e.text, stalledN: undefined })
      } catch (error) {
        $.ui.log(`otomatik-devir: son istem kaydedilemedi: ${String(error)}`, { to: 'debug' })
      }
    }
    // O1 and O7 first, before the running-turn and command returns below.
    const orkestra = await orkestraSubmit($, e, next, isPerson)
    if (orkestra !== undefined) return orkestra
    // O10: the role resolves off the dispatch, at the first submission.
    try {
      const known = await read($, conv)
      if (known === null || known.role === undefined) later($, async () => void (await roleOf($)))
    } catch {
      // resolved at the next trip, start or Stop site instead
    }
    if (e.turnId !== undefined) {
      // Typed over a running turn: the app counts that turn as the person's
      // from then on; if the message waits, it opens the next turn too.
      if (isPerson && e.turnId === runningTurnId) isPersonTurn = true
      if (isPerson) isNextTurnPerson = true

      return next(e)
    }
    isNextTurnPerson = isPerson
    if (!isPerson || e.command !== undefined) return next(e)
    const before = await currentConv($)
    const sid = before.sid
    // O12: a managed sub-chat hands off by its file only; no S8 there. O20: nor in a normal chat.
    const role = await roleOf($)
    if (role === 'alt' || role === 'yok') return next(e)
    const settings = await readSettings($)
    if (!settings.isEnabled || (await handedOf($, sid)) !== undefined) return next(e)
    let held: OtomatikDevirConv | undefined
    if (before.phase === 'ready' || (before.phase === 'handoff_running' && before.isGateClosed === true)) {
      const isClaimed = await claim($, sid, h => h.phase === before.phase && h.starting === undefined, {
        phase: 'handoff_running',
        pendingMessage: e.text,
        instructNext: true,
      })
      held = isClaimed ? await currentConv($) : undefined
    } else if (before.phase === 'idle' && (await isDue($, before)) !== undefined) {
      held = await claimHandoff($, sid, h => h.phase === 'idle', { pendingMessage: e.text, instructNext: true })
    }
    if (held?.file === undefined) return next(e)
    const note = nextMessageNote(held.file, await isFresh($, held.file, held.handoffAt), await hasHandoffSkill($))
    $.ui.toast('Devir: yeni sohbet bu mesajınla açılacak.')
    const out = await next({ ...e, context: [...(e.context ?? []), note] })
    if (out.drop !== undefined) {
      // Dropped beneath: no turn carries the instruction; the phase goes back.
      await update($, conv, now => (now !== null && now.sid === sid ? before : now))
      await syncStore($, sid)
    }

    return out
  })

  on('turn.start', async ($, e, next) => {
    if ((e as { agentId?: string }).agentId === undefined) {
      runningTurnId = e.turnId
      isPersonTurn = isNextTurnPerson
      isNextTurnPerson = false
      handoffBlocks = 0
      missingBlocks = 0
      // The turn an S8 message opens is the one its instruction is for.
      const held = await currentConv($)
      if (held.phase === 'handoff_running' && held.instructNext === true) {
        await claim($, held.sid, h => h.phase === 'handoff_running' && h.instructNext === true, {
          instructNext: false,
          instructedTurn: e.turnId,
          isGateClosed: false,
        })
      }
      // O7: a turn the person typed holds the main chat (a machine turn never does).
      if (isPersonTurn && held.role === 'ana' && held.localId !== undefined) {
        const main = await readMain($, held.localId)
        if (main !== undefined && main.ended === undefined) {
          if (!main.isHeld) await patchMain($, main.localId, { isHeld: true })
          await patchConv($, held.sid, { isPaused: undefined })
        }
      }
    }

    return next(e)
  })

  // S9: a main turn that ends with the handoff still running closes the gate
  // (an Esc, `isAborted`, too: the handoff stays; only the mod off cancels it). The
  // file written and nothing running: the handoff is `ready`.
  on('turn.complete', async ($, e, next) => {
    const result = await next(e)
    if (e.agentId !== undefined) return result
    isPersonTurn = false
    runningTurnId = undefined
    const held = await currentConv($)
    // O7: the main turn closed (an Esc too): the chain pauses until a typed message.
    if (held.role === 'ana' && held.localId !== undefined) {
      const main = await readMain($, held.localId)
      if (main !== undefined && main.ended === undefined) {
        await patchMain($, main.localId, { isHeld: false })
        await patchConv($, held.sid, { isPaused: true })
      }
    }
    // O14: a managed sub-chat whose turn ends idle with nothing running is finished.
    const child = held.phase === 'idle' && (await roleOf($)) === 'alt' ? await read($, conv) : null
    if (child !== null && child.sid === held.sid) {
      const own = await childBase($, child)
      // Decision 21a: this turn's last Stop saw its Workflows too.
      const idleTasks = lastStopTasks?.turnId === e.turnId ? lastStopTasks.tasks : undefined
      if (
        own?.role === 'alt' &&
        own.status !== 'finished' &&
        own.status !== 'cancelled' &&
        (await runningWork($, idleTasks)).length === 0
      ) {
        await writeRecord($, own.localId, {
          ...own,
          status: 'finished',
          report: e.answer.slice(0, 3000),
          isAborted: e.isAborted || undefined,
          at: await $.clock.now(),
        })
      }
    }
    if (held.phase === 'handoff_running') {
      if (e.isAborted) $.ui.log('otomatik-devir: tur durduruldu; devir sürüyor', { to: 'debug' })
      await claim($, held.sid, h => h.phase === 'handoff_running', { isGateClosed: true })
      // Decision 21a: this turn's last Stop saw its Workflows too.
      const tasks = lastStopTasks?.turnId === e.turnId ? lastStopTasks.tasks : undefined
      if (
        held.starting === undefined &&
        (await isFresh($, held.file, held.handoffAt)) &&
        (await runningWork($, tasks)).length === 0
      ) {
        const isReady = await claim(
          $,
          held.sid,
          h => h.phase === 'handoff_running' && h.starting === undefined,
          { phase: 'ready' },
        )
        // O12: a managed sub-chat shows no ready toast (its status line names the child).
        if (isReady && held.role !== 'alt') $.ui.toast(READY_BAND, { timeoutMs: 15000 })
      }
    }
    await refreshStatus($).catch(() => undefined)

    return result
  })

  // (a) The mid-turn channel: a tool result's `context` is read by the model
  // right after that result, inside the running turn.
  on('tool.call', async ($, e, next) => {
    const call = e as unknown as { tool: string; agentId?: string; to?: unknown } & Record<string, unknown>
    type Out = Awaited<ReturnType<typeof next>>
    // S4 first, before the origin and subagent returns: the drain holds for
    // every caller.
    if (isDrainCall(call) && (await isDrainingNow($))) return { deny: DRAIN_DENY } as Out
    // Decision 16: the mod owns the handoff; the model's own skill call is refused.
    if (await isUnaskedSkillHandoff($, call)) return { deny: SKILL_HANDOFF_DENY } as Out
    // O13: a managed sub-chat starts no session and forks none, whoever asks.
    if ((call.tool === START_SESSION || call.tool === HAND_OFF) && (await roleOf($)) === 'alt') {
      return { deny: MANAGED_START_DENY } as Out
    }
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
    // O6: the main chat's next step rides on this result.
    const step = await orkestraNote($)
    if (step !== undefined) return { ...result, context: [...(result.context ?? []), step] } as typeof result
    const note = await tripMidTurn($)
    if (note === undefined) return result

    return { ...result, context: [...(result.context ?? []), note] } as typeof result
  }).catch(async ($, e, next) => {
    if (next.called) return next(e)
    // O13, O4 fail closed: a hook that threw before `next` never lets a
    // managed sub-chat's start or fork through, nor an unmanaged start of a main chat.
    if (e.tool === START_SESSION || e.tool === HAND_OFF) {
      const role = await cachedRole($).catch(() => undefined)
      if (role === 'alt') return { deny: MANAGED_START_DENY }
      if (role === 'ana' && e.tool === START_SESSION) return { deny: ORKESTRA_START_FAILED }
    }

    return isDraining && DRAIN_TOOLS.has(e.tool) ? { deny: DRAIN_DENY } : next(e)
  })

  // S4 at the spawn itself: also a workflow's `agent()` calls and resumes.
  on('agent.spawn', async ($, e, next) => ((await isDrainingNow($)) ? { deny: DRAIN_DENY } : next(e))).catch(
    ($, e, next) => (next.called ? next(e) : isDraining ? { deny: DRAIN_DENY } : next(e)),
  )

  // S7: the main loop's turn end. Idle and due: trip here. Running work during
  // the handoff: wait in the turn. A typed turn's handoff: start the child
  // before it ends. A closed gate: once the file is written the handoff is `ready`.
  on('classic.Stop', async ($, e, next) => {
    if (e.agent_id !== undefined) return next(e)
    lastStopTasks = { turnId: runningTurnId, tasks: e.background_tasks }
    // O5: the main chat's only Stop hold, before the mod-off return and (a).
    const orkestra = await orkestraDecision($, { isCycle: true })
    if (orkestra !== undefined) {
      const { decision, main } = orkestra
      switch (decision.kind) {
        case 'pass':
          return next(e)
        case 'start':
        case 'relay': {
          // At most 3 blocks per N, then the turn ends (and the chain pauses).
          const blocks = orkestraStartBlocks?.n === main.n ? orkestraStartBlocks : { n: main.n, count: 0 }
          if (blocks.count >= 3) return next(e)
          orkestraStartBlocks = { n: main.n, count: blocks.count + 1 }

          return { block: decision.text }
        }
        case 'end':
          await patchMain($, main.localId, { ended: decision.end })
          later($, () => refreshStatus($))
          // A paused main chat (O21): no block; its next typed message gets the end text (O7).
          // A tool result of this turn already carried it (O6) and a reply followed: no second announcement.
          if (!main.isHeld) return next(e)
          if (orkestraEndTold === `${runningTurnId}:${decision.n}` && (e.last_assistant_message?.trim() ?? '') !== '') {
            return next(e)
          }

          return { block: decision.text }
        case 'stalled':
          await patchMain($, main.localId, { ended: 'durdu' })
          await patchConv($, main.sid, { stalledN: decision.n })
          later($, () => refreshStatus($))

          return { block: decision.text }
        case 'wait':
          return { block: decision.text }
      }
    }
    // O20: a normal chat's turn end passes; no (a)-(d), no wait.
    if ((await roleOf($)) === 'yok') return next(e)
    const settings = await readSettings($)
    if (!settings.isEnabled) return next(e)
    let held = await currentConv($)
    // (a)
    if (held.phase === 'idle') {
      const due = await isDue($, held)
      if (due !== undefined) {
        const claimed = await claimHandoff(
          $,
          held.sid,
          h => h.phase === 'idle',
          isPersonTurn ? {} : { notedTurn: runningTurnId },
        )
        if (claimed?.file !== undefined) {
          const hasSkill = await hasHandoffSkill($)

          return { block: handoffTextFor(claimed, due.threshold, claimed.file, hasSkill) }
        }
        held = await currentConv($)
      }
    }
    // (b) Only while this chat's handoff runs (v1.0.1): outside a handoff,
    // running subagents and Workflows never hold the turn end. Not in `ready`
    // either: the file is written and the child waits for the next typed
    // message, which makes it `handoff_running` again; the 30-minute timeout
    // counts only in `handoff_running`, so a wait there could never end.
    const running = held.phase === 'handoff_running' ? await runningWork($, e.background_tasks) : []
    if (running.length > 0) {
      const now = await $.clock.now()
      const isTimedOut =
        held.phase === 'handoff_running' &&
        held.handoffAt !== undefined &&
        now - held.handoffAt >= DRAIN_TIMEOUT_MS
      if (!isTimedOut) return { block: waitText(running) }
      const id = held.handoffId ?? ''
      const n = timeoutFor?.id === id ? timeoutFor.n : 0
      if (n < MAX_TIMEOUT_BLOCKS) {
        timeoutFor = { id, n: n + 1 }

        return { block: timeoutText(running) }
      }
      // Two timeout blocks given: the running work no longer holds the turn.
    }
    if (held.phase !== 'handoff_running') return next(e)
    const file = held.file ?? handoffFile(await $.session.cwd(), held.sid)
    const isFileFresh = await isFresh($, file, held.handoffAt)
    // (c)
    if (isPersonTurn && held.isGateClosed !== true) {
      if (handoffBlocks >= MAX_HANDOFF_BLOCKS) return next(e)
      handoffBlocks += 1

      return { block: isFileFresh ? START_NOW : fileMissingText(file, true) }
    }
    // (d)
    if (isFileFresh) {
      const isReady = await claim(
        $,
        held.sid,
        h => h.phase === 'handoff_running' && h.starting === undefined,
        { phase: 'ready' },
      )
      if (isReady) {
        // O12: a managed sub-chat shows no ready toast.
        if (held.role !== 'alt') $.ui.toast(READY_BAND, { timeoutMs: 15000 })
        await refreshStatus($).catch(() => undefined)
      }

      return next(e)
    }
    if (missingBlocks >= MAX_MISSING_BLOCKS) return next(e)
    missingBlocks += 1

    return { block: fileMissingText(file, false) }
  })

  on('command.run', { command: 'devir' }, async ($, e) => {
    const [verb = '', value, extra] = e.args.trim().split(/\s+/)
    const role = await roleOf($)
    const held = await currentConv($)
    const settings = await readSettings($)
    // O20, Decision 22: a normal chat only answers; nothing is written (`dene` keeps this chat's own value).
    const isNormal = role !== 'ana' && role !== 'alt'

    switch (verb.toLowerCase()) {
      case '': {
        if (isNormal) return { text: NORMAL_INFO }
        const percent = await contextPercent($)
        const running = held.phase === 'handoff_running' ? (await activeAgents($)).length : 0

        const orkestra = await orkestraStatusOf($, held)

        return { text: `${statusText(settings, percent, held, running, orkestra)} · aşama: ${held.phase}` }
      }
      case 'esik': {
        if (isNormal) return { text: NORMAL_INFO }
        const n = Number(value)
        if (!isThreshold(n)) return { text: 'Kullanım: /devir esik <1-99>' }
        // Decision 22: this chain's threshold only.
        const chainId = await chainIdOf($)
        if (chainId === undefined) return { text: NORMAL_INFO }
        await patchChainSettings($, chainId, { esik: n })
        await refreshStatus($)

        return { text: chainEsikText(n) }
      }
      case 'dene': {
        // Decision 13: a threshold for THIS chat only ($.state), for live tests.
        const isMain = (await roleOf($)) === 'ana' && held.localId !== undefined
        if (value === undefined) {
          await patchConv($, held.sid, { testThreshold: undefined })
          if (isMain) await patchMain($, held.localId as string, { testThreshold: undefined })
          await refreshStatus($)

          return { text: `Bu sohbetin deneme eşiği kaldırıldı; eşik %${settings.threshold}.` }
        }
        const n = Number(value)
        if (!isThreshold(n)) return { text: 'Kullanım: /devir dene <1-99> (boş: kaldır)' }
        await patchConv($, held.sid, { testThreshold: n })
        if (isNormal) return { text: normalDeneText(n) }
        // Decision 11: in the main chat the chain's later children inherit it.
        const main = isMain ? await patchMain($, held.localId as string, { testThreshold: n }) : undefined
        await refreshStatus($)
        if (main !== undefined) {
          return { text: `Zincirin deneme eşiği %${n}: bundan sonra açılan alt sohbetler bunu kullanır.` }
        }

        return { text: `Bu sohbetin deneme eşiği %${n} (yalnızca bu sohbet).` }
      }
      case 'simdi': {
        // O3: the main chat never hands off; O20: nor does a normal chat.
        if (role === 'ana') return { text: 'Ana sohbet devredilmez (orkestra modu).' }
        if (isNormal) return { text: NORMAL_INFO }
        const handed = await handedOf($, held.sid)
        if (handed !== undefined || held.phase === 'done') {
          return {
            text: `Bu sohbet zaten devredildi${handed?.startedId ? ` (${handed.startedId})` : ''}.`,
          }
        }
        if (isDrainPhase(held.phase)) return { text: 'Devir zaten çalışıyor.' }
        // Decision 22: a closed chain is not reopened.
        if (!settings.isEnabled) return { text: AC_CHAIN_STOPPED }
        await patchConv($, held.sid, { isForced: true })

        return { text: 'Devir istendi: çalışan turda ya da bir sonraki mesajınla başlayacak.' }
      }
      case 'kapat': {
        if (isNormal) return { text: NORMAL_INFO }
        // O21: this chain's emergency stop; no other chain and no global key changes.
        const chainId = await chainIdOf($)
        if (chainId === undefined) return { text: NORMAL_INFO }
        await patchChainSettings($, chainId, { isClosed: true })
        // v1.0.1: this chat's running or ready handoff is cancelled (a pending
        // `/devir simdi` too); a finished one stays.
        const wasHandoff = isDrainPhase(held.phase)
        if (held.phase !== 'done') await cancelHandoff($, held.sid, false)
        await refreshStatus($)

        return {
          text: `${
            wasHandoff
              ? `Otomatik devir kapatıldı; bu sohbetin ${held.phase === 'ready' ? 'hazır' : 'süren'} devri iptal edildi. Alt ajan ve Workflow yeniden başlatılabilir; yazılmış devir dosyası yerinde kalır.`
              : 'Otomatik devir kapatıldı.'
          } ${KAPAT_CHAIN}`,
        }
      }
      case 'ac': {
        if (isNormal) return { text: NORMAL_INFO }
        // Decisions 20, 22: writes nothing; a closed or ended chain is not resumed.
        const chainId = await chainIdOf($)
        if (chainId === undefined) return { text: NORMAL_INFO }
        const isClosed = (await readChainSettings($, chainId).catch(() => undefined))?.isClosed === true
        const main = isClosed ? undefined : await readRecord($, chainId).catch(() => undefined)
        const isEnded = main?.role === 'ana' && main.ended !== undefined

        return { text: isClosed || isEnded ? AC_CHAIN_STOPPED : AC_CHAIN_OPEN }
      }
      case 'otonom':
        return { text: await otonomVerb($, held, (value ?? '').toLowerCase(), extra) }
      case 'sor':
      case 'otomatik':
      case 'gec':
      case 'hazirla':
        return { text: REMOVED_VERB }
      default:
        return { text: USAGE }
    }
  })

  // S10, the ready band: one row, no buttons, only in `ready`.
  //
  // The context indicator lives in the status line ($.ui.status: one line per
  // plugin, no contention); only this row uses the AbovePrompt band, which
  // every mod shares (ilerleme-cubugu draws there too, blast-radius / Silme
  // Kalkanı falls back to it in a narrow terminal).
  //
  // Coexistence contract: nothing to show -> return next(e) untouched;
  // otherwise this row FIRST, then the drawing of the plugins below (next(e)),
  // in a column Box, never swallowed. While a turn runs (isWorking) the row
  // stays hidden: a blast-radius hold is mid-turn and owns the keys then. The
  // row has no hotkeys, so every key stays free for others.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    if (e.props.hasSurvey || e.props.isWorking) return next(e)
    const held = await read($, conv)
    if (held === null || held.sid !== (await $.session.id())) return next(e)
    const row = await bandRow($, held)
    if (row === undefined) return next(e)
    // The mod off: no band, even before this chat's next hook drops the handoff.
    if (!(await readSettings($)).isEnabled) return next(e)

    const below = await next(e)
    const { Box, Text } = $.ui.resolve(e)

    return (
      <Box flexDirection="column">
        <Box key="devir">
          <Text>{row}</Text>
        </Box>
        {below ?? null}
      </Box>
    )
  })
}
