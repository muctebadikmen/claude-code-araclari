import { describe, expect, mock, test } from 'claude-code/testing'

import {
  DEFAULT_LIMIT,
  handoffFile,
  HANDED_PREFIX,
  KIMLIK_PREFIX,
  LONG_CHAT_SECTION_ID,
  MANAGED_START_DENY,
  managedHandoff,
  NORMAL_INFO,
  ORKESTRA_PAUSED_BAND,
  ORKESTRA_SECTION_ID,
  orkestraRecordFile,
  READY_BAND,
  RUN_PREFIX,
  SKILL_HANDOFF_DENY,
  zincirAyarFile,
} from '../hooks/register.tsx'

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
const HAND_OFF = 'mcp__ccd_session__hand_off_to_session'
const GET = 'mcp__ccd_session_mgmt__get_session'
// A call v1 must never make: the child stays nested (Decision 9).
const DETACH = 'mcp__ccd_session_mgmt__detach_session'
const NEW_ID = 'local_bec10f6a-0001'
const SID = 's1'
const FILE = handoffFile('/proj', SID)
const HANDOFF_TEXT = '# Devir\n\nDevam et: adım 3\n\n## Devam prompt\'u\nAdım 3\'ten sürdür.\n'
const HOME = '/home/test'

// v1.1 (Decision 19): a threshold handoff happens only in a managed sub-chat.
// The harness makes `s1` one by default (role `alt`): its parent chain's main
// record, its own record, `kimlik:s1` and the chain settings are seeded, so
// session.start restores the role (O16). Role `yok` is a normal chat (passive,
// O20); role `ana` makes `s1` the main chat itself (the paused band, M4).
type Role = 'alt' | 'yok' | 'ana'
const MAIN_ID = 'local_main'
const CHILD_ID = 'local_c1'
const MAIN_RECORD = {
  role: 'ana',
  sid: 'main',
  localId: MAIN_ID,
  task: 'iş',
  title: 'iş',
  n: 1,
  childId: CHILD_ID,
  isHeld: true,
  startedAt: 0,
  at: 0,
}
const CHILD_RECORD = { role: 'alt', parent: MAIN_ID, n: 1, sid: SID, localId: CHILD_ID, status: 'working', at: 0 }
const NOT_ORCHESTRATED = `Bu sohbet orkestra modunda değil (sınır ${DEFAULT_LIMIT} alt sohbet). Başlatmak için /otomatik-devir:devir-otonom <görev> yaz.`

/** A record (or chain settings) file as BACKEND file keeps it (store-probe.md). */
const seedJson = (world: any, path: string, value: unknown) => {
  world.files[path] = { text: JSON.stringify(value), mtimeMs: 0 }
}
const readJson = (world: any, path: string) => {
  const held = world.files[path]
  return held === undefined ? undefined : JSON.parse(held.text)
}

/** The world beneath the mod: a session whose id and context fill the test controls. */
const setup = (
  on: any,
  store: Record<string, unknown> = { esik: 40 },
  opts: { commands?: string[]; tools?: string[]; role?: Role } = {},
) => {
  const { commands = [SKILL], tools = [START, GET, HAND_OFF], role = 'alt' } = opts
  const world = {
    sid: SID,
    percent: 50 as number | undefined,
    // Messages the mod itself submitted (its own turns): v1 sends none.
    sent: [] as string[],
    // Messages the person typed, with the context hooks attached to them.
    typed: [] as { text: string; context: readonly string[] }[],
    ran: [] as string[],
    toasts: [] as string[],
    statuses: [] as (string | undefined)[],
    calls: [] as any[],
    spawns: [] as any[],
    // The paths the mod wrote with $.fs.write.
    writes: [] as string[],
    // `get_session self` per transcript id; any other id is a normal chat.
    self: {} as Record<string, Record<string, unknown>>,
    // The mod's durable store, as it stands.
    store: { ...store } as Record<string, unknown>,
    // The files the model wrote, by path, as the file system holds them.
    files: {} as Record<string, { text: string; mtimeMs: number }>,
  }
  if (role === 'alt') {
    world.self[SID] = { sessionId: CHILD_ID, parentSessionId: MAIN_ID, title: 'Eski iş' }
    world.store[`${KIMLIK_PREFIX}${SID}`] = CHILD_ID
    seedJson(world, orkestraRecordFile(HOME, MAIN_ID), MAIN_RECORD)
    seedJson(world, orkestraRecordFile(HOME, CHILD_ID), CHILD_RECORD)
  }
  if (role === 'ana') {
    world.self[SID] = { sessionId: MAIN_ID, title: 'Ana' }
    world.store[`${KIMLIK_PREFIX}${SID}`] = MAIN_ID
    seedJson(world, orkestraRecordFile(HOME, MAIN_ID), { ...MAIN_RECORD, sid: SID })
  }
  // M11 (Decision 22): the test's global `esik`/`acik` become this chain's settings.
  if (role !== 'yok') {
    seedJson(world, zincirAyarFile(HOME, MAIN_ID), {
      esik: store.esik,
      isClosed: store.acik === false ? true : undefined,
      at: 0,
    })
  }
  const clock = mock.clock(on, { now: 1_000_000 })
  // The store lives in memory here (not mock.store), so a test can read what the mod kept.
  on('store.get', (_$: any, e: any) => ({ value: world.store[e.key] }))
  on('store.set', (_$: any, e: any) => {
    world.store[e.key] = e.value
    return { value: undefined }
  })
  on('store.delete', (_$: any, e: any) => {
    delete world.store[e.key]
    return { value: undefined }
  })
  on('store.keys', () => ({ value: Object.keys(world.store) }))
  // Nothing beneath the mod answers the main loop's Stop: it ends.
  on('classic.Stop', () => ({}))
  mock.env(on, { HOME })
  // The plugins below this one in the shared band (other mods, or the engine).
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) =>
    $.ui.resolve(e).Box({ key: 'below' }),
  )
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
  on('command.run', ($: any, e: any) => {
    world.ran.push(e.command)
    return {}
  })
  on('agent.list', () => ({ value: [] }))
  on('agent.spawn', ($: any, e: any) => {
    world.spawns.push(e)
    return { model: 'claude-haiku', agentId: `a${world.spawns.length}` }
  })
  on('tool.list', () => ({
    value: tools.map(name => ({ name, description: '', mcp: true })),
  }))
  on('tool.call', ($: any, e: any) => {
    world.calls.push(e)
    if (e.tool === GET) {
      const self = world.self[world.sid] ?? { sessionId: 'local_self', title: 'Eski iş' }
      return { result: [], text: JSON.stringify(self) }
    }
    if (e.tool === START) {
      return { result: [], text: `Started session "${e.title}" (session_id: ${NEW_ID}, name: eski-is)` }
    }
    return { result: [], text: 'ok' }
  })
  on('fs.exists', () => ({ value: false }))
  on('fs.stat', ($: any, e: any) => {
    const held = world.files[e.path]
    if (held === undefined) throw new Error('ENOENT')
    return { value: { kind: 'file', size: held.text.length, mtimeMs: held.mtimeMs, isLink: false } }
  })
  on('fs.read', ($: any, e: any) => {
    const held = world.files[e.path]
    if (held === undefined) throw new Error('ENOENT')
    return { value: held.text }
  })
  // BACKEND file: the records and chain settings the mod writes (mtime = now).
  on('fs.write', ($: any, e: any) => {
    world.writes.push(e.path)
    world.files[e.path] = { text: String(e.content ?? e.text ?? e.data ?? ''), mtimeMs: clock.now() }
    return { value: undefined }
  })
  on('prompt.submit', ($: any, e: any) => {
    if (e.origin?.kind === 'plugin' || e.origin === undefined) world.sent.push(e.text)
    else world.typed.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text, context: e.context }
  })
  on('ui.status', ($: any, e: any) => {
    world.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.log', () => ({ value: undefined }))
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

// The turn id turnEnd closes: the one turnBegin opened last (the engine pairs them).
let turnSeq = 0
const turnEnd = ($: any, answer: string, isAborted = false) =>
  $.turn.complete({
    answer,
    durationMs: 1,
    isAborted,
    turnId: `tt${turnSeq}`,
    reason: isAborted ? 'aborted' : 'answer',
  })

const mountBand = ($: any, surface: 'terminal' | 'desktop' = 'terminal', props = BAND) =>
  $.ui.mount({ plugin: PLUGIN, surface, component: 'AbovePrompt', props })

const start = ($: any) =>
  $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })

const startCalls = (world: any) => world.calls.filter((c: any) => c.tool === START)
const callsOf = (world: any, tool: string) => world.calls.filter((c: any) => c.tool === tool)
const phase = async ($: any) => (await devir($, '')).text

/** The person presses Enter (Claude desktop's composer, or the terminal's). */
const typed = ($: any, text: string) =>
  $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
/** A message no person typed (a subagent's result, a schedule...). */
const machine = ($: any, text: string, kind = 'task-notification') =>
  $.prompt.submit({ text, origin: { kind }, wait: false })
const turnBegin = ($: any) => $.turn.start({ text: '', turnId: `tt${++turnSeq}` })
/** One main-loop tool call of the model's. */
const bash = ($: any) => $.tool.call({ tool: 'Bash', command: 'ls' })
/** The main loop tries to end its turn. */
const stop = ($: any, tasks: any[] = []) => $.classic.Stop({ stop_hook_active: false, background_tasks: tasks })
/** The model wrote the handoff file (newer than the claim at clock 1_000_000). */
const writeFile = (world: any, text = HANDOFF_TEXT, mtimeMs = 2_000_000) => {
  world.files[FILE] = { text, mtimeMs }
}

const SUBAGENT = { id: 'a1', type: 'subagent', status: 'running', description: 'araştır' }
const WORKFLOW = { id: 'w1', type: 'workflow', status: 'pending', description: 'denetim' }

/**
 * A typed turn that starts under the threshold and crosses it on the first
 * tool result: the instruction rides on that result.
 */
const typedTrip = async ($: any, world: any, clock: any) => {
  world.percent = 10
  await typed($, 'uzun işi yap')
  await turnBegin($)
  world.percent = 50
  const first = await bash($)
  await clock.advance(100)

  return first
}

/**
 * M4: the main chat (role `ana`, its record seeded and restored at session.start)
 * whose turn the person ends with Esc: the chain pauses and the band shows
 * ORKESTRA_PAUSED_BAND (O7).
 */
const toPaused = async ($: any, world: any, clock: any) => {
  await turnBegin($)
  await turnEnd($, '', true)
  await clock.advance(100)
  expect(readJson(world, orkestraRecordFile(HOME, MAIN_ID))).toMatchObject({ role: 'ana', isHeld: false })
  expect(world.statuses.at(-1)).toBe('Orkestra duraklatıldı')
  expect(startCalls(world)).toHaveLength(0)
}

describe('otomatik-devir', () => {
  test('(a) boşta: çıktı tam olarak alttaki çizimdir', async ($, on) => {
    // A normal chat (Decision 19): nothing of the mod's in the band; /devir answers NORMAL_INFO (Decision 22).
    setup(on, { esik: 40 }, { role: 'yok' })
    await start($)
    const ui = await mountBand($)
    const drawn: any = await ui.drawn()
    expect(drawn).toMatchObject({ type: 'Box', props: { key: 'below' } })
    expect(drawn.props.flexDirection).toBeUndefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    expect(await ui.findAll({ text: READY_BAND })).toHaveLength(0)
    expect(await phase($)).toBe(NORMAL_INFO)
    await ui.unmount()
  })

  test('(c) done aynı oturumda done kalır: tüketilen alt sohbet, eşiğin altındaki tur ve sonraki eşik aşımı yeni devir açmaz', async ($, on) => {
    // M6: a managed sub-chat reaches `done` when its main chat moved on (O15), not by starting a child itself.
    const { world, clock } = setup(on)
    await start($)
    await typedTrip($, world, clock)
    writeFile(world)
    expect((await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'x' })).deny).toBe(MANAGED_START_DENY)
    expect((await stop($))?.block).toBeUndefined()
    // The main chat relayed child 2: this child is consumed.
    seedJson(world, orkestraRecordFile(HOME, MAIN_ID), { ...MAIN_RECORD, n: 2, childId: 'local_c2' })
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: done')
    await turnEnd($, 'Devir dosyası yazıldı.')

    // Fill measured under the threshold (e.g. /compact): done does not go back to idle.
    world.percent = 10
    await $.session.measure({
      context: { window: 100, percent: 10 },
      rateLimits: [],
      changed: ['context'],
    })
    await turnBegin($)
    await turnEnd($, 'iş')
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: done')

    // Over the threshold again: no new instruction, no block, no child of its own.
    world.percent = 50
    await typed($, 'devam')
    expect(world.typed.at(-1)?.context).toEqual([])
    await turnBegin($)
    expect((await bash($)).context ?? []).toEqual([])
    expect((await stop($))?.block).toBeUndefined()
    await turnEnd($, 'tamam')
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: done')
    expect(startCalls(world)).toHaveLength(0)
    expect(world.sent).toEqual([])
  })

  test('(e) my-skill-handoff yoksa yedek talimat dosya yolunu ve "## Devam prompt\'u" başlığını taşır', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40 }, { commands: [] })
    await start($)
    const first = await typedTrip($, world, clock)
    expect(first.context).toEqual([managedHandoff(40, FILE, false)])
    expect(first.context[0]).toContain(FILE)
    expect(first.context[0]).toContain("## Devam prompt'u")
    expect(first.context[0]).not.toContain(SKILL)
    expect(world.ran).toEqual([])
    expect(await phase($)).toContain('aşama: handoff_running')
  })

  test('(h) model çalışırken orkestra duraklatıldı bandı çizilmez', async ($, on) => {
    // M4: the one row the mod still draws is the main chat's paused band (O7).
    const { world, clock } = setup(on, { esik: 40 }, { role: 'ana' })
    await start($)
    await toPaused($, world, clock)

    // Idle turn: the row is first, the drawing beneath stays.
    const ui = await mountBand($)
    const shown: any = await ui.drawn()
    expect(shown.type).toBe('Box')
    expect(shown.props.flexDirection).toBe('column')
    expect(shown.children[0]).toMatchObject({ type: 'Box', props: { key: 'devir' } })
    expect(shown.children[1]).toMatchObject({ type: 'Box', props: { key: 'below' } })
    expect((await ui.find({ text: ORKESTRA_PAUSED_BAND }))?.text).toBe(ORKESTRA_PAUSED_BAND)
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)

    // While the model works the row stays hidden.
    await ui.redraw({ ...BAND, isWorking: true })
    expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { key: 'below' } })
    expect(await ui.findAll({ text: ORKESTRA_PAUSED_BAND })).toHaveLength(0)
    await ui.unmount()
  })

  test('(i) zinciri kapalıyken eşik aşılsa da devir başlamaz', async ($, on) => {
    // M11: `acik:false` is this chain's `isClosed: true` (Decision 22).
    const { world, clock } = setup(on, { esik: 40, acik: false })
    await start($)
    await typed($, 'iş')
    expect(world.typed[0]?.context).toEqual([])
    await turnBegin($)
    expect((await bash($)).context ?? []).toEqual([])
    expect((await stop($))?.block).toBeUndefined()
    await turnEnd($, 'tamam')
    await clock.advance(100)
    expect(world.ran).toEqual([])
    expect(world.sent).toEqual([])
    expect(startCalls(world)).toHaveLength(0)
    expect(await phase($)).toContain('Devir: kapalı')
    expect(await phase($)).toContain('aşama: idle')
    expect(world.store[`${RUN_PREFIX}${SID}`]).toBeUndefined()
  })

  test('(o1) yazılan turda eşik aşılır: talimat araç sonucunda gelir, yönetilen alt sohbet yeni sohbet açamaz, dosyayla ready olur, devredildi: yazılmaz', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    const first = await typedTrip($, world, clock)
    expect(first.context).toEqual([managedHandoff(40, FILE)])
    expect(first.context[0]).not.toContain('initiation "user_asked"')
    expect(first.context[0]).toContain('Kalan: var')
    expect(first.context[0]).toContain(`auto ${FILE}`)
    expect(await phase($)).toContain('aşama: handoff_running')
    // The claim is durable before anything else happens.
    expect(world.store[`${RUN_PREFIX}${SID}`]).toMatchObject({
      file: FILE,
      phase: 'handoff_running',
    })
    // One instruction: the next result carries nothing more.
    expect((await bash($)).context ?? []).toEqual([])

    // M3 (O13): no file, a stale file or a fresh one: this chat never starts a session.
    const early = await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'x' })
    expect(early.deny).toBe(MANAGED_START_DENY)
    writeFile(world, HANDOFF_TEXT, 1)
    const stale = await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'x' })
    expect(stale.deny).toBe(MANAGED_START_DENY)
    expect(startCalls(world)).toHaveLength(0)

    // The file is written: the model's start_session is still denied. The
    // forwarding (prompt = file + message, background >= 80, title, no detach)
    // now belongs to the main chat's O4 (orkestra-ana A7/A10).
    writeFile(world)
    const started = await $.tool.call({
      tool: START,
      initiation: 'user_asked',
      prompt: 'modelin kendi prompt\'u',
      background: 'kısa',
    })
    expect(started.deny).toBe(MANAGED_START_DENY)
    expect(String(started.text ?? '')).not.toContain(NEW_ID)
    expect(startCalls(world)).toHaveLength(0)
    const fork = await $.tool.call({ tool: HAND_OFF, title: 'x', remaining_plan: 'y' })
    expect(fork.deny).toBe(MANAGED_START_DENY)
    expect(callsOf(world, HAND_OFF)).toHaveLength(0)
    expect(world.store[`${HANDED_PREFIX}${SID}`]).toBeUndefined()
    await clock.advance(100)

    // The turn ends with no block: the fresh file makes the handoff `ready` (Stop (d)).
    expect((await stop($))?.block).toBeUndefined()
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: ready')
    expect(world.store[`${RUN_PREFIX}${SID}`]).toMatchObject({ file: FILE, phase: 'ready' })
    // O14: its own record says `ready` with the file, for the main chat to relay.
    expect(readJson(world, orkestraRecordFile(HOME, CHILD_ID))).toMatchObject({ status: 'ready', file: FILE })
    // Nested child: no detach, no /clear, no ready toast (O12), no handed-off flag.
    expect(callsOf(world, DETACH)).toEqual([])
    expect(world.ran).toEqual([])
    expect(world.toasts).not.toContain(READY_BAND)
    expect(world.store[`${HANDED_PREFIX}${SID}`]).toBeUndefined()

    // A second start_session is denied as well, nothing reaches the app.
    const again = await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'x' })
    expect(again.deny).toBe(MANAGED_START_DENY)
    expect(startCalls(world)).toHaveLength(0)

    await turnEnd($, 'Devir dosyası yazıldı.')
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: ready')
    expect(world.sent).toEqual([])
    expect(callsOf(world, DETACH)).toEqual([])
  })

  test(
    '(M1) başka bir modun $.tool.call çağrısı talimatı almaz',
    {
      plugins: [
        {
          name: 'baska-mod',
          register(on: any) {
            on('command.run', { command: 'baska' }, async ($: any) => {
              const got = await $.tool.call({ tool: 'Bash', command: 'pwd' })
              return { text: JSON.stringify(got.context ?? []) }
            })
          },
        },
      ],
    },
    async ($, on) => {
      const { world } = setup(on)
      await start($)
      world.percent = 10
      await typed($, 'iş')
      await turnBegin($)
      world.percent = 50
      const other = await $.command.run({
        command: 'baska',
        args: '',
        origin: { kind: 'composer' },
        presentation: { isFullscreen: false, columns: 100 },
      } as any)
      expect((other as any).text).toBe('[]')
      expect(await phase($)).toContain('aşama: idle')
      expect(world.store[`${RUN_PREFIX}${SID}`]).toBeUndefined()
      // The model's own call still gets it.
      expect((await bash($)).context).toEqual([managedHandoff(40, FILE)])
    },
  )

  test('(M2) yönetilen alt sohbette hand_off_to_session her aşamada reddedilir; normal sohbette dokunulmadan geçer', async ($, on) => {
    const { world, clock } = setup(on)
    // A normal chat (no parent): the call passes untouched (O20).
    world.sid = 'n1'
    await start($)
    await $.tool.call({ tool: HAND_OFF, title: 'x', remaining_plan: 'y' })
    expect(callsOf(world, HAND_OFF)).toHaveLength(1)
    expect(callsOf(world, HAND_OFF)[0]).toMatchObject({ title: 'x', remaining_plan: 'y' })

    // The managed sub-chat s1 (a fresh engine load): denied idle and during its handoff (O13).
    world.sid = SID
    await start($)
    expect((await $.tool.call({ tool: HAND_OFF, title: 'x', remaining_plan: 'y' })).deny).toBe(MANAGED_START_DENY)
    await typedTrip($, world, clock)
    expect(await phase($)).toContain('aşama: handoff_running')
    const fork = await $.tool.call({ tool: HAND_OFF, title: 'x', remaining_plan: 'y' })
    expect(fork.deny).toBe(MANAGED_START_DENY)
    expect(String(fork.deny)).toContain('yeni sohbet açma')
    expect(callsOf(world, HAND_OFF)).toHaveLength(1)
  })
})

// Decision 19, O20: a normal chat (role `yok`) is fully passive, whatever the
// old global `esik`/`acik` say and at any fill; Decision 22: its `/devir`
// verbs change nothing anywhere.
describe('normal sohbet pasif (D19)', () => {
  const normal = (on: any, opts: { commands?: string[] } = {}) => {
    const got = setup(on, { esik: 40, acik: true }, { ...opts, role: 'yok' })
    got.world.percent = 90
    return got
  }
  // The engine's own sections beneath the mod.
  const base = (on: any) =>
    on('prompt.compose', () => ({
      sections: [
        { id: 'intro', text: 'giriş', scope: 'shared' },
        { id: 'env', text: 'ortam', scope: 'session' },
      ],
    }))
  const sectionIds = async ($: any) =>
    (
      await $.prompt.compose({
        model: 'claude-test',
        promptModel: 'claude-test',
        surfaces: ['terminal'],
        tools: [],
        outputStyle: null,
        traits: [],
      })
    ).sections.map((s: any) => s.id) as string[]
  const runKeys = (world: any) => Object.keys(world.store).filter(key => key.startsWith(RUN_PREFIX))
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

  test('(P1) yazılan ve makine turu eşik üstünde: araç sonucu bağlam taşımaz, Stop tutmaz, devir: yok, /devir NORMAL_INFO', async ($, on) => {
    const { world, clock } = normal(on)
    await start($)
    await typed($, 'uzun işi yap')
    expect(world.typed.at(-1)?.context).toEqual([])
    await turnBegin($)
    for (let i = 0; i < 3; i += 1) expect((await bash($)).context ?? []).toEqual([])
    expect((await stop($, [SUBAGENT, WORKFLOW]))?.block).toBeUndefined()
    await turnEnd($, 'tamam')
    await clock.advance(100)

    await machine($, 'a1 bitti')
    await turnBegin($)
    expect((await bash($)).context ?? []).toEqual([])
    expect((await stop($, [SUBAGENT, WORKFLOW]))?.block).toBeUndefined()
    await turnEnd($, 'tamam')
    await clock.advance(100)

    expect(runKeys(world)).toEqual([])
    expect(world.toasts).toEqual([])
    expect((await devir($, '')).text).toBe(NORMAL_INFO)
  })

  test('(P2) prompt.compose: otomatik-devir bölümü yok (long-chat, orkestra, eski kimlik)', async ($, on) => {
    const { world, clock } = normal(on)
    base(on)
    await start($)
    expect(await sectionIds($)).toEqual(['intro', 'env'])
    await typed($, 'iş')
    await turnBegin($)
    await bash($)
    await clock.advance(100)
    const ids = await sectionIds($)
    expect(ids).not.toContain(LONG_CHAT_SECTION_ID)
    expect(ids).not.toContain(ORKESTRA_SECTION_ID)
    expect(ids).not.toContain('otomatik-devir')
    expect(ids).toEqual(['intro', 'env'])
    expect(world.writes).toEqual([])
  })

  test('(P3) "devam et" sonrası Skill my-skill-handoff geçer; Agent, Workflow ve agent.spawn geçer', async ($, on) => {
    const { world } = normal(on)
    await start($)
    await typed($, 'devam et')
    await turnBegin($)
    await bash($)
    const skill = await $.tool.call({ tool: 'Skill', skill: SKILL } as any)
    expect(skill.deny).toBeUndefined()
    expect(skill.deny).not.toBe(SKILL_HANDOFF_DENY)
    expect(callsOf(world, 'Skill')).toHaveLength(1)
    expect((await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'y' } as any)).deny).toBeUndefined()
    expect((await $.tool.call({ tool: 'Workflow', script: 'x' } as any)).deny).toBeUndefined()
    expect(callsOf(world, 'Agent')).toHaveLength(1)
    expect(callsOf(world, 'Workflow')).toHaveLength(1)
    const spawned: any = await spawn($, 'normal')
    expect(spawned.deny).toBeUndefined()
    expect(world.spawns).toHaveLength(1)
  })

  test('(P4) start_session ve hand_off_to_session dokunulmadan geçer; devredildi:<sid> varken de', async ($, on) => {
    const { world } = normal(on)
    const model = {
      tool: START,
      initiation: 'user_asked',
      context: 'fresh',
      title: 'model başlığı',
      background: 'kısa',
      prompt: 'modelin promptu',
    }
    await start($)
    await typed($, 'yeni sohbet aç')
    await turnBegin($)
    const started = await $.tool.call(model as any)
    expect(started.deny).toBeUndefined()
    expect(startCalls(world)).toHaveLength(1)
    expect(startCalls(world)[0]).toMatchObject({ title: 'model başlığı', prompt: 'modelin promptu', background: 'kısa' })
    expect(world.store[`${HANDED_PREFIX}${SID}`]).toBeUndefined()
    expect((await $.tool.call({ tool: HAND_OFF, title: 'x', remaining_plan: 'y' } as any)).deny).toBeUndefined()
    expect(callsOf(world, HAND_OFF)).toHaveLength(1)

    // Another normal chat that a v1 handoff left `devredildi:` (no "zaten devredildi" deny).
    world.sid = 's2'
    world.store[`${HANDED_PREFIX}s2`] = { handoffId: 's2-x', startedId: 'local_old', file: FILE, at: 0 }
    await start($)
    await typed($, 'yine aç')
    await turnBegin($)
    const again = await $.tool.call({ ...model, title: 'ikinci' } as any)
    expect(again.deny).toBeUndefined()
    expect(startCalls(world)).toHaveLength(2)
    expect(startCalls(world)[1]).toMatchObject({ title: 'ikinci', prompt: 'modelin promptu' })
    expect((await $.tool.call({ tool: HAND_OFF, title: 'x', remaining_plan: 'y' } as any)).deny).toBeUndefined()
    expect(callsOf(world, HAND_OFF)).toHaveLength(2)
    expect(world.store[`${HANDED_PREFIX}s2`]).toMatchObject({ startedId: 'local_old' })
  })

  test('(P5) durum satırı hep undefined; bant yalnızca alttakini çizer', async ($, on) => {
    const { world, clock } = normal(on)
    await start($)
    await clock.advance(100)
    const afterStart = world.statuses.length
    expect(afterStart).toBeGreaterThan(0)
    await $.session.measure({ context: { window: 100, percent: 90 }, rateLimits: [], changed: ['context'] })
    expect(world.statuses.length).toBeGreaterThan(afterStart)
    const afterMeasure = world.statuses.length
    await typed($, 'iş')
    await turnBegin($)
    await bash($)
    await turnEnd($, 'tamam')
    await clock.advance(100)
    expect(world.statuses.length).toBeGreaterThan(afterMeasure)
    expect(world.statuses.every(text => text === undefined)).toBe(true)
    const ui = await mountBand($)
    const drawn: any = await ui.drawn()
    expect(drawn).toMatchObject({ type: 'Box', props: { key: 'below' } })
    expect(drawn.props.flexDirection).toBeUndefined()
    await ui.unmount()
  })

  test('(P6) v1.0.1 kalıntısı devir:<sid> açılışta sessizce silinir; Agent geçer, toast yok', async ($, on) => {
    const { world, clock } = normal(on)
    world.store[`${RUN_PREFIX}${SID}`] = { handoffId: 's1-x', file: FILE, handoffAt: 0, phase: 'handoff_running' }
    await start($)
    await clock.advance(100)
    expect(world.store[`${RUN_PREFIX}${SID}`]).toBeUndefined()
    expect((await $.tool.call({ tool: 'Agent', prompt: 'x', description: 'y' } as any)).deny).toBeUndefined()
    expect(callsOf(world, 'Agent')).toHaveLength(1)
    expect(world.toasts).toEqual([])
    expect((await devir($, '')).text).toBe(NORMAL_INFO)
  })

  test('(P7) /devir simdi NORMAL_INFO; sonraki araç sonucu ve Stop eşik üstünde de bir şey taşımaz', async ($, on) => {
    const { world, clock } = normal(on)
    await start($)
    expect((await devir($, 'simdi')).text).toBe(NORMAL_INFO)
    await typed($, 'iş')
    expect(world.typed.at(-1)?.context).toEqual([])
    await turnBegin($)
    expect((await bash($)).context ?? []).toEqual([])
    expect((await stop($))?.block).toBeUndefined()
    await turnEnd($, 'tamam')
    await clock.advance(100)
    expect(runKeys(world)).toEqual([])
    expect(startCalls(world)).toHaveLength(0)
  })

  test('(P8) normal sohbette /devir esik, kapat, ac, otonom limit hiçbir şeyi değiştirmez', async ($, on) => {
    const { world, clock } = normal(on)
    // Another chain's settings and main record exist (Decision 22: not this chat's).
    seedJson(world, zincirAyarFile(HOME, MAIN_ID), { esik: 30, at: 0 })
    seedJson(world, orkestraRecordFile(HOME, MAIN_ID), MAIN_RECORD)
    await start($)
    expect((await devir($, 'esik 10')).text).toBe(NORMAL_INFO)
    expect((await devir($, 'kapat')).text).toBe(NORMAL_INFO)
    expect((await devir($, 'ac')).text).toBe(NORMAL_INFO)
    expect((await devir($, 'otonom limit 3')).text).toBe(NOT_ORCHESTRATED)
    await clock.advance(100)
    expect(world.store.esik).toBe(40)
    expect(world.store.acik).toBe(true)
    expect('otonomLimit' in world.store).toBe(false)
    expect(readJson(world, zincirAyarFile(HOME, MAIN_ID))).toEqual({ esik: 30, at: 0 })
    expect(readJson(world, orkestraRecordFile(HOME, MAIN_ID))).toEqual(MAIN_RECORD)
    expect(world.writes).toEqual([])
  })
})
