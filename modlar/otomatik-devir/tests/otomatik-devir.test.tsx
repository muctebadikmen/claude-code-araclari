import { describe, expect, mock, test } from 'claude-code/testing'

import { noteText } from '../hooks/register.tsx'

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
  } = {},
) => {
  const {
    commands = [SKILL],
    tools = [START, GET, DETACH],
    isStartFailing = false,
    isAgentListBroken = false,
    isUserAskedRefused = false,
  } = opts
  const world = {
    sid: 's1',
    percent: 50 as number | undefined,
    sent: [] as string[],
    ran: [] as string[],
    toasts: [] as string[],
    copied: [] as string[],
    calls: [] as any[],
    agents: [] as { id: string; description: string; type: string; status: string }[],
    listed: [] as { sessionId: string; title: string; startedBy?: string }[],
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
      return { result: [], text: JSON.stringify({ sessionId: 'local_self', title: 'Eski iş' }) }
    }
    if (e.tool === LIST) return { result: [], text: JSON.stringify(world.listed) }
    if (e.tool === START && isStartFailing) return { result: [], text: 'nope', isError: true }
    if (e.tool === START && isUserAskedRefused && e.initiation === 'user_asked') {
      return { result: [], text: REFUSAL, isError: true }
    }
    if (e.tool === START && e.initiation === 'own_initiative') {
      return { result: [], text: `Proposed "${e.title}" (task_id: task_d39c5c47). The user sees a card.` }
    }
    if (e.tool === START) {
      return { result: [], text: `Started session "${e.title}" (session_id: ${NEW_ID}, name: eski-is)` }
    }
    return { result: [], text: 'ok' }
  })
  on('fs.exists', () => ({ value: false }))
  on('prompt.submit', ($: any, e: any) => {
    world.sent.push(e.text)
    return { text: e.text }
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

const turnEnd = ($: any, answer: string, isAborted = false) =>
  $.turn.complete({
    answer,
    durationMs: 1,
    isAborted,
    turnId: `t${Math.random()}`,
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

describe('otomatik-devir', () => {
  test('(a) boşta: çıktı tam olarak alttaki çizimdir', async ($, on) => {
    setup(on)
    await start($)
    const ui = await mountBand($)
    const drawn: any = await ui.drawn()
    expect(drawn).toMatchObject({ type: 'Box', props: { key: 'below' } })
    expect(drawn.props.flexDirection).toBeUndefined()
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    expect((await devir($, '')).text).toContain('aşama: idle')
    await ui.unmount()
  })

  for (const surface of ['terminal', 'desktop'] as const) {
    test(`(b) soru aşaması: kendi satırı önce, alttaki çizim korunur (${surface})`, async ($, on) => {
      const { world, clock } = setup(on)
      await start($)
      await toAwaitingChoice($, clock)
      expect(world.ran).toEqual([SKILL])
      expect((await devir($, '')).text).toContain('aşama: awaiting_choice')

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
      expect(world.ran).toEqual([SKILL])
      expect(world.calls.map((c: any) => c.tool)).toEqual([GET, START, DETACH])
      expect(world.sent).toEqual([])
      expect((await devir($, '')).text).toContain('aşama: done')
    })
  }

  test('(b2) Geç düğmesi yeni kardeş sohbet açar, /clear çalışmaz', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await toAwaitingChoice($, clock)
    const ui = await mountBand($)
    await ui.press({ key: 'gec' })
    await clock.advance(100)
    expect(world.ran).toEqual([SKILL])
    expect(world.ran).not.toContain('clear')
    expect(world.sent).toEqual([])
    const started = world.calls.find((c: any) => c.tool === START)
    expect(started).toMatchObject({
      initiation: 'user_asked',
      context: 'fresh',
      title: 'Eski iş (devam)',
      prompt: 'Devam et: adım 3',
      use_worktree: false,
    })
    expect(started.background.length).toBeGreaterThanOrEqual(80)
    expect(world.calls.find((c: any) => c.tool === DETACH)).toMatchObject({ session_id: NEW_ID })
    expect(world.toasts).toContain('Devam yeni sohbette: Eski iş (devam)')
    expect(world.copied).toEqual([])
    expect((await devir($, '')).text).toContain('aşama: done')
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
    expect((await devir($, '')).text).toContain('aşama: done')

    // Still over the threshold: stays done, no new handoff every turn.
    await turnEnd($, 'iş')
    await clock.advance(100)
    expect(world.ran).toEqual([SKILL])
    expect((await devir($, '')).text).toContain('aşama: done')

    // Fill measured under the threshold (e.g. /compact) -> idle.
    world.percent = 10
    await $.session.measure({
      context: { window: 100, percent: 10 },
      rateLimits: [],
      changed: ['context'],
    })
    expect((await devir($, '')).text).toContain('aşama: idle')

    // Re-armed: crossing again triggers a new handoff at the turn end.
    world.percent = 45
    await turnEnd($, 'iş')
    await clock.advance(100)
    expect(world.ran).toEqual([SKILL, SKILL])
    expect((await devir($, '')).text).toContain('aşama: handoff_running')

    // Aborted again -> done; a new threshold re-arms too.
    await turnEnd($, '', true)
    expect((await devir($, '')).text).toContain('aşama: done')
    expect((await devir($, 'esik 70')).text).toContain('%70')
    expect((await devir($, '')).text).toContain('aşama: idle')
  })

  test('(c2) turn sonunda eşiğin altındaki doluluk done kaydını sıfırlar', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await devir($, 'simdi')
    await clock.advance(100)
    await turnEnd($, 'devam bloğu yok')
    expect(world.toasts).toContain("Devir: devam prompt'u bulunamadı.")
    expect((await devir($, '')).text).toContain('aşama: done')
    world.percent = 20
    await turnEnd($, 'iş')
    expect((await devir($, '')).text).toContain('aşama: idle')
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
    expect(world.sent).toEqual([])
  })
  test('(e) my-skill-handoff yoksa yedek prompt gönderilir', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'sor' }, { commands: [] })
    await start($)
    await turnEnd($, 'iş')
    await clock.advance(100)
    expect(world.ran).toEqual([])
    expect(world.sent).toHaveLength(1)
    expect(world.sent[0]).toContain('.workflow/HANDOFF.md')
    expect(world.sent[0]).toContain('tek bir kod bloğu')
    expect((await devir($, '')).text).toContain('aşama: handoff_running')
    await turnEnd($, ANSWER)
    expect((await devir($, '')).text).toContain('aşama: awaiting_choice')
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
      expect(world.ran).toEqual([SKILL])
      expect(world.calls.map((c: any) => c.tool)).not.toContain(DETACH)
      expect(world.sent).toEqual([])
      expect(world.copied).toEqual(['Devam et: adım 3'])
      expect(world.toasts).toContain("Devam prompt'u panoya kopyalandı. Yeni sohbet açıp yapıştır.")
      // Still claimable, but the band stays hidden: no repeated question.
      expect((await devir($, '')).text).toContain('aşama: awaiting_choice')
      const ui = await mountBand($)
      expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
      await ui.unmount()
    })
  }

  test('(g) otomatik modda sormadan geçer, tek sefer', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    await start($)
    await turnEnd($, 'iş')
    await clock.advance(100)
    await turnEnd($, ANSWER)
    await clock.advance(100)
    expect(world.ran).toEqual([SKILL])
    expect(world.calls.filter((c: any) => c.tool === START)).toHaveLength(1)
    expect(world.sent).toEqual([])
    // This chat stays at done: a later turn over the threshold starts nothing.
    await turnEnd($, 'devam')
    await clock.advance(100)
    expect(world.ran).toEqual([SKILL])
    expect(world.calls.filter((c: any) => c.tool === START)).toHaveLength(1)
  })

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

  test('(n) user_asked reddedilirse kart önerilir, başlatılınca üst seviyeye taşınır', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' }, { isUserAskedRefused: true })
    await start($)
    await turnEnd($, 'iş')
    await clock.advance(100)
    await turnEnd($, ANSWER)
    await clock.advance(100)
    const starts = world.calls.filter((c: any) => c.tool === START)
    expect(starts.map((c: any) => c.initiation)).toEqual(['user_asked', 'own_initiative'])
    expect(starts[1]).toMatchObject({ title: 'Eski iş (devam)', prompt: 'Devam et: adım 3', context: 'fresh' })
    expect(world.toasts).toContain('Devam kartı hazır: karta tıklayınca yeni sohbet açılır.')
    expect(world.copied).toEqual([])
    expect((await devir($, '')).text).toContain('aşama: done')
    expect(world.calls.filter((c: any) => c.tool === DETACH)).toHaveLength(0)

    // Not started yet: the watcher keeps looking, linked sessions only.
    await clock.advance(5000)
    const lists = world.calls.filter((c: any) => c.tool === LIST)
    expect(lists.length).toBeGreaterThan(0)
    expect(lists[0]).toMatchObject({ linked: true })
    expect(world.calls.filter((c: any) => c.tool === DETACH)).toHaveLength(0)

    // The person clicks the card: only the one this chat started, by its title, moves.
    world.listed = [
      { sessionId: 'local_other', title: 'Eski iş (devam)', startedBy: 'local_baska' },
      { sessionId: 'local_new', title: 'Eski iş (devam)', startedBy: 'local_self' },
    ]
    await clock.advance(5000)
    expect(world.calls.filter((c: any) => c.tool === DETACH)).toEqual([
      expect.objectContaining({ session_id: 'local_new' }),
    ])
    const seen = world.calls.filter((c: any) => c.tool === LIST).length
    await clock.advance(20000)
    expect(world.calls.filter((c: any) => c.tool === LIST)).toHaveLength(seen)
    expect(world.ran).toEqual([SKILL])
  })

  test('(k) subagent çalışırken devir başlamaz; bitince izleyici başlatır', async ($, on) => {
    const { world, clock } = setup(on)
    world.agents = [{ id: 'a1', description: 'tara', type: 'Explore', status: 'running' }]
    await start($)
    await turnEnd($, 'iş')
    await clock.advance(100)
    expect(world.ran).toEqual([])
    expect((await devir($, '')).text).toContain('aşama: warned')
    expect(world.toasts).toContain('Devir: 1 subagent bitince başlayacak.')

    // Another turn end while it still runs: no handoff, no second toast.
    await turnEnd($, 'iş')
    await clock.advance(5000)
    expect(world.ran).toEqual([])
    expect(world.toasts.filter(t => t.includes('subagent bitince'))).toHaveLength(1)

    // Done (an idle teammate does not count either): the watcher starts it once.
    world.agents = [
      { id: 'a1', description: 'tara', type: 'Explore', status: 'completed' },
      { id: 't1', description: 'ekip', type: 'teammate', status: 'idle' },
    ]
    await clock.advance(5000)
    expect(world.ran).toEqual([SKILL])
    expect((await devir($, '')).text).toContain('aşama: handoff_running')
    await clock.advance(20000)
    expect(world.ran).toEqual([SKILL])
  })

  test('(l) /devir simdi subagent beklerken söyler, bitince başlar', async ($, on) => {
    const { world, clock } = setup(on)
    world.agents = [{ id: 'a1', description: 'tara', type: 'Explore', status: 'pending' }]
    await start($)
    expect((await devir($, 'simdi')).text).toBe('1 subagent bitince devir başlayacak.')
    await clock.advance(100)
    expect(world.ran).toEqual([])
    world.agents = []
    await clock.advance(5000)
    expect(world.ran).toEqual([SKILL])
  })

  test('(m) ajan listesi okunamazsa devir yine başlar', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'sor' }, { isAgentListBroken: true })
    await start($)
    await turnEnd($, 'iş')
    await clock.advance(100)
    expect(world.ran).toEqual([SKILL])
  })

  test('(j) gizli notta Türkçe hal eki eşiğe uyar', () => {
    const cases = [[60, "%60'a"], [70, "%70'e"], [50, "%50'ye"], [75, "%75'e"], [40, "%40'a"], [86, "%86'ya"]] as const
    for (const [esik, ek] of cases) {
      expect(noteText(esik).startsWith(`Bağlam ${ek} ulaştı.`)).toBe(true)
    }
    expect(noteText(60)).toContain("çalışan subagent'ların bitmesini bekle")
    expect(noteText(60)).toContain('/my-skill-handoff')
  })
})
