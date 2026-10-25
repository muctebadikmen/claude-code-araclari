import { describe, expect, mock, test } from 'claude-code/testing'

import {
  CLEANUP_FLAG,
  closedTurnHandoff,
  DRAIN_DENY,
  DRAIN_TIMEOUT_MS,
  fileMissingText,
  HANDED_PREFIX,
  handoffFile,
  inTurnHandoff,
  KAPAT_CHAIN,
  KIMLIK_PREFIX,
  LONG_CHAT_SECTION_ID,
  longChatNote,
  MANAGED_START_DENY,
  managedHandoff,
  nextMessageNote,
  NORMAL_INFO,
  normalDeneText,
  ORKESTRA_PREFIX,
  orkestraRecordFile,
  READY_BAND,
  RECORD_BACKEND,
  RUN_PREFIX,
  SKILL_HANDOFF_DENY,
  START_NOW,
  timeoutText,
  waitText,
  ZINCIR_AYAR_PREFIX,
  zincirAyarFile,
} from '../hooks/register.tsx'

// v1.0 Spec (S1-S11) tests, one per id V1-V15 (probe: RESULT M, turn.complete PER-TURN,
// so V16/V17 do not apply).
//
// v1.1 (Decisions 19-22, T11): a normal chat is passive, so every handoff test here runs
// in a managed sub-chat (role `alt`, `local_c1` of the chain `local_main`), and the old
// global `esik`/`acik` of the store argument are that chain's settings. Tests about
// things that do not depend on a handoff (V14/V14b, R1) keep a normal chat (`yok`).

const PLUGIN = 'otomatik-devir'
const SKILL = 'my-skill-handoff'
const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 10,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 10 },
  view: {},
}
const START = 'mcp__ccd_session__start_session'
const GET = 'mcp__ccd_session_mgmt__get_session'
const DETACH = 'mcp__ccd_session_mgmt__detach_session'
const HAND_OFF = 'mcp__ccd_session__hand_off_to_session'
const DELETE = 'mcp__scheduled-tasks__delete_scheduled_task'
const TASKS = 'mcp__scheduled-tasks__list_scheduled_tasks'
const NEW_ID = 'local_bec10f6a-0001'
const FILE = handoffFile('/proj', 's1')
const NOW = 1_000_000
const HANDOFF_TEXT = "# HANDOFF\n\nkalanlar: adım 3\n\n## Devam prompt'u\nDevam et: adım 3"

type Task = { id: string; type: string; status: string; description: string }

// The managed sub-chat's chain (Decisions 19, 22): its main chat's record, its own record
// and the chain settings, all through RECORD_BACKEND (store-probe.md: BACKEND file).
const HOME = '/home/test'
const MAIN = 'local_main'
const CHILD = 'local_c1'
const CHILD2 = 'local_c2'
const PARENT_REC = {
  role: 'ana',
  sid: 'main',
  localId: MAIN,
  task: 'iş',
  title: 'iş',
  n: 1,
  childId: CHILD,
  isHeld: true,
  startedAt: 0,
  at: 0,
}
const CHILD_REC = { role: 'alt', parent: MAIN, n: 1, sid: 's1', localId: CHILD, status: 'working', at: 0 }
const CHILD_PREFIX = 'Orkestra alt sohbet 1 · '

const putRecord = (world: any, localId: string, rec: Record<string, unknown>) => {
  if (RECORD_BACKEND === 'store') world.store[`${ORKESTRA_PREFIX}${localId}`] = JSON.parse(JSON.stringify(rec))
  else world.files[orkestraRecordFile(HOME, localId)] = { text: JSON.stringify(rec), mtimeMs: 0 }
}
const getRecord = (world: any, localId: string): any => {
  if (RECORD_BACKEND === 'store') return world.store[`${ORKESTRA_PREFIX}${localId}`]
  const file = world.files[orkestraRecordFile(HOME, localId)]
  return file === undefined ? undefined : JSON.parse(file.text)
}
const putChainSettings = (world: any, rec: Record<string, unknown>) => {
  if (RECORD_BACKEND === 'store') world.store[`${ZINCIR_AYAR_PREFIX}${MAIN}`] = JSON.parse(JSON.stringify(rec))
  else world.files[zincirAyarFile(HOME, MAIN)] = { text: JSON.stringify(rec), mtimeMs: 0 }
}
const getChainSettings = (world: any): any => {
  if (RECORD_BACKEND === 'store') return world.store[`${ZINCIR_AYAR_PREFIX}${MAIN}`]
  const file = world.files[zincirAyarFile(HOME, MAIN)]
  return file === undefined ? undefined : JSON.parse(file.text)
}
/** The main chat relays the next child (O15): this ready child is consumed. */
const parentMovesOn = (world: any) => putRecord(world, MAIN, { ...PARENT_REC, n: 2, childId: CHILD2 })
/** A second managed sub-chat of the same chain, for session `s2`. */
const seedSecondChild = (world: any) => {
  world.store[`${KIMLIK_PREFIX}s2`] = CHILD2
  putRecord(world, CHILD2, { role: 'alt', parent: MAIN, n: 2, sid: 's2', localId: CHILD2, status: 'working', at: 0 })
}

/**
 * The world beneath the mod (the trimmed v0.5 setup): a session whose id, fill,
 * subagents and handoff files the test controls, the store open to the test.
 * `role: 'alt'` (default) makes session s1 the managed sub-chat `local_c1` of the chain
 * `local_main`, the store argument's `esik`/`acik` its chain settings (M11);
 * `role: 'yok'` keeps the plain v1 world (a normal chat).
 */
const setup = (
  on: any,
  store: Record<string, unknown> = { esik: 40 },
  opts: { tools?: string[]; commands?: string[]; role?: 'alt' | 'yok' } = {},
) => {
  const { tools = [START, GET, DETACH, HAND_OFF], commands = [SKILL], role = 'alt' } = opts
  const world = {
    sid: 's1',
    percent: 10 as number | undefined,
    store: {} as Record<string, unknown>,
    typed: [] as { text: string; context: readonly string[] }[],
    toasts: [] as string[],
    logs: [] as string[],
    statuses: [] as string[],
    calls: [] as any[],
    agents: [] as { id: string; description: string; type: string; status: string }[],
    // The file system's handoff files: path -> text and mtime.
    files: {} as Record<string, { text: string; mtimeMs: number }>,
    // The scheduled tasks list_scheduled_tasks answers with, and $.tool.check's verdict.
    tasks: [] as Record<string, unknown>[],
    checkDecision: 'allow' as string,
    checks: [] as any[],
    spawns: [] as any[],
    // How start_session answers ('ok', 'error' = isError, 'throw'), a drop of the next
    // submitted prompt, and a session.id that throws (a failing guard).
    startMode: 'ok' as 'ok' | 'error' | 'throw',
    dropNext: undefined as string | undefined,
    failSid: false,
  }
  const clock = mock.clock(on, { now: NOW })
  const clone = (value: unknown) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
  Object.assign(world.store, clone(store))
  if (role === 'alt') {
    // session.start restores role `alt` from kimlik:s1 and the own record (O16), so
    // compose and the status line see it from the first call (O2, O9).
    world.store[`${KIMLIK_PREFIX}s1`] = CHILD
    putRecord(world, MAIN, PARENT_REC)
    putRecord(world, CHILD, CHILD_REC)
    putChainSettings(world, { esik: store.esik, isClosed: store.acik === false ? true : undefined, at: 0 })
  }
  on('store.get', ($: any, e: any) => ({ value: clone(world.store[e.key]) }))
  on('store.set', ($: any, e: any) => {
    world.store[e.key] = clone(e.value)
    return { value: undefined }
  })
  on('store.delete', ($: any, e: any) => {
    delete world.store[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(world.store) }))
  mock.env(on, { HOME: '/home/test' })
  // The plugins below this one in the shared band (other mods, or the engine).
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => $.ui.resolve(e).Box({ key: 'below' }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => {
    if (world.failSid) throw new Error('session.id failed')
    return { value: world.sid }
  })
  on('session.root', () => ({ value: '/proj' }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 100, percent: world.percent }, rateLimits: [] },
  }))
  on('session.measure', ($: any, e: any) => ({ changed: e.changed }))
  on('session.messages', () => ({ value: [] }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
  on('command.list', () => ({
    value: commands.map(name => ({ name, description: '', source: 'plugin' })),
  }))
  on('command.run', () => ({}))
  on('agent.list', () => ({ value: world.agents }))
  on('agent.spawn', ($: any, e: any) => {
    world.spawns.push(e)
    return { model: 'claude-haiku', agentId: `a${world.spawns.length}` }
  })
  on('tool.list', () => ({ value: tools.map(name => ({ name, description: '', mcp: true })) }))
  // The test's verdict applies to the delete; it records the mod's own queries
  // (no tool_use_id), not the engine's check of each real call.
  on('tool.check', ($: any, e: any) => {
    if (e.tool_use_id === undefined) world.checks.push(e)
    return { decision: e.tool === DELETE ? world.checkDecision : 'allow' }
  })
  on('tool.call', ($: any, e: any) => {
    world.calls.push(e)
    if (e.tool === GET) {
      if (role === 'yok') return { result: [], text: JSON.stringify({ sessionId: 'local_self', title: 'Eski iş' }) }
      // s1 is the chain's child; any other session is a normal chat (no parent).
      const self =
        world.sid === 's1'
          ? { sessionId: CHILD, parentSessionId: MAIN, title: 'Eski iş' }
          : { sessionId: `local_${world.sid}`, title: 'Eski iş' }
      return { result: [], text: JSON.stringify(self) }
    }
    if (e.tool === START) {
      if (world.startMode === 'throw') throw new Error('start_session failed')
      if (world.startMode === 'error') return { result: [], isError: true, text: 'refused by the app' }
      return { result: [], text: `Started session "${e.title}" (session_id: ${NEW_ID}, name: eski-is)` }
    }
    if (e.tool === TASKS) return { result: [], text: JSON.stringify(world.tasks) }
    if (e.tool === DELETE) {
      world.tasks = world.tasks.filter(t => (t.taskId ?? t.id) !== e.taskId)
      return { result: [], text: `Deleted ${e.taskId}` }
    }
    return { result: [], text: 'ok' }
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.stat', ($: any, e: any) => {
    const file = world.files[e.path]
    if (file === undefined) throw new Error('ENOENT')
    return { value: { kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs, isLink: false } }
  })
  on('fs.read', ($: any, e: any) => {
    const file = world.files[e.path]
    if (file === undefined) throw new Error('ENOENT')
    return { value: file.text }
  })
  // The orchestration records and chain settings (BACKEND file) land beside the handoff files.
  on('fs.write', ($: any, e: any) => {
    world.files[e.path] = { text: e.text, mtimeMs: clock.now() }
    return { value: undefined }
  })
  on('prompt.submit', ($: any, e: any) => {
    world.typed.push({ text: e.text, context: e.context ?? [] })
    if (world.dropNext !== undefined) {
      const drop = world.dropNext
      world.dropNext = undefined
      return { drop }
    }
    return { text: e.text, context: e.context }
  })
  on('classic.Stop', () => ({}))
  on('ui.status', ($: any, e: any) => {
    world.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.log', ($: any, e: any) => {
    world.logs.push(e.text)
    return { value: undefined }
  })
  on('ui.toast', ($: any, e: any) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })

  return { world, clock }
}

const devir = ($: any, args: string) =>
  $.command.run({
    command: 'devir',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })
const phase = async ($: any) => (await devir($, '')).text as string

const start = ($: any) => $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })

let turnSeq = 0
/** The person presses Enter (Claude desktop's composer). */
const typed = ($: any, text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
/** A message no person typed (a task notification). */
const machine = ($: any, text: string) => $.prompt.submit({ text, origin: { kind: 'task-notification' }, wait: false })
const turnBegin = ($: any) => $.turn.start({ text: '', turnId: `tt${++turnSeq}` })
const turnEnd = ($: any, isAborted = false) =>
  $.turn.complete({
    answer: 'ok',
    durationMs: 1,
    isAborted,
    turnId: `tt${turnSeq}`,
    reason: isAborted ? 'aborted' : 'answer',
  })
/** One main-loop tool call of the model's. */
const bash = ($: any) => $.tool.call({ tool: 'Bash', command: 'ls' })
const stop = ($: any, tasks: Task[] | undefined = [], extra: Record<string, unknown> = {}) =>
  $.classic.Stop({ stop_hook_active: false, background_tasks: tasks, ...extra })
const callsOf = (world: any, tool: string) => world.calls.filter((c: any) => c.tool === tool)
const startSession = ($: any, extra: Record<string, unknown> = {}) =>
  $.tool.call({
    tool: START,
    initiation: 'user_asked',
    context: 'fresh',
    title: 'model başlığı',
    background: 'kısa',
    prompt: 'modelin promptu',
    ...extra,
  })
const writeFile = (world: any, clock: any, text = HANDOFF_TEXT) => {
  world.files[FILE] = { text, mtimeMs: clock.now() }
}

const SUBAGENT: Task = { id: 'a1', type: 'subagent', status: 'running', description: 'araştır' }
const WORKFLOW: Task = { id: 'w1', type: 'workflow', status: 'pending', description: 'denetim' }
const SHELL: Task = { id: 'b1', type: 'shell', status: 'running', description: 'dev server' }
const MONITOR: Task = { id: 'm1', type: 'monitor', status: 'running', description: 'log izle' }

/**
 * A typed turn under the threshold at Enter that crosses it mid-turn: the next
 * Bash result carries the in-turn handoff (S5).
 */
const typedTrip = async ($: any, world: any, clock: any) => {
  world.percent = 30
  await typed($, 'iş')
  await turnBegin($)
  world.percent = 50
  const got = await bash($)
  await clock.advance(100)
  return got
}

describe('otomatik-devir v1', () => {
  test('(V1) devir sürerken çalışan alt ajan ya da Workflow turu tutar; yalnızca shell/monitor tutmaz', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    // v1.0.1: the Stop guard holds only during a handoff (see hotfix (B)).
    await typedTrip($, world, clock)
    const held = await stop($, [SUBAGENT, WORKFLOW, SHELL])
    expect(held.block).toBe(
      waitText([
        { id: 'a1', description: 'araştır' },
        { id: 'w1', description: 'denetim' },
      ]),
    )
    expect(held.block).toContain("perl -e 'select(undef,undef,undef,120)'")
    expect(held.block).toContain('5 dakika')
    expect(held.block).not.toContain('b1')
    // Nothing waited on: the Stop goes on to the handoff's own block (file missing), no wait text.
    // M2: a managed sub-chat's gate is closed, so (d) asks for the file (no START_NOW part).
    expect((await stop($, [SHELL, MONITOR])).block).toBe(fileMissingText(FILE, false))
    // A finished or waiting subagent is not waited on (Decision 15).
    expect((await stop($, [{ ...SUBAGENT, status: 'completed' }, { ...SUBAGENT, id: 'a2', status: 'waiting' }])).block).toBe(
      fileMissingText(FILE, false),
    )
    // (d) gives at most 2 file blocks per turn: a new turn for the $.agent.list() checks.
    await turnBegin($)
    // No background_tasks in the hook: $.agent.list() decides.
    world.agents = [{ id: 'a7', description: 'yaz', type: 'general-purpose', status: 'running' }]
    expect((await $.classic.Stop({ stop_hook_active: false } as any)).block).toBe(
      waitText([{ id: 'a7', description: 'yaz' }]),
    )
    world.agents = [{ id: 'a7', description: 'yaz', type: 'general-purpose', status: 'waiting' }]
    expect((await $.classic.Stop({ stop_hook_active: false } as any)).block).toBe(fileMissingText(FILE, false))
    expect(await phase($)).toContain('aşama: handoff_running')
  })

  test('(V2) bir alt ajanın Stop olayı (agent_id) hiç tutulmaz', async ($, on) => {
    const { world } = setup(on)
    await start($)
    await typed($, 'iş')
    await turnBegin($)
    world.percent = 90
    expect((await stop($, [SUBAGENT], { agent_id: 'a1' })).block).toBeUndefined()
    // Not tripped there either.
    expect(world.store[`${RUN_PREFIX}s1`]).toBeUndefined()
  })

  test('(V3) mod kapalıyken (acik:false) Stop tutulmaz, devir başlamaz', async ($, on) => {
    const { world } = setup(on, { esik: 40, acik: false })
    await start($)
    world.percent = 30
    await typed($, 'iş')
    await turnBegin($)
    world.percent = 90
    expect((await bash($)).context ?? []).toEqual([])
    expect((await stop($, [SUBAGENT])).block).toBeUndefined()
    expect(await phase($)).toContain('aşama: idle')
    expect(world.store[`${RUN_PREFIX}s1`]).toBeUndefined()
  })

  test(
    '(V4) devir sürerken Agent/Workflow/Task/ajan SendMessage reddedilir; local_ mesajı ve arka plan Bash geçer',
    {
      plugins: [
        {
          name: 'baska-mod',
          register(on: any) {
            // A plugin starts a subagent through $.agent.spawn (the host refuses its $.tool.call of Agent).
            on('command.run', { command: 'baska' }, async ($: any) => {
              const got = await $.agent.spawn({ prompt: 'x', description: 'başka', background: true })
              return { text: String(got.deny) }
            })
          },
        },
      ],
    },
    async ($, on) => {
      const { world, clock } = setup(on)
      await start($)
      // Idle: an Agent call passes.
      expect((await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'önce' } as any)).deny).toBeUndefined()
      expect(callsOf(world, 'Agent')).toHaveLength(1)
      await typedTrip($, world, clock)
      expect(await phase($)).toContain('aşama: handoff_running')

      for (const call of [
        { tool: 'Agent', prompt: 'x', description: 'y' },
        { tool: 'Workflow', script: 'x' },
        { tool: 'Task', prompt: 'x', description: 'y' },
        { tool: 'SendMessage', to: 'worker-1', message: 'devam' },
        // A subagent's own call (agentId) is denied too.
        { tool: 'Agent', prompt: 'x', description: 'y', agentId: 'a1' },
      ]) {
        expect((await $.tool.call(call as any)).deny).toBe(DRAIN_DENY)
      }
      expect(callsOf(world, 'Agent')).toHaveLength(1)
      expect(callsOf(world, 'Workflow')).toHaveLength(0)
      expect(callsOf(world, 'Task')).toHaveLength(0)
      expect(callsOf(world, 'SendMessage')).toHaveLength(0)

      const toSession = await $.tool.call({ tool: 'SendMessage', to: 'local_x', message: 'merhaba' } as any)
      expect(toSession.deny).toBeUndefined()
      const background = await $.tool.call({ tool: 'Bash', command: 'npm run dev', run_in_background: true } as any)
      expect(background.deny).toBeUndefined()
      expect(callsOf(world, 'SendMessage')).toEqual([expect.objectContaining({ to: 'local_x' })])
      expect(callsOf(world, 'Bash')).toContainEqual(expect.objectContaining({ command: 'npm run dev' }))

      // Another plugin's Agent call is denied as well.
      const other = await $.command.run({
        command: 'baska',
        args: '',
        origin: { kind: 'composer' },
        presentation: { isFullscreen: false, columns: 100 },
      } as any)
      expect((other as any).text).toBe(DRAIN_DENY)
      expect(world.spawns).toHaveLength(0)
      expect(callsOf(world, 'Agent')).toHaveLength(1)
    },
  )

  test('(V5) agent.spawn boşta geçer, devir sürerken reddedilir', async ($, on) => {
    const { world, clock } = setup(on)
    const spawn = (description: string) =>
      $.agent.spawn({
        tool_use_id: `tu-${description}`,
        prompt: 'x',
        description,
        subagentType: 'general-purpose',
        provider: { plugin: 'engine', tier: 'core' },
        parentModel: 'claude-opus-5-5',
        background: true,
        fork: false,
      } as any)
    await start($)
    const idle: any = await spawn('boşta')
    expect(idle.deny).toBeUndefined()
    expect(idle.agentId).toBe('a1')
    expect(world.spawns).toHaveLength(1)
    await typedTrip($, world, clock)
    const draining: any = await spawn('devirde')
    expect(draining.deny).toBe(DRAIN_DENY)
    expect(world.spawns).toHaveLength(1)
  })

  test('(V6) yazılan turda eşik aşılınca araç sonucu devir talimatını taşır', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    world.percent = 30
    await typed($, 'iş')
    await turnBegin($)
    // Under the threshold: nothing.
    expect((await bash($)).context ?? []).toEqual([])
    world.percent = 50
    const got = await bash($)
    // M1: a managed sub-chat writes its file only; the main chat opens the next one (O12).
    expect(got.context).toEqual([managedHandoff(40, FILE)])
    expect(got.context?.[0]).toContain(`auto ${FILE}`)
    expect(got.context?.[0]).toContain(START)
    expect(got.context?.[0]).not.toContain('initiation "user_asked"')
    expect(got.context?.[0]).toContain('Kalan: yok')
    expect(got.context?.[0]).toContain('reddeder')
    expect(world.store[`${RUN_PREFIX}s1`]).toEqual({
      handoffId: `s1-${NOW.toString(36)}`,
      file: FILE,
      handoffAt: NOW,
      phase: 'handoff_running',
    })
    // Only once: the next result carries nothing.
    expect((await bash($)).context ?? []).toEqual([])
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: handoff_running')
  })

  test('(V7) yazılan turun sonunda (Stop) eşik aşılmışsa devir orada başlar', async ($, on) => {
    const { world } = setup(on)
    await start($)
    world.percent = 30
    await typed($, 'iş')
    await turnBegin($)
    world.percent = 50
    const got = await stop($, [])
    expect(got.block).toBe(managedHandoff(40, FILE))
    expect(await phase($)).toContain('aşama: handoff_running')
    expect(world.store[`${RUN_PREFIX}s1`]).toMatchObject({ phase: 'handoff_running', file: FILE })
  })

  test('(V8) start_session yönetilen alt sohbette hep reddedilir (dosya yokken, taze dosyayla, tüketildikten sonra); dosya ready yapar, ayrılmaz', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await typedTrip($, world, clock)
    // M3 (O13): the managed sub-chat never starts a session itself, file or not. The
    // forwarding (prompt = file + message, background >= 80, title, no detach) is the
    // main chat's O4 now (T5 A7/A10).
    const missing = await startSession($)
    expect(missing.deny).toBe(MANAGED_START_DENY)
    expect(callsOf(world, START)).toHaveLength(0)
    // A file older than this handoff is not fresh.
    world.files[FILE] = { text: HANDOFF_TEXT, mtimeMs: NOW - 1 }
    expect((await startSession($)).deny).toBe(MANAGED_START_DENY)
    expect((await stop($, [])).block).toBe(fileMissingText(FILE, false))
    writeFile(world, clock)
    const got = await startSession($, { initiation: 'offer', context: 'inherit' })
    expect(got.deny).toBe(MANAGED_START_DENY)
    expect(callsOf(world, START)).toHaveLength(0)
    expect(world.store[`${HANDED_PREFIX}s1`]).toBeUndefined()
    expect(world.store[`${RUN_PREFIX}s1`]).toMatchObject({ phase: 'handoff_running', file: FILE })
    // The fresh file makes it ready at the Stop (d); the child's record names the file.
    expect((await stop($, [])).block).toBeUndefined()
    expect(await phase($)).toContain('aşama: ready')
    expect(getRecord(world, CHILD)).toMatchObject({ role: 'alt', status: 'ready', file: FILE })
    expect(callsOf(world, DETACH)).toHaveLength(0)
    await clock.advance(100)
    expect(callsOf(world, DETACH)).toHaveLength(0)
    expect(world.toasts.some(text => text.startsWith('Devam yeni sohbette'))).toBe(false)
    // M6 (O15): the main chat relays the next child, so this one is consumed: done.
    parentMovesOn(world)
    expect(await phase($)).toContain('aşama: done')
    expect(world.store[`${RUN_PREFIX}s1`]).toBeUndefined()
    expect(world.store[`${HANDED_PREFIX}s1`]).toBeUndefined()
    // Done: a later threshold crossing opens no handoff.
    world.percent = 95
    expect((await bash($)).context ?? []).toEqual([])
    const again = await startSession($)
    expect(again.deny).toBe(MANAGED_START_DENY)
    expect((await $.tool.call({ tool: HAND_OFF, prompt: 'x' } as any)).deny).toBe(MANAGED_START_DENY)
    expect(callsOf(world, START)).toHaveLength(0)
    expect(callsOf(world, HAND_OFF)).toHaveLength(0)
  })

  test('(V9) depoda devredildi:<sid> varsa taze $.state ile de eşik üstünde devir olmaz', async ($, on) => {
    const { world } = setup(on, {
      esik: 40,
      [`${HANDED_PREFIX}s1`]: { handoffId: 's1-old', startedId: 'local_old', file: FILE, at: 1 },
    })
    world.percent = 90
    await start($)
    expect(await phase($)).toContain('aşama: done')
    await typed($, 'iş')
    expect(world.typed[0]?.context).toEqual([])
    await turnBegin($)
    expect((await bash($)).context ?? []).toEqual([])
    expect((await stop($, [])).block).toBeUndefined()
    expect(world.store[`${RUN_PREFIX}s1`]).toBeUndefined()
    const now = (await devir($, 'simdi')).text
    expect(now).toContain('zaten devredildi')
    expect(now).toContain('local_old')
    expect((await bash($)).context ?? []).toEqual([])
    expect(await phase($)).toContain('aşama: done')
  })

  test('(V10) 30 dk sonra timeoutText iki kez, sonra bekleme bloğu yok', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await typedTrip($, world, clock)
    const running = [{ id: 'a1', description: 'araştır' }]
    expect((await stop($, [SUBAGENT])).block).toBe(waitText(running))
    await clock.advance(DRAIN_TIMEOUT_MS - 1000)
    expect((await stop($, [SUBAGENT])).block).toBe(waitText(running))
    await clock.advance(1000)
    const first = (await stop($, [SUBAGENT])).block
    expect(first).toBe(timeoutText(running))
    expect(first).toContain('TaskStop')
    expect(first).toContain('a1')
    expect(first).toContain('Yeniden çalıştır')
    expect((await stop($, [SUBAGENT])).block).toBe(timeoutText(running))
    // Third: the running work no longer holds the turn; the handoff itself goes on.
    const third = (await stop($, [SUBAGENT])).block
    expect(third).not.toBe(waitText(running))
    expect(third).not.toBe(timeoutText(running))
    // M2: Stop (d) in a managed sub-chat (closed gate).
    expect(third).toBe(fileMissingText(FILE, false))
  })

  test('(V11) makine turunda tetik: yönetilen devir metni, start_session ret, dosyayla ready; hazır tostu ve bandı yok', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await machine($, 'görev bildirimi')
    await turnBegin($)
    world.percent = 50
    const got = await bash($)
    // M1: the managed handoff text in a machine turn too (O12).
    expect(got.context).toEqual([managedHandoff(40, FILE)])
    expect(got.context?.[0]).toContain(FILE)
    expect(got.context?.[0]).toContain('çağırma')
    expect(got.context?.[0]).not.toContain('user_asked')
    await clock.advance(100)
    const refused = await startSession($)
    // M3 (O13).
    expect(refused.deny).toBe(MANAGED_START_DENY)
    expect(callsOf(world, START)).toHaveLength(0)
    // Without the file the Stop asks for it (closed gate).
    expect((await stop($, [])).block).toBe(fileMissingText(FILE, false))
    writeFile(world, clock)
    expect((await stop($, [])).block).toBeUndefined()
    expect(await phase($)).toContain('aşama: ready')
    expect(world.store[`${RUN_PREFIX}s1`]).toMatchObject({ phase: 'ready' })
    // M4, M10: no ready toast or band in a managed sub-chat; the status names the child.
    expect(world.toasts).not.toContain(READY_BAND)
    expect(world.statuses.at(-1)).toBe(`${CHILD_PREFIX}Devir hazır`)
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND } as any)
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.map((t: any) => t.text ?? t.props?.children)).not.toContain(READY_BAND)
    const drawn: any = await ui.drawn()
    expect(JSON.stringify(drawn)).not.toContain(READY_BAND)
    expect(JSON.stringify(drawn)).toContain('"below"')
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    await ui.unmount()
  })

  test('(V12) Esc: iptal yok, makine turu başına bir yönetilen devir notu; yazılan mesaj not almaz, devir dosyayla ready olur', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await typedTrip($, world, clock)
    await turnEnd($, true)
    expect(await phase($)).toContain('aşama: handoff_running')
    expect([...world.toasts, ...world.logs].some(text => /iptal/i.test(text))).toBe(false)
    // A machine turn gets the (managed, M1) handoff text once.
    await machine($, 'görev bildirimi')
    await turnBegin($)
    expect((await bash($)).context).toEqual([managedHandoff(40, FILE)])
    expect((await bash($)).context ?? []).toEqual([])
    await turnEnd($)
    await machine($, 'görev bildirimi 2')
    await turnBegin($)
    expect((await bash($)).context).toEqual([managedHandoff(40, FILE)])
    expect((await bash($)).context ?? []).toEqual([])
    await turnEnd($)
    // M5 (O12): S8 is skipped in a managed sub-chat: no next-message note, no claim. The
    // pending-message behaviour is the main chat's O7 (T5 A12).
    await typed($, 'şunu yap')
    const last = world.typed.at(-1)
    expect(last?.text).toBe('şunu yap')
    expect(last?.context).toEqual([])
    expect(world.toasts).not.toContain('Devir: yeni sohbet bu mesajınla açılacak.')
    expect(await phase($)).toContain('aşama: handoff_running')
    await turnBegin($)
    writeFile(world, clock)
    expect((await startSession($)).deny).toBe(MANAGED_START_DENY)
    expect(callsOf(world, START)).toHaveLength(0)
    // The turn end with the file written makes it ready (the main chat starts the next one).
    await turnEnd($)
    expect(await phase($)).toContain('aşama: ready')
    expect(getRecord(world, CHILD)).toMatchObject({ status: 'ready', file: FILE })
  })

  test('(V13) /devir dene 5 yalnızca bu oturum; depodaki esik değişmez; dene kaldırır', async ($, on) => {
    const { world, clock } = setup(on)
    seedSecondChild(world)
    world.percent = 3
    await start($)
    expect((await devir($, 'dene 5')).text).toContain('%5')
    // The global key is never written (Decision 22); the chain's esik stays too.
    expect(world.store.esik).toBe(40)
    expect(getChainSettings(world)).toMatchObject({ esik: 40 })
    expect(await phase($)).toContain('Devir: %3 / eşik %5 (bu sohbet)')
    // M10: the managed sub-chat's status carries its prefix.
    expect(world.statuses.at(-1)).toBe(`${CHILD_PREFIX}Devir: %3 / eşik %5 (bu sohbet)`)
    // This chat trips at 5 (fill 10), under the chain's 40.
    await typed($, 'iş')
    await turnBegin($)
    world.percent = 10
    expect((await bash($)).context).toEqual([managedHandoff(5, FILE)])
    await clock.advance(100)
    // Another sub-chat of the same chain keeps the chain's threshold.
    world.sid = 's2'
    expect(await phase($)).toContain('Devir: %10 / eşik %40 · aşama: idle')
    expect(await phase($)).not.toContain('bu sohbet')
    await turnEnd($)
    await typed($, 'iş')
    await turnBegin($)
    expect((await bash($)).context ?? []).toEqual([])
    expect((await devir($, 'dene 7')).text).toContain('%7')
    expect(await phase($)).toContain('eşik %7 (bu sohbet)')
    expect((await devir($, 'dene')).text).toContain('%40')
    expect(await phase($)).toContain('Devir: %10 / eşik %40 · aşama: idle')
    expect(world.store.esik).toBe(40)
    expect((await devir($, 'dene 0')).text).toContain('Kullanım')
    // A normal chat (no chain) keeps its dene too, but does not hand off (normalDeneText).
    world.sid = 's3'
    expect((await devir($, 'dene 9')).text).toBe(normalDeneText(9))
    expect(await phase($)).toBe(NORMAL_INFO)
    expect(world.store.esik).toBe(40)
  })

  describe('(V14) tek seferlik temizlik', () => {
    const TASK_STORE = {
      esik: 40,
      acik: true,
      mod: 'sor',
      depoGoruldu: true,
      'zincir:s0': { x: 1 },
      'hazirlik:s0': { x: 2 },
      [`${HANDED_PREFIX}s0`]: { handoffId: 'h', startedId: 'local_z', file: 'f', at: 1 },
    }
    const TASK_LIST = [
      { taskId: 'otomatik-devir-1a2b3c4d-a' },
      { taskId: 'otomatik-devir-1a2b3c4d-3b' },
      { id: 'otomatik-devir-deadbeef-b' },
      { taskId: 'otomatik-devir-benim-isim' },
      { taskId: 'baska-gorev' },
    ]

    test('(V14) yalnızca OWN_TASK kimliklerini siler, temizlik-v1 koyar, esik/acik kalır', async ($, on) => {
      const { world, clock } = setup(on, TASK_STORE, { tools: [START, GET, TASKS, DELETE], role: 'yok' })
      world.tasks = [...TASK_LIST]
      await start($)
      await clock.advance(500)
      expect(callsOf(world, DELETE).map((c: any) => c.taskId)).toEqual([
        'otomatik-devir-1a2b3c4d-a',
        'otomatik-devir-1a2b3c4d-3b',
        'otomatik-devir-deadbeef-b',
      ])
      expect(world.checks.map((c: any) => [c.tool, c.input])).toEqual([
        [DELETE, { taskId: 'otomatik-devir-1a2b3c4d-a' }],
        [DELETE, { taskId: 'otomatik-devir-1a2b3c4d-3b' }],
        [DELETE, { taskId: 'otomatik-devir-deadbeef-b' }],
      ])
      expect(world.tasks.map(t => t.taskId ?? t.id)).toEqual(['otomatik-devir-benim-isim', 'baska-gorev'])
      expect(world.store[CLEANUP_FLAG]).toMatchObject({ deleted: 3 })
      expect(world.store.esik).toBe(40)
      expect(world.store.acik).toBe(true)
      expect(world.store[`${HANDED_PREFIX}s0`]).toBeDefined()
      for (const key of ['mod', 'depoGoruldu', 'zincir:s0', 'hazirlik:s0', 'temizlik-kilit']) {
        expect(world.store[key]).toBeUndefined()
      }
      // Once: a later session start does nothing more.
      await start($)
      await clock.advance(500)
      expect(callsOf(world, DELETE)).toHaveLength(3)
      expect(callsOf(world, TASKS)).toHaveLength(1)
    })

    test('(V14b) $.tool.check izin vermezse silme yok, bayrak yok', async ($, on) => {
      const { world, clock } = setup(on, TASK_STORE, { tools: [START, GET, TASKS, DELETE], role: 'yok' })
      world.tasks = [...TASK_LIST]
      world.checkDecision = 'ask'
      await start($)
      await clock.advance(500)
      expect(callsOf(world, TASKS)).toHaveLength(1)
      expect(world.checks.map((c: any) => [c.tool, c.input])).toEqual([
        [DELETE, { taskId: 'otomatik-devir-1a2b3c4d-a' }],
      ])
      expect(callsOf(world, DELETE)).toHaveLength(0)
      expect(world.tasks).toHaveLength(TASK_LIST.length)
      expect(world.store[CLEANUP_FLAG]).toBeUndefined()
      expect(world.store.esik).toBe(40)
      expect(world.store.acik).toBe(true)
    })
  })

  test('(V15) yazılan turda yönetilen alt sohbet en çok 2 dosya bloğu (d) alır; tur sonu kapıyı kapalı bırakır', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await typedTrip($, world, clock)
    // M2: no Stop (c) in a managed sub-chat; (d) asks for the file at most MAX_MISSING_BLOCKS (2) times.
    for (let i = 0; i < 2; i += 1) {
      expect((await stop($, [])).block).toBe(fileMissingText(FILE, false))
    }
    expect((await stop($, [])).block).toBeUndefined()
    await turnEnd($)
    expect(await phase($)).toContain('aşama: handoff_running')
    // The gate is closed: a machine turn gets the handoff text, start_session is refused there...
    await machine($, 'görev bildirimi')
    await turnBegin($)
    expect((await bash($)).context).toEqual([managedHandoff(40, FILE)])
    writeFile(world, clock)
    expect((await startSession($)).deny).toBe(MANAGED_START_DENY)
    await turnEnd($)
    // ...and the turn end with the file written makes it ready.
    expect(await phase($)).toContain('aşama: ready')
    // M5: a typed message reopens nothing (no S8 note); start_session stays refused (M3).
    await typed($, 'devam')
    expect(world.typed.at(-1)?.context).toEqual([])
    await turnBegin($)
    expect((await startSession($)).deny).toBe(MANAGED_START_DENY)
    expect(callsOf(world, START)).toHaveLength(0)
  })
})

describe('long-chat note', () => {
  // The engine's own sections beneath the mod: a shared one, then a session one.
  const base = (on: any) =>
    on('prompt.compose', () => ({
      sections: [
        { id: 'intro', text: 'giriş', scope: 'shared' },
        { id: 'env', text: 'ortam', scope: 'session' },
      ],
    }))
  const sections = async ($: any) => (
      await $.prompt.compose({
        model: 'claude-test',
        promptModel: 'claude-test',
        surfaces: ['terminal'],
        tools: [],
        outputStyle: null,
        traits: [],
      })
    ).sections as { id: string; text: string; scope: string }[]

  test('(a) mod açık + idle: son bölüm otomatik-devir, %60 ve /devir simdi içerir', async ($, on) => {
    setup(on, { esik: 60 })
    base(on)
    await start($)
    const got = await sections($)
    // M8: in a managed sub-chat only, id `otomatik-devir:long-chat` (Decision 21b).
    expect(got.map(s => s.id)).toEqual(['intro', 'env', 'otomatik-devir:long-chat'])
    const last = got.at(-1)!
    expect(last.id).toBe(LONG_CHAT_SECTION_ID)
    expect(last.scope).toBe('session')
    expect(last.text).toBe(longChatNote(60))
    expect(last.text).toContain('%60')
    expect(last.text).toContain("%60'a")
    expect(last.text).toContain('/devir simdi')
  })

  test('(b) acik:false: bölüm eklenmez', async ($, on) => {
    setup(on, { esik: 60, acik: false })
    base(on)
    await start($)
    expect((await sections($)).map(s => s.id)).toEqual(['intro', 'env'])
  })

  test('(c) aşama done: bölüm eklenmez', async ($, on) => {
    const { world, clock } = setup(on, { esik: 60 })
    base(on)
    await start($)
    expect((await sections($)).at(-1)?.id).toBe(LONG_CHAT_SECTION_ID)
    world.percent = 30
    await typed($, 'iş')
    await turnBegin($)
    world.percent = 70
    await bash($)
    writeFile(world, clock)
    // A managed sub-chat writes its file only (M3); the Stop makes it ready and the main
    // chat's next child consumes it (M6, O15): done.
    expect((await startSession($)).deny).toBe(MANAGED_START_DENY)
    expect((await stop($, [])).block).toBeUndefined()
    parentMovesOn(world)
    expect(await phase($)).toContain('aşama: done')
    expect((await sections($)).map(s => s.id)).toEqual(['intro', 'env'])
  })

  test('(d) dene 15: metin %15 içerir', async ($, on) => {
    setup(on, { esik: 60 })
    base(on)
    await start($)
    await devir($, 'dene 15')
    const text = (await sections($)).at(-1)!.text
    expect(text).toContain('%15')
    expect(text).not.toContain('%60')
  })
})

// T8 review: Spec items the V-tests left unchecked, and the fixes of review-1.md.
describe('T8 review', () => {
  /** A machine-turn trip, the file written, the Stop: phase `ready`. */
  const toReady = async ($: any, world: any, clock: any) => {
    await machine($, 'görev bildirimi')
    await turnBegin($)
    world.percent = 50
    await bash($)
    await clock.advance(100)
    writeFile(world, clock)
    await stop($, [])
    await turnEnd($)
    expect(await phase($)).toContain('aşama: ready')
  }
  const mountBand = ($: any, props: Record<string, unknown> = {}) =>
    $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: { ...BAND, ...props } } as any)
  const bandText = async (ui: any) => JSON.stringify(await ui.drawn())

  test('(R1, S11 fix) görev araçları yokken bayrak konmaz; araçlar bağlanınca aynı oturum yeniden dener', async ($, on) => {
    const tools = [START, GET]
    const { world, clock } = setup(on, { esik: 40, mod: 'sor', 'zincir:s0': { x: 1 } }, { tools, role: 'yok' })
    world.tasks = [{ taskId: 'otomatik-devir-1a2b3c4d-a' }, { taskId: 'baska-gorev' }]
    await start($)
    await clock.advance(500)
    // Store keys go at once; nothing could be listed, so no flag and no lock left.
    expect(world.store.mod).toBeUndefined()
    expect(world.store['zincir:s0']).toBeUndefined()
    expect(world.store[CLEANUP_FLAG]).toBeUndefined()
    expect(world.store['temizlik-kilit']).toBeUndefined()
    expect(callsOf(world, TASKS)).toHaveLength(0)
    // The MCP connects later: the retry a minute on deletes the task and sets the flag.
    tools.push(TASKS, DELETE)
    await clock.advance(60_000)
    expect(callsOf(world, DELETE).map((c: any) => c.taskId)).toEqual(['otomatik-devir-1a2b3c4d-a'])
    expect(world.store[CLEANUP_FLAG]).toMatchObject({ deleted: 1 })
    expect(world.store.esik).toBe(40)
  })

  test('(R2, S6) yönetilen alt sohbette start_session reddedilir (isError bile denenmez); Stop ready yapar, START_NOW yok', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await typedTrip($, world, clock)
    writeFile(world, clock)
    world.startMode = 'error'
    // M3 (O13): the refusal is the mod's own, before the app is reached.
    expect((await startSession($)).deny).toBe(MANAGED_START_DENY)
    expect(callsOf(world, START)).toHaveLength(0)
    expect(world.store[`${HANDED_PREFIX}s1`]).toBeUndefined()
    const after = await stop($, [])
    expect(after.block).toBeUndefined()
    expect(await phase($)).toContain('aşama: ready')
  })

  test('(R3, S6 fix) yönetilen alt sohbette hata fırlatacak start_session da reddedilir: starting kalmaz, kapı kapalı, ana sohbet sıradakini açınca done', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await typedTrip($, world, clock)
    writeFile(world, clock)
    world.startMode = 'throw'
    const got: any = await startSession($).catch((error: unknown) => ({ thrown: error }))
    // M3 (O13): denied before the app is reached, so nothing throws.
    expect(got.deny).toBe(MANAGED_START_DENY)
    expect(world.store[`${HANDED_PREFIX}s1`]).toBeUndefined()
    // Gate closed: the Stop makes it ready instead of asking for another start (START_NOW).
    expect((await stop($, [])).block).toBeUndefined()
    expect(await phase($)).toContain('aşama: ready')
    // The next typed message starts nothing here either (M3, M5).
    world.startMode = 'ok'
    await typed($, 'devam')
    await turnBegin($)
    expect((await startSession($)).deny).toBe(MANAGED_START_DENY)
    expect(callsOf(world, START)).toHaveLength(0)
    // M6 (O15): the main chat starts the next child from the file; this one is done.
    parentMovesOn(world)
    expect(await phase($)).toContain('aşama: done')
  })

  test('(R4, S7c) yazılan turda dosya hazırsa yönetilen alt sohbette Stop START_NOW ile tutmaz: (d) ready yapar', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await typedTrip($, world, clock)
    writeFile(world, clock)
    // M2: Stop (c) does not run in a managed sub-chat; (d) with a fresh file → ready.
    const got = await stop($, [])
    expect(got.block).toBeUndefined()
    expect(got.block).not.toBe(START_NOW)
    expect(await phase($)).toContain('aşama: ready')
  })

  test('(R5, S8) yönetilen alt sohbette yazılan mesaj (düşürülen ya da geçen) ready aşamasını değiştirmez', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await toReady($, world, clock)
    world.dropNext = 'başka mod düşürdü'
    await typed($, 'şunu yap')
    expect(await phase($)).toContain('aşama: ready')
    expect(world.store[`${RUN_PREFIX}s1`]).toMatchObject({ phase: 'ready' })
    // M5 (O12): S8 is skipped in a managed sub-chat: no note, no claim (the main chat's O7, T5 A12).
    await typed($, 'şunu yap')
    expect(world.typed.at(-1)?.context).toEqual([])
    expect(await phase($)).toContain('aşama: ready')
  })

  test('(R6, S2) depodaki devir:<sid> kapı kapalı geri yüklenir', async ($, on) => {
    const { world } = setup(on, {
      esik: 40,
      [`${RUN_PREFIX}s1`]: { handoffId: 's1-x', file: FILE, handoffAt: NOW - 10, phase: 'handoff_running' },
    })
    await start($)
    expect(await phase($)).toContain('aşama: handoff_running')
    // Closed gate: a machine turn gets the (managed, M1) handoff text; a typed message no note (M5).
    await machine($, 'görev bildirimi')
    await turnBegin($)
    expect((await bash($)).context).toEqual([managedHandoff(40, FILE)])
    await turnEnd($)
    await typed($, 'devam')
    expect(world.typed.at(-1)?.context).toEqual([])
  })

  test('(R7, S1) devirde durum satırı: N alt ajan bitiyor; ready iken Devir hazır', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    world.agents = [{ id: 'a1', description: 'araştır', type: 'general-purpose', status: 'running' }]
    await typedTrip($, world, clock)
    expect(await phase($)).toContain('Devir: 1 alt ajan bitiyor')
    world.agents = []
    expect(await phase($)).toContain('Devir: %50 / eşik %40')
  })

  test('(R8, S4/S10) ready iken drain sürer; hazır bandı yönetilen alt sohbette hiç çizilmez', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    const idle = await mountBand($)
    expect(await bandText(idle)).not.toContain(READY_BAND)
    await idle.unmount()
    await toReady($, world, clock)
    expect((await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'y' } as any)).deny).toBe(DRAIN_DENY)
    expect((await $.tool.call({ tool: 'Workflow', script: 'x' } as any)).deny).toBe(DRAIN_DENY)
    const working = await mountBand($, { isWorking: true })
    expect(await bandText(working)).not.toContain(READY_BAND)
    expect(await bandText(working)).toContain('"below"')
    await working.unmount()
    // M4 (O12): idle and not working, a managed sub-chat still draws no ready band.
    const shown = await mountBand($)
    expect(await bandText(shown)).not.toContain(READY_BAND)
    expect(await bandText(shown)).toContain('"below"')
    await shown.unmount()
  })

  test('(R9, S4) koruma kancası hata verirse .catch drain sırasında yine reddeder', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await typedTrip($, world, clock)
    world.failSid = true
    expect((await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'y' } as any)).deny).toBe(DRAIN_DENY)
    const spawned: any = await $.agent.spawn({
      tool_use_id: 'tu-x',
      prompt: 'x',
      description: 'x',
      subagentType: 'general-purpose',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: true,
      fork: false,
    } as any)
    expect(spawned.deny).toBe(DRAIN_DENY)
    expect(callsOf(world, 'Agent')).toHaveLength(0)
    expect(world.spawns).toHaveLength(0)
    // A tool outside the drain set still runs.
    expect((await bash($)).deny).toBeUndefined()
  })
})

// T15 (Decision 16): the model's own my-skill-handoff call is refused while the mod is on.
describe('skill handoff deny', () => {
  const skill = ($: any, args?: string, name = SKILL) =>
    $.tool.call({ tool: 'Skill', skill: name, ...(args === undefined ? {} : { args }) })

  test('(a) açık + idle + yazılan istem "devam et": Skill my-skill-handoff reddedilir', async ($, on) => {
    const { world } = setup(on)
    await start($)
    await typed($, 'devam et')
    const got = await skill($)
    expect(got.deny).toBe(SKILL_HANDOFF_DENY)
    expect(callsOf(world, 'Skill')).toHaveLength(0)
    // The plugin-qualified name is the same skill.
    expect((await skill($, undefined, `my-skills:${SKILL}`)).deny).toBe(SKILL_HANDOFF_DENY)
  })

  test('(b) yazılan istem "handoff yap": geçer', async ($, on) => {
    const { world } = setup(on)
    await start($)
    await typed($, 'devam et')
    await typed($, 'handoff yap')
    expect((await skill($)).deny).toBeUndefined()
    expect(callsOf(world, 'Skill')).toHaveLength(1)
  })

  test('(c) args `auto /x.md`: geçer (modun kendi çağrısı)', async ($, on) => {
    const { world } = setup(on)
    await start($)
    await typed($, 'devam et')
    expect((await skill($, 'auto /x.md')).deny).toBeUndefined()
    expect(callsOf(world, 'Skill')).toHaveLength(1)
  })

  test('(d) acik:false: geçer', async ($, on) => {
    const { world } = setup(on, { esik: 40, acik: false })
    await start($)
    await typed($, 'devam et')
    expect((await skill($)).deny).toBeUndefined()
    expect(callsOf(world, 'Skill')).toHaveLength(1)
  })

  test('(e) başka beceriler geçer', async ($, on) => {
    const { world } = setup(on)
    await start($)
    await typed($, 'devam et')
    expect((await skill($, undefined, 'my-skill-audit')).deny).toBeUndefined()
    expect((await skill($, undefined, 'my-skill-handoff-notes')).deny).toBeUndefined()
    expect(callsOf(world, 'Skill')).toHaveLength(2)
  })
})

// v1.0.1 hotfix: (A) /devir kapat cancels the handoff, (B) the Stop guard holds
// only during a handoff, (C) the child reads only the per-session handoff file.
describe('v1.0.1 hotfix', () => {
  const spawn = ($: any, description: string) =>
    $.agent.spawn({
      tool_use_id: `tu-${description}`,
      prompt: 'x',
      description,
      subagentType: 'general-purpose',
      provider: { plugin: 'engine', tier: 'core' },
      parentModel: 'claude-opus-5-5',
      background: true,
      fork: false,
    } as any)
  const mountBand = ($: any) =>
    $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND } as any)
  /** A machine-turn trip, the file written, the Stop: phase `ready`. */
  const toReady = async ($: any, world: any, clock: any) => {
    await machine($, 'görev bildirimi')
    await turnBegin($)
    world.percent = 50
    await bash($)
    await clock.advance(100)
    writeFile(world, clock)
    await stop($, [])
    await turnEnd($)
    expect(await phase($)).toContain('aşama: ready')
  }

  test('(A1) devir sürerken /devir kapat: devir iptal, devir:<sid> silinir, Agent/Workflow/spawn/Stop serbest', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await typedTrip($, world, clock)
    writeFile(world, clock)
    expect(world.store[`${RUN_PREFIX}s1`]).toMatchObject({ phase: 'handoff_running' })
    expect((await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'y' } as any)).deny).toBe(DRAIN_DENY)

    const reply = (await devir($, 'kapat')).text as string
    expect(reply).toContain('kapatıldı')
    expect(reply).toContain('süren devri iptal edildi')
    // M7: the reply names the chain stop (O21).
    expect(reply.endsWith(` ${KAPAT_CHAIN}`)).toBe(true)
    // M11: the chain's settings are closed; the global key is never written.
    expect(getChainSettings(world)).toMatchObject({ isClosed: true })
    expect(world.store.acik).toBeUndefined()
    expect(world.store[`${RUN_PREFIX}s1`]).toBeUndefined()
    expect(world.store[`${HANDED_PREFIX}s1`]).toBeUndefined()
    // M7 (O21): the cancelled sub-chat keeps role `alt` (its status prefix); its record is `cancelled`.
    expect(await phase($)).toContain('aşama: idle')
    expect(await phase($)).toContain(CHILD_PREFIX)
    expect(getRecord(world, CHILD)).toMatchObject({ role: 'alt', status: 'cancelled' })
    expect(getRecord(world, CHILD)?.file).toBeUndefined()
    expect(world.statuses.at(-1)).toBe(`${CHILD_PREFIX}Devir: kapalı`)
    // The file already written stays.
    expect(world.files[FILE]).toBeDefined()

    expect((await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'y' } as any)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Workflow', script: 'x' } as any)).deny).toBeUndefined()
    expect(callsOf(world, 'Agent')).toHaveLength(1)
    expect(callsOf(world, 'Workflow')).toHaveLength(1)
    expect(((await spawn($, 'sonra')) as any).deny).toBeUndefined()
    expect((await stop($, [SUBAGENT])).block).toBeUndefined()
    expect((await stop($, [])).block).toBeUndefined()
    // M3 (O13): no handoff, yet a managed sub-chat's start_session stays refused; no handed-off flag.
    expect((await startSession($)).deny).toBe(MANAGED_START_DENY)
    expect(callsOf(world, START)).toHaveLength(0)
    expect(world.store[`${HANDED_PREFIX}s1`]).toBeUndefined()
    // No handoff starts above the threshold while off.
    expect((await bash($)).context ?? []).toEqual([])
    expect(await phase($)).toContain('aşama: idle')
  })

  test('(A2) ready iken /devir kapat: hazır devir iptal, bant çizilmez, drain kalkar', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await toReady($, world, clock)
    const reply = (await devir($, 'kapat')).text as string
    expect(reply).toContain('hazır devri iptal edildi')
    // M7 (O21): the chain stop text; the sub-chat keeps role `alt`, its record `cancelled`.
    expect(reply.endsWith(` ${KAPAT_CHAIN}`)).toBe(true)
    expect(getRecord(world, CHILD)).toMatchObject({ role: 'alt', status: 'cancelled' })
    expect(await phase($)).toContain(`${CHILD_PREFIX}Devir: kapalı · aşama: idle`)
    expect(world.store[`${RUN_PREFIX}s1`]).toBeUndefined()
    await clock.advance(100)
    const ui = await mountBand($)
    expect(JSON.stringify(await ui.drawn())).not.toContain(READY_BAND)
    await ui.unmount()
    expect((await $.tool.call({ tool: 'Workflow', script: 'x' } as any)).deny).toBeUndefined()
    // The next typed message is not a handoff message.
    await typed($, 'şunu yap')
    expect(world.typed.at(-1)?.context).toEqual([])
  })

  test('(A3) zincir başka sohbette kapatılınca (/devir kapat) bu alt sohbet devrini bir sonraki olayında bırakır', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await toReady($, world, clock)
    // M4: a managed sub-chat draws no ready band at all.
    const shown = await mountBand($)
    expect(JSON.stringify(await shown.drawn())).not.toContain(READY_BAND)
    await shown.unmount()
    // M11: another chat of the chain runs /devir kapat: only the chain's settings change.
    putChainSettings(world, { esik: 40, isClosed: true, at: NOW })
    // The band is gone even before this chat's next hook drops the handoff.
    const ui = await mountBand($)
    expect(JSON.stringify(await ui.drawn())).not.toContain(READY_BAND)
    await ui.unmount()
    expect(world.store[`${RUN_PREFIX}s1`]).toMatchObject({ phase: 'ready' })
    // The next hook event (here an Agent call) drops it.
    expect((await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'y' } as any)).deny).toBeUndefined()
    expect(world.store[`${RUN_PREFIX}s1`]).toBeUndefined()
    await clock.advance(100)
    expect(world.toasts).toContain('Otomatik devir kapalı: bu sohbetin devri iptal edildi.')
    expect(await phase($)).toContain('aşama: idle')
    // O21: the cancelled drain is recorded, so the main chat never relays it.
    expect(getRecord(world, CHILD)).toMatchObject({ role: 'alt', status: 'cancelled' })
  })

  test('(A4) yeniden yüklemede zincir kapalıysa depodaki devir:<sid> geri gelmez; devredildi kalır', async ($, on) => {
    const { world } = setup(on, {
      esik: 40,
      acik: false,
      [`${RUN_PREFIX}s1`]: { handoffId: 's1-x', file: FILE, handoffAt: NOW - 10, phase: 'handoff_running' },
      [`${HANDED_PREFIX}s2`]: { handoffId: 's2-x', startedId: 'local_old', file: 'f', at: 1 },
    })
    // M11: `acik: false` is this chain's `isClosed`; s2 is another sub-chat of the chain.
    seedSecondChild(world)
    await start($)
    expect(await phase($)).toContain('aşama: idle')
    expect(world.store[`${RUN_PREFIX}s1`]).toBeUndefined()
    expect(((await spawn($, 'sonra')) as any).deny).toBeUndefined()
    // A finished handoff is not undone, by the mod off nor by /devir kapat.
    world.sid = 's2'
    expect(await phase($)).toContain('aşama: done')
    expect((await devir($, 'kapat')).text).toBe(`Otomatik devir kapatıldı. ${KAPAT_CHAIN}`)
    expect(world.store[`${HANDED_PREFIX}s2`]).toBeDefined()
    expect(await phase($)).toContain('aşama: done')
  })

  test('(B1) devir yokken çalışan alt ajan/Workflow Stop\'u tutmaz', async ($, on) => {
    const { world } = setup(on)
    await start($)
    await typed($, 'iş')
    await turnBegin($)
    expect((await stop($, [SUBAGENT, WORKFLOW])).block).toBeUndefined()
    world.agents = [{ id: 'a7', description: 'yaz', type: 'general-purpose', status: 'running' }]
    expect((await $.classic.Stop({ stop_hook_active: false } as any)).block).toBeUndefined()
    expect(await phase($)).toContain('aşama: idle')
  })

  test('(B2) devir sürerken (handoff_running) çalışan iş Stop\'u yine tutar; ready tutmaz', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    const running = [{ id: 'a1', description: 'araştır' }]
    // `handoff_running`: the running work holds the turn end.
    await machine($, 'görev bildirimi')
    await turnBegin($)
    world.percent = 50
    await bash($)
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: handoff_running')
    expect((await stop($, [SUBAGENT])).block).toBe(waitText(running))
    writeFile(world, clock)
    expect((await stop($, [])).block).toBeUndefined()
    await turnEnd($)
    // `ready`: the file is written and the main chat starts the next sub-chat from it.
    expect(await phase($)).toContain('aşama: ready')
    expect((await stop($, [SUBAGENT])).block).toBeUndefined()
    world.agents = [{ id: 'a7', description: 'yaz', type: 'general-purpose', status: 'running' }]
    expect((await $.classic.Stop({ stop_hook_active: false } as any)).block).toBeUndefined()
    world.agents = []
    expect(await phase($)).toContain('aşama: ready')
    // M5: a typed message does not make a managed sub-chat `handoff_running` again (no S8),
    // so its running work still does not hold the turn end.
    await typed($, 'devam')
    await turnBegin($)
    expect(await phase($)).toContain('aşama: ready')
    expect((await stop($, [SUBAGENT])).block).toBeUndefined()
  })

  test('(B3) 30 dk zaman aşımından sonra ready olan devir, sonraki makine turlarını beklemede tutmaz', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await machine($, 'görev bildirimi')
    await turnBegin($)
    world.percent = 50
    await bash($)
    await clock.advance(100)
    writeFile(world, clock)
    const running = [{ id: 'a1', description: 'araştır' }]
    expect((await stop($, [SUBAGENT])).block).toBe(waitText(running))
    await clock.advance(DRAIN_TIMEOUT_MS)
    expect((await stop($, [SUBAGENT])).block).toBe(timeoutText(running))
    expect((await stop($, [SUBAGENT])).block).toBe(timeoutText(running))
    // Third: the work no longer holds the turn; the written file makes it `ready`.
    expect((await stop($, [SUBAGENT])).block).toBeUndefined()
    await turnEnd($)
    expect(await phase($)).toContain('aşama: ready')
    // The agent was never stopped: a later machine turn ends instead of waiting with no end.
    await machine($, 'görev bildirimi 2')
    await turnBegin($)
    expect((await stop($, [SUBAGENT])).block).toBeUndefined()
    expect((await stop($, [SUBAGENT])).block).toBeUndefined()
    expect(await phase($)).toContain('aşama: ready')
  })

  test('(C1) devir talimatları ve yeni sohbetin promptu HANDOFF.md/STATE.md anmaz; yalnızca devir dosyası', async ($, on) => {
    const texts = [
      inTurnHandoff(40, FILE),
      inTurnHandoff(40, FILE, false),
      closedTurnHandoff(40, FILE),
      closedTurnHandoff(40, FILE, false),
      nextMessageNote(FILE, false),
      nextMessageNote(FILE, false, false),
      nextMessageNote(FILE, true),
      fileMissingText(FILE, true),
      fileMissingText(FILE, false),
      START_NOW,
      managedHandoff(40, FILE),
      managedHandoff(40, FILE, false),
      MANAGED_START_DENY,
    ]
    for (const text of texts) {
      expect(text).not.toContain('HANDOFF.md')
      expect(text).not.toContain('STATE.md')
    }
    // Both writers (the skill's auto mode and the fallback) say the child reads only this file.
    for (const text of [
      inTurnHandoff(40, FILE),
      inTurnHandoff(40, FILE, false),
      fileMissingText(FILE, true),
      managedHandoff(40, FILE),
      managedHandoff(40, FILE, false),
    ]) {
      expect(text).toContain(`yalnızca ${FILE} dosyasını okumasını`)
    }
    // A managed sub-chat: the instruction it gets and the refusal of its own start name
    // only the handoff file. The next child's first prompt (the file plus the message, the
    // mod's own background) is built by the main chat's O4 (T5 A7/A10).
    const { world, clock } = setup(on)
    await start($)
    const got = await typedTrip($, world, clock)
    expect(got.context).toEqual([managedHandoff(40, FILE)])
    writeFile(world, clock)
    const refused = await startSession($)
    expect(refused.deny).toBe(MANAGED_START_DENY)
    expect(callsOf(world, START)).toHaveLength(0)
    for (const text of [got.context?.[0], refused.deny]) {
      expect(text).not.toContain('HANDOFF.md')
      expect(text).not.toContain('STATE.md')
    }
  })
})
