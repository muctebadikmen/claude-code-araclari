import { describe, expect, mock, test } from 'claude-code/testing'

import {
  cardToScheduled,
  gateClosedNote,
  gatedHandoff,
  gateOpenNote,
  handoffMessage,
  inTurnHandoff,
  nextMessageHandoff,
  NOT_PERSON_NOTE,
  refusedToScheduled,
  reminderText,
  scheduledHandoff,
  scheduledPlan,
  syncText,
  taskPrompt,
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
const ANSWER = 'Devam notu yazıldı.\n\n```\nDevam et: adım 3\n```\n'
const START = 'mcp__ccd_session__start_session'
const GET = 'mcp__ccd_session_mgmt__get_session'
const DETACH = 'mcp__ccd_session_mgmt__detach_session'
const LIST = 'mcp__ccd_session_mgmt__list_sessions'
const REFUSAL =
  "Start sessions only on the user's own words to you here; this turn runs an automated event. Propose the session instead (initiation \"own_initiative\")."
const NEW_ID = 'local_bec10f6a-0001'
const CREATE = 'mcp__scheduled-tasks__create_scheduled_task'
const RUN = 'mcp__scheduled-tasks__run_scheduled_task'
const UPDATE = 'mcp__scheduled-tasks__update_scheduled_task'
const DELETE = 'mcp__scheduled-tasks__delete_scheduled_task'
const TASKS = 'mcp__scheduled-tasks__list_scheduled_tasks'
const SET_EFFORT = 'mcp__ccd_session_mgmt__set_session_effort'
// Claude desktop with the scheduled-task tools.
const DESKTOP = [START, GET, DETACH, LIST, CREATE, RUN, UPDATE, DELETE, TASKS, SET_EFFORT]
const RUN_ID = 'local_2ef52c7a-0002'
const GATE = 'mcp__ccd_session__list_start_targets'
const HAND_OFF = 'mcp__ccd_session__hand_off_to_session'
// Claude desktop with the start gate tool too.
const GATED = [...DESKTOP, GATE, HAND_OFF]

/** The world beneath the mod: a session whose id and context fill the test controls. */
const setup = (
  on: any,
  store: Record<string, unknown> = { esik: 40, mod: 'sor' },
  opts: {
    commands?: string[]
    tools?: string[]
    isStartFailing?: boolean
    isAgentListBroken?: boolean
    isUserAskedRefused?: boolean
    // The text of that refusal (default: the gate's R1 text).
    refusalText?: string
    // The person answers "no" on the permission card of start_session.
    isUserAskedDenied?: boolean
    // A successful start_session's text (default: with a local_ id).
    startText?: string
  } = {},
) => {
  const {
    commands = [SKILL],
    tools = [START, GET, DETACH],
    isStartFailing = false,
    isAgentListBroken = false,
    isUserAskedRefused = false,
    refusalText = REFUSAL,
    isUserAskedDenied = false,
    startText,
  } = opts
  const world = {
    sid: 's1',
    percent: 50 as number | undefined,
    // Messages the mod itself submitted (its own turns).
    sent: [] as string[],
    // Messages the person typed, with the context hooks attached to them.
    typed: [] as { text: string; context: readonly string[] }[],
    ran: [] as string[],
    toasts: [] as string[],
    copied: [] as string[],
    calls: [] as any[],
    agents: [] as { id: string; description: string; type: string; status: string }[],
    listed: [] as { sessionId: string; title: string; startedBy?: string }[],
    // get_session "self" fields beyond the id and title.
    self: {} as Record<string, unknown>,
    // Tasks whose run the app refuses ("already has a run in progress").
    busy: [] as string[],
    // The prompt file the model wrote, as the file system holds it.
    file: undefined as { text: string; mtimeMs: number } | undefined,
    // list_start_targets: this computer's repositories ({} = the gate is closed).
    repos: {} as Record<string, unknown>,
  }
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, store)
  mock.env(on, { HOME: '/home/test' })
  // The plugins below this one in the shared band (other mods, or the engine).
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) =>
    $.ui.resolve(e).Box({ key: 'below' }),
  )
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: world.sid }))
  on('session.root', () => ({ value: '/proj' }))
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
  on('agent.list', () => {
    if (isAgentListBroken) throw new Error('liste yok')
    return { value: world.agents }
  })
  on('tool.list', () => ({
    value: tools.map(name => ({ name, description: '', mcp: true })),
  }))
  on('tool.call', ($: any, e: any) => {
    world.calls.push(e)
    if (e.tool === GET) {
      return {
        result: [],
        text: JSON.stringify({ sessionId: 'local_self', title: 'Eski iş', ...world.self }),
      }
    }
    if (e.tool === RUN && world.busy.includes(e.taskId)) {
      return { result: [], text: `Task ${e.taskId} already has a run in progress.`, isError: true }
    }
    if (e.tool === RUN) return { result: [], text: `Started a run of ${e.taskId}: session ${RUN_ID}` }
    if (e.tool === LIST) return { result: [], text: JSON.stringify(world.listed) }
    if (e.tool === START && isStartFailing) return { result: [], text: 'nope', isError: true }
    if (e.tool === GATE) {
      return { result: [], text: JSON.stringify({ thisComputer: { repositories: world.repos }, remote: {} }) }
    }
    if (e.tool === START && isUserAskedDenied && e.initiation === 'user_asked') {
      return { deny: 'Kullanıcı reddetti' }
    }
    if (e.tool === START && isUserAskedRefused && e.initiation === 'user_asked') {
      return { result: [], text: refusalText, isError: true }
    }
    if (e.tool === START && e.initiation === 'own_initiative') {
      return { result: [], text: `Proposed "${e.title}" (task_id: task_d39c5c47). The user sees a card.` }
    }
    if (e.tool === START) {
      return { result: [], text: startText ?? `Started session "${e.title}" (session_id: ${NEW_ID}, name: eski-is)` }
    }
    return { result: [], text: 'ok' }
  })
  on('fs.exists', () => ({ value: false }))
  on('session.cwd', () => ({ value: '/proj' }))
  on('fs.stat', () => {
    if (world.file === undefined) throw new Error('ENOENT')
    return { value: { kind: 'file', size: world.file.text.length, mtimeMs: world.file.mtimeMs, isLink: false } }
  })
  on('fs.read', () => {
    if (world.file === undefined) throw new Error('ENOENT')
    return { value: world.file.text }
  })
  on('prompt.submit', ($: any, e: any) => {
    if (e.text === 'DÜŞÜR') return { drop: 'düşürüldü' }
    if (e.origin?.kind === 'plugin' || e.origin === undefined) world.sent.push(e.text)
    else world.typed.push({ text: e.text, context: e.context ?? [] })
    return { text: e.text, context: e.context }
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

/** /devir simdi, then the handoff turn: ends at awaiting_choice (mode sor). */
const toAwaitingChoice = async ($: any, clock: any) => {
  expect((await devir($, 'simdi')).text).toBe('Devir başlatılıyor.')
  await clock.advance(100)
  expect((await devir($, 'gec')).text).toContain('hâlâ çalışıyor')
  await turnEnd($, ANSWER)
}

const startCalls = (world: any) => world.calls.filter((c: any) => c.tool === START)
const phase = async ($: any) => (await devir($, '')).text

/** The person presses Enter (Claude desktop's composer, or the terminal's). */
const typed = ($: any, text: string, extra: Record<string, unknown> = {}) =>
  $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false, ...extra })
/** A message no person typed (a subagent's result, a schedule...). */
const machine = ($: any, text: string, kind = 'task-notification') =>
  $.prompt.submit({ text, origin: { kind }, wait: false })
const runningTurn = () => `tt${turnSeq}`
const turnBegin = ($: any) => $.turn.start({ text: '', turnId: `tt${++turnSeq}` })
/** One main-loop tool call of the model's. */
const bash = ($: any) => $.tool.call({ tool: 'Bash', command: 'ls' })
const detaches = (world: any) => world.calls.filter((c: any) => c.tool === DETACH)
const callsOf = (world: any, tool: string) => world.calls.filter((c: any) => c.tool === tool)
const PLAN = scheduledPlan('/proj')
const [TASK_A, TASK_B] = PLAN.ids
const SELF = { effort: 'high', model: 'claude-opus-5-5', permissionMode: 'bypassPermissions' }

describe('otomatik-devir', () => {
  test('(a) boşta: çıktı tam olarak alttaki çizimdir', async ($, on) => {
    setup(on)
    await start($)
    const ui = await mountBand($)
    const drawn: any = await ui.drawn()
    expect(drawn).toMatchObject({ type: 'Box', props: { key: 'below' } })
    expect(drawn.props.flexDirection).toBeUndefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    expect(await phase($)).toContain('aşama: idle')
    await ui.unmount()
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`(b) sor modu: önce sorar; kendi satırı önce, alttaki çizim korunur (${surface})`, async ($, on) => {
      const { world, clock } = setup(on)
      await start($)
      await toAwaitingChoice($, clock)
      expect(world.ran).toEqual([])
      expect(world.sent).toHaveLength(1)
      expect(await phase($)).toContain('aşama: awaiting_choice')
      // Sor: nothing starts before the person answers.
      await clock.advance(1000)
      expect(startCalls(world)).toHaveLength(0)

      const ui = await mountBand($, surface)
      const drawn: any = await ui.drawn()
      expect(drawn.type).toBe('Box')
      expect(drawn.props.flexDirection).toBe('column')
      expect(drawn.children).toHaveLength(2)
      expect(drawn.children[0]).toMatchObject({ type: 'Box', props: { key: 'devir' } })
      expect(drawn.children[1]).toMatchObject({ type: 'Box', props: { key: 'below' } })
      expect((await ui.findAll({ type: 'Button' })).map((b: any) => b.text)).toEqual(['Geç', 'Bekle'])
      const gec: any = await ui.find({ key: 'gec' })
      expect(gec.props.hotkey).toBe('g')
      expect(gec.props.autoFocus).toBe(true)
      const bekle: any = await ui.find({ key: 'bekle' })
      expect(bekle.props.hotkey).toBe('b')
      expect(bekle.props.autoFocus).toBeUndefined()
      expect((await ui.find({ text: /Yeni sohbet açayım mı\?/ }))?.text).toContain("Devam prompt'u hazır.")

      // A survey holds the band: pass straight through.
      await ui.redraw({ ...BAND, hasSurvey: true })
      expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { key: 'below' } })
      await ui.redraw(BAND)

      // [Bekle] hides the row; the band is the below-drawing alone again.
      await ui.press({ key: 'bekle' })
      await ui.redraw(BAND)
      expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { key: 'below' } })
      await ui.unmount()

      // The prompt is kept: /devir gec opens a new sibling chat; this one stays.
      expect((await devir($, 'gec')).text).toBe('Yeni sohbete geçiliyor.')
      await clock.advance(100)
      expect(world.ran).toEqual([])
      // The mod never calls user_asked itself: the app refuses it outside a
      // typed turn. It raises the card at once.
      expect(world.calls.map((c: any) => c.tool)).toEqual([GET, START])
      expect(startCalls(world)[0]).toMatchObject({ initiation: 'own_initiative', title: 'Eski iş (devam)' })
      expect(startCalls(world)[0].consent).toBeUndefined()
      expect(world.toasts).toContain('Devam kartı hazır: karta tıklayınca yeni sohbet açılır.')
      expect(world.sent).toHaveLength(1)
      expect(await phase($)).toContain('aşama: done')
    })
  }

  test('(b2) Geç düğmesi yeni kardeş sohbet kartını açar, /clear çalışmaz', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await toAwaitingChoice($, clock)
    const ui = await mountBand($)
    await ui.press({ key: 'gec' })
    await clock.advance(100)
    expect(world.ran).toEqual([])
    expect(world.sent).toHaveLength(1)
    const started = startCalls(world)[0]
    expect(started).toMatchObject({
      initiation: 'own_initiative',
      context: 'fresh',
      title: 'Eski iş (devam)',
      prompt: 'Devam et: adım 3',
    })
    // The worktree is the app's default (review M3).
    expect(started.use_worktree).toBeUndefined()
    expect(started.consent).toBeUndefined()
    expect(startCalls(world)).toHaveLength(1)
    expect(started.background.length).toBeGreaterThanOrEqual(80)
    expect(world.toasts).toContain('Devam kartı hazır: karta tıklayınca yeni sohbet açılır.')
    expect(world.copied).toEqual([])
    expect(await phase($)).toContain('aşama: done')
    await ui.unmount()
  })

  test('(c) done aynı oturumda idle durumuna döner', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)

    // Aborted handoff -> done.
    await devir($, 'simdi')
    await clock.advance(100)
    await turnEnd($, '', true)
    expect(world.toasts).toContain('Devir iptal edildi.')
    expect(await phase($)).toContain('aşama: done')

    // Still over the threshold: stays done, no new handoff every turn.
    await turnEnd($, 'iş')
    await clock.advance(100)
    expect(world.sent).toHaveLength(1)
    expect(await phase($)).toContain('aşama: done')

    // Fill measured under the threshold (e.g. /compact) -> idle.
    world.percent = 10
    await $.session.measure({
      context: { window: 100, percent: 10 },
      rateLimits: [],
      changed: ['context'],
    })
    expect(await phase($)).toContain('aşama: idle')

    // Re-armed: crossing again sends a new handoff message at the turn end.
    world.percent = 45
    await turnEnd($, 'iş')
    await clock.advance(100)
    expect(world.sent).toHaveLength(2)
    expect(await phase($)).toContain('aşama: handoff_running')

    // Aborted again -> done; a new threshold re-arms too.
    await turnEnd($, '', true)
    expect(await phase($)).toContain('aşama: done')
    expect((await devir($, 'esik 70')).text).toContain('%70')
    expect(await phase($)).toContain('aşama: idle')
  })

  test('(c2) turn sonunda eşiğin altındaki doluluk done kaydını sıfırlar', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await devir($, 'simdi')
    await clock.advance(100)
    await turnEnd($, '', true)
    expect(await phase($)).toContain('aşama: done')
    world.percent = 20
    await turnEnd($, 'iş')
    expect(await phase($)).toContain('aşama: idle')
  })

  test('(d) bekleyen devir yokken /devir gec geri bildirim verir', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)

    const idle = await devir($, 'gec')
    expect(idle.text).toContain('Geçilecek bekleyen devir yok')
    expect(idle.text).toContain('aşama: idle')

    // After a done with a stale prompt kept from an earlier handoff.
    await toAwaitingChoice($, clock)
    await devir($, 'simdi')
    await clock.advance(100)
    await turnEnd($, '', true)
    const done = await devir($, 'gec')
    expect(done.text).toContain('Geçilecek bekleyen devir yok')
    expect(done.text).toContain('aşama: done')
    expect(done.text).toContain('/devir simdi')
    await clock.advance(100)
    expect(world.ran).not.toContain('clear')
    expect(world.calls).toEqual([])
    expect(world.sent).toHaveLength(2)
  })

  test('(e) my-skill-handoff yoksa yedek talimat mesajın içindedir', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'sor' }, { commands: [] })
    await start($)
    await turnEnd($, 'iş')
    await clock.advance(100)
    expect(world.ran).toEqual([])
    expect(world.sent).toHaveLength(1)
    expect(world.sent[0]).toContain('.workflow/HANDOFF.md')
    expect(world.sent[0]).toContain('tek bir kod bloğu')
    expect(world.sent[0]).not.toContain('/my-skill-handoff')
    expect(await phase($)).toContain('aşama: handoff_running')
    await turnEnd($, ANSWER)
    expect(await phase($)).toContain('aşama: awaiting_choice')
  })

  const fallbacks = [
    ['oturum aracı yoksa', { tools: [] as string[] }],
    ['start_session hata verirse', { isStartFailing: true }],
  ] as const
  for (const [name, opts] of fallbacks) {
    test(`(f) ${name}: panoya kopyala, aşama awaiting_choice kalır`, async ($, on) => {
      const { world, clock } = setup(on, { esik: 40, mod: 'sor' }, opts)
      await start($)
      await toAwaitingChoice($, clock)
      expect((await devir($, 'gec')).text).toBe('Yeni sohbete geçiliyor.')
      await clock.advance(100)
      expect(world.ran).toEqual([])
      expect(world.calls.map((c: any) => c.tool)).not.toContain(DETACH)
      expect(world.sent).toHaveLength(1)
      expect(world.copied).toEqual(['Devam et: adım 3'])
      expect(world.toasts).toContain("Devam prompt'u panoya kopyalandı. Yeni sohbet açıp yapıştır.")
      // Still claimable, but the band stays hidden: no repeated question.
      expect(await phase($)).toContain('aşama: awaiting_choice')
      const ui = await mountBand($)
      expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
      await ui.unmount()
    })
  }

  test('(h) model çalışırken soru bandı çizilmez', async ($, on) => {
    const { clock } = setup(on)
    await start($)
    await toAwaitingChoice($, clock)
    const ui = await mountBand($, 'terminal', { ...BAND, isWorking: true })
    expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { key: 'below' } })
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    await ui.unmount()
  })

  test('(i) kapalıyken eşik aşılsa da devir başlamaz', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'sor', acik: false })
    await start($)
    await turnEnd($, 'iş')
    await clock.advance(100)
    expect(world.ran).toEqual([])
    expect(world.sent).toEqual([])
  })

  test('(o1) otomatik (a): eşik yazılan turda aşılır; talimat araç sonucunda gelir, model aynı turda açar', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    await start($)
    await typed($, 'uzun işi yap')
    await turnBegin($)
    const first = await bash($)
    expect(first.context).toEqual([inTurnHandoff(40)])
    expect(first.context[0]).toContain('initiation "user_asked"')
    expect(first.context[0]).toContain('context "fresh"')
    expect(first.context[0]).toContain('/my-skill-handoff')
    expect(first.context[0]).toContain('BAŞLATMA')
    expect(await phase($)).toContain('aşama: handoff_running')
    // One instruction: the next result carries nothing more.
    expect((await bash($)).context ?? []).toEqual([])
    await clock.advance(100)

    // The model's own start_session in that turn: the mod fills what the
    // continuation needs and moves the new chat to top level.
    const started = await $.tool.call({
      tool: START,
      initiation: 'user_asked',
      prompt: 'Devam et: adım 3',
      background: 'kısa',
    })
    expect(started.text).toContain(NEW_ID)
    expect(startCalls(world)[0]).toMatchObject({
      initiation: 'user_asked',
      context: 'fresh',
      title: 'Eski iş (devam)',
      prompt: 'Devam et: adım 3',
    })
    expect(startCalls(world)[0].use_worktree).toBeUndefined()
    expect(startCalls(world)[0].background.length).toBeGreaterThanOrEqual(80)
    expect(startCalls(world)[0].consent).toBeUndefined()
    // A second start in the same turn is refused (no cascade).
    const again = await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'x' })
    expect(String(again.deny ?? again.text)).toContain('zaten açıldı')
    expect(startCalls(world)).toHaveLength(1)
    await clock.advance(100)
    expect(detaches(world)).toEqual([expect.objectContaining({ session_id: NEW_ID })])
    expect(world.toasts).toContain('Devam yeni sohbette: Eski iş (devam)')

    await turnEnd($, 'Yeni sohbet açıldı.')
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: done')
    // No message turn of the mod's, no /clear, no clipboard.
    expect(world.sent).toEqual([])
    expect(world.ran).toEqual([])
    expect(world.copied).toEqual([])
    await turnEnd($, 'devam')
    await clock.advance(100)
    expect(world.sent).toEqual([])
    expect(startCalls(world)).toHaveLength(1)
  })

  test('(o2) otomatik (b): açık yazılan tur yoksa devir sonraki yazılan mesaja bekletilir', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    await start($)
    // A machine turn (a subagent reported back): no instruction mid-turn.
    await machine($, 'a1 bitti')
    await turnBegin($)
    expect((await bash($)).context ?? []).toEqual([])
    expect(await phase($)).toContain('aşama: idle')
    await turnEnd($, 'iş')
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: deferred')
    expect(world.sent).toEqual([])
    expect(world.toasts).toContain('Devir: bağlam eşiği aşıldı; yeni sohbet bir sonraki mesajınla açılacak.')
    // Turns nobody typed do not carry it, nor a slash command typed.
    await machine($, 'zamanlanmış', 'scheduled-trigger')
    await typed($, '/review', { command: { name: 'review', args: '' } })
    expect(world.typed.map((m: any) => m.context)).toEqual([[], [], []])
    await turnEnd($, 'başka tur')
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: deferred')

    // The person types: the instruction rides on that message.
    await typed($, 'şimdi testleri yaz')
    expect(world.typed.at(-1)).toEqual({
      text: 'şimdi testleri yaz',
      context: [nextMessageHandoff(40)],
    })
    expect(world.typed.at(-1)?.context[0]).toContain('bu sohbette YAPMA')
    expect(await phase($)).toContain('aşama: handoff_running')
    await turnBegin($)
    await clock.advance(100)
    await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'Devam et: adım 3\n\nşimdi testleri yaz' })
    await clock.advance(100)
    expect(detaches(world)).toEqual([expect.objectContaining({ session_id: NEW_ID })])
    await turnEnd($, 'Yeni sohbet açıldı.')
    expect(await phase($)).toContain('aşama: done')
    expect(world.sent).toEqual([])
    expect(startCalls(world)).toHaveLength(1)
  })

  test('(o3) sıra: model başlatması reddedilirse son çare kart; mod user_asked/proposal_id çağırmaz', async ($, on) => {
    const { world, clock } = setup(
      on,
      { esik: 40, mod: 'otomatik' },
      { isUserAskedRefused: true, refusalText: 'Session could not start.' },
    )
    await start($)
    await typed($, 'iş')
    await turnBegin($)
    await bash($)
    await clock.advance(100)
    const refused = await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'Devam et: adım 3' })
    expect(refused.isError).toBe(true)
    expect(String(refused.context?.at(-1))).toContain('Yeniden deneme')
    await turnEnd($, 'Yeni sohbet açılamadı.')
    await clock.advance(100)
    const starts = startCalls(world)
    expect(starts.map((c: any) => c.initiation)).toEqual(['user_asked', 'own_initiative'])
    expect(starts.some((c: any) => c.proposal_id !== undefined)).toBe(false)
    expect(starts[1]).toMatchObject({ title: 'Eski iş (devam)', prompt: 'Devam et: adım 3', context: 'fresh' })
    expect(world.toasts).toContain('Devam kartı hazır: karta tıklayınca yeni sohbet açılır.')
    expect(await phase($)).toContain('aşama: done')
    expect(world.sent).toEqual([])
    expect(world.copied).toEqual([])
    // Card band hidden: the card is the question.
    const ui = await mountBand($, 'desktop')
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    await ui.unmount()

    // The person clicks the card: only the one this chat started, by its title, moves.
    await clock.advance(5000)
    expect(world.calls.filter((c: any) => c.tool === LIST)[0]).toMatchObject({ linked: true })
    expect(detaches(world)).toHaveLength(0)
    world.listed = [
      { sessionId: 'local_other', title: 'Eski iş (devam)', startedBy: 'local_baska' },
      { sessionId: 'local_new', title: 'Eski iş (devam)', startedBy: 'local_self' },
    ]
    await clock.advance(5000)
    expect(detaches(world)).toEqual([expect.objectContaining({ session_id: 'local_new' })])
    const seen = world.calls.filter((c: any) => c.tool === LIST).length
    await clock.advance(20000)
    expect(world.calls.filter((c: any) => c.tool === LIST)).toHaveLength(seen)
  })

  test('(o4) sıra: prompt makine turunda gelirse (b) bir kez, sonra kart', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    world.agents = [{ id: 'a1', description: 'tara', type: 'Explore', status: 'running' }]
    await start($)
    await typed($, 'iş')
    await turnBegin($)
    expect((await bash($)).context).toEqual([inTurnHandoff(40)])
    // The model ends its turn to wait for the background agent: not a failure.
    await turnEnd($, 'Arka plan işini bekliyorum.')
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: handoff_running')
    // The prompt comes in the notification turn: held for the next message.
    world.agents = []
    await machine($, 'a1 bitti')
    await turnBegin($)
    await turnEnd($, ANSWER)
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: deferred')
    expect(world.toasts).toContain("Devam prompt'u hazır: yeni sohbet bir sonraki mesajınla açılacak.")
    expect(startCalls(world)).toHaveLength(0)

    await typed($, 'sıradaki')
    expect(world.typed.at(-1)?.context).toEqual([nextMessageHandoff(40, true, true, 'Devam et: adım 3')])
    expect(world.typed.at(-1)?.context[0]).toContain('devir becerisini yeniden çalıştırma')
    await turnBegin($)
    // The model did not start it: the card, with the held prompt.
    await turnEnd($, 'Tamam.')
    await clock.advance(100)
    // The person's message is not lost: it rides under the held prompt (M7).
    expect(startCalls(world).map((c: any) => [c.initiation, c.prompt])).toEqual([
      ['own_initiative', 'Devam et: adım 3\n\nSıradaki iş (kullanıcının son mesajı):\nsıradaki'],
    ])
    expect(world.sent).toEqual([])
  })

  test('(o5) terminal (oturum araçları yok): talimatta start_session yok, pano + bildirim', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' }, { tools: [] })
    await start($)
    await typed($, 'iş')
    await turnBegin($)
    const got = await bash($)
    expect(got.context).toEqual([inTurnHandoff(40, true, false)])
    expect(got.context[0]).not.toContain(START)
    await turnEnd($, ANSWER)
    await clock.advance(100)
    expect(startCalls(world)).toHaveLength(0)
    expect(world.copied).toEqual(['Devam et: adım 3'])
    expect(world.toasts).toContain("Devam prompt'u panoya kopyalandı. Yeni sohbet açıp yapıştır.")
    expect(world.sent).toEqual([])
  })

  test('(o6) otomatik: prompt gelmezse hatırlatma mesajı yok; bir kez sonraki mesaja, sonra bırakır', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    await start($)
    await typed($, 'iş')
    await turnBegin($)
    await bash($)
    for (let i = 0; i < 6; i++) await turnEnd($, `ara tur ${i}`)
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: deferred')
    expect(world.toasts).toContain("Devir: devam prompt'u gelmedi; bir sonraki mesajınla yeniden denenecek.")
    await typed($, 'devam')
    expect(world.typed.at(-1)?.context).toEqual([nextMessageHandoff(40)])
    for (let i = 0; i < 6; i++) await turnEnd($, `yine yok ${i}`)
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: done')
    expect(world.toasts).toContain("Devir: devam prompt'u bulunamadı.")
    expect(world.sent).toEqual([])
  })

  test('(o7) otomatik /devir simdi mesaj göndermez, sonraki mesaja bekletir; sor modunda tur içi talimat yok', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    world.percent = 10
    await start($)
    expect((await devir($, 'simdi')).text).toContain('bir sonraki mesajınla')
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: deferred')
    expect((await devir($, 'simdi')).text).toContain('Devir bekliyor')
    expect(world.sent).toEqual([])
    await typed($, 'hadi')
    expect(world.typed.at(-1)?.context).toEqual([nextMessageHandoff(40)])

    // sor: a typed turn over the threshold gets no in-turn instruction.
    await devir($, 'sor')
    await turnEnd($, '', true)
    world.percent = 50
    await typed($, 'iş')
    await turnBegin($)
    expect((await bash($)).context ?? []).toEqual([])
  })
  test('(k) subagent çalışırken eşikte mesaj hemen gider; ara turlar hata sayılmaz', async ($, on) => {
    const { world, clock } = setup(on)
    world.agents = [{ id: 'a1', description: 'tara', type: 'Explore', status: 'running' }]
    await start($)
    await turnEnd($, 'iş')
    await clock.advance(100)
    // No silent wait: the one message goes out at once.
    expect(world.sent).toEqual([handoffMessage(40)])
    expect(world.sent[0]).toContain('BAŞLATMA')
    expect(await phase($)).toContain('aşama: handoff_running')

    // A notification turn: a subagent reported back; a code block, but not last.
    await turnEnd($, 'a1 sonucu:\n\n```\nbulgu\n```\n\nDiğer işin bitmesini bekliyorum.')
    await clock.advance(5000)
    expect(await phase($)).toContain('aşama: handoff_running')
    expect(world.toasts).not.toContain("Devir: devam prompt'u bulunamadı.")
    expect(world.sent).toHaveLength(1)

    // A plain intermediate turn: still waiting, nothing sent again.
    await turnEnd($, 'Sonuç işlendi.')
    await clock.advance(5000)
    expect(await phase($)).toContain('aşama: handoff_running')
    expect(world.sent).toHaveLength(1)

    // Everything finished: the turn ending in the handoff prompt completes it.
    world.agents = [{ id: 'a1', description: 'tara', type: 'Explore', status: 'completed' }]
    await turnEnd($, ANSWER)
    expect(await phase($)).toContain('aşama: awaiting_choice')
    expect(world.sent).toHaveLength(1)
    expect(world.ran).toEqual([])
  })

  test('(l) /devir simdi subagent varken de mesajı hemen gönderir', async ($, on) => {
    const { world, clock } = setup(on)
    world.agents = [{ id: 'a1', description: 'tara', type: 'Explore', status: 'pending' }]
    await start($)
    expect((await devir($, 'simdi')).text).toBe(
      'Devir başlatılıyor; 1 subagent bitiyor, yeni iş başlatılmayacak.',
    )
    await clock.advance(100)
    expect(world.sent).toHaveLength(1)
    expect((await devir($, 'simdi')).text).toBe('Devir zaten çalışıyor.')
    await clock.advance(100)
    expect(world.sent).toHaveLength(1)
  })

  test('(m) ajan listesi okunamazsa devir yine başlar', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'sor' }, { isAgentListBroken: true })
    await start($)
    await turnEnd($, 'iş')
    await clock.advance(100)
    expect(world.sent).toHaveLength(1)
  })

  test('(q) 6 turda prompt yoksa bir hatırlatma, sonra sınırlı geri dönüş', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await turnEnd($, 'iş')
    await clock.advance(100)
    expect(world.sent).toHaveLength(1)
    for (let i = 0; i < 5; i++) await turnEnd($, `ara tur ${i}`)
    await clock.advance(100)
    expect(world.sent).toHaveLength(1)

    // The sixth: one reminder.
    await turnEnd($, 'ara tur 5')
    await clock.advance(100)
    expect(world.sent).toHaveLength(2)
    expect(world.sent[1]).toBe(reminderText())
    expect(await phase($)).toContain('aşama: handoff_running')

    // Six more without it: give up as before, no further message.
    for (let i = 0; i < 6; i++) await turnEnd($, `yine yok ${i}`)
    await clock.advance(100)
    expect(world.sent).toHaveLength(2)
    expect(world.toasts).toContain("Devir: devam prompt'u bulunamadı.")
    expect(await phase($)).toContain('aşama: done')
    await turnEnd($, 'sonra')
    await clock.advance(60_000)
    expect(world.sent).toHaveLength(2)
  })

  test('(r) hiç tur gelmezse bekçi süreyle hatırlatır, sonra bırakır', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await turnEnd($, 'iş')
    await clock.advance(100)
    expect(world.sent).toHaveLength(1)
    await clock.advance(4 * 60 * 1000)
    expect(world.sent).toHaveLength(1)
    await clock.advance(70 * 1000)
    expect(world.sent).toEqual([handoffMessage(40), reminderText()])
    await clock.advance(5 * 60 * 1000 + 10_000)
    expect(await phase($)).toContain('aşama: done')
    expect(world.toasts).toContain("Devir: devam prompt'u bulunamadı.")
    await clock.advance(60 * 60 * 1000)
    expect(world.sent).toHaveLength(2)
  })

  test('(r2) subagent sürdükçe boşta kuralı işlemez, toplam süre sınırı işler', async ($, on) => {
    const { world, clock } = setup(on)
    world.agents = [{ id: 'a1', description: 'uzun', type: 'Explore', status: 'running' }]
    await start($)
    await turnEnd($, 'iş')
    await clock.advance(100)
    await clock.advance(20 * 60 * 1000)
    expect(world.sent).toHaveLength(1)
    await clock.advance(10 * 60 * 1000 + 10_000)
    expect(world.sent).toHaveLength(2)
    expect(await phase($)).toContain('aşama: handoff_running')
  })

  test('(j) tek mesaj: hal eki, yeni iş yasağı, devir adımı', () => {
    const cases = [[60, "%60'a"], [70, "%70'e"], [50, "%50'ye"], [75, "%75'e"], [40, "%40'a"], [86, "%86'ya"]] as const
    for (const [esik, ek] of cases) {
      expect(handoffMessage(esik).startsWith(`Bağlam ${ek} ulaştı`)).toBe(true)
    }
    const message = handoffMessage(60)
    expect(message).toContain("çalışan subagent'ların ve arka plan görevlerinin sonuçlarını geldikçe işle")
    expect(message).toContain('Yeni görev, yeni subagent, yeni arka plan işi ya da yeni bir iş BAŞLATMA')
    expect(message).toContain('/my-skill-handoff')
    expect(message).toContain('kod bloğu')
    expect(handoffMessage(60, false)).toContain('.workflow/HANDOFF.md')
    expect(reminderText()).toContain('yeni iş başlatmayı bırak')
    expect(reminderText()).toContain('/my-skill-handoff')
  })
  test('(s1) otomatik (s): makine turunda eşik; model görev oluşturur ve çalıştırır, mod alanları doldurur, effort eşitlenir', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' }, { tools: DESKTOP })
    world.self = SELF
    await start($)
    expect(TASK_A).toMatch(/^otomatik-devir-[0-9a-f]{8}-a$/)
    expect(TASK_B).toBe(TASK_A.replace(/-a$/, '-b'))
    expect(PLAN.file).toBe('/proj/.workflow/otomatik-devir-devam.md')
    // A task notification opened the turn: start_session would be refused, (s) instead.
    await machine($, 'a1 bitti')
    await turnBegin($)
    const first = await bash($)
    expect(first.context).toEqual([scheduledHandoff(40, true, PLAN)])
    for (const part of [PLAN.file, TASK_A, TASK_B, RUN, CREATE, '/my-skill-handoff', 'BAŞLATMA', 'asla silme']) {
      expect(first.context[0]).toContain(part)
    }
    expect(first.context[0]).not.toContain('user_asked')
    expect(await phase($)).toContain('aşama: handoff_running')
    expect((await bash($)).context ?? []).toEqual([])
    await clock.advance(100)

    // The model creates the two tasks with only a taskId: the mod fills the
    // static prompt, no schedule, no completion notices to this chat.
    await $.tool.call({ tool: CREATE, taskId: TASK_A, prompt: 'başka', description: 'x', cronExpression: '0 9 * * *' })
    await $.tool.call({ tool: CREATE, taskId: TASK_B, prompt: 'başka', description: 'x' })
    const created = callsOf(world, CREATE)
    expect(created).toHaveLength(2)
    for (const task of created) {
      expect(task).toMatchObject({ prompt: taskPrompt(PLAN.file), notifyOnCompletion: false })
      expect(task.cronExpression).toBeUndefined()
      expect(task.fireAt).toBeUndefined()
    }
    expect(taskPrompt(PLAN.file)).toContain("devam prompt'u /proj/.workflow/otomatik-devir-devam.md dosyasında")

    const ran = await $.tool.call({ tool: RUN, taskId: TASK_A })
    expect(ran.text).toContain(RUN_ID)
    // Effort sync: the model is told to copy this chat's settings over.
    expect(ran.context).toEqual([syncText(RUN_ID, SELF)])
    expect(ran.context[0]).toContain(`${SET_EFFORT} aracını session_id "${RUN_ID}", effort "high"`)
    expect(ran.context[0]).toContain('"claude-opus-5-5"')
    // v0.5 review H1: the permission mode is never switched (a raise always shows a card).
    expect(ran.context[0]).not.toContain('"bypassPermissions"')
    expect(ran.context[0]).toContain('İzin modunu değiştirme')
    expect(await phase($)).toContain('aşama: done')
    // Once started, no second run; never a delete or an update of its tasks.
    expect(String((await $.tool.call({ tool: RUN, taskId: TASK_B })).deny)).toContain('zaten açıldı')
    expect(String((await $.tool.call({ tool: DELETE, taskId: TASK_A })).deny)).toContain('silinmez')
    expect(String((await $.tool.call({ tool: UPDATE, taskId: TASK_B, prompt: 'y' })).deny)).toContain('güncellenmez')
    expect(callsOf(world, RUN)).toHaveLength(1)
    expect(callsOf(world, DELETE)).toHaveLength(0)
    expect(callsOf(world, UPDATE)).toHaveLength(0)
    await clock.advance(100)
    expect(world.toasts).toContain(`Devam yeni sohbette (zamanlanmış görev ${TASK_A}).`)

    await turnEnd($, 'Yeni sohbet açıldı.')
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: done')
    // No message of the mod's (the instruction rode on a tool result), no
    // start_session, no card, no /clear, no clipboard.
    expect(world.sent).toEqual([])
    expect(startCalls(world)).toHaveLength(0)
    expect(world.ran).toEqual([])
    expect(world.copied).toEqual([])
    // A task outside this mod's prefix is left alone.
    await $.tool.call({ tool: DELETE, taskId: 'gunluk-ozet' })
    expect(callsOf(world, DELETE)).toHaveLength(1)
  })

  test('(s2) A/B: bu sohbet A görevinin çalışmasıysa A reddedilir, B çalışır; güncelleme gerekmez', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' }, { tools: DESKTOP })
    world.self = { ...SELF, scheduledTaskId: TASK_A }
    await start($)
    await machine($, 'zamanlanmış', 'scheduled-trigger')
    await turnBegin($)
    expect((await bash($)).context).toEqual([scheduledHandoff(40, true, PLAN)])
    await clock.advance(100)
    const own = await $.tool.call({ tool: RUN, taskId: TASK_A })
    expect(String(own.deny)).toContain(TASK_B)
    expect(callsOf(world, RUN)).toHaveLength(0)
    const other = await $.tool.call({ tool: RUN, taskId: TASK_B })
    expect(other.text).toContain(RUN_ID)
    expect(callsOf(world, RUN).map((c: any) => c.taskId)).toEqual([TASK_B])
    expect(callsOf(world, CREATE)).toHaveLength(0)
    expect(callsOf(world, UPDATE)).toHaveLength(0)
    expect(await phase($)).toContain('aşama: done')
  })

  test('(s3) (s) olmazsa (b): iki görev de meşgul; dosyadaki prompt sonraki yazılan mesaja kalır, silme yok', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' }, { tools: DESKTOP })
    world.busy = [TASK_A, TASK_B]
    await start($)
    await machine($, 'a1 bitti')
    await turnBegin($)
    await bash($)
    await clock.advance(100)
    // The model wrote the prompt file, then both runs are refused.
    world.file = { text: 'Devam et: dosyadan\n', mtimeMs: 1_000_500 }
    const a = await $.tool.call({ tool: RUN, taskId: TASK_A })
    expect(a.isError).toBe(true)
    expect(String(a.context?.at(-1))).toContain('Diğer görev')
    const b = await $.tool.call({ tool: RUN, taskId: TASK_B })
    expect(String(b.context?.at(-1))).toContain('görev yolu olmadı')
    expect(String((await $.tool.call({ tool: RUN, taskId: TASK_A })).deny)).toContain('görev yolu olmadı')
    expect(callsOf(world, RUN)).toHaveLength(2)
    await turnEnd($, 'Görev açılamadı.')
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: deferred')
    expect(world.toasts).toContain('Zamanlanmış görev yolu olmadı; yeni sohbet bir sonraki mesajınla açılacak.')

    await typed($, 'sıradaki')
    expect(world.typed.at(-1)?.context).toEqual([nextMessageHandoff(40, true, true, 'Devam et: dosyadan')])
    await turnBegin($)
    await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'Devam et: dosyadan\n\nsıradaki' })
    await clock.advance(100)
    expect(detaches(world)).toEqual([expect.objectContaining({ session_id: NEW_ID })])
    await turnEnd($, 'Yeni sohbet açıldı.')
    expect(await phase($)).toContain('aşama: done')
    expect(callsOf(world, DELETE)).toHaveLength(0)
    expect(world.sent).toEqual([])
  })

  test('(s4) (s) olmazsa (b): önceki devrin dosyası sayılmaz, beceri (b) turunda yeniden çalışır', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' }, { tools: DESKTOP })
    // A file left by an earlier handoff (older than this one) is not read.
    world.file = { text: 'eski devam', mtimeMs: 10 }
    world.busy = [TASK_A, TASK_B]
    await start($)
    await machine($, 'a1 bitti')
    await turnBegin($)
    await bash($)
    await clock.advance(100)
    await $.tool.call({ tool: RUN, taskId: TASK_A })
    await turnEnd($, 'olmadı')
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: deferred')
    await typed($, 'hadi')
    expect(world.typed.at(-1)?.context).toEqual([nextMessageHandoff(40)])
  })

  test('(s5) tur sonunda eşik (araç çağrısı kalmadı): (s) modun mesajıyla', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' }, { tools: DESKTOP })
    await start($)
    // The typed turn ended right at the crossing: no typed turn is open, so (s).
    await turnEnd($, 'iş')
    await clock.advance(100)
    expect(world.sent).toEqual([scheduledHandoff(40, true, PLAN)])
    expect(await phase($)).toContain('aşama: handoff_running')
    await turnBegin($)
    await $.tool.call({ tool: RUN, taskId: TASK_A })
    expect(await phase($)).toContain('aşama: done')
    expect(startCalls(world)).toHaveLength(0)
  })

  test('(s6) (a) sonra (s): prompt makine turunda gelirse (s) hazır prompt ile; /devir simdi de (s)', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' }, { tools: DESKTOP })
    world.agents = [{ id: 'a1', description: 'tara', type: 'Explore', status: 'running' }]
    await start($)
    await typed($, 'iş')
    await turnBegin($)
    expect((await bash($)).context).toEqual([inTurnHandoff(40)])
    await turnEnd($, 'Arka plan işini bekliyorum.')
    world.agents = []
    await machine($, 'a1 bitti')
    await turnBegin($)
    await turnEnd($, ANSWER)
    await clock.advance(100)
    expect(world.sent).toEqual([scheduledHandoff(40, true, PLAN, 'Devam et: adım 3')])
    expect(world.sent[0]).toContain('devir becerisini yeniden çalıştırma')
    await turnBegin($)
    expect((await $.tool.call({ tool: RUN, taskId: TASK_A })).text).toContain(RUN_ID)
    await turnEnd($, 'Yeni sohbet açıldı.')
    expect(await phase($)).toContain('aşama: done')
    expect(startCalls(world)).toHaveLength(0)

    // /devir simdi in otomatik with the scheduled tools: (s) at once.
    expect((await devir($, 'simdi')).text).toContain('zamanlanmış görevle')
    await clock.advance(100)
    expect(world.sent).toHaveLength(2)
    expect(world.sent[1]).toBe(scheduledHandoff(40, true, PLAN))
  })

  test('(s7) sor modunda değişmez: makine turunda (s) talimatı yok, v0.3 mesajı gider', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'sor' }, { tools: DESKTOP })
    await start($)
    await machine($, 'a1 bitti')
    await turnBegin($)
    expect((await bash($)).context ?? []).toEqual([])
    await turnEnd($, 'iş')
    await clock.advance(100)
    expect(world.sent).toEqual([handoffMessage(40)])
    expect(callsOf(world, RUN)).toHaveLength(0)
  })

  // ---- v0.4 review fixes: one regression test per High/Medium finding ----

  test('(H1a) kapı açık: talimat önce list_start_targets der; depo listesi doluysa (a) start_session', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' }, { tools: GATED })
    world.repos = { '/proj': { name: 'proj' } }
    await start($)
    await typed($, 'uzun işi yap', { origin: { kind: 'sdk' } })
    await turnBegin($)
    const first = await bash($)
    expect(first.context).toEqual([gatedHandoff(40, true, PLAN)])
    for (const part of [GATE, PLAN.file, 'BAŞLATMA', HAND_OFF]) expect(first.context[0]).toContain(part)
    // The path is not picked by the prompt's origin: no start step yet.
    expect(first.context[0]).not.toContain('initiation "user_asked"')
    await clock.advance(100)
    const gate = await $.tool.call({ tool: GATE })
    expect(gate.context).toEqual([gateOpenNote(PLAN)])
    expect(gate.context[0]).toContain('initiation "user_asked"')
    const started = await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'Devam et: adım 3' })
    expect(started.text).toContain(NEW_ID)
    await turnEnd($, 'Yeni sohbet açıldı.')
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: done')
    expect(callsOf(world, RUN)).toHaveLength(0)
    expect(world.sent).toEqual([])
  })

  test('(H1b) sdk kökenli makine mesajı: kapı kapalı (depo listesi boş, önce dolu görüldü) → (s), (b) harcanmaz', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik', depoGoruldu: true }, { tools: GATED })
    await start($)
    // The app wakes this chat (a side session ended its turn): it reads `sdk`, like a typed message.
    await machine($, 'yan oturum turunu bitirdi', 'sdk')
    await turnBegin($)
    expect((await bash($)).context).toEqual([gatedHandoff(40, true, PLAN)])
    await clock.advance(100)
    const gate = await $.tool.call({ tool: GATE })
    expect(gate.context).toEqual([gateClosedNote(PLAN)])
    expect(gate.context[0]).toContain(RUN)
    expect((await $.tool.call({ tool: RUN, taskId: TASK_A })).text).toContain(RUN_ID)
    await turnEnd($, 'Yeni sohbet açıldı.')
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: done')
    expect(startCalls(world)).toHaveLength(0)
    expect(world.sent).toEqual([])
  })

  test('(H1c) depo hiç görülmediyse köken karar verir; start_session R1 ile reddedilirse aynı turda (s), kart yok', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' }, { tools: GATED, isUserAskedRefused: true })
    await start($)
    await machine($, 'uyandırma', 'sdk')
    await turnBegin($)
    await bash($)
    await clock.advance(100)
    // Empty, and never seen filled: the signal is unavailable, the origin (sdk) says (a).
    expect((await $.tool.call({ tool: GATE })).context).toEqual([gateOpenNote(PLAN)])
    const refused = await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'Devam et: adım 3' })
    expect(refused.isError).toBe(true)
    expect(refused.context?.at(-1)).toBe(refusedToScheduled(PLAN))
    expect(await phase($)).toContain('aşama: handoff_running')
    expect((await $.tool.call({ tool: RUN, taskId: TASK_A })).text).toContain(RUN_ID)
    await turnEnd($, 'Yeni sohbet açıldı.')
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: done')
    expect(startCalls(world).map((c: any) => c.initiation)).toEqual(['user_asked'])
    expect(world.sent).toEqual([])
  })

  test('(H1d) (s) yokken R1 reddi makine turu sayılır: kart değil, (b) bir kez; isMeta kişi sayılmaz', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' }, { isUserAskedRefused: true })
    await start($)
    await typed($, 'gizli not', { isMeta: true })
    await turnBegin($)
    expect((await bash($)).context ?? []).toEqual([])
    await turnEnd($, 'tamam', true)
    await devir($, 'ac')
    await typed($, 'iş', { origin: { kind: 'sdk' } })
    await turnBegin($)
    expect((await bash($)).context).toEqual([inTurnHandoff(40)])
    await clock.advance(100)
    await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'Devam et: adım 3' })
    await turnEnd($, 'Yeni sohbet açılamadı.')
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: deferred')
    expect(startCalls(world).map((c: any) => c.initiation)).toEqual(['user_asked'])
    await typed($, 'sıradaki')
    expect(world.typed.at(-1)?.context).toEqual([nextMessageHandoff(40, true, true, 'Devam et: adım 3')])
  })

  test('(H2) talimattan sonraki kişi turunun kod bloğu devir prompt\'u sayılmaz; sonraki mesaj talimatı taşır', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    world.agents = [{ id: 'a1', description: 'tara', type: 'Explore', status: 'running' }]
    await start($)
    await typed($, 'iş')
    await turnBegin($)
    expect((await bash($)).context).toEqual([inTurnHandoff(40)])
    await turnEnd($, 'Arka plan işini bekliyorum.')
    await clock.advance(100)
    // A machine turn runs; the person types into it and asks something.
    await machine($, 'a1 ara sonuç')
    await turnBegin($)
    await typed($, 'hangi komutu çalıştırayım?', { turnId: runningTurn() })
    await turnEnd($, 'Şunu çalıştır:\n\n```\nnpm test\n```\n')
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: handoff_running')
    expect(startCalls(world)).toHaveLength(0)
    expect(world.copied).toEqual([])
    // The person types again: the (b) instruction rides on it, once.
    await typed($, 'peki')
    expect(world.typed.at(-1)?.context).toEqual([nextMessageHandoff(40)])
    await turnBegin($)
    await turnEnd($, ANSWER)
    await clock.advance(100)
    expect(startCalls(world).map((c: any) => [c.initiation, c.prompt])).toEqual([['own_initiative', 'Devam et: adım 3']])
  })

  test('(H3) başarı metninde local_ yoksa da açıldı sayılır: ikinci devir yok, sohbet listeden bulunup taşınır', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' }, { startText: 'Yeni oturum başlatıldı.' })
    await start($)
    await typed($, 'iş')
    await turnBegin($)
    await bash($)
    await clock.advance(100)
    await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'Devam et: adım 3' })
    expect(await phase($)).toContain('aşama: done')
    expect(String((await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'x' })).deny)).toContain('zaten açıldı')
    await turnEnd($, 'Yeni sohbet açıldı.')
    await clock.advance(100)
    for (let i = 0; i < 7; i++) await turnEnd($, `ara ${i}`)
    await typed($, 'sıradaki')
    expect(world.typed.at(-1)?.context).toEqual([])
    expect(startCalls(world)).toHaveLength(1)
    world.listed = [{ sessionId: 'local_new', title: 'Eski iş (devam)', startedBy: 'local_self' }]
    await clock.advance(5000)
    expect(detaches(world)).toEqual([expect.objectContaining({ session_id: 'local_new' })])
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
      setup(on, { esik: 40, mod: 'otomatik' })
      await start($)
      await typed($, 'iş')
      await turnBegin($)
      const other = await $.command.run({
        command: 'baska',
        args: '',
        origin: { kind: 'composer' },
        presentation: { isFullscreen: false, columns: 100 },
      } as any)
      expect((other as any).text).toBe('[]')
      expect(await phase($)).toContain('aşama: idle')
      expect((await bash($)).context).toEqual([inTurnHandoff(40)])
    },
  )

  test('(M2) devir sürerken hand_off_to_session reddedilir; devir yokken geçer', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' }, { tools: GATED })
    await start($)
    await $.tool.call({ tool: HAND_OFF, title: 'x', remaining_plan: 'y' })
    expect(callsOf(world, HAND_OFF)).toHaveLength(1)
    await typed($, 'iş')
    await turnBegin($)
    await bash($)
    await clock.advance(100)
    const fork = await $.tool.call({ tool: HAND_OFF, title: 'x', remaining_plan: 'y' })
    expect(String(fork.deny)).toContain(`${HAND_OFF} kullanma`)
    expect(callsOf(world, HAND_OFF)).toHaveLength(1)
  })

  test('(M4) (b) talimatı çalışan işlerin bitmesini bekletir', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    await start($)
    await machine($, 'a1 bitti')
    await turnBegin($)
    await turnEnd($, 'iş')
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: deferred')
    world.agents = [{ id: 'a2', description: 'tara', type: 'Explore', status: 'running' }]
    await typed($, 'sıradaki')
    const note = world.typed.at(-1)?.context[0] ?? ''
    expect(note).toContain('bitmelerini bekle')
    expect(note).toContain('sonraki turlarda çağırma')
  })

  test('(M5) bekleyen devir, çalışan tura yazılan mesajla kişinin turunda araç sonucuna biner; zorla bekletilen devir ölçümle iptal olmaz', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' }, { tools: [START, GET, DETACH, GATE] })
    world.percent = 10
    await start($)
    expect((await devir($, 'simdi')).text).toContain('bir sonraki mesajınla')
    await clock.advance(100)
    // L2: a fill measured under the threshold does not cancel /devir simdi.
    await $.session.measure({ context: { window: 100, percent: 10 }, rateLimits: [], changed: ['context'] })
    expect(await phase($)).toContain('aşama: deferred')
    await machine($, 'a1 bitti')
    await turnBegin($)
    expect((await bash($)).context ?? []).toEqual([])
    await typed($, 'şunu da yap', { turnId: runningTurn() })
    expect((await bash($)).context).toEqual([gatedHandoff(40, true)])
    expect(await phase($)).toContain('aşama: handoff_running')
    world.repos = { '/proj': {} }
    expect((await $.tool.call({ tool: GATE })).context).toEqual([gateOpenNote()])
  })

  test('(M6) aynı mesajda iki start_session ya da iki görev çalıştırması: yalnızca biri geçer', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' }, { tools: DESKTOP })
    await start($)
    await typed($, 'iş')
    await turnBegin($)
    await bash($)
    await clock.advance(100)
    const both = await Promise.all([
      $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'Devam et: 1' }),
      $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'Devam et: 2' }),
    ])
    expect(both.filter((r: any) => r.deny !== undefined)).toHaveLength(1)
    expect(startCalls(world)).toHaveLength(1)
    await turnEnd($, 'Yeni sohbet açıldı.')

    // The same for two task runs in one message.
    await devir($, 'esik 40')
    await machine($, 'a1 bitti')
    await turnBegin($)
    await bash($)
    await clock.advance(100)
    const runs = await Promise.all([
      $.tool.call({ tool: RUN, taskId: TASK_A }),
      $.tool.call({ tool: RUN, taskId: TASK_B }),
    ])
    expect(runs.filter((r: any) => r.deny !== undefined)).toHaveLength(1)
    expect(callsOf(world, RUN)).toHaveLength(1)
  })

  test('(L1, L5) düşürülen (b) mesajı devri yeniden bekletir; kişinin "hayır"ı kart açmaz, /devir gec ile açılır', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' }, { isUserAskedDenied: true })
    await start($)
    await machine($, 'a1 bitti')
    await turnBegin($)
    await turnEnd($, 'iş')
    await clock.advance(100)
    await typed($, 'DÜŞÜR')
    expect(await phase($)).toContain('aşama: deferred')
    await typed($, 'şimdi')
    expect(world.typed.at(-1)?.context).toEqual([nextMessageHandoff(40)])
    await turnBegin($)
    await clock.advance(100)
    const denied = await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'Devam et: adım 3' })
    expect(denied.deny).toBe('Kullanıcı reddetti')
    await turnEnd($, 'Tamam.')
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: awaiting_choice')
    expect(startCalls(world)).toHaveLength(1)
    expect((await devir($, 'gec')).text).toBe('Yeni sohbete geçiliyor.')
    await clock.advance(100)
    expect(startCalls(world).map((c: any) => c.initiation)).toEqual(['user_asked', 'own_initiative'])
  })

  // ---- v0.4 re-review fixes: one regression test per High/Medium finding ----

  test('(N1) bekçi devri bekletse de geç kalan görev çalıştırması sayılır; sonraki mesaj ikinci sohbet açmaz', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' }, { tools: DESKTOP })
    await start($)
    await machine($, 'a1 bitti')
    await turnBegin($)
    expect((await bash($)).context).toEqual([scheduledHandoff(40, true, PLAN)])
    // The model ends its turn to wait on a background build the guard cannot see.
    await turnEnd($, 'Arka plan derlemesini bekliyorum.')
    await clock.advance(6 * 60 * 1000)
    expect(await phase($)).toContain('aşama: deferred')
    // The build's notification turn: the model runs the task late; it is tracked.
    await machine($, 'derleme bitti')
    await turnBegin($)
    const run = await $.tool.call({ tool: RUN, taskId: TASK_A })
    expect(run.text).toContain(RUN_ID)
    expect(String(run.context?.at(-1))).toContain('devam sohbeti açıldı')
    expect(await phase($)).toContain('aşama: done')
    await turnEnd($, 'Yeni sohbet açıldı.')
    await clock.advance(100)
    // The person's next message carries no (b): no second chat.
    await typed($, 'sıradaki')
    expect(world.typed.at(-1)?.context).toEqual([])
    expect(callsOf(world, RUN)).toHaveLength(1)
    expect(startCalls(world)).toHaveLength(0)
    expect(world.sent).toEqual([])
  })

  test('(N1b) bekletilen devirde geç kalan kapı çağrısı yolu yine alır', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik', depoGoruldu: true }, { tools: GATED })
    await start($)
    await machine($, 'a1 bitti')
    await turnBegin($)
    expect((await bash($)).context).toEqual([gatedHandoff(40, true, PLAN)])
    await turnEnd($, 'Arka plan işini bekliyorum.')
    await clock.advance(6 * 60 * 1000)
    expect(await phase($)).toContain('aşama: deferred')
    await machine($, 'iş bitti')
    await turnBegin($)
    expect((await $.tool.call({ tool: GATE })).context).toEqual([gateClosedNote(PLAN)])
    expect(await phase($)).toContain('aşama: handoff_running')
    expect((await $.tool.call({ tool: RUN, taskId: TASK_A })).text).toContain(RUN_ID)
    await turnEnd($, 'Yeni sohbet açıldı.')
    await clock.advance(100)
    await typed($, 'sıradaki')
    expect(world.typed.at(-1)?.context).toEqual([])
    expect(startCalls(world)).toHaveLength(0)
  })

  test("(N1c) bekletilen devirde makine turunda geç gelen prompt tutulur; kart yok, beceri yeniden çalışmaz", async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    await start($)
    await typed($, 'iş')
    await turnBegin($)
    expect((await bash($)).context).toEqual([inTurnHandoff(40)])
    await turnEnd($, 'Arka plan işini bekliyorum.')
    await clock.advance(6 * 60 * 1000)
    expect(await phase($)).toContain('aşama: deferred')
    await machine($, 'iş bitti')
    await turnBegin($)
    await turnEnd($, ANSWER)
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: deferred')
    expect(startCalls(world)).toHaveLength(0)
    await typed($, 'sıradaki')
    expect(world.typed.at(-1)?.context).toEqual([nextMessageHandoff(40, true, true, 'Devam et: adım 3')])
  })

  test('(N2) ikinci yazılan mesajda çalışan ajan varken devir bırakılmaz; geç gelen sonuç sayılır', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik', depoGoruldu: true }, { tools: GATED })
    world.agents = [{ id: 'a1', description: 'tara', type: 'Explore', status: 'running' }]
    await start($)
    await typed($, 'iş')
    await turnBegin($)
    expect((await bash($)).context).toEqual([gatedHandoff(40, true, PLAN)])
    await turnEnd($, 'Arka plan ajanını bekliyorum.')
    await clock.advance(100)
    await typed($, 'durum ne?')
    expect(world.typed.at(-1)?.context).toHaveLength(1)
    await turnBegin($)
    await turnEnd($, 'Hâlâ bekliyorum.')
    await clock.advance(100)
    // Second typed message, the agent still runs: not a give-up.
    await typed($, 'tamam')
    expect(world.typed.at(-1)?.context).toEqual([])
    expect(await phase($)).toContain('aşama: handoff_running')
    expect(world.toasts).not.toContain("Devir: devam prompt'u bulunamadı.")
    await turnBegin($)
    await turnEnd($, 'ok')
    await clock.advance(100)
    // The agent finishes: the gate names (s) and the run starts the chat.
    world.agents = []
    await machine($, 'ajan bitti')
    await turnBegin($)
    expect((await $.tool.call({ tool: GATE })).context).toEqual([gateClosedNote(PLAN)])
    expect((await $.tool.call({ tool: RUN, taskId: TASK_A })).text).toContain(RUN_ID)
    await turnEnd($, 'Yeni sohbet açıldı.')
    expect(await phase($)).toContain('aşama: done')
    expect(startCalls(world)).toHaveLength(0)
  })

  test('(N2b) bırakılan devrin geç kalan görev çalıştırması da sayılır', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' }, { tools: DESKTOP })
    await start($)
    await machine($, 'a1 bitti')
    await turnBegin($)
    await bash($)
    for (let i = 0; i < 6; i++) await turnEnd($, `ara tur ${i}`)
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: deferred')
    await typed($, 'devam')
    await turnBegin($)
    for (let i = 0; i < 6; i++) await turnEnd($, `yine yok ${i}`)
    await clock.advance(100)
    expect(world.toasts).toContain("Devir: devam prompt'u bulunamadı.")
    await machine($, 'derleme bitti')
    await turnBegin($)
    expect((await $.tool.call({ tool: RUN, taskId: TASK_A })).text).toContain(RUN_ID)
    expect(String((await $.tool.call({ tool: RUN, taskId: TASK_B })).deny)).toContain('zaten açıldı')
    expect(callsOf(world, RUN)).toHaveLength(1)
  })

  test('(N3) (s) olmadıktan sonra sdk uyandırması (b)yi harcamaz, kart açmaz', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik', depoGoruldu: true }, { tools: GATED })
    world.busy = [TASK_A, TASK_B]
    await start($)
    await machine($, 'a1 bitti')
    await turnBegin($)
    await bash($)
    await clock.advance(100)
    expect((await $.tool.call({ tool: GATE })).context).toEqual([gateClosedNote(PLAN)])
    await $.tool.call({ tool: RUN, taskId: TASK_A })
    await $.tool.call({ tool: RUN, taskId: TASK_B })
    await turnEnd($, ANSWER)
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: deferred')
    // The app wakes this chat (sdk, like a typed message): the gate says closed.
    await machine($, 'yan oturum bitti', 'sdk')
    expect(world.typed.at(-1)?.context).toHaveLength(1)
    await turnBegin($)
    expect((await $.tool.call({ tool: GATE })).context).toEqual([NOT_PERSON_NOTE])
    expect(await phase($)).toContain('aşama: deferred')
    await turnEnd($, ANSWER)
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: deferred')
    expect(startCalls(world)).toHaveLength(0)
    // The person's real next message gets (b), with the held prompt and without the wake-up's text.
    await typed($, 'sıradaki')
    expect(world.typed.at(-1)?.context).toEqual([
      nextMessageHandoff(40, true, true, 'Devam et: adım 3', { plan: PLAN }),
    ])
    await turnBegin($)
    world.repos = { '/proj': {} }
    expect((await $.tool.call({ tool: GATE })).context).toEqual([gateOpenNote(PLAN)])
    await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'Devam et: adım 3\n\nsıradaki' })
    expect(await phase($)).toContain('aşama: done')
    expect(startCalls(world).map((c: any) => c.initiation)).toEqual(['user_asked'])
  })

  test('(N4) R1 sonrası modelin kendi kartı (s) varken reddedilir; yeni sohbet (s) ile açılır', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' }, { tools: GATED, isUserAskedRefused: true })
    await start($)
    await machine($, 'uyandırma', 'sdk')
    await turnBegin($)
    await bash($)
    await clock.advance(100)
    expect((await $.tool.call({ tool: GATE })).context).toEqual([gateOpenNote(PLAN)])
    const refused = await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'Devam et: adım 3' })
    expect(refused.context?.at(-1)).toBe(refusedToScheduled(PLAN))
    // The app's text says "propose the session instead": the card waits while (s) can run.
    const card = await $.tool.call({ tool: START, initiation: 'own_initiative', prompt: 'Devam et: adım 3', title: 'x' })
    expect(card.deny).toBe(cardToScheduled(PLAN))
    expect(startCalls(world).map((c: any) => c.initiation)).toEqual(['user_asked'])
    expect(await phase($)).toContain('aşama: handoff_running')
    expect((await $.tool.call({ tool: RUN, taskId: TASK_A })).text).toContain(RUN_ID)
    expect(await phase($)).toContain('aşama: done')
  })

  test('(N5) kapı aracı yokken bekleyen devir çalışan tura yazılan mesajla kişinin turunda araç sonucuna biner', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    world.percent = 10
    await start($)
    expect((await devir($, 'simdi')).text).toContain('bir sonraki mesajınla')
    await clock.advance(100)
    expect(await phase($)).toContain('aşama: deferred')
    await machine($, 'a1 bitti')
    await turnBegin($)
    expect((await bash($)).context ?? []).toEqual([])
    await typed($, 'şunu da yap', { turnId: runningTurn() })
    expect((await bash($)).context).toEqual([inTurnHandoff(40)])
    expect(await phase($)).toContain('aşama: handoff_running')
    await clock.advance(100)
    await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'Devam et: adım 3' })
    expect(await phase($)).toContain('aşama: done')
    expect(startCalls(world)).toHaveLength(1)
  })

  test(
    '(N6, N8, N9, N10) görev koruması: subagent ve başka mod silemez; kişinin kendi otomatik-devir-* görevi serbest; -a-2 oluşturulmaz; çalıştırmadan sonra start_session yok',
    {
      plugins: [
        {
          name: 'baska-mod',
          register(on: any) {
            on('command.run', { command: 'sil' }, async ($: any, e: any) => {
              const got = await $.tool.call({ tool: 'mcp__scheduled-tasks__delete_scheduled_task', taskId: e.args })
              return { text: String(got.deny ?? 'geçti') }
            })
          },
        },
      ],
    },
    async ($, on) => {
      const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' }, { tools: DESKTOP })
      await start($)
      const other = await $.command.run({
        command: 'sil',
        args: TASK_A,
        origin: { kind: 'composer' },
        presentation: { isFullscreen: false, columns: 100 },
      } as any)
      expect((other as any).text).toContain('silinmez')
      const sub = await $.tool.call({ tool: DELETE, taskId: TASK_B, agentId: 'ag1' } as any)
      expect(String(sub.deny)).toContain('silinmez')
      expect(callsOf(world, DELETE)).toHaveLength(0)
      // A person's own task that only starts with the prefix is left alone.
      await $.tool.call({ tool: DELETE, taskId: 'otomatik-devir-rapor' })
      await $.tool.call({ tool: UPDATE, taskId: 'otomatik-devir-rapor', prompt: 'y' })
      expect(callsOf(world, DELETE)).toHaveLength(1)
      expect(callsOf(world, UPDATE)).toHaveLength(1)
      // A create under the app's suggested free id is refused: run the pair's task.
      const retry = await $.tool.call({ tool: CREATE, taskId: `${TASK_A}-2` })
      expect(String(retry.deny)).toContain(`"${TASK_A}" görevi zaten var`)
      expect(callsOf(world, CREATE)).toHaveLength(0)
      // N6: a run started the chat in this turn; a start_session after it is a second chat.
      await machine($, 'a1 bitti')
      await turnBegin($)
      await bash($)
      await clock.advance(100)
      expect((await $.tool.call({ tool: RUN, taskId: TASK_A })).text).toContain(RUN_ID)
      const second = await $.tool.call({ tool: START, initiation: 'user_asked', prompt: 'x' })
      expect(String(second.deny)).toContain('zaten açıldı')
      expect(startCalls(world)).toHaveLength(0)
    },
  )
})
