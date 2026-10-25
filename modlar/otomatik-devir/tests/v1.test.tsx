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
  MAX_HANDOFF_BLOCKS,
  nextMessageNote,
  READY_BAND,
  RUN_PREFIX,
  timeoutText,
  waitText,
} from '../hooks/register.tsx'

// v1.0 Spec (S1-S11) tests, one per id V1-V15 (probe: RESULT M, turn.complete PER-TURN,
// so V16/V17 do not apply).

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

/**
 * The world beneath the mod (the trimmed v0.5 setup): a session whose id, fill,
 * subagents and handoff files the test controls, the store open to the test.
 */
const setup = (
  on: any,
  store: Record<string, unknown> = { esik: 40 },
  opts: { tools?: string[]; commands?: string[] } = {},
) => {
  const { tools = [START, GET, DETACH, HAND_OFF], commands = [SKILL] } = opts
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
  }
  const clock = mock.clock(on, { now: NOW })
  const clone = (value: unknown) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
  Object.assign(world.store, clone(store))
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
  on('session.id', () => ({ value: world.sid }))
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
      return { result: [], text: JSON.stringify({ sessionId: 'local_self', title: 'Eski iş' }) }
    }
    if (e.tool === START) {
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
  on('prompt.submit', ($: any, e: any) => {
    world.typed.push({ text: e.text, context: e.context ?? [] })
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
  test('(V1) çalışan alt ajan ya da Workflow turu tutar; yalnızca shell/monitor tutmaz', async ($, on) => {
    const { world } = setup(on)
    await start($)
    await typed($, 'iş')
    await turnBegin($)
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
    expect((await stop($, [SHELL, MONITOR])).block).toBeUndefined()
    // A finished or waiting subagent is not waited on (Decision 15).
    expect((await stop($, [{ ...SUBAGENT, status: 'completed' }, { ...SUBAGENT, id: 'a2', status: 'waiting' }])).block).toBeUndefined()
    // No background_tasks in the hook: $.agent.list() decides.
    world.agents = [{ id: 'a7', description: 'yaz', type: 'general-purpose', status: 'running' }]
    expect((await $.classic.Stop({ stop_hook_active: false } as any)).block).toBe(
      waitText([{ id: 'a7', description: 'yaz' }]),
    )
    world.agents = [{ id: 'a7', description: 'yaz', type: 'general-purpose', status: 'waiting' }]
    expect((await $.classic.Stop({ stop_hook_active: false } as any)).block).toBeUndefined()
    expect(await phase($)).toContain('aşama: idle')
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
    expect(got.context).toEqual([inTurnHandoff(40, FILE)])
    expect(got.context?.[0]).toContain(`auto ${FILE}`)
    expect(got.context?.[0]).toContain(START)
    expect(got.context?.[0]).toContain('initiation "user_asked"')
    expect(got.context?.[0]).toContain('context "fresh"')
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
    expect(got.block).toBe(inTurnHandoff(40, FILE))
    expect(await phase($)).toContain('aşama: handoff_running')
    expect(world.store[`${RUN_PREFIX}s1`]).toMatchObject({ phase: 'handoff_running', file: FILE })
  })

  test('(V8) start_session: dosya yoksa ret; taze dosyayla iletilir, ayrılmaz; ikinci kez ret', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await typedTrip($, world, clock)
    const missing = await startSession($)
    expect(missing.deny).toBe(`otomatik-devir: önce devir dosyasını yaz: ${FILE}`)
    expect(callsOf(world, START)).toHaveLength(0)
    // A file older than this handoff is not fresh.
    world.files[FILE] = { text: HANDOFF_TEXT, mtimeMs: NOW - 1 }
    expect((await startSession($)).deny).toBe(`otomatik-devir: önce devir dosyasını yaz: ${FILE}`)
    writeFile(world, clock)
    const got = await startSession($)
    expect(got.deny).toBeUndefined()
    const [sent] = callsOf(world, START)
    expect(callsOf(world, START)).toHaveLength(1)
    expect(sent.prompt).toBe(HANDOFF_TEXT)
    expect(sent.context).toBe('fresh')
    expect(sent.initiation).toBe('user_asked')
    expect(sent.title).toBe('Eski iş (devam)')
    expect(sent.background.length).toBeGreaterThanOrEqual(80)
    expect(callsOf(world, DETACH)).toHaveLength(0)
    await clock.advance(100)
    expect(callsOf(world, DETACH)).toHaveLength(0)
    expect(world.store[`${HANDED_PREFIX}s1`]).toMatchObject({
      handoffId: `s1-${NOW.toString(36)}`,
      startedId: NEW_ID,
      file: FILE,
    })
    expect(world.store[`${RUN_PREFIX}s1`]).toBeUndefined()
    expect(world.toasts).toContain('Devam yeni sohbette: Eski iş (devam)')
    expect(await phase($)).toContain('aşama: done')
    const again = await startSession($)
    expect(String(again.deny)).toContain('zaten devredildi')
    expect(String(again.deny)).toContain(NEW_ID)
    expect(callsOf(world, START)).toHaveLength(1)
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
    expect(third).toBe(fileMissingText(FILE, true))
  })

  test('(V11) makine turunda tetik: kapalı tur metni, start_session ret, dosyayla ready ve bant', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await machine($, 'görev bildirimi')
    await turnBegin($)
    world.percent = 50
    const got = await bash($)
    expect(got.context).toEqual([closedTurnHandoff(40, FILE)])
    expect(got.context?.[0]).toContain(FILE)
    expect(got.context?.[0]).toContain('çağırma')
    expect(got.context?.[0]).not.toContain('user_asked')
    await clock.advance(100)
    const refused = await startSession($)
    expect(String(refused.deny)).toContain('kullanıcının yazdığı bir tur değil')
    expect(callsOf(world, START)).toHaveLength(0)
    // Without the file the Stop asks for it (closed gate).
    expect((await stop($, [])).block).toBe(fileMissingText(FILE, false))
    writeFile(world, clock)
    expect((await stop($, [])).block).toBeUndefined()
    expect(await phase($)).toContain('aşama: ready')
    expect(world.store[`${RUN_PREFIX}s1`]).toMatchObject({ phase: 'ready' })
    expect(world.toasts).toContain(READY_BAND)
    expect(world.statuses.at(-1)).toBe('Devir hazır')
    const ui = await $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND } as any)
    const texts = await ui.findAll({ type: 'Text' })
    expect(texts.map((t: any) => t.text ?? t.props?.children)).toContain(READY_BAND)
    const drawn: any = await ui.drawn()
    expect(JSON.stringify(drawn)).toContain(READY_BAND)
    expect(JSON.stringify(drawn)).toContain('"below"')
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    await ui.unmount()
  })

  test('(V12) Esc: iptal yok, makine turu başına bir kapalı not, yazılan mesaj notu ve prompt\'a eklenir', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await typedTrip($, world, clock)
    await turnEnd($, true)
    expect(await phase($)).toContain('aşama: handoff_running')
    expect([...world.toasts, ...world.logs].some(text => /iptal/i.test(text))).toBe(false)
    // A machine turn gets the closed-turn text once.
    await machine($, 'görev bildirimi')
    await turnBegin($)
    expect((await bash($)).context).toEqual([closedTurnHandoff(40, FILE)])
    expect((await bash($)).context ?? []).toEqual([])
    await turnEnd($)
    await machine($, 'görev bildirimi 2')
    await turnBegin($)
    expect((await bash($)).context).toEqual([closedTurnHandoff(40, FILE)])
    expect((await bash($)).context ?? []).toEqual([])
    await turnEnd($)
    // The person's message carries the next-message note and opens the child.
    await typed($, 'şunu yap')
    const last = world.typed.at(-1)
    expect(last?.text).toBe('şunu yap')
    expect(last?.context).toEqual([nextMessageNote(FILE, false)])
    expect(last?.context?.[0]).toContain('YAPMA')
    await turnBegin($)
    writeFile(world, clock)
    expect((await startSession($)).deny).toBeUndefined()
    const [sent] = callsOf(world, START)
    expect(sent.prompt).toBe(`${HANDOFF_TEXT}\n\n## Kullanıcının son mesajı (yeni sohbetin ilk işi)\nşunu yap`)
    expect(await phase($)).toContain('aşama: done')
  })

  test('(V13) /devir dene 5 yalnızca bu oturum; depodaki esik değişmez; dene kaldırır', async ($, on) => {
    const { world, clock } = setup(on)
    world.percent = 3
    await start($)
    expect((await devir($, 'dene 5')).text).toContain('%5')
    expect(world.store.esik).toBe(40)
    expect(await phase($)).toContain('Devir: %3 / eşik %5 (bu sohbet)')
    expect(world.statuses.at(-1)).toBe('Devir: %3 / eşik %5 (bu sohbet)')
    // This chat trips at 5 (fill 10), under the global 40.
    await typed($, 'iş')
    await turnBegin($)
    world.percent = 10
    expect((await bash($)).context).toEqual([inTurnHandoff(5, FILE)])
    await clock.advance(100)
    // Another session keeps the global threshold.
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
      const { world, clock } = setup(on, TASK_STORE, { tools: [START, GET, TASKS, DELETE] })
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
      const { world, clock } = setup(on, TASK_STORE, { tools: [START, GET, TASKS, DELETE] })
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

  test('(V15) yazılan turda en çok 4 devir bloğu; tur sonu kapıyı kapatır', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await typedTrip($, world, clock)
    for (let i = 0; i < MAX_HANDOFF_BLOCKS; i += 1) {
      expect((await stop($, [])).block).toBe(fileMissingText(FILE, true))
    }
    expect((await stop($, [])).block).toBeUndefined()
    await turnEnd($)
    expect(await phase($)).toContain('aşama: handoff_running')
    // The gate is closed: a machine turn gets the closed-turn text, start_session is refused there...
    await machine($, 'görev bildirimi')
    await turnBegin($)
    expect((await bash($)).context).toEqual([closedTurnHandoff(40, FILE)])
    writeFile(world, clock)
    expect(String((await startSession($)).deny)).toContain('kullanıcının yazdığı bir tur değil')
    await turnEnd($)
    // ...and the turn end with the file written makes it ready.
    expect(await phase($)).toContain('aşama: ready')
    // A typed message then reopens the gate with the file ready.
    await typed($, 'devam')
    expect(world.typed.at(-1)?.context).toEqual([nextMessageNote(FILE, true)])
    await turnBegin($)
    expect((await startSession($)).deny).toBeUndefined()
    expect(callsOf(world, START)).toHaveLength(1)
  })
})
