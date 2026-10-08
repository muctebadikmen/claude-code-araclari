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

/** The world beneath the mod: a session whose id and context fill the test controls. */
const setup = (
  on: any,
  store: Record<string, unknown> = { esik: 40, mod: 'sor' },
  opts: { commands?: string[]; isClearWorking?: boolean } = {},
) => {
  const { commands = [SKILL], isClearWorking = true } = opts
  const world = {
    sid: 's1',
    percent: 50 as number | undefined,
    sent: [] as string[],
    ran: [] as string[],
    toasts: [] as string[],
    copied: [] as string[],
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
    if (e.command === 'clear' && isClearWorking) world.sid = `${world.sid}-yeni`
    return {}
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
      expect((await ui.find({ text: /Yeni sohbete geçeyim mi\?/ }))?.text).toContain('geçeyim')

      // A survey holds the band: pass straight through.
      await ui.redraw({ ...BAND, hasSurvey: true })
      expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { key: 'below' } })
      await ui.redraw(BAND)

      // [Bekle] hides the row; the band is the below-drawing alone again.
      await ui.press({ key: 'bekle' })
      await ui.redraw(BAND)
      expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { key: 'below' } })
      await ui.unmount()

      // The prompt is kept: /devir gec switches to a fresh chat.
      expect((await devir($, 'gec')).text).toBe('Yeni sohbete geçiliyor.')
      await clock.advance(100)
      expect(world.ran).toEqual([SKILL, 'clear'])
      expect(world.sent).toEqual(['Devam et: adım 3'])
      expect((await devir($, '')).text).toContain('aşama: idle')
    })
  }

  test('(b2) Geç düğmesi yeni sohbete geçer', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await toAwaitingChoice($, clock)
    const ui = await mountBand($)
    await ui.press({ key: 'gec' })
    await clock.advance(100)
    expect(world.ran).toEqual([SKILL, 'clear'])
    expect(world.sent).toEqual(['Devam et: adım 3'])
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

  test('(f) /clear çalışmazsa: panoya kopyala + "Yeni sohbete yapıştır"', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'sor' }, { isClearWorking: false })
    await start($)
    await toAwaitingChoice($, clock)
    expect((await devir($, 'gec')).text).toBe('Yeni sohbete geçiliyor.')
    await clock.advance(100)
    expect(world.ran).toEqual([SKILL, 'clear'])
    expect(world.sent).toEqual([])
    expect(world.copied).toEqual(['Devam et: adım 3'])
    expect(world.toasts.some(t => t.includes('yeni sohbete yapıştır'))).toBe(true)
    // Still claimable, but the band stays hidden: no repeated question.
    expect((await devir($, '')).text).toContain('aşama: awaiting_choice')
    const ui = await mountBand($)
    expect(await ui.findAll({ type: 'Button' })).toHaveLength(0)
    await ui.unmount()
  })

  test('(g) otomatik modda sormadan geçer, tek sefer', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, mod: 'otomatik' })
    await start($)
    await turnEnd($, 'iş')
    await clock.advance(100)
    await turnEnd($, ANSWER)
    await clock.advance(100)
    expect(world.ran).toEqual([SKILL, 'clear'])
    expect(world.sent).toEqual(['Devam et: adım 3'])
    // The continuation turn in the fresh chat is exempt, even over the threshold.
    await turnEnd($, 'devam')
    await clock.advance(100)
    expect(world.ran).toEqual([SKILL, 'clear'])
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

  test('(j) gizli notta Türkçe hal eki eşiğe uyar', () => {
    const cases = [[60, "%60'a"], [70, "%70'e"], [50, "%50'ye"], [75, "%75'e"], [40, "%40'a"], [86, "%86'ya"]] as const
    for (const [esik, ek] of cases) {
      expect(noteText(esik).startsWith(`Bağlam ${ek} ulaştı.`)).toBe(true)
    }
  })
})
