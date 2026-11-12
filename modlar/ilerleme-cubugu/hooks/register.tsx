import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register, RenderElement, RenderInput, Timer } from 'claude-code'

import type { IlerlemeCubuguAdim as Adim, IlerlemeCubuguDurum as Durum } from '../types'
import {
  genericSteps,
  ledgerUnread,
  mergeProgress,
  mySkillSteps,
  parseMsPlan,
  parseProgress,
  parseState,
  planDirsFromState,
} from './progress'
import type { MsPlan } from './progress'

const tasks = atom({ plugin: 'ilerleme-cubugu', key: 'tasks' } as const, [])
const plan = atom({ plugin: 'ilerleme-cubugu', key: 'plan' } as const, [])
const job = atom({ plugin: 'ilerleme-cubugu', key: 'job' } as const, { startedAt: null, doneAt: null })
const isHidden = atom({ plugin: 'ilerleme-cubugu', key: 'isHidden' } as const, false)
const isExpanded = atom({ plugin: 'ilerleme-cubugu', key: 'isExpanded' } as const, false)
const engagedSid = atom({ plugin: 'ilerleme-cubugu', key: 'engagedSid' } as const, null)
const isUnread = atom({ plugin: 'ilerleme-cubugu', key: 'isUnread' } as const, false)
// when the task list was first seen with every task completed; null while it is open
const tasksDoneAt = atom({ plugin: 'ilerleme-cubugu', key: 'tasksDoneAt' } as const, null)

const HIDE_MS = 4000
const TICK_MS = 5000
const MAX_CELLS = 20
const USAGE = 'Kullanım: /ilerleme gizle | göster | detay'
const UNREAD = '⚠ ilerleme kaydı okunamadı · '
// a text or tool argument that names the my-skill workflow files
const WORKFLOW = /\b(?:PLAN|STATE|PROGRESS)\.md\b|\bHANDOFF\b|\.workflow\/plans\//
const ENGAGING_SKILLS = new Set(['my-skill-execute', 'my-skill-handoff', 'my-skill-masterplan'])

type $ = EngineInterface
type Args = Record<string, unknown>

const text = (value: unknown) => (typeof value === 'string' ? value.trim() : '')

const toStatus = (value: unknown): Durum | 'deleted' | undefined =>
  value === 'pending' || value === 'in_progress' || value === 'completed' || value === 'deleted'
    ? value
    : undefined

const isDone = (step: Adim) => step.status === 'completed'

const isRunning = (step: Adim) => step.status === 'in_progress'

const fromTodos = (todos: unknown): Adim[] =>
  (Array.isArray(todos) ? todos : []).flatMap((todo: Args, i) => {
    const content = text(todo?.content)
    const status = toStatus(todo?.status)
    if (!content || !status || status === 'deleted') return []
    return [{ id: `todo-${i}`, content, activeForm: text(todo.activeForm), status }]
  })

const createdId = (ran: { result?: unknown; text?: string }) => {
  const result = (ran.result ?? {}) as Args
  const task = (result.task ?? {}) as Args
  const id = task.id ?? result.id ?? result.taskId
  if (typeof id === 'string' || typeof id === 'number') return String(id)
  return /#(\w+)/.exec(ran.text ?? '')?.[1]
}

const upsert = (list: Adim[], step: Adim) => {
  const startsOver = list.length > 0 && list.every(isDone)
  const base = startsOver ? [] : list
  const twin = base.findIndex(
    one => one.id === step.id || (one.id.startsWith('tu:') && one.content === step.content),
  )
  if (twin === -1) return [...base, step]
  return base.map((one, i) => (i === twin ? { ...one, id: step.id } : one))
}

const patch = (list: Adim[], id: string, args: Args) => {
  const status = toStatus(args.status)
  if (status === 'deleted') return list.filter(one => one.id !== id)
  return list.map(one =>
    one.id !== id
      ? one
      : {
          ...one,
          status: status ?? one.status,
          content: text(args.subject) || one.content,
          activeForm: text(args.activeForm) || one.activeForm,
        },
  )
}

const bar = (done: number, total: number) => {
  const cells = Math.min(total, MAX_CELLS)
  const filled = Math.round((done / total) * cells)
  return '▓'.repeat(filled) + '░'.repeat(cells - filled)
}

const clip = (value: string, room: number) =>
  value.length <= room ? value : `${value.slice(0, Math.max(1, room - 1))}…`

type Found = { path: string; mtimeMs: number }

const STATE_PATH = '.workflow/STATE.md'
const planPath = (dir: string) => `.workflow/plans/${dir}/PLAN.md`
const progressPath = (dir: string) => `.workflow/plans/${dir}/PROGRESS.md`

const statFile = ($: $, path: string): Promise<Found | undefined> =>
  $.fs.stat(path).then(
    stat => (stat.kind === 'file' ? { path, mtimeMs: stat.mtimeMs } : undefined),
    () => undefined,
  )

const newest = (list: (Found | undefined)[]) =>
  list.filter(one => one !== undefined).sort((a, b) => b.mtimeMs - a.mtimeMs)

let seen = ''
// last stat of each plan dir's PLAN.md / PROGRESS.md; between full looks only the `hot` dirs
// (the plan in use and the newest one) are stat'ed again
const dirStats = new Map<string, { plan?: Found; ledger?: Found }>()
let hot = new Set<string>()
let ticks = 0
const FULL_EVERY = 6
// one interval per process: a repeated session.start replaces it, never stacks a second one
let ticker: Timer | undefined

// File I/O only; the parsing is in ./progress (pure, unit-tested). Order (spec §2.1):
// a my-skill plan (the one STATE.md names, else the newest .workflow/plans/*/PLAN.md)
// with its status from its PROGRESS.md ledger, else from STATE.md; then the generic ladder on PLAN.md,
// .workflow/PLAN.md, STATE.md and the newest plan, newest first.
async function refreshPlan($: $, full = true) {
  const entries = await $.fs.list('.workflow/plans').catch(() => [])
  const dirs = entries.filter(entry => entry.kind === 'dir').map(entry => entry.name)
  for (const dir of dirStats.keys()) if (!dirs.includes(dir)) dirStats.delete(dir)
  const stats = await Promise.all(
    dirs.map(async dir => {
      const known = dirStats.get(dir)
      if (!full && known && !hot.has(dir)) return known
      const fresh = { plan: await statFile($, planPath(dir)), ledger: await statFile($, progressPath(dir)) }
      dirStats.set(dir, fresh)
      return fresh
    }),
  )
  const plans = stats.map(one => one.plan)
  const ledgers = stats.map(one => one.ledger)
  const fixed = await Promise.all(['PLAN.md', '.workflow/PLAN.md', STATE_PATH].map(path => statFile($, path)))

  // re-read only when any file consulted changed (or appeared, or went away)
  const stamp = newest([...plans, ...ledgers, ...fixed])
    .map(one => `${one.path}:${one.mtimeMs}`)
    .sort()
    .join('|')
  if (stamp === seen) return

  const texts = new Map<string, Promise<string>>()
  const load = (path: string) => {
    if (!texts.has(path)) texts.set(path, $.fs.read(path).catch(() => ''))
    return texts.get(path) as Promise<string>
  }

  const state = fixed[2]
  const stateText = state ? await load(STATE_PATH) : ''
  const [active] = newest(plans)
  const named = state ? planDirsFromState(stateText, dirs.filter((_, i) => plans[i] !== undefined)) : []

  type Mine = { plan: MsPlan; found: Found; isNamed: boolean; dir: string }
  const stepsOf = async (one: Mine) => {
    // an unnamed plan newer than STATE.md is not what STATE.md's ids are about
    const credit = state !== undefined && (one.isNamed || state.mtimeMs >= one.found.mtimeMs)
    const ids = new Set(one.plan.ids)
    const status = credit ? parseState(stateText, ids) : undefined
    // the plan's own ledger always belongs to it, and decides over STATE.md (Decision 6)
    const ledger = ledgers[dirs.indexOf(one.dir)]
    if (ledger) return { steps: mySkillSteps(one.plan, mergeProgress(parseProgress(await load(ledger.path), ids), status)), unread: false }
    const steps = mySkillSteps(one.plan, status)
    return { steps, unread: status !== undefined && ledgerUnread(status) }
  }

  // of the plans STATE.md names, in order, the first with a step still open; when every
  // named plan is complete, the first one (a later plan's files are read only after the
  // earlier ones turned out complete)
  let mine: Mine | undefined
  let result: { steps: Adim[]; unread: boolean } | undefined
  for (const dir of named) {
    const found = plans[dirs.indexOf(dir)]
    const parsed = found && parseMsPlan(await load(found.path))
    if (!found || !parsed) continue
    const one = { plan: parsed, found, isNamed: true, dir }
    const got = await stepsOf(one)
    if (!mine) [mine, result] = [one, got]
    if (got.steps.some(step => step.status !== 'completed')) {
      ;[mine, result] = [one, got]
      break
    }
  }
  if (!mine && active) {
    const parsed = parseMsPlan(await load(active.path))
    if (parsed) {
      mine = { plan: parsed, found: active, isNamed: false, dir: dirs[plans.indexOf(active)] ?? '' }
      result = await stepsOf(mine)
    }
  }

  hot = new Set([mine?.dir ?? '', active ? (dirs[plans.indexOf(active)] ?? '') : ''])
  let steps: Adim[] = result?.steps ?? []
  let unread = result?.unread ?? false
  // an all-done my-skill plan yields to anything else open; kept, it lets reconcile
  // flash "✓ Tamamlandı" for a job it saw run
  if (steps.every(one => one.status === 'completed')) {
    const skip = new Set([mine?.found.path, mine?.isNamed ? STATE_PATH : undefined])
    // after a finished plan only a file written since then is new work (an ended STATE.md never is)
    const since = mine && steps.length > 0 ? Math.max(mine.found.mtimeMs, ledgers[dirs.indexOf(mine.dir)]?.mtimeMs ?? 0) : 0
    for (const { path, mtimeMs } of newest([...fixed, active])) {
      if (skip.has(path) || mtimeMs <= since) continue
      const found = genericSteps(await load(path), path === STATE_PATH)
      if (found.length > 0 && (steps.length === 0 || found.some(one => one.status !== 'completed'))) {
        steps = found
        // the safety net is about the my-skill plan, not the file that replaced it
        unread = false
        break
      }
    }
  }

  seen = stamp
  await update($, plan, () => steps)
  await update($, isUnread, () => unread)
}

const sessionId = ($: $) => $.session.id().catch(() => '')

// The plan-file bar belongs to the conversation that engaged it (a prompt naming the
// workflow files, an engaging skill, a tool call on them); a task list always does.
async function isEngaged($: $) {
  const sid = await read($, engagedSid)
  return sid !== null && sid === (await sessionId($))
}

async function engage($: $) {
  const sid = await sessionId($)
  await update($, engagedSid, () => sid)
  await refreshPlan($)
  await reconcile($)
}

// A task list whose every task is completed, once the "✓ Tamamlandı" delay has passed, is a
// finished job: it no longer stands in for the plan files. A new task starts a fresh list.
async function liveTasks($: $) {
  const list = await read($, tasks)
  const at = await read($, tasksDoneAt)
  if (list.length === 0 || !list.every(isDone)) {
    if (at !== null) await update($, tasksDoneAt, () => null).catch(() => undefined)
    return list
  }
  const now = await $.clock.now()
  if (at === null) {
    // also called while rendering: a failed write must never escape
    await update($, tasksDoneAt, () => now).catch(() => undefined)
    return list
  }
  return now - at > HIDE_MS ? [] : list
}

async function activeSteps($: $) {
  const fromTasks = await liveTasks($)
  if (fromTasks.length > 0) return fromTasks
  return (await isEngaged($)) ? await read($, plan) : []
}

async function reconcile($: $) {
  const steps = await activeSteps($)
  const before = await read($, job)
  const now = await $.clock.now()
  let after = before

  if (steps.length === 0) {
    after = { startedAt: null, doneAt: null }
  } else if (!steps.every(isDone)) {
    if (before.startedAt === null || before.doneAt !== null) after = { startedAt: now, doneAt: null }
  } else if (before.startedAt !== null && before.doneAt === null) {
    after = { startedAt: before.startedAt, doneAt: now }
    $.ui.toast('✓ Tamamlandı')
    $.clock.after(HIDE_MS + 100, () => $.ui.invalidate('ui.render'))
  }

  if (after !== before) await update($, job, () => after)
}

// `timer` ticks look at every plan dir only each FULL_EVERY-th time
async function tick($: $, timer = false) {
  if ((await liveTasks($)).length === 0 && (await isEngaged($))) await refreshPlan($, !timer || ++ticks % FULL_EVERY === 0)
  await reconcile($)
}

const isOtherSession = async ($: $, id: string | undefined) => {
  const sid = await sessionId($)
  return Boolean(id) && Boolean(sid) && id !== sid
}

export const register: Register = on => {
  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'ilerleme',
      description: 'İlerleme çubuğunu gizler, gösterir ya da adım listesini açar',
      argumentHint: 'gizle | göster | detay',
      immediate: true,
    })
    ticker?.cancel()
    ticker = $.clock.every(TICK_MS, () => void tick($, true).catch(() => undefined))
    await tick($).catch(() => undefined)

    return next(e)
  })

  on('command.run', { command: 'ilerleme' }, async ($, e) => {
    // "GİZLE", "GIZLE", "Göster" and "goster" all work
    const arg = e.args.trim().toLocaleLowerCase('tr').replace(/ı/g, 'i')

    if (arg === 'gizle') {
      await update($, isHidden, () => true)
      return { text: 'İlerleme çubuğu gizlendi. Geri getirmek için: /ilerleme göster' }
    }
    if (arg === 'göster' || arg === 'goster') {
      await update($, isHidden, () => false)
      return { text: 'İlerleme çubuğu gösteriliyor.' }
    }
    if (arg === 'detay') {
      const open = await update($, isExpanded, value => !value)
      return { text: open ? 'Adım listesi açıldı.' : 'Adım listesi kapatıldı.' }
    }

    return { text: USAGE }
  })

  on('tool.call', async ($, e, next) => {
    const ran = await next(e)
    if (ran.deny !== undefined || ran.isError === true) return ran

    const tool = String(e.tool)
    const args = e as unknown as Args
    // TaskCreate/TaskUpdate share the session's single task list, so a sub-agent's
    // calls count; a sub-agent's TodoWrite is its own private list and must not
    // replace the main one.
    if (tool === 'TodoWrite' && e.agentId !== undefined) return ran

    try {
      if (tool === 'TodoWrite') {
        await update($, tasks, () => fromTodos(args.todos))
        // a list that arrives already complete gets its own hide delay
        await update($, tasksDoneAt, () => null)
      } else if (tool === 'TaskCreate') {
        const id = createdId(ran) ?? `tu:${e.tool_use_id}`
        const step: Adim = {
          id,
          content: text(args.subject) || text(args.description),
          activeForm: text(args.activeForm),
          status: 'pending',
        }
        await update($, tasks, list => upsert(list, step))
      } else if (tool === 'TaskUpdate') {
        await update($, tasks, list => patch(list, String(args.taskId), args))
      } else if (Object.values(args).some(value => typeof value === 'string' && WORKFLOW.test(value))) {
        await engage($)
        return ran
      } else {
        return ran
      }
      await reconcile($)
    } catch {
      // the tool already ran; a failed progress update must not fail it
    }

    return ran
  })

  on('prompt.submit', async ($, e, next) => {
    const ran = await next(e)
    if (ran.drop === undefined && WORKFLOW.test(e.text)) await engage($).catch(() => undefined)

    return ran
  })

  on('skill.prompt', async ($, e, next) => {
    const ran = await next(e)
    if (ENGAGING_SKILLS.has(e.skill.split(':').pop() ?? '')) await engage($).catch(() => undefined)

    return ran
  })

  on('classic.TaskCreated', async ($, e, next) => {
    if (await isOtherSession($, e.session_id)) return next(e)
    const step: Adim = {
      id: e.task_id,
      content: e.task_subject,
      activeForm: '',
      status: 'pending',
    }
    // a failure here must never hold up Claude's own task flow
    await update($, tasks, list => upsert(list, step))
      .then(() => reconcile($))
      .catch(() => undefined)

    return next(e)
  })

  on('classic.TaskCompleted', async ($, e, next) => {
    if (await isOtherSession($, e.session_id)) return next(e)
    await update($, tasks, list => patch(list, e.task_id, { status: 'completed' }))
      .then(() => reconcile($))
      .catch(() => undefined)

    return next(e)
  })

  on('turn.complete', async ($, e, next) => {
    await tick($).catch(() => undefined)

    return next(e)
  })

  // A /clear or a resume goes on in this process as
  // another conversation, with no session.start: nothing of the old one carries over.
  on('session.end', async ($, e, next) => {
    seen = ''
    dirStats.clear()
    hot.clear()
    ticks = 0
    await update($, tasks, () => [])
    await update($, tasksDoneAt, () => null)
    await update($, plan, () => [])
    await update($, job, () => ({ startedAt: null, doneAt: null }))
    await update($, engagedSid, () => null)
    await update($, isUnread, () => false)

    return next(e)
  })

  // AbovePrompt is one band shared with other plugins such as blast-radius (its narrow-
  // terminal fallback). Nothing to show: pass with next(e) untouched. Otherwise compose,
  // never replace: whatever the plugins beneath drew comes FIRST (a handoff question, a
  // held command), then this mod's rows, so an opened step list can never push another
  // mod's buttons out of the band's window. No hotkey, no autoFocus: the keys stay theirs.
  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const mine = await ownRows($, e)
    if (mine === undefined) return next(e)

    const below = await next(e)
    const { Box } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        {below ?? null}
        {mine}
      </Box>
    )
  })
}

async function ownRows($: $, e: RenderInput<'AbovePrompt'>): Promise<RenderElement[] | undefined> {
  if (e.component !== 'AbovePrompt') return undefined
  if (e.props.hasSurvey || (await read($, isHidden))) return undefined

  const steps = await activeSteps($)
  const { startedAt, doneAt } = await read($, job)
  if (steps.length === 0 || startedAt === null) return undefined

  const now = await $.clock.now()
  const done = steps.filter(isDone).length
  const isComplete = done === steps.length
  if (isComplete && (doneAt === null || now - doneAt > HIDE_MS)) return undefined

  const total = steps.length
  // the safety net speaks for the plan files only, never for a task list
  const warn = (await liveTasks($)).length === 0 && (await read($, isUnread)) ? UNREAD : ''
  const head = `${bar(done, total)} ${done}/${total} · %${Math.round((done / total) * 100)} · ${warn}`
  const running = steps.filter(isRunning)
  const next = steps.find(one => !isDone(one))
  const room = Math.max(8, e.props.bodyColumns - head.length - 9)
  // Decision 7: parallel work is a count; one step is named; none running names the next
  const middle =
    isComplete || !next
      ? '✓ Tamamlandı'
      : running.length >= 2
        ? `Şu an ${running.length} iş üzerinde çalışılıyor`
        : running[0]
          ? `Şu an: ${clip(running[0].activeForm || running[0].content, room)}`
          : `Sıradaki: ${clip(next.content, room)}`
  const expanded = await read($, isExpanded)

  const { Button, Text } = $.ui.resolve(e)

  return [
    <Button key="toggle" label={head + middle} plain onPress={() => update($, isExpanded, value => !value)} />,
    ...(expanded
      ? steps.map(one => (
          <Text key={`adim-${one.id}`} dimColor={isDone(one)} bold={isRunning(one)} wrap="truncate-end">
            {isDone(one) ? '✓' : isRunning(one) ? '●' : '○'} {one.content}
          </Text>
        ))
      : []),
  ]
}
