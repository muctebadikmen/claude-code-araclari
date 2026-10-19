import { expect, mock, test } from 'claude-code/testing'

// Cross-mod check of the shared AbovePrompt band: the REAL otomatik-devir (the
// plugin under test) in one chain with the two other mods of the pack.
//
// The test kit loads only the plugin under test from its folder; others load
// inline, and an inline `register` is compiled on its own (it may close over
// nothing, and a module outside this folder cannot be imported). So the other
// two are stand-ins that copy their real render hooks' shape and contract:
// ilerleme-cubugu a `toggle` Button (no hotkey, no autoFocus) above what is
// beneath; blast-radius (Silme Kalkanı) in its narrow-terminal fallback, which
// draws its Proceed/Cancel box (hotkeys 1/2, autoFocus on Cancel) only while it
// holds a Bash call, i.e. mid-turn (`isWorking`), and then does NOT call
// next(e): whatever stands beneath it is not drawn.

const SKILL = 'my-skill-handoff'
const ANSWER = 'Devam notu yazıldı.\n\n```\nDevam et: adım 3\n```\n'
const BAND = {
  hasSurvey: false,
  isWorking: false,
  maxRows: 20,
  bodyColumns: 120,
  scroll: { offset: 0, bodyRows: 20 },
  view: {},
}

const ilerlemeStandIn = {
  name: 'ilerleme-cubugu',
  register(on: any) {
    on('ui.render', { component: 'AbovePrompt' }, async ($: any, e: any, next: any) => {
      const mine = e.props.hasSurvey ? undefined : true
      const below = await next(e)
      if (mine === undefined) return below
      const { Box, Button } = $.ui.resolve(e)
      return (
        <Box flexDirection="column">
          <Button key="toggle" label="▓░ 1/2 · %50 · Şu an: Adım 2" plain onPress={() => undefined} />
          {below ?? null}
        </Box>
      )
    })
  },
}

const blastStandIn = {
  name: 'blast-radius',
  register(on: any) {
    on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any, next: any) => {
      if (!e.props.isWorking) return next(e)
      const { Box, Button } = $.ui.resolve(e)
      return (
        <Box flexDirection="column" borderStyle="round">
          <Button key="proceed" label="Proceed" hotkey="1" plain onPress={() => undefined} />
          <Button key="cancel" label="Cancel" hotkey="2" plain autoFocus onPress={() => undefined} />
        </Box>
      )
    })
  },
}

/** Every element of a drawn tree, depth first, in drawing order. */
const walk = (node: any, out: any[] = []): any[] => {
  if (node === null || typeof node !== 'object') return out
  out.push(node)
  for (const child of node.children ?? []) walk(child, out)
  return out
}

const setup = (on: any) => {
  const world = { sid: 's1', percent: 50, sent: [] as string[], ran: [] as string[], tools: [] as string[] }
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, { esik: 40, mod: 'sor' })
  mock.env(on, { HOME: '/home/test' })
  // Stands in for core beneath every plugin.
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => $.ui.resolve(e).Box({ key: 'below' }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: world.sid }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.usage', () => ({
    value: { startedAt: 0, context: { window: 100, percent: world.percent }, rateLimits: [] },
  }))
  on('session.messages', () => ({ value: [] }))
  on('turn.complete', ($: any, e: any) => ({ text: e.answer }))
  on('command.register', ($: any, e: any) => ({ value: { command: e.name } }))
  on('command.list', () => ({ value: [{ name: SKILL }] }))
  on('command.run', ($: any, e: any) => {
    world.ran.push(e.command)
    return {}
  })
  on('agent.list', () => ({ value: [] }))
  on('tool.list', () => ({
    value: [
      'mcp__ccd_session__start_session',
      'mcp__ccd_session_mgmt__get_session',
      'mcp__ccd_session_mgmt__detach_session',
    ].map(name => ({ name, description: '', mcp: true })),
  }))
  on('tool.call', ($: any, e: any) => {
    world.tools.push(e.tool)
    if (e.tool === 'mcp__ccd_session__start_session') {
      return { result: [], text: 'Started session "Devam" (session_id: local_ab12-cd34, name: devam)' }
    }
    return { result: [], text: '{}' }
  })
  on('fs.exists', () => ({ value: false }))
  on('prompt.submit', ($: any, e: any) => {
    world.sent.push(e.text)
    return { text: e.text }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
  on('ui.copy', () => ({ value: { isCopied: true } }))
  on('ui.toast', () => ({ value: undefined }))

  return { world, clock }
}

const devir = ($: any, args: string) =>
  $.command.run({
    command: 'devir',
    args,
    origin: { kind: 'composer' },
    presentation: { isFullscreen: false, columns: 100 },
  })

/** /devir simdi, then the handoff turn: ends at awaiting_choice (mode sor). */
const toAwaitingChoice = async ($: any, clock: any) => {
  await devir($, 'simdi')
  await clock.advance(100)
  await $.turn.complete({ answer: ANSWER, durationMs: 1, isAborted: false, turnId: 't1', reason: 'answer' })
}

const OPTIONS = { plugins: [ilerlemeStandIn, blastStandIn] }

for (const surface of ['terminal', 'desktop'] as const) {
  test(`bant: üç mod birlikte yığılır, hiçbiri alttakini yutmaz (${surface})`, OPTIONS, async ($, on) => {
    const { world, clock } = setup(on)
    await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
    const mount = () => $.ui.mount({ plugin: 'otomatik-devir', surface, component: 'AbovePrompt', props: BAND })

    // Idle: otomatik-devir passes; the two others and the drawing beneath remain.
    const idle = await mount()
    const idleAll = walk(await idle.drawn())
    expect(idleAll.filter(n => n.type === 'Button').map(n => n.props.key)).toEqual(['toggle'])
    expect(idleAll.filter(n => n.props?.key === 'below')).toHaveLength(1)
    expect(idleAll.filter(n => n.props?.autoFocus === true)).toHaveLength(0)
    await idle.unmount()

    // The handover question: all three rows, the drawing beneath exactly once, last.
    await toAwaitingChoice($, clock)
    const ui = await mount()
    const all = walk(await ui.drawn())
    const buttons = all.filter(n => n.type === 'Button')
    expect(buttons.map(n => [n.press.plugin, n.props.key])).toContainEqual(['otomatik-devir', 'gec'])
    expect(buttons.map(n => [n.press.plugin, n.props.key])).toContainEqual(['otomatik-devir', 'bekle'])
    expect(buttons.map(n => [n.press.plugin, n.props.key])).toContainEqual(['ilerleme-cubugu', 'toggle'])
    expect(buttons).toHaveLength(3)
    const belowAt = all.findIndex(n => n.props?.key === 'below')
    expect(all.filter(n => n.props?.key === 'below')).toHaveLength(1)
    expect(belowAt).toBe(all.length - 1)

    // Focus: one autoFocus in the whole band, on otomatik-devir's [Geç].
    const focused = all.filter(n => n.props?.autoFocus === true)
    expect(focused.map(n => [n.press.plugin, n.props.key])).toEqual([['otomatik-devir', 'gec']])

    // Hotkeys: no two Buttons share one; letters are otomatik-devir's.
    const hotkeys = buttons.filter(n => n.props.hotkey !== undefined).map(n => n.props.hotkey)
    expect(new Set(hotkeys).size).toBe(hotkeys.length)
    for (const n of buttons) {
      if (n.press.plugin === 'otomatik-devir') expect(n.props.hotkey).toMatch(/^[a-z]$/)
      if (n.press.plugin === 'ilerleme-cubugu') expect(n.props.hotkey).toBeUndefined()
    }

    // Mid-turn a blast-radius hold takes the band: the question steps aside,
    // so exactly one autoFocus (blast-radius' Cancel) and no 'gec', in any order.
    await ui.redraw({ ...BAND, isWorking: true })
    const busy = walk(await ui.drawn())
    expect(busy.filter(n => n.props?.key === 'gec')).toHaveLength(0)
    expect(busy.filter(n => n.props?.autoFocus === true).map(n => [n.press.plugin, n.props.key])).toEqual([
      ['blast-radius', 'cancel'],
    ])
    await ui.redraw(BAND)

    // Presses reach the plugin that drew the Button, nested or not. The
    // handoff went out as the one message; nothing more is sent on the press.
    expect(world.ran).toEqual([])
    expect(world.sent).toHaveLength(1)
    await ui.press({ key: 'gec' })
    await clock.advance(100)
    expect(world.ran).toEqual([])
    expect(world.tools).toContain('mcp__ccd_session__start_session')
    expect(world.sent).toHaveLength(1)

    // After the switch the question is gone; the others and the drawing beneath stay.
    const after = walk(await ui.drawn())
    expect(after.filter(n => n.type === 'Button').map(n => n.props.key)).not.toContain('gec')
    expect(after.filter(n => n.props?.key === 'below')).toHaveLength(1)
    await ui.unmount()
  })
}

test('bant: anket varken üçü de yalnızca alttaki çizimi döndürür', OPTIONS, async ($, on) => {
  const { clock } = setup(on)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  await toAwaitingChoice($, clock)
  const ui = await $.ui.mount({
    plugin: 'otomatik-devir',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { ...BAND, hasSurvey: true },
  })
  expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { key: 'below' } })
  await ui.unmount()
})
