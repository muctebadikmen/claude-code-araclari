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
const BULLET = /^([ \t]?)[-*+][ \t]+(.*)$/
const RANGE = /[A-Z]{1,3}\d+[a-z]{0,2}[ \t]*(?:\.\.|–|—|→|-)[ \t]*[A-Z]{1,3}\d+[a-z]{0,2}/g
const SHA_AFTER = '(?=[ \\t]+(?=[0-9a-f]*\\d)[0-9a-f]{7,40}\\b)'
const PLAN_PATH = /(?:^|[^\w-])(?:\.workflow\/)?plans\/([^/\s`'")\]]+)\/PLAN\.md/g

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
  visit: (section: Section, text: string) => void,
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
    if (bullet) visit(section, bullet[2] ?? '')
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

// an In progress line about what is held up, not running ("BLOCKED on owner: T245")
const BLOCKED = /^(blocked|engell?i|bloke)(?!\p{L})/u

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
    (section, text) => {
      if (section === 'done') doneLines++
      if (!withSha) return
      if (section === 'done') {
        for (const id of idsIn(text.replace(RANGE, ' '), withSha)) done.add(id)
        for (const id of leadIds(text, ids)) done.add(id)
      } else if (section === 'in_progress' && !BLOCKED.test(fold(plainText(text.replace(/^\[[^\]]\][ \t]*/, ''))))) {
        for (const id of leadIds(text, ids)) inProgress.add(id)
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

const TERMINAL_PHASE = /^(tamam(land[ıi])?|bitti|complete(d)?|done|finished|shipped)(?![\p{L}\d])/u

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
    if (plan) add(/(?:^|\/)plans\/([^/\s`'")\]]+)\/PLAN\.md/.exec(plan)?.[1])
  }

  const counts = new Map<string, number>()
  const inFiles = new Set<string>()
  let isFiles = false
  for (const line of all) {
    const heading = HEADING.exec(line)
    if (heading) isFiles = /^files\b/.test(fold(heading[2] ?? ''))
    for (const match of line.matchAll(PLAN_PATH)) {
      const dir = match[1] ?? ''
      counts.set(dir, (counts.get(dir) ?? 0) + 1)
      if (isFiles) inFiles.add(dir)
    }
  }
  const mentioned = [...counts.keys()]
  ;[...mentioned]
    .sort((a, b) => Number(inFiles.has(b)) - Number(inFiles.has(a)) || (counts.get(b) ?? 0) - (counts.get(a) ?? 0))
    .forEach(add)

  const header = all.slice(0, Math.max(0, all.findIndex(line => /^##\s/.test(line)))).join('\n') || source
  const goal = all.filter(line => /^Goal:/.test(line)).join('\n')
  for (const text of [goal, header]) {
    for (const dir of dirs) {
      if (text.includes(`${dir} PLAN.md`) || text.includes(`plans/${dir}/`)) add(dir)
    }
  }
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
  walkSections(source, (section, text) => {
    if (section === 'none') return
    steps.push({ id: `plan-${steps.length}`, content: plainText(text), activeForm: '', status: status[section] })
  })
  return steps.length >= 2 ? steps : []
}

export const genericSteps = (source: string, isState: boolean): Adim[] => {
  const boxes = checkboxSteps(source)
  if (boxes.length > 0) return boxes
  const numbered = numberedSteps(source)
  if (numbered.length > 0) return numbered
  return isState ? stateBulletSteps(source) : []
}
