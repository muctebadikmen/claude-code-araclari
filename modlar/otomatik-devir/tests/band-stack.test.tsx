import { expect, mock, test } from 'claude-code/testing'

import { READY_BAND } from '../hooks/register'

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

/** The text a drawn node holds, joined from its string children. */
const textOf = (node: any): string | undefined => {
  const parts = [node?.props?.children, ...(node?.children ?? [])].filter(part => typeof part === 'string')

  return parts.length === 0 ? undefined : parts.join('')
}

const setup = (on: any) => {
  const world = {
    sid: 's1',
    percent: 50,
    sent: [] as string[],
    ran: [] as string[],
    tools: [] as string[],
    files: {} as Record<string, { text: string; mtimeMs: number }>,
  }
  const clock = mock.clock(on, { now: 1_000_000 })
  mock.store(on, { esik: 1 })
  mock.env(on, { HOME: '/home/test' })
  // Stands in for core beneath every plugin.
  on('ui.render', { component: 'AbovePrompt' }, ($: any, e: any) => $.ui.resolve(e).Box({ key: 'below' }))
  on('session.start', ($: any, e: any) => ({ cwd: e.cwd }))
  on('session.id', () => ({ value: world.sid }))
  on('session.root', () => ({ value: '/proj' }))
  on('session.cwd', () => ({ value: '/proj' }))
  // Stands in for core beneath the Stop hooks: no block, the turn may end.
  on('classic.Stop', () => ({}))
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
    world.sent.push(e.text)
    return { text: e.text }
  })
  on('ui.status', () => ({ value: undefined }))
  on('ui.log', () => ({ value: undefined }))
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

/**
 * Trips a handoff in a machine turn (esik 1, a model tool call), writes the
 * handoff file as the model would, then lets the main turn end: the Stop hook
 * sees the closed gate and a fresh file and moves the phase to `ready`.
 */
const toReady = async ($: any, world: any, clock: any) => {
  await $.tool.call({ tool: 'Bash', command: 'ls' })
  await clock.advance(100)
  world.files['/proj/.workflow/handoff/s1.md'] = { text: 'Devam notu\n\nAdım 3', mtimeMs: clock.now() }
  await clock.advance(100)
  await $.classic.Stop({ stop_hook_active: false, background_tasks: [] })
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

    // Ready: the one READY_BAND row first, the two others and the drawing beneath intact.
    await toReady($, world, clock)
    const ui = await mount()
    const all = walk(await ui.drawn())
    const rows = all.filter(n => textOf(n) === READY_BAND)
    expect(rows).toHaveLength(1)
    const rowAt = all.indexOf(rows[0])
    expect(all.slice(0, rowAt).filter(n => n.type === 'Button')).toHaveLength(0)
    expect(all.slice(0, rowAt).filter(n => n.props?.key === 'below')).toHaveLength(0)
    const buttons = all.filter(n => n.type === 'Button')
    expect(buttons.map(n => [n.press.plugin, n.props.key])).toEqual([['ilerleme-cubugu', 'toggle']])
    const belowAt = all.findIndex(n => n.props?.key === 'below')
    expect(all.filter(n => n.props?.key === 'below')).toHaveLength(1)
    expect(belowAt).toBe(all.length - 1)

    // No button of its own: no autoFocus and no hotkey anywhere in the band.
    expect(all.filter(n => n.props?.autoFocus === true)).toHaveLength(0)
    expect(buttons.filter(n => n.props.hotkey !== undefined)).toHaveLength(0)

    // Mid-turn a blast-radius hold takes the band: the row steps aside, so
    // exactly one autoFocus (blast-radius' Cancel) and no READY_BAND row.
    await ui.redraw({ ...BAND, isWorking: true })
    const busy = walk(await ui.drawn())
    expect(busy.filter(n => textOf(n) === READY_BAND)).toHaveLength(0)
    expect(busy.filter(n => n.props?.autoFocus === true).map(n => [n.press.plugin, n.props.key])).toEqual([
      ['blast-radius', 'cancel'],
    ])
    await ui.redraw(BAND)

    // Back at rest the row is drawn again, with the others and the drawing beneath.
    const again = walk(await ui.drawn())
    expect(again.filter(n => textOf(n) === READY_BAND)).toHaveLength(1)
    expect(again.filter(n => n.type === 'Button').map(n => n.props.key)).toEqual(['toggle'])
    expect(again.filter(n => n.props?.key === 'below')).toHaveLength(1)
    await ui.unmount()
  })
}

test('bant: anket varken üçü de yalnızca alttaki çizimi döndürür', OPTIONS, async ($, on) => {
  const { world, clock } = setup(on)
  await $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
  await toReady($, world, clock)
  const ui = await $.ui.mount({
    plugin: 'otomatik-devir',
    surface: 'terminal',
    component: 'AbovePrompt',
    props: { ...BAND, hasSurvey: true },
  })
  const drawn = walk(await ui.drawn())
  expect(drawn.filter(n => textOf(n) === READY_BAND)).toHaveLength(0)
  expect(await ui.drawn()).toMatchObject({ type: 'Box', props: { key: 'below' } })
  await ui.unmount()
})
