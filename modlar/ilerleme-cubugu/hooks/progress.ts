// Pure parsers for the progress bar: text in, steps out. No I/O here; register.tsx
// reads the files and hands their text to these functions.
// Spec: .workflow/research/progress-formats.md (my-skill first, then a generic ladder).

import type { IlerlemeCubuguAdim as Adim, IlerlemeCubuguDurum as Durum } from '../types'

export type MsPlan = {
  ids: string[]
  titles: Map<string, string>
  done: Set<string>
}

export type StateInfo = {
  done: Set<string>
  inProgress: Set<string>
  phase: string
  activeSkill: string
  /** ids retired from the plan (PROGRESS.md `[-]`); left out of the total */
  dropped?: Set<string>
  /** non-blank content lines under STATE.md's `## Done` */
  doneLines?: number
}

// A plan's own ledger, .workflow/plans/<dir>/PROGRESS.md: one `- [x] T12 — …` line per task.
export type ProgressInfo = {
  done: Set<string>
  inProgress: Set<string>
  blocked: Set<string>
  dropped: Set<string>
  /** any running box (`[~] [>] [/]`) at all; without one STATE.md's In progress stands in */
  marksRunning: boolean
}

const MS_ID = /^[ \t]{0,3}[-*+][ \t]+id:[ \t]*([A-Z]{1,3}\d{1,4}[a-z]{0,2})[ \t]*(?:#.*)?$/
const MS_TITLE = /^[ \t]{2,6}(?:goal|title):[ \t]*(.+)$/
const MS_STATUS_DONE = /^[ \t]{2,6}status:[ \t]*(?:\[x\][ \t]*)?(?:DONE|done|✅|tamam(?:land[ıi])?)(?!\p{L})/u
const CHECKED = /^[ \t]{0,3}[-*+][ \t]+\[[xX]\][ \t]+(.*)$/
const HEADING = /^[ \t]{0,3}(#{1,6})[ \t]+(.*)$/
// up to 6 leading blanks: a nested sub-bullet is passed on as `nested` (indent beyond 1)
const BULLET = /^([ \t]{0,6})[-*+][ \t]+(.*)$/
const RANGE = /[A-Z]{1,3}\d+[a-z]{0,2}[ \t]*(?:\.\.|–|—|→|-)[ \t]*[A-Z]{1,3}\d+[a-z]{0,2}/g
const SHA_AFTER = '(?=[ \\t]+(?=[0-9a-f]*\\d)[0-9a-f]{7,40}\\b)'
// any `plans/<dir>/` mention: PLAN.md, PROGRESS.md, the `{PLAN,PROMPT,PROGRESS}.md` brace form or the bare dir
const PLAN_PATH = /(?:^|[^\w-])(?:\.workflow\/)?plans\/([^/\s`'")\]{}]+)\//g
// `T2–T19`, `T2-T19`, `T21..T28`: same prefix, no letter suffix
const RANGE_IDS = /(?<![\w/.\-])([A-Z]{1,3})(\d{1,5})[ \t]*(?:\.\.|–|—|→|-)[ \t]*\1(\d{1,5})(?![\w])/g
const RANGE_CAP = 500
// an id-like token: T12, t12, T-12, or a bare number ("12 — …"); a sha like 1a2b3c4d is none
const ID_LIKE = /(?<![\w-])(?:[A-Za-z]{1,3}-?)?\d+(?![\w])/

const lines = (source: string) => source.replace(/\r\n?/g, '\n').split('\n')

export const plainText = (value: string) => value.replace(/\*\*|__|`|~~/g, '').trim()

// Turkish-aware fold that keeps English words intact (tr's own 'I' → 'ı' would not)
export const fold = (value: string) => value.replace(/[İI]/g, 'i').toLowerCase()

export type Section = 'done' | 'in_progress' | 'remaining' | 'none'

const SECTION_DONE = /^(done|completed|finished|merged|tamamland|tamamlanan|bitti|biten|yap[ıi]ld[ıi]|yap[ıi]lan|birleş)/
const SECTION_RUNNING = /^(in[ -]progress|doing|wip|active|devam ediyor|sürüyor|sürmekte|yap[ıi]l[ıi]yor|çal[ıi]ş[ıi]l[ıi]yor|şu an)/
const SECTION_REMAINING = /^(remaining|to[ -]?do|pending|backlog|next|up next|kalan|yap[ıi]lacak|bekleyen|s[ıi]rada|s[ıi]radaki)/

export const sectionOf = (heading: string): Section => {
  const name = fold(heading.replace(/^[^\p{L}]+/u, ''))
  if (SECTION_DONE.test(name)) return 'done'
  if (SECTION_RUNNING.test(name)) return 'in_progress'
  if (SECTION_REMAINING.test(name)) return 'remaining'
  return 'none'
}

// Calls `visit` for every top-level bullet with the section it sits in, and `onLine`
// for every other non-blank, non-heading line.
const walkSections = (
  source: string,
  visit: (section: Section, text: string, nested: boolean) => void,
  onLine?: (section: Section) => void,
) => {
  let section: Section = 'none'
  let level = 0
  for (const line of lines(source)) {
    const heading = HEADING.exec(line)
    if (heading) {
      const depth = (heading[1] ?? '').length
      const found = sectionOf(heading[2] ?? '')
      if (found !== 'none' || section === 'none' || depth <= level) {
        section = found
        level = depth
      }
      continue
    }
    const bullet = BULLET.exec(line)
    if (bullet) visit(section, bullet[2] ?? '', (bullet[1] ?? '').length > 1)
    else if (line.trim()) onLine?.(section)
  }
}

const shortTitle = (goal: string) => {
  const text = plainText(goal)
  const cuts = [' (AUD-', '. ', '; '].map(mark => text.indexOf(mark)).filter(at => at > 0)
  return (cuts.length > 0 ? text.slice(0, Math.min(...cuts)) : text).trim()
}

const idPattern = (ids: Iterable<string>, tail = '') => {
  const sorted = [...ids].sort((a, b) => b.length - a.length)
  return new RegExp(`(?<![\\w/.\\-])(${sorted.join('|')})(?![\\w\\-/])${tail}`, 'g')
}

const idsIn = (text: string, pattern: RegExp) => [...text.matchAll(pattern)].map(match => match[1] ?? '')

// a parenthetical that qualifies a label: "Session 4 (ids in x.txt): T1 T2"
const LABEL_NOTE = /\([^()]*\)(?=[ \t]*:)/g
// what may sit between the ids of a bare list ("T90, T300 and T267.")
const LIST_REST = /^(?:[\s,.&+]|\band\b|\bve\b)*$/

// `;`-separated clauses, outside parentheses
const clauses = (text: string) => {
  const found: string[] = []
  let depth = 0
  let from = 0
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (char === '(') depth++
    else if (char === ')') depth = Math.max(0, depth - 1)
    else if (char === ';' && depth === 0) {
      found.push(text.slice(from, i))
      from = i + 1
    }
  }
  found.push(text.slice(from))
  return found
}

const headOf = (clause: string) => clause.replace(RANGE, ' ').split(/ — | – | - |\(/)[0] ?? ''

// The ids a bullet is about: its head, before the first dash or parenthesis; of its
// colon segments, the first that names a plan id ("W4: T1 T15" → T1 T15). A later
// `;` clause adds its ids only when it is a bare id list ("…: T1 (x); T2, T3 (y)").
export const leadIds = (bullet: string, ids: Set<string>) => {
  if (ids.size === 0) return []
  const pattern = idPattern(ids)
  const text = plainText(bullet.replace(/^\[[^\]]\][ \t]*/, '')).replace(LABEL_NOTE, '')
  const [first = '', ...rest] = clauses(text)
  const found: string[] = []
  for (const segment of headOf(first).split(':')) {
    const some = idsIn(segment, pattern)
    if (some.length > 0) {
      found.push(...some)
      break
    }
  }
  for (const clause of rest) {
    const head = headOf(clause)
    const some = idsIn(head, pattern)
    if (some.length > 0 && LIST_REST.test(head.replace(pattern, ' '))) found.push(...some)
  }
  return found
}

// A my-skill plan: `- id: T1` lines (at least two), `goal:` titles, `status: DONE`
// fields and a `- [x] T1 — …` ledger as the plan's own record of what is done.
export const parseMsPlan = (source: string): MsPlan | undefined => {
  const ids: string[] = []
  const titles = new Map<string, string>()
  const done = new Set<string>()
  const ledger: string[] = []
  let at: string | undefined
  for (const line of lines(source)) {
    const id = MS_ID.exec(line)?.[1]
    if (id) {
      if (!ids.includes(id)) ids.push(id)
      at = id
      continue
    }
    const checked = CHECKED.exec(line)
    if (checked) ledger.push(checked[1] ?? '')
    if (!at) continue
    const title = MS_TITLE.exec(line)?.[1]
    if (title && !titles.has(at)) titles.set(at, shortTitle(title))
    if (MS_STATUS_DONE.test(line)) done.add(at)
  }
  if (ids.length < 2) return undefined
  const set = new Set(ids)
  for (const text of ledger) for (const id of leadIds(text, set)) done.add(id)
  return { ids, titles, done }
}

// The plan ids a Done bullet credits through ranges in its head: "T2–T19, T21..T28 merged".
const rangeIds = (bullet: string, ids: Set<string>) => {
  const found: string[] = []
  const text = plainText(bullet.replace(/^\[[^\]]\][ \t]*/, '')).replace(LABEL_NOTE, '')
  for (const clause of clauses(text)) {
    const head = clause.split(/ — | – | - |\(/)[0] ?? ''
    for (const match of head.matchAll(RANGE_IDS)) {
      const [, prefix = '', from = '0', to = '0'] = match
      // a reversed, empty or wider-than-RANGE_CAP range credits nothing
      const [first, last] = [Number(from), Number(to)]
      if (!(first < last) || last - first + 1 > RANGE_CAP) continue
      for (let n = first; n <= last; n++) if (ids.has(`${prefix}${n}`)) found.push(`${prefix}${n}`)
    }
  }
  return found
}

// an In progress line about what is held up, not running ("BLOCKED on owner: T245")
const BLOCKED = /^(blocked|engell?i|bloke)(?!\p{L})/u
// a nested Done note whose first word after the id says it is not finished ("T2 blocked on owner")
const NESTED_OPEN = /^\S+[\s:—–-]+(?:blocked|engell?i|bloke|open|pending|todo|waiting|bekliyor)(?!\p{L})/u

// STATE.md, read against a plan's id set: Done (sha pairs + lead ids), In progress
// (lead ids), and the header's Phase / Active skill. Ids outside the plan are dropped.
export const parseState = (source: string, ids: Set<string>): StateInfo => {
  const done = new Set<string>()
  const inProgress = new Set<string>()
  let phase = ''
  let activeSkill = ''
  for (const line of lines(source)) {
    const phaseAt = /^Phase:[ \t]*(.*)$/.exec(line)
    if (phaseAt && !phase) phase = phaseAt[1] ?? ''
    const skillAt = /^Active skill:[ \t]*(.*)$/.exec(line)
    if (skillAt && !activeSkill) activeSkill = skillAt[1] ?? ''
  }
  let doneLines = 0
  const withSha = ids.size > 0 ? idPattern(ids, SHA_AFTER) : undefined
  walkSections(
    source,
    (section, text, nested) => {
      // a checked setup line that names no task ("Branch + BASE") is no ledger the bar failed to read
      if (section === 'done' && !(CHECKED.test(`- ${text}`) && !ID_LIKE.test(text))) doneLines++
      if (!withSha) return
      if (section === 'done' && nested && NESTED_OPEN.test(fold(plainText(text.replace(/^\[[^\]]\][ \t]*/, ''))))) {
        // "  - T2 blocked on owner": a nested note about work that is not finished
      } else if (section === 'done') {
        for (const id of idsIn(text.replace(RANGE, ' '), withSha)) done.add(id)
        for (const id of leadIds(text, ids)) done.add(id)
        for (const id of rangeIds(text, ids)) done.add(id)
      } else if (section === 'in_progress' && !nested && !BLOCKED.test(fold(plainText(text.replace(/^\[[^\]]\][ \t]*/, ''))))) {
        // a ticked box under In progress is finished work, not running work
        for (const id of leadIds(text, ids)) (/^\[[xX]\]/.test(text) ? done : inProgress).add(id)
      }
    },
    section => {
      if (section === 'done') doneLines++
    },
  )
  return { done, inProgress, phase, activeSkill, doneLines }
}

const LEDGER = /^[ \t]*[-*+][ \t]+\[([ xX~>/!-])\][ \t]+(.*)$/

// A ledger line credits only the plan id that is its first token (`- [x] T12 — <sha> — notes`);
// ids in the notes tail, ranges ("T5–T7") and other prefixes ("AT2", "T1a") never count.
const ledgerId = (text: string, ids: Set<string>) => {
  const token = plainText(text).split(/\s/, 1)[0]?.replace(/[:,.;]+$/, '') ?? ''
  return ids.has(token) ? token : undefined
}

// PROGRESS.md against a plan's id set: `[x]` done, `[~] [>] [/]` running, `[!]` blocked
// (neither), `[-]` dropped, `[ ]` pending. Ids outside the plan are ignored; when an id
// is marked twice, done > dropped > blocked > running.
export const parseProgress = (source: string, ids: Set<string>): ProgressInfo => {
  const done = new Set<string>()
  const inProgress = new Set<string>()
  const blocked = new Set<string>()
  const dropped = new Set<string>()
  let marksRunning = false
  for (const line of lines(source)) {
    const match = LEDGER.exec(line)
    if (!match) continue
    const mark = match[1] ?? ' '
    const isRunning = mark === '~' || mark === '>' || mark === '/'
    if (isRunning) marksRunning = true
    const into = /[xX]/.test(mark) ? done : mark === '-' ? dropped : mark === '!' ? blocked : isRunning ? inProgress : undefined
    const id = ledgerId(match[2] ?? '', ids)
    if (into && id) into.add(id)
  }
  const rank = [done, dropped, blocked, inProgress]
  rank.forEach((set, i) => {
    for (const lower of rank.slice(i + 1)) for (const id of set) lower.delete(id)
  })
  return { done, inProgress, blocked, dropped, marksRunning }
}

// The status a plan gets when it has a PROGRESS.md (Decision 6): the ledger decides
// done / dropped / blocked / running; STATE.md (if credited) only gives the phase and
// active skill, and its In progress while the ledger has no running mark yet.
export const mergeProgress = (progress: ProgressInfo, state?: StateInfo): StateInfo => {
  const settled = (id: string) => progress.done.has(id) || progress.dropped.has(id) || progress.blocked.has(id)
  const inProgress = progress.marksRunning
    ? progress.inProgress
    : new Set([...(state?.inProgress ?? [])].filter(id => !settled(id)))
  return {
    done: progress.done,
    inProgress,
    dropped: progress.dropped,
    phase: state?.phase ?? '',
    activeSkill: state?.activeSkill ?? '',
  }
}

// The safety net: execute is running, STATE.md's Done says something, yet none of it
// names a plan id and there is no PROGRESS.md: the bar's count cannot be trusted.
export const ledgerUnread = (state: StateInfo) =>
  /^my-skill-execute\b/.test(fold(state.activeSkill)) && (state.doneLines ?? 0) > 0 && state.done.size === 0

const TERMINAL_WORD = 'tamam(?:land[ıi])?|bitti|complete(?:d)?|done|finished|shipped|published|yay[ıi]nland[ıi]'
const TERMINAL_PHASE = new RegExp(`^(?:${TERMINAL_WORD})(?![\\p{L}\\d])`, 'u')

// words that say work goes on; one inside a note in parentheses keeps the job open
const RUNNING = 'sürüyor|devam|running|next|pending|kalan|todo|wip|in progress|başlıyor|sonra|s[ıi]radaki|starting|verifying|remaining'
// the first done word in the phase, as a whole word (not `done-criteria`)
const DONE_WORD = new RegExp(`(?<![\\p{L}\\d-])(?:${TERMINAL_WORD})(?![\\p{L}\\d-])`, 'u')
const RUNNING_WORD = new RegExp(`(?<![\\p{L}\\d])(?:${RUNNING})`, 'u')
// "T3 bitti", "Faz 2 tamamlandı", "Wave A done": a done word right after a part label ends only
// that part. A label is a task-id-like token (not a version such as `v3`) or a counter word + number / letter
const PART_DONE = new RegExp(
  `(?<![\\p{L}\\d-])(?:(?!v\\d)[a-z]{1,3}\\d+[a-z]?|(?:faz|phase|wave|stage|step|ad[ıi]m|lane|round|tur|part|sprint|batch)\\s+(?:\\d+|[a-z]))\\s+(?:${TERMINAL_WORD})(?![\\p{L}\\d-])`,
  'u',
)
const DATE = '\\d{4}-\\d{2}-\\d{2}'
// "DONE (3/3)", "DONE 2026-11-10 (note)", "Tamamlandı — rapor": the phase STARTS with the word as a whole word
const PHASE_STARTS_DONE = new RegExp(
  `^(?:${TERMINAL_WORD})(?![\\p{L}\\d-])(?:\\s*$|\\s*[—–:.,;(]|\\s*${DATE})`,
  'u',
)
// "T21 bitti", "BUILD DONE 2026-11-10": the word ends the phase (notes in parentheses taken out) or only a date follows
const PHASE_ENDS_DONE = new RegExp(
  `(?<![\\p{L}\\d-])(?:${TERMINAL_WORD})(?![\\p{L}\\d-])(?:[\\s\\d/.:\\-–—,]*$|\\s*${DATE})`,
  'u',
)
// the skills for which a done phase really means the job is over
const ENDING_SKILL = /^(?:(?:my-skill-)?orchestrate|my-skill-ship)(?![\p{L}\d-])/u

// STATE.md's header says no job is open. When in doubt the job is OPEN: a stale bar is
// better than hiding a running one.
export const stateEnded = (source: string) => {
  const header = (name: string) => new RegExp(`^${name}:[ \\t]*(.*)$`, 'm').exec(source.replace(/\r\n?/g, '\n'))?.[1] ?? ''
  const skill = fold(header('Active skill')).trim()
  const phase = fold(header('Phase')).trim()
  const fraction = /(\d+)\/(\d+)/.exec(phase)
  if (fraction && Number(fraction[1]) < Number(fraction[2])) return false
  if (/^none(?![\p{L}\d-])/u.test(skill)) return true
  if (skill !== '' && !ENDING_SKILL.test(skill)) return false
  if (new RegExp(`\\([^)]*(?:${RUNNING})`, 'u').test(phase)) return false
  // a running word before the done word, or after it up to the first `.` or `(`, keeps the job open
  const word = DONE_WORD.exec(phase)
  if (word) {
    const after = phase.slice(word.index + word[0].length).split(/[.(]/)[0] ?? ''
    if (RUNNING_WORD.test(phase.slice(0, word.index)) || RUNNING_WORD.test(after)) return false
  }
  if (PART_DONE.test(phase)) return false
  return PHASE_STARTS_DONE.test(phase) || PHASE_ENDS_DONE.test(phase.replace(/\([^)]*\)/g, ' '))
}

// Steps for a my-skill plan; [] when no job is active (spec §4). An all-done plan
// is returned as such, so reconcile can flash "✓ Tamamlandı" for a job it saw run.
export const mySkillSteps = (plan: MsPlan, state?: StateInfo): Adim[] => {
  const status = (id: string): Durum =>
    plan.done.has(id) || state?.done.has(id) ? 'completed' : state?.inProgress.has(id) ? 'in_progress' : 'pending'
  const steps = plan.ids.filter(id => !state?.dropped?.has(id)).map(id => {
    const title = plan.titles.get(id)
    return { id, content: title ? `${id} · ${title}` : id, activeForm: '', status: status(id) }
  })
  const done = steps.filter(one => one.status === 'completed').length
  const running = steps.some(one => one.status === 'in_progress')
  const skill = fold(state?.activeSkill ?? '')
  if (!running && TERMINAL_PHASE.test(fold(state?.phase ?? '')) && /^(none|my-skill-ship)\b/.test(skill)) return []
  if (done === 0 && !running && !/^my-skill-execute\b/.test(skill)) return []
  return steps
}

// Which plan dir STATE.md names, best first (spec §2.3 steps 1-3). `dirs` are the
// existing .workflow/plans/<dir> names; anything else is ignored.
export const planDirsFromState = (source: string, dirs: string[]): string[] => {
  const known = new Set(dirs)
  const found: string[] = []
  const add = (dir: string | undefined) => {
    if (dir && known.has(dir) && !found.includes(dir)) found.push(dir)
  }
  const all = lines(source)

  for (const line of all) {
    const plan = /^\s*[-*]?\s*Plan:\s*(\S+)/.exec(line)?.[1]
    if (plan) add(/(?:^|\/)plans\/([^/\s`'")\]{}]+)\//.exec(plan)?.[1])
  }

  // then the dirs named by the header lines (Goal / Phase / Active skill / Progress, before the
  // first `##`), then a `## Files` section's, then the rest in order of first appearance
  const firstSection = all.findIndex(line => /^##\s/.test(line))
  const headerLines = all.slice(0, firstSection === -1 ? all.length : firstSection).filter(line => /^(?:Goal|Phase|Active skill|Progress):/.test(line))
  const header = headerLines.join('\n')
  const goal = all.filter(line => /^Goal:/.test(line)).join('\n')
  for (const line of headerLines) for (const match of line.matchAll(PLAN_PATH)) add(match[1])
  for (const text of [goal, header]) {
    for (const dir of dirs) {
      if (text.includes(`${dir} PLAN.md`) || text.includes(`plans/${dir}/`)) add(dir)
    }
  }
  let isFiles = false
  const inFiles: string[] = []
  const elsewhere: string[] = []
  for (const line of all) {
    const heading = HEADING.exec(line)
    if (heading) isFiles = /^files\b/.test(fold(heading[2] ?? ''))
    for (const match of line.matchAll(PLAN_PATH)) (isFiles ? inFiles : elsewhere).push(match[1] ?? '')
  }
  ;[...inFiles, ...elsewhere].forEach(add)
  return found
}

// --- generic ladder (spec §5) ---

// any indent, as before the my-skill parser: nested sub-task boxes count too
const BOX = /^[ \t]*[-*+][ \t]+\[([ xX✓✔~>/.-])\][ \t]+(.*)$/

// L1 (and L4's checkbox part): `[x]` done, `[~] [>] [/] [.]` running, `[-]` dropped;
// an open box under an in-progress heading is running.
export const checkboxSteps = (source: string): Adim[] => {
  let section: Section = 'none'
  return lines(source).flatMap((line, i) => {
    const heading = HEADING.exec(line)
    if (heading) {
      section = sectionOf(heading[2] ?? '')
      return []
    }
    const match = BOX.exec(line)
    if (!match) return []
    const mark = match[1] ?? ' '
    if (mark === '-') return []
    const status: Durum = /[xX✓✔]/.test(mark)
      ? 'completed'
      : mark !== ' ' || section === 'in_progress'
        ? 'in_progress'
        : 'pending'
    return [{ id: `plan-${i}`, content: plainText(match[2] ?? ''), activeForm: '', status }]
  })
}

// whole words only: "tamamlanmadı" (not finished) and "tamamen" are no done marks
const MARK_DONE = /✅|✔|☑|\bDONE\b|\[done\]|\(done\)|(?<!\p{L})(tamam(?:land[ıi])?|bitti)(?!\p{L})/u
const MARK_RUNNING = /🔄|⏳|🚧|\bIN PROGRESS\b|\[wip\]|devam ediyor|sürüyor|←\s*(now|current|şimdi)/u
const NUMBERED_HEADING =
  /^[ \t]{0,3}#{2,4}[ \t]+(?:(?:Task|Step|Görev|Adım|Faz|Phase|Aşama)[ \t]+)?(\d+|[A-Z]\d+)[.):\-—][ \t]*(.+)$/
const ORDERED = /^[ \t]{0,3}(\d+)[.)][ \t]+(.+)$/

const markOf = (title: string): Durum | undefined =>
  /^~~/.test(title.trim()) || MARK_DONE.test(title) ? 'completed' : MARK_RUNNING.test(title) ? 'in_progress' : undefined

// L2: numbered headings or an ordered list, only with ≥3 items and ≥1 status marker.
export const numberedSteps = (source: string): Adim[] => {
  for (const pattern of [NUMBERED_HEADING, ORDERED]) {
    const items = lines(source).flatMap((line, i) => {
      const title = pattern.exec(line)?.[2]
      return title ? [{ i, title, mark: markOf(title) }] : []
    })
    if (items.length >= 3 && items.some(item => item.mark !== undefined)) {
      return items.map(({ i, title, mark }) => ({
        id: `plan-${i}`,
        content: plainText(title),
        activeForm: '',
        status: mark ?? 'pending',
      }))
    }
  }
  return []
}

// L4's fallback: a STATE.md with sections but no checkboxes; plain top-level bullets.
export const stateBulletSteps = (source: string): Adim[] => {
  const steps: Adim[] = []
  const status = { done: 'completed', in_progress: 'in_progress', remaining: 'pending' } as const
  walkSections(source, (section, text, nested) => {
    if (section === 'none' || nested) return
    steps.push({ id: `plan-${steps.length}`, content: plainText(text), activeForm: '', status: status[section] })
  })
  return steps.length >= 2 ? steps : []
}

export const genericSteps = (source: string, isState: boolean): Adim[] => {
  if (isState && stateEnded(source)) return []
  const boxes = checkboxSteps(source)
  if (boxes.length > 0) return boxes
  const numbered = numberedSteps(source)
  if (numbered.length > 0) return numbered
  return isState ? stateBulletSteps(source) : []
}
