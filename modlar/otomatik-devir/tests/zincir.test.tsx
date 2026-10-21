import { describe, expect, mock, test } from 'claude-code/testing'

import {
  BOOTSTRAP_PROMPT,
  CHAIN_WAIT_NOTE,
  chainMessage,
  gatedHandoff,
  OWN_DISPATCH_NOTE,
  provisionRequest,
  RELAY_NOTE,
  RELAYED_LINE,
  runChatHandoff,
  savedFrom,
  scheduledHandoff,
  scheduledPlan,
  SETUP_HINT,
  SETUP_OFF_HINT,
  setupFailHint,
  syncText,
  taskPrompt,
} from '../hooks/register.tsx'

// v0.5 endless chain: own dispatch, relay, bootstrap, pre-provisioning.

const SKILL = 'my-skill-handoff'
const START = 'mcp__ccd_session__start_session'
const GATE = 'mcp__ccd_session__list_start_targets'
const HAND_OFF = 'mcp__ccd_session__hand_off_to_session'
const GET = 'mcp__ccd_session_mgmt__get_session'
const DETACH = 'mcp__ccd_session_mgmt__detach_session'
const LIST = 'mcp__ccd_session_mgmt__list_sessions'
const SEND = 'mcp__ccd_session_mgmt__send_message'
const SET_EFFORT = 'mcp__ccd_session_mgmt__set_session_effort'
const SET_MODEL = 'mcp__ccd_session_mgmt__set_session_model'
const SET_PERMISSION = 'mcp__ccd_session_mgmt__set_session_permission_mode'
const CREATE = 'mcp__scheduled-tasks__create_scheduled_task'
const RUN = 'mcp__scheduled-tasks__run_scheduled_task'
const UPDATE = 'mcp__scheduled-tasks__update_scheduled_task'
const DELETE = 'mcp__scheduled-tasks__delete_scheduled_task'
const TASKS = 'mcp__scheduled-tasks__list_scheduled_tasks'
const RUNS = 'mcp__scheduled-tasks__list_task_runs'
const CHAIN_TOOLS = [
  START, GATE, HAND_OFF, GET, DETACH, LIST, SEND, SET_EFFORT, SET_MODEL, SET_PERMISSION,
  CREATE, RUN, UPDATE, DELETE, TASKS, RUNS,
]
const NOT_SAVED =
  "Created task. This session's permission mode was not saved with this task: its runs start in the default mode."
const SAVED = "Created task. This session's permission mode (Bypass permissions) was saved with this task."
// The app's own wording (v0.5 live check, 2026-10-19; the log keeps the
// saved sentence up to its "…"). The Auto one is the same sentence with the
// Auto mode's name (inferred: no live Auto create was logged).
const SAVED_LIVE =
  'This task was saved in Bypass permissions mode because this session is in it: its runs use tools and connectors without asking first…'
const SAVED_AUTO = 'This task was saved in Auto mode because this session is in it'
const NOT_SAVED_LIVE = "This session's permission mode was not saved with this task"
// The app's refusal of the gate in an unattended run (live check, verbatim).
const UNATTENDED =
  'Starting sessions requires a user at the keyboard; this session runs unattended (scheduled or remotely dispatched).'

const PLAN = scheduledPlan('/proj')
const FILE = PLAN.file
const PAIR1 = scheduledPlan('/proj', 1).ids
const PAIR2 = scheduledPlan('/proj', 2).ids
const HASH = PAIR1[0].split('-')[2]
const PAIR_KEY = `zincir:${HASH}`
const SELF = { effort: 'high', model: 'claude-opus-5-5', permissionMode: 'bypassPermissions' }
const RUN_INFO = { effort: 'medium', model: 'claude-sonnet-4-5' }
// A pair whose create said the mode was saved: the only kind a hop uses (review H1).
const READY = { [PAIR_KEY]: { gen: 1, ids: [...PAIR1], savedMode: 'bypassPermissions', model: 'claude-opus-5-5' } }

const setup = (on: any, store: Record<string, unknown>) => {
  const world = {
    sid: 's1',
    percent: 50 as number | undefined,
    self: { ...SELF } as Record<string, unknown>,
    calls: [] as any[],
    sent: [] as string[],
    typed: [] as { text: string; context: readonly string[] }[],
    toasts: [] as string[],
    copied: [] as string[],
    agents: [] as { id: string; description: string; type: string; status: string }[],
    busy: [] as string[],
    runs: {} as Record<string, Record<string, unknown>>,
    runSeq: 0,
    created: [] as string[],
    createText: NOT_SAVED,
    files: {} as Record<string, { text: string; mtimeMs: number }>,
    store: {} as Record<string, any>,
    // Tools whose calls never come back (a dialog nobody answers).
    hang: new Set<string>(),
    sendText: 'Sent. (delivery: delivered; message_id: m1)',
    startDeny: undefined as string | undefined,
    gateError: false,
    // Extra task-list entries (a mode set in the app).
    listed: [] as Record<string, unknown>[],
    // The session's folder.
    cwd: '/proj',
    // Who raised each call in `calls` (next.origin.plugin: 'engine' for the model's).
    origins: [] as (string | undefined)[],
    // The create's answer instead of `createText` (a deny, an error).
    createResult: undefined as Record<string, unknown> | undefined,
    // What $.prompt.fill put in the box, and whether a box took it.
    fills: [] as string[],
    fillOk: true,
  }
  const clock = mock.clock(on, { now: 1_000_000 })
  // The mod's store (one JSON file every session shares), open to the test,
  // which plays the other sessions writing into it.
  const clone = (value: unknown) => (value === undefined ? undefined : JSON.parse(JSON.stringify(value)))
  const kept = world.store
  Object.assign(kept, clone(store))
  on('store.get', ($: any, e: any) => ({ value: clone(kept[e.key]) }))
  on('store.set', ($: any, e: any) => {
    kept[e.key] = clone(e.value)
    return { value: undefined }
  })
  on('store.delete', ($: any, e: any) => {
    delete kept[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(kept) }))
  mock.env(on, { HOME: '/home/test' })
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => $.ui.resolve(e).Box({ key: 'below' }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: world.sid }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.cwd', () => ({ value: world.cwd }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 100, percent: world.percent }, rateLimits: [] },
  }))
  on('session.measure', ($: any, e: any) => ({ changed: e.changed }))
  on('session.messages', () => ({ value: [] }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  on('turn.start', ($: any, e: any) => ({ turnId: e.turnId }))
  on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [{ name: SKILL, description: '', source: 'plugin' }] }))
  on('command.run', () => ({}))
  on('agent.list', () => ({ value: world.agents }))
  on('tool.list', () => ({ value: CHAIN_TOOLS.map(name => ({ name, description: '', mcp: true })) }))
  on('tool.call', ($: any, e: any, next: any) => {
    world.calls.push(e)
    world.origins.push(next?.origin?.plugin)
    if (world.hang.has(e.tool)) return new Promise(() => undefined)
    if (e.tool === START && world.startDeny !== undefined) return { deny: world.startDeny }
    if (e.tool === GET) {
      if (e.session_id === 'self') {
        return { result: [], text: JSON.stringify({ sessionId: world.sid, title: 'Eski iş', ...world.self }) }
      }
      const info = world.runs[e.session_id]
      return info === undefined
        ? { result: [], text: `No session ${e.session_id}`, isError: true }
        : { result: [], text: JSON.stringify(info) }
    }
    if (e.tool === GATE) {
      // The app refuses the gate in a run (and wherever the test says so).
      if (world.gateError || world.self.scheduledTaskId !== undefined) return { result: [], text: UNATTENDED, isError: true }
      return { result: [], text: JSON.stringify({ thisComputer: { repositories: {} }, remote: {} }) }
    }
    if (e.tool === RUN) {
      if (world.busy.includes(e.taskId)) {
        return { result: [], text: `Task ${e.taskId} already has a run in progress.`, isError: true }
      }
      const id = `local_run${++world.runSeq}`
      world.runs[id] = { sessionId: id, scheduledTaskId: e.taskId, ...RUN_INFO }
      return { result: [], text: `Started a run of ${e.taskId}: session ${id}` }
    }
    if (e.tool === CREATE) {
      if (world.createResult !== undefined) return world.createResult
      world.created.push(e.taskId)
      // The app writes the task file: name/description frontmatter, then the prompt.
      world.files[`/home/test/.claude/scheduled-tasks/${e.taskId}/SKILL.md`] = {
        text: `---\nname: ${e.taskId}\ndescription: ${e.description}\n---\n\n${e.prompt}\n`,
        mtimeMs: 0,
      }
      return { result: [], text: world.createText }
    }
    if (e.tool === TASKS) {
      return { result: [], text: JSON.stringify([...world.created.map(taskId => ({ taskId })), ...world.listed]) }
    }
    if (e.tool === SEND) return { result: [], text: world.sendText }
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
  on('fs.write', ($: any, e: any) => {
    world.files[e.path] = { text: e.text, mtimeMs: clock.now() }
    return { value: undefined }
  })
  on('prompt.submit', ($: any, e: any) => {
    if (e.origin?.kind === 'plugin' || e.origin === undefined) world.sent.push(e.text)
    else world.typed.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text, context: e.context }
  })
  on('prompt.fill', ($: any, e: any) => {
    world.fills.push(e.text)
    return world.fillOk ? { isFilled: true } : { isFilled: false, refusal: 'no_composer' }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.copy', ($: any, e: any) => {
    world.copied.push(e.text)
    return { value: { isCopied: true } }
  })
  on('ui.toast', ($: any, e: any) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })

  return { world, clock }
}

/** Another session (a relay, a requester) writes the shared store. */
const setStore = (world: any, key: string, value: unknown) => {
  world.store[key] = JSON.parse(JSON.stringify(value))
}

let turnSeq = 0
const turnBegin = ($: any) => $.turn.start({ text: '', turnId: `zt${++turnSeq}` })
const turnEnd = ($: any, answer: string) =>
  $.turn.complete({ answer, durationMs: 1, isAborted: false, turnId: `zt${turnSeq}`, reason: 'answer' })
const runningTurn = () => `zt${turnSeq}`
const typed = ($: any, text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
const machine = ($: any, text: string, kind = 'task-notification', extra: Record<string, unknown> = {}) =>
  $.prompt.submit({ text, origin: { kind }, wait: false, ...extra })
const bash = ($: any) => $.tool.call({ tool: 'Bash', command: 'ls' })
const devir = ($: any, args: string) =>
  $.command.run({ command: 'devir', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } })
const phase = async ($: any) => (await devir($, '')).text
const callsOf = (world: any, tool: string) => world.calls.filter((c: any) => c.tool === tool)
/** The mod's own creates (its $.tool.call), not the model's. */
const ownCreates = (world: any) =>
  world.calls.filter((c: any, i: number) => c.tool === CREATE && world.origins[i] !== 'engine')
/** The next UTC day for the folders' provisioning records (their miss day passes). */
const newDay = (world: any) => {
  for (const key of Object.keys(world.store)) {
    if (key.startsWith('hazirlik:')) world.store[key] = { ...world.store[key], missDay: '1969-12-31' }
  }
}
/** A turn the person typed: its first tool result's context, after the mod's own work ran. */
const typedTurn = async ($: any, clock: any, text = 'iş') => {
  await typed($, text)
  await turnBegin($)
  await clock.advance(100)
  const got = (await bash($)).context ?? []
  await clock.advance(100)
  return got
}

/** This module now serves session `sid` (a new chat: a run when `self.scheduledTaskId` is set). */
const become = async ($: any, world: any, clock: any, sid: string, self: Record<string, unknown>) => {
  world.sid = sid
  world.self = self
  await $.session.start({ cwd: world.cwd, surface: 'desktop', isInteractive: true })
  await clock.advance(100)
}

/** The model writes this handoff's prompt file. */
const writePrompt = (world: any, clock: any, text: string) => {
  world.files[FILE] = { text: `${text}\n`, mtimeMs: clock.now() }
}

/**
 * A run chat's machine turn crosses the threshold: no gate step (the app
 * refuses it in a run, live check bug 2); the reply ends in the prompt block
 * and the turn's end leaves the request for the relay.
 */
const runChatHop = async ($: any, world: any, clock: any, text: string) => {
  await machine($, chainMessage(FILE), 'peer-send-message')
  await turnBegin($)
  expect((await bash($)).context).toEqual([runChatHandoff(40, true)])
  await clock.advance(100)
  await turnEnd($, `Devam notu yazıldı.\n\n\`\`\`\n${text}\n\`\`\`\n`)
  await clock.advance(100)
}

describe('otomatik-devir v0.5 zincir', () => {
  test('(z1) normal sohbet: mod görevi kendisi çalıştırır; açılış → effort/model → send_message, izin modu hiç değişmez (H1)', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik', depoGoruldu: true, ...READY })
    await become($, world, clock, 's1', { ...SELF })
    await machine($, 'a1 bitti')
    await turnBegin($)
    expect((await bash($)).context).toEqual([gatedHandoff(40, true, PLAN)])
    await clock.advance(100)
    writePrompt(world, clock, 'Devam et: adım 3')
    const before = world.calls.length
    expect((await $.tool.call({ tool: GATE })).context).toEqual([OWN_DISPATCH_NOTE])
    await turnEnd($, 'Devir yapıldı.')
    await clock.advance(60_000)

    // The dispatcher never creates tasks (a pair made outside a typed turn keeps no mode).
    expect(callsOf(world, CREATE)).toHaveLength(0)
    // Bootstrap, then effort and model (only where they differ), then the real prompt; never the mode.
    const order = world.calls
      .slice(before)
      .filter((c: any) => [RUN, SET_EFFORT, SET_MODEL, SET_PERMISSION, SEND].includes(c.tool) || (c.tool === GET && c.session_id !== 'self'))
      .map((c: any) => c.tool)
    expect(order).toEqual([RUN, GET, SET_EFFORT, SET_MODEL, SEND])
    expect(callsOf(world, RUN)[0].taskId).toBe(PAIR1[0])
    expect(callsOf(world, SET_EFFORT)[0]).toMatchObject({ session_id: 'local_run1', effort: 'high' })
    expect(callsOf(world, SET_MODEL)[0]).toMatchObject({ session_id: 'local_run1', model: 'claude-opus-5-5' })
    expect(callsOf(world, SET_PERMISSION)).toHaveLength(0)
    expect(callsOf(world, SEND)[0]).toMatchObject({ session_id: 'local_run1', message: chainMessage(FILE) })
    expect(await phase($)).toContain('aşama: done')
    expect(callsOf(world, START)).toHaveLength(0)
    expect(world.sent).toEqual([])
    expect(world.copied).toEqual([])
  })

  test('(z2) çalışma sohbeti isteği → aktarıcı gönderir: kendi görevi değil, eşit ayarlar, send_message', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik', depoGoruldu: true, ...READY })
    // local_run1 (this run chat) exists: the next run is local_run2.
    world.runSeq = 1
    await become($, world, clock, 'local_run1', { ...SELF, scheduledTaskId: PAIR1[0] })
    await runChatHop($, world, clock, 'Devam et: hop 2')
    expect(world.store['istek:local_run1']).toMatchObject({
      id: 'local_run1',
      cwd: '/proj',
      file: FILE,
      taskId: PAIR1[0],
      model: 'claude-opus-5-5',
      effort: 'high',
      permissionMode: 'bypassPermissions',
      state: 'pending',
    })
    // A run chat never runs a task (the app refuses it there).
    expect(callsOf(world, RUN)).toHaveLength(0)
    expect(await phase($)).toContain('aşama: handoff_running')

    // The relay: a regular session with the mod loaded.
    await become($, world, clock, 'local_relay', { ...SELF })
    await clock.advance(30_000)
    expect(callsOf(world, RUN).map((c: any) => c.taskId)).toEqual([PAIR1[1]])
    expect(callsOf(world, SET_EFFORT)).toEqual([expect.objectContaining({ session_id: 'local_run2', effort: 'high' })])
    expect(callsOf(world, SET_MODEL)).toHaveLength(1)
    // Never a permission switch: the run starts in the pair's saved mode.
    expect(callsOf(world, SET_PERMISSION)).toHaveLength(0)
    // The run chat noted its task's mode (the mode its run started in).
    expect(world.store[`gorevModu:${PAIR1[0]}`]).toMatchObject({ mode: 'bypassPermissions' })
    expect(callsOf(world, SEND)).toEqual([
      expect.objectContaining({ session_id: 'local_run2', message: chainMessage(FILE) }),
    ])
    expect(world.store['istek:local_run1']).toMatchObject({
      state: 'done',
      runId: 'local_run2',
      by: 'local_relay',
      sent: true,
    })
    expect(world.store['aktarici']).toMatchObject({ id: 'local_relay' })
    expect(callsOf(world, START)).toHaveLength(0)
  })

  test('(z3) istek sahibi: aktarıcı açınca done; başarısızsa (b) sonraki yazılan mesaj', async ($, on) => {
    const { world, clock } = setup(on, {
      esik: 40,
      mod: 'otomatik',
      depoGoruldu: true,
      [PAIR_KEY]: { gen: 1, ids: [...PAIR1], savedMode: null },
    })
    await become($, world, clock, 'local_run1', { ...SELF, scheduledTaskId: PAIR1[0] })
    await runChatHop($, world, clock, 'Devam et: hop 2')
    const req: any = world.store['istek:local_run1']
    // Lost from the shared file before any relay took it: posted again.
    delete world.store['istek:local_run1']
    await clock.advance(5000)
    expect(world.store['istek:local_run1']).toMatchObject({ state: 'pending', taskId: PAIR1[0] })
    // Another session's relay claims it and runs the task.
    setStore(world, 'istek:local_run1', { ...req, state: 'claimed', by: 'local_x', claimedAt: clock.now(), beatAt: clock.now(), runId: 'local_run9' })
    await clock.advance(5000)
    expect(await phase($)).toContain('aşama: done')
    setStore(world, 'istek:local_run1', { ...req, state: 'done', by: 'local_x', runId: 'local_run9' })
    await clock.advance(5000)
    expect(world.store['istek:local_run1']).toBeUndefined()

    // A second run chat whose request fails: (b), the held prompt rides the next typed message.
    await become($, world, clock, 'local_run5', { ...SELF, scheduledTaskId: PAIR1[1] })
    await runChatHop($, world, clock, 'Devam et: hop 6')
    const failed: any = world.store['istek:local_run5']
    setStore(world, 'istek:local_run5', { ...failed, state: 'failed', reason: 'görev yok' })
    await clock.advance(5000)
    expect(await phase($)).toContain('aşama: deferred')
    expect(world.toasts).toContain('Zamanlanmış görev yolu olmadı; yeni sohbet bir sonraki mesajınla açılacak.')
    await typed($, 'sıradaki')
    expect(world.typed.at(-1)?.context?.[0]).toContain('Devam et: hop 6')
    expect(callsOf(world, RUN)).toHaveLength(0)
  })

  test('(z4) iki aktarıcı: istek tek kez alınır, çift gönderim yok', async ($, on) => {
    const { world, clock } = setup(on, {
      esik: 40,
      mod: 'otomatik',
      [PAIR_KEY]: { gen: 1, ids: [...PAIR1], savedMode: 'bypassPermissions' },
      'istek:local_runA': { id: 'local_runA', cwd: '/proj', file: FILE, taskId: PAIR1[0], at: 1_000_000, state: 'pending' },
      aktarici: { id: 'local_other', at: 1_000_000 },
    })
    world.percent = 10
    await become($, world, clock, 's1', { ...SELF })
    // Another relay's heartbeat is fresh: this session does not act.
    await clock.advance(10_000)
    expect(callsOf(world, RUN)).toHaveLength(0)

    // This session is the relay now; it claims, but the other relay's claim
    // lands in the settle window: the read-back is not ours, no run.
    setStore(world, 'aktarici', { id: 's1', at: clock.now() })
    let claimed: any
    for (let i = 0; i < 80 && claimed?.by !== 's1'; i++) {
      await clock.advance(100)
      claimed = world.store['istek:local_runA']
    }
    expect(claimed).toMatchObject({ state: 'claimed', by: 's1' })
    setStore(world, 'istek:local_runA', { ...claimed, by: 'local_other', claimedAt: clock.now(), beatAt: clock.now() })
    await clock.advance(1000)
    expect(callsOf(world, RUN)).toHaveLength(0)
    // The other relay finishes it; later passes leave it alone.
    setStore(world, 'istek:local_runA', { ...claimed, by: 'local_other', state: 'done', runId: 'local_run7' })
    await clock.advance(20_000)
    expect(callsOf(world, RUN)).toHaveLength(0)
    expect(callsOf(world, SEND)).toHaveLength(0)
  })

  test('(z5) aktarıcı devri: kalp atışı eskiyince başka oturum devralır ve gönderir', async ($, on) => {
    const { world, clock } = setup(on, {
      esik: 40,
      mod: 'otomatik',
      [PAIR_KEY]: { gen: 1, ids: [...PAIR1], savedMode: 'bypassPermissions' },
      'istek:local_runA': { id: 'local_runA', cwd: '/proj', file: FILE, taskId: PAIR1[0], effort: 'high', at: 1_000_000, state: 'pending' },
      aktarici: { id: 'local_dead', at: 1_000_000 },
    })
    world.percent = 10
    await become($, world, clock, 's1', { ...SELF })
    await clock.advance(20_000)
    expect(callsOf(world, RUN)).toHaveLength(0)
    // No heartbeat for 30 s: taken over.
    await clock.advance(15_000)
    expect(world.store['aktarici']).toMatchObject({ id: 's1' })
    expect(callsOf(world, RUN).map((c: any) => c.taskId)).toEqual([PAIR1[1]])
    expect(callsOf(world, SEND)).toEqual([expect.objectContaining({ session_id: 'local_run1' })])
    expect(world.store['istek:local_runA']).toMatchObject({ state: 'done', runId: 'local_run1', by: 's1' })
  })

  test('(z6) ön hazırlık yalnızca uygun yazılan Bypass turunda ve modun kendi oluşturmasıyla: makine turu, ajan, karışan makine girdisi, varsayılan mod sayılmaz', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    world.percent = 10
    await become($, world, clock, 's1', { ...SELF })
    const turn = async (open: () => Promise<unknown>, during?: () => Promise<unknown>) => {
      await open()
      await turnBegin($)
      await clock.advance(100)
      if (during !== undefined) await during()
      const got = await bash($)
      await clock.advance(100)
      return got.context ?? []
    }
    // A machine's turn.
    expect(await turn(() => machine($, 'a1 bitti'))).toEqual([])
    await turnEnd($, 'tamam')
    // An agent still running.
    world.agents = [{ id: 'a1', description: 'tara', type: 'Explore', status: 'running' }]
    expect(await turn(() => typed($, 'iş'))).toEqual([])
    await turnEnd($, 'tamam')
    world.agents = []
    // A machine's input joined the typed turn.
    expect(
      await turn(
        () => typed($, 'iş'),
        () => machine($, 'bildirim', 'task-notification', { turnId: runningTurn() }),
      ),
    ).toEqual([])
    await turnEnd($, 'tamam')
    // Default mode: the app would not keep it.
    world.self = { ...SELF, permissionMode: 'default' }
    expect(await turn(() => typed($, 'iş'))).toEqual([])
    await turnEnd($, 'tamam')
    expect(callsOf(world, CREATE)).toHaveLength(0)
    expect(world.store[`hazirlik:${HASH}`]).toBeUndefined()

    // The qualifying typed turn: Bypass, nothing else joined. The mod creates
    // the pair itself, one after the other; the model reads nothing.
    world.self = { ...SELF }
    world.createText = SAVED
    expect(await turn(() => typed($, 'iş'))).toEqual([])
    const own = ownCreates(world)
    expect(own.map((c: any) => c.taskId)).toEqual([...PAIR1])
    expect(callsOf(world, CREATE)).toHaveLength(2)
    for (const task of own) {
      expect(task).toMatchObject({
        prompt: BOOTSTRAP_PROMPT,
        description: 'Bağlam eşiğinde devredilen sohbetin devamı (otomatik-devir).',
        notifyOnCompletion: false,
      })
      expect(String(task.title)).toMatch(/^Otomatik devir · proj · 1[AB]$/)
      expect(task.cronExpression).toBeUndefined()
      expect(task.fireAt).toBeUndefined()
    }
    expect(world.store[PAIR_KEY]).toEqual({ gen: 1, ids: [...PAIR1], savedMode: 'bypassPermissions', model: 'claude-opus-5-5' })
    expect(world.store[`hazirlik:${HASH}`]).toMatchObject({
      gen: 1, mode: 'bypassPermissions', state: 'done', by: 's1', via: 'mod', misses: 0,
      created: { [PAIR1[0]]: 'saved', [PAIR1[1]]: 'saved' },
    })
    await clock.advance(100)
    expect(world.files[`/home/test/.claude/scheduled-tasks/${PAIR1[1]}/SKILL.md`]?.text).toContain('model: claude-opus-5-5')
    await turnEnd($, 'tamam')
    // Ready in this mode: the next typed turn (and chat) creates nothing.
    expect(await turn(() => typed($, 'iş'))).toEqual([])
    await turnEnd($, 'tamam')
    await become($, world, clock, 's2', { ...SELF })
    expect(await turn(() => typed($, 'iş'))).toEqual([])
    await turnEnd($, 'tamam')
    expect(callsOf(world, CREATE)).toHaveLength(2)
    expect(callsOf(world, RUN)).toHaveLength(0)
    expect(world.toasts).toEqual([])
  })

  test('(z7) kuşak kimlikleri: mod saklanmadıysa çift silinmez, ertesi gün yeni kuşak kurulur; koruma kuşakları da kapsar', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    world.percent = 10
    expect(PAIR1[0]).toMatch(/^otomatik-devir-[0-9a-f]{8}-1a$/)
    expect(PAIR2[1]).toMatch(/^otomatik-devir-[0-9a-f]{8}-2b$/)
    expect(scheduledPlan('/proj', 3).ids[0]).toMatch(/-3a$/)
    await become($, world, clock, 's1', { ...SELF })
    // The app did not count the turn as the person's: "not saved" on the first create, the second is not made.
    expect(await typedTurn($, clock)).toEqual([])
    expect(ownCreates(world).map((c: any) => c.taskId)).toEqual([PAIR1[0]])
    expect(world.store[`hazirlik:${HASH}`]).toMatchObject({ gen: 1, state: 'failed', misses: 1 })
    await turnEnd($, 'tamam')

    // The next day's session: a new generation, the null-mode task is never deleted.
    newDay(world)
    await become($, world, clock, 's2', { ...SELF })
    world.createText = SAVED
    expect(await typedTurn($, clock)).toEqual([])
    expect(ownCreates(world).map((c: any) => c.taskId)).toEqual([PAIR1[0], ...PAIR2])
    expect(world.store[PAIR_KEY]).toMatchObject({ gen: 2, ids: [...PAIR2], savedMode: 'bypassPermissions' })
    // The guard covers the generations: no delete, no update, no "-1a-2".
    expect(String((await $.tool.call({ tool: DELETE, taskId: PAIR1[0] })).deny)).toContain('silinmez')
    expect(String((await $.tool.call({ tool: UPDATE, taskId: PAIR2[1], prompt: 'x' })).deny)).toContain('güncellenmez')
    expect(String((await $.tool.call({ tool: CREATE, taskId: `${PAIR1[0]}-2`, prompt: '-', description: '-' })).deny)).toContain(
      'zaten var',
    )
    expect(callsOf(world, DELETE)).toHaveLength(0)
    expect(callsOf(world, UPDATE)).toHaveLength(0)
    await $.tool.call({ tool: DELETE, taskId: 'otomatik-devir-rapor' })
    expect(callsOf(world, DELETE)).toHaveLength(1)
    await turnEnd($, 'tamam')
  })

  test('(z8) üç devir art arda, tıklamasız (benzetim): normal → çalışma → çalışma → çalışma', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik', depoGoruldu: true, ...READY })
    // Hop 1: the person's regular chat; its own mod dispatches.
    await become($, world, clock, 's1', { ...SELF })
    await machine($, 'a1 bitti')
    await turnBegin($)
    await bash($)
    await clock.advance(100)
    writePrompt(world, clock, 'Devam et: hop 1')
    expect((await $.tool.call({ tool: GATE })).context).toEqual([OWN_DISPATCH_NOTE])
    await turnEnd($, 'Devir yapıldı.')
    await clock.advance(30_000)
    // Hop 2: run 1 (task 1a) hands off through the relay.
    await become($, world, clock, 'local_run1', { ...SELF, scheduledTaskId: PAIR1[0] })
    await runChatHop($, world, clock, 'Devam et: hop 2')
    await become($, world, clock, 'local_relay', { ...SELF })
    await clock.advance(30_000)
    // Hop 3: run 2 (task 1b) the same way; 1a is free again.
    await become($, world, clock, 'local_run2', { ...SELF, scheduledTaskId: PAIR1[1] })
    await runChatHop($, world, clock, 'Devam et: hop 3')
    await become($, world, clock, 'local_relay', { ...SELF })
    await clock.advance(30_000)

    expect(callsOf(world, RUN).map((c: any) => c.taskId)).toEqual([PAIR1[0], PAIR1[1], PAIR1[0]])
    expect(callsOf(world, SEND).map((c: any) => c.session_id)).toEqual(['local_run1', 'local_run2', 'local_run3'])
    for (const sent of callsOf(world, SEND)) expect(sent.message).toBe(chainMessage(FILE))
    expect(callsOf(world, SET_EFFORT)).toHaveLength(3)
    expect(world.store['istek:local_run2']).toMatchObject({ state: 'done', runId: 'local_run3' })
    // No click anywhere: no start_session, no card, no clipboard, no mod message.
    expect(callsOf(world, START)).toHaveLength(0)
    expect(world.copied).toEqual([])
    expect(world.sent).toEqual([])
    expect(callsOf(world, DELETE)).toHaveLength(0)
  })

  test('(z9) ikisi de meşgulse süre içinde beklenir (M9), sonra model görevi çalıştırır; sonuç bağlamı send_message adımını taşır', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik', depoGoruldu: true, ...READY })
    world.busy = [...PAIR1]
    await become($, world, clock, 's1', { ...SELF })
    await machine($, 'a1 bitti')
    await turnBegin($)
    await bash($)
    await clock.advance(100)
    writePrompt(world, clock, 'Devam et: adım 3')
    expect((await $.tool.call({ tool: GATE })).context).toEqual([OWN_DISPATCH_NOTE])
    await turnEnd($, 'Devir yapıldı.')
    // Both tasks busy: retried every 30 s, no model message yet.
    await clock.advance(2 * 60_000)
    expect(callsOf(world, RUN).length).toBeGreaterThan(4)
    expect(world.sent).toEqual([])
    await clock.advance(8 * 60_000)
    const plan = { file: FILE, ids: PAIR1 }
    expect(world.sent).toEqual([scheduledHandoff(40, true, plan, 'Devam et: adım 3')])
    world.busy = []
    await turnBegin($)
    const ran = await $.tool.call({ tool: RUN, taskId: PAIR1[0] })
    expect(ran.context).toEqual([syncText('local_run1', SELF, FILE)])
    expect(ran.context[0]).toContain(`${SEND} aracını session_id "local_run1"`)
    await turnEnd($, 'Yeni sohbet açıldı.')
    expect(await phase($)).toContain('aşama: done')
    expect(callsOf(world, START)).toHaveLength(0)
  })

  // ---- v0.5 review fixes ----

  /** A regular chat's machine turn crosses the threshold, writes the file and asks the gate. */
  const ownHop = async ($: any, world: any, clock: any, text: string, answer = 'Devir yapıldı.') => {
    await machine($, 'a1 bitti')
    await turnBegin($)
    expect((await bash($)).context).toEqual([gatedHandoff(40, true, PLAN)])
    await clock.advance(100)
    writePrompt(world, clock, text)
    const gate = (await $.tool.call({ tool: GATE })).context
    return { gate, end: () => turnEnd($, answer) }
  }
  const pending = (id: string, taskId: string = PAIR1[0], at = 1_000_000) => ({
    id, cwd: '/proj', file: FILE, taskId, effort: 'high', at, state: 'pending',
  })

  test('(H1) kayıtlı modlu çift yoksa görev çalıştırılmaz: (b) ve klasör başına tek ipucu; çalışmanın ya da listenin gösterdiği mod sayılır', async ($, on) => {
    // A pair the app kept no mode with (made in a machine turn): never dispatched.
    const { world, clock } = setup(on, {
      esik: 40, mod: 'otomatik', depoGoruldu: true,
      [PAIR_KEY]: { gen: 1, ids: [...PAIR1], savedMode: null },
    })
    await become($, world, clock, 's1', { ...SELF })
    const hop = await ownHop($, world, clock, 'Devam et: adım 3')
    expect(hop.gate).toEqual([CHAIN_WAIT_NOTE])
    await hop.end()
    await clock.advance(60_000)
    expect(callsOf(world, RUN)).toHaveLength(0)
    expect(callsOf(world, SET_PERMISSION)).toHaveLength(0)
    expect(callsOf(world, CREATE)).toHaveLength(0)
    expect(await phase($)).toContain('aşama: deferred')
    expect(world.toasts.filter((t: string) => t === SETUP_HINT)).toHaveLength(1)
    await typed($, 'sıradaki')
    expect(world.typed.at(-1)?.context?.[0]).toContain('Devam et: adım 3')
    await clock.advance(1000)
    // A second hop in this folder: no second hint.
    await become($, world, clock, 's2', { ...SELF })
    expect((await ownHop($, world, clock, 'Devam et: adım 4')).gate).toEqual([CHAIN_WAIT_NOTE])
    expect(world.toasts.filter((t: string) => t === SETUP_HINT)).toHaveLength(1)

    // Runs of both tasks showed Bypass (their saved mode): the pair is ready.
    setStore(world, `gorevModu:${PAIR1[0]}`, { mode: 'bypassPermissions', at: 1 })
    setStore(world, `gorevModu:${PAIR1[1]}`, { mode: 'bypassPermissions', at: 1 })
    await become($, world, clock, 's3', { ...SELF })
    expect((await ownHop($, world, clock, 'Devam et: adım 5')).gate).toEqual([OWN_DISPATCH_NOTE])
    await clock.advance(60_000)
    expect(callsOf(world, RUN).map((c: any) => c.taskId)).toEqual([PAIR1[0]])

    // A mode set in the app shows in the task list: that generation is used.
    delete world.store[PAIR_KEY]
    world.listed = PAIR2.map(taskId => ({ taskId, permissionMode: 'auto' }))
    await become($, world, clock, 's4', { ...SELF })
    expect((await ownHop($, world, clock, 'Devam et: adım 6')).gate).toEqual([OWN_DISPATCH_NOTE])
    await clock.advance(60_000)
    expect(callsOf(world, RUN).map((c: any) => c.taskId)).toEqual([PAIR1[0], PAIR2[0]])
    expect(world.store[PAIR_KEY]).toMatchObject({ gen: 2, savedMode: 'auto' })
    expect(callsOf(world, SET_PERMISSION)).toHaveLength(0)
  })

  test('(H2) aktarıcı yalnızca Bypass/Auto oturum; takılan gönderim süre dolunca kilidi bırakır, istek kuyruğa döner', async ($, on) => {
    const { world, clock } = setup(on, {
      esik: 40, mod: 'otomatik', ...READY, 'istek:local_runA': pending('local_runA'),
    })
    world.percent = 10
    // A default-mode chat would wait on dialogs: never the relay.
    await become($, world, clock, 's1', { ...SELF, permissionMode: 'default' })
    await clock.advance(40_000)
    expect(world.store['aktarici']).toBeUndefined()
    expect(callsOf(world, RUN)).toHaveLength(0)

    // A Bypass relay whose task run never comes back (a dialog nobody answers).
    world.hang.add(RUN)
    await become($, world, clock, 's2', { ...SELF })
    await clock.advance(10_000)
    expect(world.store['aktarici']).toMatchObject({ id: 's2' })
    expect(callsOf(world, RUN)).toHaveLength(1)
    await clock.advance(3 * 60_000)
    expect(world.store['aktarici']).toBeUndefined()
    expect(world.store['istek:local_runA']).toMatchObject({ state: 'pending', tries: 1, reason: 'süre doldu' })
    // While that call is unsettled this session stays out: no lock, no second run.
    await clock.advance(60_000)
    expect(world.store['aktarici']).toBeUndefined()
    expect(callsOf(world, RUN)).toHaveLength(1)
  })

  test('(H3) ön hazırlık: çalışma sohbetinde ve makinenin açtığı turda yok; bir "saklanmadı" klasörün gününü bitirir, iki tanesi her yerde kapatır, /devir otomatik yeniden açar', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    world.percent = 10
    // A run chat (its delivered prompt may read as the person's).
    await become($, world, clock, 'local_run1', { ...SELF, scheduledTaskId: PAIR1[0] })
    expect(await typedTurn($, clock)).toEqual([])
    await turnEnd($, 'tamam')
    // A machine-opened turn the person types into.
    await become($, world, clock, 's1', { ...SELF })
    await machine($, 'a1 bitti')
    await turnBegin($)
    await $.prompt.submit({ text: 'şunu da yap', origin: { kind: 'composer' }, wait: false, turnId: runningTurn() })
    expect((await bash($)).context ?? []).toEqual([])
    await clock.advance(100)
    await turnEnd($, 'tamam')
    expect(callsOf(world, CREATE)).toHaveLength(0)
    // A "not saved" own create: the folder is done for the day.
    world.createText = NOT_SAVED_LIVE
    await become($, world, clock, 's2', { ...SELF })
    expect(await typedTurn($, clock)).toEqual([])
    await turnEnd($, 'tamam')
    expect(world.store[`hazirlik:${HASH}`]).toMatchObject({ gen: 1, misses: 1, state: 'failed' })
    await become($, world, clock, 's3', { ...SELF })
    expect(await typedTurn($, clock)).toEqual([])
    await turnEnd($, 'tamam')
    expect(ownCreates(world)).toHaveLength(1)
    // The next day it is tried once more; a second "not saved" pair turns it off everywhere.
    newDay(world)
    await become($, world, clock, 's4', { ...SELF })
    expect(await typedTurn($, clock)).toEqual([])
    await turnEnd($, 'tamam')
    expect(ownCreates(world).map((c: any) => c.taskId)).toEqual([PAIR1[0], PAIR2[0]])
    expect(world.store['kendiKurulum']).toMatchObject({ off: true, unsaved: 2 })
    expect(world.toasts.filter((t: string) => t === SETUP_OFF_HINT)).toHaveLength(1)
    newDay(world)
    await become($, world, clock, 's5', { ...SELF })
    expect(await typedTurn($, clock)).toEqual([])
    await turnEnd($, 'tamam')
    expect(ownCreates(world)).toHaveLength(2)
    // A same-day failure and the stop: `/devir otomatik` clears both.
    expect(world.store[`hazirlik:${HASH}`]).toMatchObject({ state: 'failed', misses: 1 })
    world.store[`hazirlik:${HASH}`].missDay = new Date(clock.now()).toISOString().slice(0, 10)
    await devir($, 'otomatik')
    expect(world.store['kendiKurulum']).toBeUndefined()
    world.createText = SAVED_LIVE
    await become($, world, clock, 's6', { ...SELF })
    expect(await typedTurn($, clock)).toEqual([])
    await turnEnd($, 'tamam')
    expect(ownCreates(world).map((c: any) => c.taskId)).toEqual([PAIR1[0], PAIR2[0], ...scheduledPlan('/proj', 3).ids])
    expect(world.store[PAIR_KEY]).toMatchObject({ gen: 3, savedMode: 'bypassPermissions' })
  })

  test('(M1) mod devri açarken modelin kendi görev çalıştırması reddedilir', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik', depoGoruldu: true, ...READY })
    await become($, world, clock, 's1', { ...SELF })
    const hop = await ownHop($, world, clock, 'Devam et: adım 3')
    expect(hop.gate).toEqual([OWN_DISPATCH_NOTE])
    expect(String((await $.tool.call({ tool: RUN, taskId: PAIR1[1] })).deny)).toContain('mod zamanlanmış görevle açıyor')
    await hop.end()
    await clock.advance(60_000)
    expect(await phase($)).toContain('aşama: done')
    await turnBegin($)
    expect(String((await $.tool.call({ tool: RUN, taskId: PAIR1[1] })).deny)).toContain('görevi çalıştırma')
    expect(callsOf(world, RUN)).toHaveLength(1)
  })

  test('(M2) tek atımlık işaret: geri dönen istek yeniden gönderilmez; alınmış görülen istek kaybolursa yeniden yazılmaz', async ($, on) => {
    const { world, clock } = setup(on, {
      esik: 40, mod: 'otomatik', depoGoruldu: true, ...READY, 'istek:local_runA': pending('local_runA'),
    })
    world.percent = 10
    await become($, world, clock, 's1', { ...SELF })
    await clock.advance(30_000)
    expect(callsOf(world, RUN)).toHaveLength(1)
    expect(world.store['istek:local_runA']).toMatchObject({ state: 'done' })
    expect(world.store['gonderildi:local_runA@1000000']).toMatchObject({ runId: 'local_run1' })
    // A stale snapshot writes the request back as pending (same `at`): no second hop.
    setStore(world, 'istek:local_runA', pending('local_runA'))
    await clock.advance(30_000)
    expect(callsOf(world, RUN)).toHaveLength(1)
    expect(world.store['istek:local_runA']).toMatchObject({ state: 'done', runId: 'local_run1' })

    // The requester: a request seen claimed and then lost is never posted again.
    world.percent = 50
    world.runSeq = 5
    await become($, world, clock, 'local_run5', { ...SELF, scheduledTaskId: PAIR1[1] })
    await runChatHop($, world, clock, 'Devam et: hop 6')
    const req: any = world.store['istek:local_run5']
    setStore(world, 'istek:local_run5', { ...req, state: 'claimed', by: 'local_x', claimedAt: clock.now(), beatAt: clock.now() })
    await clock.advance(5000)
    delete world.store['istek:local_run5']
    await clock.advance(5000)
    expect(world.store['istek:local_run5']).toBeUndefined()
    // Its mark shows up: the hop is done.
    setStore(world, `gonderildi:local_run5@${req.at}`, { at: clock.now(), runId: 'local_run8' })
    await clock.advance(5000)
    expect(await phase($)).toContain('aşama: done')
  })

  test('(M3) /devir hazirla sonrası modelin paralel iki oluşturması: çift kaydı kaybolmaz', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    world.percent = 10
    world.createText = SAVED_AUTO
    await become($, world, clock, 's1', { ...SELF, permissionMode: 'auto' })
    await devir($, 'hazirla')
    await clock.advance(100)
    expect(await typedTurn($, clock, world.fills[0])).toEqual([])
    await Promise.all(PAIR1.map(taskId => $.tool.call({ tool: CREATE, taskId, prompt: '-', description: '-' })))
    expect(ownCreates(world)).toHaveLength(0)
    expect(world.store[PAIR_KEY]).toMatchObject({ gen: 1, savedMode: 'auto' })
    expect(world.store[`hazirlik:${HASH}`]).toMatchObject({ state: 'done', via: 'hazirla', misses: 0 })
    await turnEnd($, 'tamam')
    expect(world.store[`hazirlik:${HASH}`]).toMatchObject({ state: 'done', misses: 0 })
  })

  test('(M4) send_message: "delivery:" satırı yoksa gitmemiş sayılır; yalnızca açık "not delivered" yeniden denenir', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik', depoGoruldu: true, ...READY })
    world.sendText = 'Cannot send into a session an orchestrator dispatched.'
    await become($, world, clock, 's1', { ...SELF })
    await (await ownHop($, world, clock, 'Devam et: adım 3')).end()
    await clock.advance(60_000)
    expect(callsOf(world, SEND)).toHaveLength(1)
    expect(world.toasts.some((t: string) => t.includes('devam mesajı gitmedi'))).toBe(true)
    world.sendText = 'Session local_run2 is busy; message not delivered.'
    await become($, world, clock, 's2', { ...SELF })
    await (await ownHop($, world, clock, 'Devam et: adım 4')).end()
    await clock.advance(60_000)
    expect(callsOf(world, SEND)).toHaveLength(3)
  })

  test('(M5) modun kendi devri takılırsa süre dolunca (b)', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik', depoGoruldu: true, ...READY })
    world.hang.add(RUN)
    await become($, world, clock, 's1', { ...SELF })
    await (await ownHop($, world, clock, 'Devam et: adım 3')).end()
    await clock.advance(5 * 60_000)
    expect(await phase($)).toContain('aşama: handoff_running')
    await clock.advance(6 * 60_000)
    expect(await phase($)).toContain('aşama: deferred')
    expect(world.toasts).toContain('Zamanlanmış görev yolu olmadı; yeni sohbet bir sonraki mesajınla açılacak.')
    await typed($, 'sıradaki')
    expect(world.typed.at(-1)?.context?.[0]).toContain('Devam et: adım 3')
  })

  test('(M6) çalışma sohbetinde uygulamanın otomatik reddi kişinin "hayır"ı sayılmaz: istek aktarıcıya gider', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik', depoGoruldu: true, ...READY })
    world.startDeny = `${START} needs a person's approval, and nobody has opened this scheduled run. Carry on without it.`
    await become($, world, clock, 'local_run1', { ...SELF, scheduledTaskId: PAIR1[0] })
    await machine($, taskPrompt(FILE), 'sdk')
    await turnBegin($)
    await bash($)
    await clock.advance(100)
    writePrompt(world, clock, 'Devam et: hop 2')
    const denied = await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'Devam et: hop 2' })
    expect(denied.context).toEqual([RELAY_NOTE])
    expect(world.store['istek:local_run1']).toMatchObject({ state: 'pending', taskId: PAIR1[0] })
    expect(await phase($)).toContain('aşama: handoff_running')
    expect(world.toasts.some((t: string) => t.includes('/devir gec'))).toBe(false)
  })

  test('(M7) sor modunda ya da bekleyen istek yokken aktarıcı depoya yazmaz', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'sor', depoGoruldu: true, ...READY, 'istek:local_runA': pending('local_runA') })
    world.percent = 10
    await become($, world, clock, 's1', { ...SELF })
    await clock.advance(30_000)
    expect(world.store['aktarici']).toBeUndefined()
    expect(callsOf(world, RUN)).toHaveLength(0)
    // A run chat in sor mode leaves no request (no relay would serve it).
    await become($, world, clock, 'local_run2', { ...SELF, scheduledTaskId: PAIR1[0] })
    await machine($, taskPrompt(FILE), 'peer-send-message')
    await turnBegin($)
    await bash($)
    await clock.advance(100)
    writePrompt(world, clock, 'Devam et')
    expect((await $.tool.call({ tool: GATE })).context?.[0]).not.toBe(RELAY_NOTE)
    expect(world.store['istek:local_run2']).toBeUndefined()
    await turnEnd($, 'tamam')
    // otomatik, nothing waiting: the lock is not written.
    world.store['mod'] = 'otomatik'
    delete world.store['istek:local_runA']
    await become($, world, clock, 's3', { ...SELF })
    await clock.advance(30_000)
    expect(world.store['aktarici']).toBeUndefined()
  })

  test('(M8) savedFrom yalnızca modun kaydedildiğini söyleyen cümleyi sayar', async ($, on) => {
    expect(savedFrom(SAVED)).toBe(true)
    expect(savedFrom(NOT_SAVED)).toBe(false)
    // Any other wording is unknown: not a "not saved".
    expect(savedFrom('Task saved to ~/.claude/scheduled-tasks/x/SKILL.md')).toBeUndefined()
    expect(savedFrom(undefined)).toBeUndefined()
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    world.percent = 10
    world.createText = 'Task saved to ~/.claude/scheduled-tasks/x/SKILL.md'
    await become($, world, clock, 's1', { ...SELF })
    expect(await typedTurn($, clock)).toEqual([])
    expect(ownCreates(world).map((c: any) => c.taskId)).toEqual([...PAIR1])
    expect(world.store[PAIR_KEY]).toMatchObject({ gen: 1, savedMode: null })
    // An unknown wording is never a miss (v0.5 live check, bug 1), nor a failure.
    expect(world.store[`hazirlik:${HASH}`]).toMatchObject({
      state: 'done',
      misses: 0,
      created: { [PAIR1[0]]: 'unknown', [PAIR1[1]]: 'unknown' },
    })
    await turnEnd($, 'tamam')
    expect(world.store[`hazirlik:${HASH}`]).toMatchObject({ state: 'done', misses: 0 })
    expect(world.toasts).toEqual([])
  })

  test('(M9) ortak görev meşgulse aktarıcı süre içinde yeniden dener, boşalınca gönderir', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik', ...READY, 'istek:local_runA': pending('local_runA') })
    world.percent = 10
    world.busy = [PAIR1[1]]
    await become($, world, clock, 's1', { ...SELF })
    await clock.advance(3 * 60_000)
    expect(callsOf(world, RUN).length).toBeGreaterThan(3)
    expect(world.store['istek:local_runA'].state).not.toBe('done')
    expect(world.store['istek:local_runA'].runId).toBeUndefined()
    world.busy = []
    await clock.advance(60_000)
    expect(world.store['istek:local_runA']).toMatchObject({ state: 'done', runId: 'local_run1' })
    expect(callsOf(world, SEND)).toHaveLength(1)
  })

  test('(T1) aktarıcı devri sürerken tur sonu (kod bloğu bile olsa) kart açmaz', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik', depoGoruldu: true, ...READY })
    await become($, world, clock, 's1', { ...SELF })
    const hop = await ownHop($, world, clock, 'Devam et: adım 3', 'Devir yapıldı.\n\n```\nDevam et: adım 3\n```')
    expect(hop.gate).toEqual([OWN_DISPATCH_NOTE])
    await hop.end()
    await clock.advance(60_000)
    expect(callsOf(world, START)).toHaveLength(0)
    expect(world.copied).toEqual([])
    expect(callsOf(world, RUN)).toHaveLength(1)
    expect(await phase($)).toContain('aşama: done')
  })

  test('(T2) aktarıcı kendi isteğini almaz; çalışma sohbeti asla aktarıcı olmaz', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik', ...READY, 'istek:s1': pending('s1') })
    world.percent = 10
    await become($, world, clock, 's1', { ...SELF })
    await clock.advance(30_000)
    expect(callsOf(world, RUN)).toHaveLength(0)
    // A run chat with a foreign request waiting: no lock, no run.
    delete world.store['istek:s1']
    delete world.store['aktarici']
    setStore(world, 'istek:local_runA', pending('local_runA'))
    await become($, world, clock, 'local_run7', { ...SELF, scheduledTaskId: PAIR1[1] })
    await clock.advance(30_000)
    expect(world.store['aktarici']).toBeUndefined()
    expect(callsOf(world, RUN)).toHaveLength(0)
  })

  test('(T3) aktarıcı seçimi: kilit yazıldıktan sonra başkasınınki üstüne gelirse bu oturum çekilir', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik', ...READY, 'istek:local_runA': pending('local_runA') })
    world.percent = 10
    await become($, world, clock, 's1', { ...SELF })
    for (let i = 0; i < 80 && world.store['aktarici']?.id !== 's1'; i++) await clock.advance(100)
    expect(world.store['aktarici']).toMatchObject({ id: 's1' })
    // The other session's write lands inside the settle window.
    setStore(world, 'aktarici', { id: 'local_other', at: clock.now() })
    await clock.advance(10_000)
    expect(callsOf(world, RUN)).toHaveLength(0)
    expect(world.store['istek:local_runA']).toMatchObject({ state: 'pending' })
  })

  // v0.5 live check (2026-10-19) fixes, with the app's verbatim strings.

  test('(L1) savedFrom: uygulamanın gerçek "saved in … mode" cümlesi kayıtlı, "not saved" kayıtsız, bilinmeyen sayılmaz', async ($, on) => {
    expect(savedFrom(SAVED_LIVE)).toBe(true)
    expect(savedFrom(SAVED_AUTO)).toBe(true)
    expect(savedFrom(NOT_SAVED_LIVE)).toBe(false)
    expect(savedFrom(`Created task. ${NOT_SAVED_LIVE}: its runs start in the default mode.`)).toBe(false)
    expect(savedFrom('This task was saved in Default mode because this session is in it')).toBeUndefined()
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    world.percent = 10
    world.createText = SAVED_LIVE
    await become($, world, clock, 's1', { ...SELF })
    expect(await typedTurn($, clock, 'devam')).toEqual([])
    expect(world.store[PAIR_KEY]).toMatchObject({ gen: 1, ids: [...PAIR1], savedMode: 'bypassPermissions' })
    expect(world.store[`hazirlik:${HASH}`]).toMatchObject({
      state: 'done',
      misses: 0,
      created: { [PAIR1[0]]: 'saved', [PAIR1[1]]: 'saved' },
    })
    await turnEnd($, 'tamam')
  })

  test('(L2) kapı: çalışma sohbetinde kapı adımı yok, kapı hatası "kapalı" sayılır; normal sohbette de hata erken dönmez', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik', depoGoruldu: true, ...READY })
    world.runSeq = 1
    await become($, world, clock, 'local_run1', { ...SELF, scheduledTaskId: PAIR1[0] })
    await machine($, chainMessage(FILE), 'peer-send-message')
    await turnBegin($)
    const trip = (await bash($)).context ?? []
    expect(trip).toEqual([runChatHandoff(40, true)])
    expect(trip[0]).toContain("tek bir kod bloğu içinde ver")
    expect(trip[0]).not.toContain('önce mcp__ccd_session__list_start_targets aracını çağır')
    await clock.advance(100)
    // The model calls the gate anyway: the app's error reads as "closed", the request goes to the relay.
    writePrompt(world, clock, 'Devam et: hop 2')
    const gate = await $.tool.call({ tool: GATE })
    expect(gate.isError).toBe(true)
    expect(gate.context).toEqual([RELAY_NOTE])
    expect(world.store['istek:local_run1']).toMatchObject({ state: 'pending', taskId: PAIR1[0] })
    await turnEnd($, 'Devir istendi.')
    expect(await phase($)).toContain('aşama: handoff_running')

    // A regular chat whose gate errors: closed too, the mod dispatches (no early return).
    delete world.store['istek:local_run1']
    world.gateError = true
    await become($, world, clock, 's1', { ...SELF })
    await machine($, 'a1 bitti')
    await turnBegin($)
    expect((await bash($)).context).toEqual([gatedHandoff(40, true, PLAN)])
    await clock.advance(100)
    writePrompt(world, clock, 'Devam et: adım 3')
    expect((await $.tool.call({ tool: GATE })).context).toEqual([OWN_DISPATCH_NOTE])
    await turnEnd($, 'Devir yapıldı.')
    await clock.advance(60_000)
    expect(callsOf(world, RUN).map((c: any) => c.taskId)).toEqual([PAIR1[0]])
    expect(await phase($)).toContain('aşama: done')
    expect(callsOf(world, START)).toHaveLength(0)
  })

  test('(L3) ön hazırlık isteği oturuma bağlı ve kısa ömürlü: başka sohbetleri saatlerce kilitlemez; sahipsiz kalan istek bir eksik sayılır', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    world.percent = 10
    world.createText = SAVED_LIVE
    // s1 asks by hand; while its ask is open, another chat in the folder is held off.
    await become($, world, clock, 's1', { ...SELF })
    await devir($, 'hazirla')
    expect(world.store[`hazirlik:${HASH}`]).toMatchObject({ by: 's1', state: 'asked', via: 'hazirla', ids: [...PAIR1] })
    await become($, world, clock, 's2', { ...SELF })
    expect(await typedTurn($, clock)).toEqual([])
    await turnEnd($, 'tamam')
    expect(callsOf(world, CREATE)).toHaveLength(0)
    // Past the short TTL (s1 is gone) the same ids are made in another chat, one miss counted.
    await clock.advance(10 * 60 * 1000)
    await become($, world, clock, 's3', { ...SELF })
    expect(await typedTurn($, clock)).toEqual([])
    expect(ownCreates(world).map((c: any) => c.taskId)).toEqual([...PAIR1])
    expect(world.store[`hazirlik:${HASH}`]).toMatchObject({ by: 's3', state: 'done', misses: 1, gen: 1 })
    await turnEnd($, 'tamam')
    // A v0.5.0 record (no `by`, asked 11 minutes ago) holds nothing, and counts as a miss.
    delete world.store[PAIR_KEY]
    setStore(world, `hazirlik:${HASH}`, {
      gen: 2, ids: [...PAIR2], mode: 'bypassPermissions', at: clock.now() - 11 * 60 * 1000, state: 'asked', created: {}, misses: 0,
    })
    await become($, world, clock, 's4', { ...SELF })
    expect(await typedTurn($, clock)).toEqual([])
    expect(ownCreates(world).map((c: any) => c.taskId)).toEqual([...PAIR1, ...PAIR2])
    expect(world.store[`hazirlik:${HASH}`]).toMatchObject({ by: 's4', state: 'done', misses: 1, gen: 2 })
    await turnEnd($, 'tamam')
    // The miss limit: a second abandoned ask the same day stops the folder.
    delete world.store[PAIR_KEY]
    const ids3 = scheduledPlan('/proj', 3).ids
    setStore(world, `hazirlik:${HASH}`, {
      gen: 3, ids: [...ids3], mode: 'bypassPermissions', at: clock.now() - 11 * 60 * 1000, state: 'asked', created: {},
      by: 'gone', misses: 1, missDay: new Date(clock.now()).toISOString().slice(0, 10),
    })
    await become($, world, clock, 's5', { ...SELF })
    expect(await typedTurn($, clock)).toEqual([])
    await turnEnd($, 'tamam')
    expect(ownCreates(world)).toHaveLength(4)
    expect(world.store[`hazirlik:${HASH}`]).toMatchObject({ state: 'failed', misses: 2 })
  })

  test('(L4) gerçek prompt mesajı tek satırlık Türkçe "başka sohbetten iletilen devam" satırıyla başlar', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik', depoGoruldu: true, ...READY })
    world.runSeq = 1
    await become($, world, clock, 'local_run1', { ...SELF, scheduledTaskId: PAIR1[0] })
    await runChatHop($, world, clock, 'Devam et: hop 2')
    await become($, world, clock, 'local_relay', { ...SELF })
    await clock.advance(30_000)
    const [sent] = callsOf(world, SEND)
    const [first, ...rest] = String(sent.message).split('\n')
    expect(first).toBe(RELAYED_LINE)
    expect(first).toContain('otomatik devrin devamı')
    expect(first).toContain('başka bir sohbet tarafından iletildi')
    expect(rest.join('\n')).toBe(taskPrompt(FILE))
  })

  // v0.5.2: provisioning without notes to the model.

  test('(P1) hiçbir modda araç sonucunun bağlamına ön hazırlık metni eklenmez', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    world.percent = 10
    world.createText = SAVED_LIVE
    const contexts: string[] = []
    let n = 0
    for (const permissionMode of ['bypassPermissions', 'auto', 'default', 'acceptEdits', 'plan']) {
      for (const createText of [SAVED_LIVE, NOT_SAVED_LIVE]) {
        world.createText = createText
        delete world.store[PAIR_KEY]
        await devir($, 'otomatik')
        await become($, world, clock, `s${++n}`, { ...SELF, permissionMode })
        contexts.push(...(await typedTurn($, clock)))
        contexts.push(...((await bash($)).context ?? []))
        await turnEnd($, 'tamam')
        // The /devir hazirla turn too: the request is the person's own message, never context.
        await devir($, 'hazirla')
        await clock.advance(100)
        contexts.push(...(await typedTurn($, clock, world.fills.at(-1) ?? 'iş')))
        await turnEnd($, 'tamam')
        newDay(world)
      }
    }
    expect(ownCreates(world).length).toBeGreaterThan(0)
    expect(contexts).toEqual([])
    for (const turn of world.typed) expect(turn.context).toEqual([])
  })

  test('(P2) modun kendi oluşturması reddedilir / hata verir / "saklanmadı" der: eksik, failed, o gün yeniden deneme yok, klasör başına tek bildirim', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    world.percent = 10
    const cases = [
      { result: { deny: 'Permission denied' }, reason: 'izin verilmedi' },
      { result: { result: [], text: 'Scheduled tasks are unavailable.', isError: true }, reason: 'görev aracı hata verdi' },
      { result: { result: [] }, reason: 'görev aracı hata verdi' },
      { result: undefined, reason: 'uygulama izin modunu görevle saklamadı' },
    ]
    let n = 0
    for (const { result, reason } of cases) {
      world.createResult = result
      world.createText = NOT_SAVED_LIVE
      const before = ownCreates(world).length
      await become($, world, clock, `s${++n}`, { ...SELF })
      expect(await typedTurn($, clock)).toEqual([])
      await turnEnd($, 'tamam')
      // One create tried, the second never made.
      expect(ownCreates(world).length - before).toBe(1)
      expect(world.store[`hazirlik:${HASH}`]).toMatchObject({ state: 'failed', misses: 1 })
      // The same day, another chat: no retry.
      await become($, world, clock, `s${++n}`, { ...SELF })
      expect(await typedTurn($, clock)).toEqual([])
      await turnEnd($, 'tamam')
      expect(ownCreates(world).length - before).toBe(1)
      if (n === 2) expect(world.toasts).toEqual([setupFailHint(reason)])
      newDay(world)
    }
    // One toast for the folder, whatever came after.
    expect(world.toasts).toHaveLength(1)
    expect(world.toasts[0]).toContain('/devir hazirla')
    expect(world.store['kendiKurulum']).toMatchObject({ unsaved: 1 })
    expect(world.store['kendiKurulum'].off).toBeUndefined()
  })

  test('(P3) iki "saklanmadı" çifti (farklı klasörler): kendi kurulum her yerde kapanır, tek bildirim; /devir hazirla açar', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    world.percent = 10
    world.createText = NOT_SAVED_LIVE
    for (const [sid, cwd] of [['s1', '/proj'], ['s2', '/other']] as const) {
      world.cwd = cwd
      await become($, world, clock, sid, { ...SELF })
      expect(await typedTurn($, clock)).toEqual([])
      await turnEnd($, 'tamam')
    }
    expect(ownCreates(world).map((c: any) => c.taskId)).toEqual([PAIR1[0], scheduledPlan('/other', 1).ids[0]])
    expect(world.store['kendiKurulum']).toMatchObject({ off: true, unsaved: 2, reason: 'izin modu saklanmadı' })
    expect(world.toasts.filter((t: string) => t === SETUP_OFF_HINT)).toHaveLength(1)
    // Off everywhere: a third folder (and another day) gets no own create.
    world.createText = SAVED_LIVE
    newDay(world)
    world.cwd = '/third'
    await become($, world, clock, 's3', { ...SELF })
    expect(await typedTurn($, clock)).toEqual([])
    await turnEnd($, 'tamam')
    expect(ownCreates(world)).toHaveLength(2)
    expect(world.toasts.filter((t: string) => t === SETUP_OFF_HINT)).toHaveLength(1)
    // `/devir hazirla` clears the stop: the next qualifying chat creates again.
    await devir($, 'hazirla')
    expect(world.store['kendiKurulum']).toBeUndefined()
    world.cwd = '/fourth'
    await become($, world, clock, 's4', { ...SELF })
    expect(await typedTurn($, clock)).toEqual([])
    await turnEnd($, 'tamam')
    expect(ownCreates(world).map((c: any) => c.taskId)).toContain(scheduledPlan('/fourth', 1).ids[1])
  })

  test('(P4) Auto: mod kendisi hiç oluşturmaz; yalnızca /devir hazirla', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    world.percent = 10
    world.createText = SAVED_AUTO
    await become($, world, clock, 's1', { ...SELF, permissionMode: 'auto' })
    expect(await typedTurn($, clock)).toEqual([])
    await turnEnd($, 'tamam')
    await become($, world, clock, 's2', { ...SELF, permissionMode: 'auto' })
    expect(await typedTurn($, clock)).toEqual([])
    await turnEnd($, 'tamam')
    expect(callsOf(world, CREATE)).toHaveLength(0)
    expect(world.store[`hazirlik:${HASH}`]).toBeUndefined()
    expect(world.toasts).toEqual([])
  })

  test('(P5) yok sayılan /devir hazirla isteği yazılan turun sonunda eksik sayılır; makinenin turu isteği tüketmez', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    world.percent = 10
    world.createText = SAVED_LIVE
    await become($, world, clock, 's1', { ...SELF })
    await devir($, 'hazirla')
    await clock.advance(100)
    // A machine's turn ends first: the ask waits for the person's send.
    await machine($, 'a1 bitti')
    await turnBegin($)
    await bash($)
    await clock.advance(100)
    await turnEnd($, 'tamam')
    expect(world.store[`hazirlik:${HASH}`]).toMatchObject({ state: 'asked', by: 's1', misses: 0 })
    // The person sends something else; nothing is created in that turn.
    expect(await typedTurn($, clock, 'başka bir şey')).toEqual([])
    expect(callsOf(world, CREATE)).toHaveLength(0)
    await turnEnd($, 'tamam')
    const ask = world.store[`hazirlik:${HASH}`]
    expect(ask).toMatchObject({ state: 'failed', misses: 1 })
    expect(ask.until).toBeLessThanOrEqual(clock.now())
    // Same day, Bypass: no own create in this folder.
    await become($, world, clock, 's2', { ...SELF })
    expect(await typedTurn($, clock)).toEqual([])
    await turnEnd($, 'tamam')
    expect(callsOf(world, CREATE)).toHaveLength(0)
    // A hazirla ask the model fulfils in the sent turn is no miss.
    await devir($, 'hazirla')
    await clock.advance(100)
    expect(await typedTurn($, clock, world.fills.at(-1))).toEqual([])
    for (const taskId of PAIR1) await $.tool.call({ tool: CREATE, taskId, prompt: '-', description: '-' })
    await turnEnd($, 'tamam')
    expect(world.store[`hazirlik:${HASH}`]).toMatchObject({ state: 'done', misses: 1, via: 'hazirla' })
    expect(world.store[PAIR_KEY]).toMatchObject({ gen: 1, savedMode: 'bypassPermissions' })
  })

  test('(P6) /devir hazirla isteği giriş kutusuna açık, İngilizce yazar: kimlikler ve mod yolu var, gizleme yok; kutu almazsa bildirim', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik', kendiKurulum: { unsaved: 2, off: true } })
    world.percent = 10
    await become($, world, clock, 's1', { ...SELF })
    const reply = await devir($, 'hazirla')
    expect(reply.text).toContain(PAIR1[0])
    await clock.advance(100)
    expect(world.fills).toEqual([provisionRequest(PAIR1)])
    const text = world.fills[0]
    for (const id of PAIR1) expect(text).toContain(`"${id}"`)
    expect(text).toContain('~/.claude/mods/otomatik-devir')
    expect(text).toContain('mcp__scheduled-tasks__create_scheduled_task')
    expect(text).toContain('permission mode')
    expect(text).toContain('prompt "-"')
    expect(text).toContain('no schedule')
    for (const hidden of ['anlatma', "don't mention", 'do not mention', 'not mention', 'hide', 'secret']) {
      expect(text.toLowerCase()).not.toContain(hidden)
    }
    expect(world.store['kendiKurulum']).toBeUndefined()
    expect(world.store[`hazirlik:${HASH}`]).toMatchObject({ state: 'asked', by: 's1', via: 'hazirla', ids: [...PAIR1] })
    expect(world.toasts).toEqual([])
    // No box takes it (a dialog, a surface with its own composer): the same text as a toast.
    world.fillOk = false
    await become($, world, clock, 's2', { ...SELF })
    await devir($, 'hazirla')
    await clock.advance(100)
    expect(world.toasts).toHaveLength(1)
    expect(world.toasts[0]).toContain(provisionRequest(PAIR1))
    // Default mode: refused, nothing recorded anew.
    await become($, world, clock, 's3', { ...SELF, permissionMode: 'default' })
    expect((await devir($, 'hazirla')).text).toContain('Auto ya da Bypass')
    expect(world.store[`hazirlik:${HASH}`]).toMatchObject({ by: 's2' })
  })
})
