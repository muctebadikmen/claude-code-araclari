import { describe, expect, mock, test } from 'claude-code/testing'

import {
  closedTurnHandoff,
  handoffFile,
  HANDED_PREFIX,
  inTurnHandoff,
  READY_BAND,
  RUN_PREFIX,
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

/** The world beneath the mod: a session whose id and context fill the test controls. */
const setup = (
  on: any,
  store: Record<string, unknown> = { esik: 40 },
  opts: { commands?: string[]; tools?: string[] } = {},
) => {
  const { commands = [SKILL], tools = [START, GET, HAND_OFF] } = opts
  const world = {
    sid: SID,
    percent: 50 as number | undefined,
    // Messages the mod itself submitted (its own turns): v1 sends none.
    sent: [] as string[],
    // Messages the person typed, with the context hooks attached to them.
    typed: [] as { text: string; context: readonly string[] }[],
    ran: [] as string[],
    toasts: [] as string[],
    calls: [] as any[],
    // The mod's durable store, as it stands.
    store: { ...store } as Record<string, unknown>,
    // The files the model wrote, by path, as the file system holds them.
    files: {} as Record<string, { text: string; mtimeMs: number }>,
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
  mock.env(on, { HOME: '/home/test' })
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
  on('tool.list', () => ({
    value: tools.map(name => ({ name, description: '', mcp: true })),
  }))
  on('tool.call', ($: any, e: any) => {
    world.calls.push(e)
    if (e.tool === GET) {
      return { result: [], text: JSON.stringify({ sessionId: 'local_self', title: 'Eski iş' }) }
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
  on('prompt.submit', ($: any, e: any) => {
    if (e.origin?.kind === 'plugin' || e.origin === undefined) world.sent.push(e.text)
    else world.typed.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text, context: e.context }
  })
  on('ui.status', () => ({ value: undefined }))
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
const stop = ($: any) => $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
/** The model wrote the handoff file (newer than the claim at clock 1_000_000). */
const writeFile = (world: any, text = HANDOFF_TEXT, mtimeMs = 2_000_000) => {
  world.files[FILE] = { text, mtimeMs }
}

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

/** A machine turn (no person typed it) that crosses the threshold, then the file and the Stop: `ready`. */
const toReady = async ($: any, world: any, clock: any) => {
  await machine($, 'a1 bitti')
  await turnBegin($)
  const first = await bash($)
  await clock.advance(100)
  expect(first.context).toEqual([closedTurnHandoff(40, FILE)])
  writeFile(world)
  expect((await stop($))?.block).toBeUndefined()
  expect(await phase($)).toContain('aşama: ready')
}

describe('otomatik-devir', () => {
  test('(a) boşta: çıktı tam olarak alttaki çizimdir', async ($, on) => {
    setup(on)
    await start($)
    const ui = await mountBand($)
    const drawn: any = await ui.drawn()
    expect(drawn).toMatchObject({ type: 'Box', props: { key: 'below' } })
    expect(drawn.props.flexDirection).toBeUndefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    expect(await ui.findAll({ text: READY_BAND })).toHaveLength(0)
    expect(await phase($)).toContain('aşama: idle')
    await ui.unmount()
  })

  test('(c) done aynı oturumda done kalır: eşiğin altındaki tur ve sonraki eşik aşımı yeni devir açmaz', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await typedTrip($, world, clock)
    writeFile(world)
    await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'x' })
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: done')
    await turnEnd($, 'Yeni sohbet açıldı.')

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

    // Over the threshold again: no new instruction, no block, no second child.
    world.percent = 50
    await typed($, 'devam')
    expect(world.typed.at(-1)?.context).toEqual([])
    await turnBegin($)
    expect((await bash($)).context ?? []).toEqual([])
    expect((await stop($))?.block).toBeUndefined()
    await turnEnd($, 'tamam')
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: done')
    expect(startCalls(world)).toHaveLength(1)
    expect(world.sent).toEqual([])
  })

  test('(e) my-skill-handoff yoksa yedek talimat dosya yolunu ve "## Devam prompt\'u" başlığını taşır', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40 }, { commands: [] })
    await start($)
    const first = await typedTrip($, world, clock)
    expect(first.context).toEqual([inTurnHandoff(40, FILE, false)])
    expect(first.context[0]).toContain(FILE)
    expect(first.context[0]).toContain("## Devam prompt'u")
    expect(first.context[0]).not.toContain(SKILL)
    expect(world.ran).toEqual([])
    expect(await phase($)).toContain('aşama: handoff_running')
  })

  test('(h) model çalışırken devir hazır bandı çizilmez', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await toReady($, world, clock)

    // Idle turn: the row is first, the drawing beneath stays.
    const ui = await mountBand($)
    const shown: any = await ui.drawn()
    expect(shown.type).toBe('Box')
    expect(shown.props.flexDirection).toBe('column')
    expect(shown.children[0]).toMatchObject({ type: 'Box', props: { key: 'devir' } })
    expect(shown.children[1]).toMatchObject({ type: 'Box', props: { key: 'below' } })
    expect((await ui.find({ text: READY_BAND }))?.text).toBe(READY_BAND)
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)

    // While the model works the row stays hidden.
    await ui.redraw({ ...BAND, isWorking: true })
    expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { key: 'below' } })
    expect(await ui.findAll({ text: READY_BAND })).toHaveLength(0)
    await ui.unmount()
  })

  test('(i) kapalıyken eşik aşılsa da devir başlamaz', async ($, on) => {
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

  test('(o1) yazılan turda eşik aşılır: talimat araç sonucunda gelir, model aynı turda yeni sohbeti açar, devredildi: yazılır, ikinci açış reddedilir', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    const first = await typedTrip($, world, clock)
    expect(first.context).toEqual([inTurnHandoff(40, FILE)])
    expect(first.context[0]).toContain('initiation "user_asked"')
    expect(first.context[0]).toContain('context "fresh"')
    expect(first.context[0]).toContain(`auto ${FILE}`)
    expect(await phase($)).toContain('aşama: handoff_running')
    // The claim is durable before anything else happens.
    expect(world.store[`${RUN_PREFIX}${SID}`]).toMatchObject({
      file: FILE,
      phase: 'handoff_running',
    })
    // One instruction: the next result carries nothing more.
    expect((await bash($)).context ?? []).toEqual([])

    // No file yet, or a file older than the claim: start_session is refused.
    const early = await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'x' })
    expect(String(early.deny)).toContain(`önce devir dosyasını yaz: ${FILE}`)
    writeFile(world, HANDOFF_TEXT, 1)
    const stale = await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'x' })
    expect(String(stale.deny)).toContain(`önce devir dosyasını yaz: ${FILE}`)
    expect(startCalls(world)).toHaveLength(0)

    // The file is written: the model's start_session goes through with the file as its prompt.
    writeFile(world)
    const started = await $.tool.call({
      tool: START,
      initiation: 'user_asked',
      prompt: 'modelin kendi prompt\'u',
      background: 'kısa',
    })
    expect(started.text).toContain(NEW_ID)
    expect(startCalls(world)).toHaveLength(1)
    expect(startCalls(world)[0]).toMatchObject({
      initiation: 'user_asked',
      context: 'fresh',
      title: 'Eski iş (devam)',
      prompt: HANDOFF_TEXT.trim(),
    })
    expect(startCalls(world)[0].background.length).toBeGreaterThanOrEqual(80)
    expect(startCalls(world)[0].use_worktree).toBeUndefined()
    expect(startCalls(world)[0].consent).toBeUndefined()
    await clock.advance(100)

    // Nested child: no detach, no /clear; the handed-off flag is durable and the run record is gone.
    expect(callsOf(world, DETACH)).toEqual([])
    expect(world.ran).toEqual([])
    expect(world.toasts).toContain('Devam yeni sohbette: Eski iş (devam)')
    expect(world.store[`${HANDED_PREFIX}${SID}`]).toMatchObject({
      startedId: NEW_ID,
      file: FILE,
      handoffId: expect.stringMatching(/^s1-/),
    })
    expect(world.store[`${RUN_PREFIX}${SID}`]).toBeUndefined()
    expect(await phase($)).toContain('aşama: done')

    // A second start_session is denied, nothing reaches the app.
    const again = await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'x' })
    expect(String(again.deny)).toContain(`bu sohbet zaten devredildi (${NEW_ID})`)
    expect(startCalls(world)).toHaveLength(1)

    // The turn ends with no block and no message of the mod's.
    expect((await stop($))?.block).toBeUndefined()
    await turnEnd($, 'Yeni sohbet açıldı.')
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: done')
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
      expect((await bash($)).context).toEqual([inTurnHandoff(40, FILE)])
    },
  )

  test('(M2) devir sürerken hand_off_to_session reddedilir ve metin START_SESSION adını verir; devir yokken geçer', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await $.tool.call({ tool: HAND_OFF, title: 'x', remaining_plan: 'y' })
    expect(callsOf(world, HAND_OFF)).toHaveLength(1)
    await typedTrip($, world, clock)
    expect(await phase($)).toContain('aşama: handoff_running')
    const fork = await $.tool.call({ tool: HAND_OFF, title: 'x', remaining_plan: 'y' })
    expect(String(fork.deny)).toContain(START)
    expect(String(fork.deny)).toContain(`${HAND_OFF} kullanma`)
    expect(callsOf(world, HAND_OFF)).toHaveLength(1)
  })
})
