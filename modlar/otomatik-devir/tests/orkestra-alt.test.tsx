import { describe, expect, mock, test } from 'claude-code/testing'

import {
  AC_CHAIN_STOPPED,
  chainEsikText,
  DRAIN_DENY,
  fileMissingText,
  handoffFile,
  inTurnHandoff,
  KAPAT_CHAIN,
  LONG_CHAT_SECTION_ID,
  longChatNote,
  managedChildNote,
  managedHandoff,
  MANAGED_START_DENY,
  nextMessageNote,
  ORKESTRA_END_DENY,
  ORKESTRA_SECTION_ID,
  orkestraEndText,
  orkestraRecordFile,
  orkestraWaitText,
  READY_BAND,
  RECORD_BACKEND,
  START_NOW,
  timeoutText,
  waitText,
  ZINCIR_AYAR_PREFIX,
  zincirAyarFile,
} from '../hooks/register.tsx'

// v1.1 managed sub-chat Spec items (O10-O15, O18, O21 child side, Decisions 21
// and 22), and one full two-session chain (B9). store-probe.md: BACKEND file,
// TRIGGER command.

const PLUGIN = 'otomatik-devir'
const SKILL = 'my-skill-handoff'
const HOME = '/home/test'
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
const NOW = 1_000_000
const TASK = 'üç adım yap'
const C1 = 'local_child-0001'
const C2 = 'local_child-0002'
const FILE_C1 = handoffFile('/proj', 'c1')
const FILE_C2 = handoffFile('/proj', 'c2')
const HANDOFF_VAR = "Kalan: var\n\n# HANDOFF\n\nkalanlar: adım 2-3\n\n## Devam prompt'u\nDevam et: adım 2"
const HANDOFF_YOK = "Kalan: yok\n\n# HANDOFF\n\nhepsi bitti\n\n## Devam prompt'u\nYok"
const ROLE_ALT_DROP = 'Bu bir alt sohbet; otonom zincir ana sohbette çalışır.'
const CHILD_DUR = 'Bu bir alt sohbet; zinciri ana sohbette /devir otonom dur ile durdur.'

type Task = { id: string; type: string; status: string; description: string }
type Session = { sessionId: string; parentSessionId?: string; title?: string }

/**
 * The world beneath the mod (v1.test.tsx's setup), extended for two or more
 * sessions: `get_session` answers per sid, start_session registers the new
 * child, and `$.fs.write` lands in `world.files` (BACKEND file).
 */
const setup = (on: any, store: Record<string, unknown> = { esik: 40 }) => {
  const world = {
    sid: 'main',
    sessions: { main: { sessionId: 'local_main', title: 'Ana' } } as Record<string, Session>,
    running: {} as Record<string, boolean>,
    percent: 10 as number | undefined,
    store: {} as Record<string, unknown>,
    typed: [] as { text: string; context: readonly string[] }[],
    toasts: [] as string[],
    statuses: [] as (string | undefined)[],
    calls: [] as any[],
    agents: [] as { id: string; description: string; type: string; status: string }[],
    files: {} as Record<string, { text: string; mtimeMs: number }>,
    k: 0,
    // The mod's per-conversation record ($.state `conv`) as last written.
    conv: null as any,
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
  on('state.set', ($: any, e: any, next: any) => {
    if (e.plugin === PLUGIN && e.key === 'conv') world.conv = clone(e.value)
    return next(e)
  })
  // The engine's own sections beneath the mod.
  on('prompt.compose', () => ({ sections: [{ id: 'env', text: 'ortam', scope: 'session' }] }))
  mock.env(on, { HOME })
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
  on('command.list', () => ({ value: [{ name: SKILL, description: '', source: 'plugin' }] }))
  on('command.run', () => ({}))
  on('agent.list', () => ({ value: world.agents }))
  on('tool.list', () => ({ value: [START, GET, DETACH, HAND_OFF].map(name => ({ name, description: '', mcp: true })) }))
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', ($: any, e: any) => {
    world.calls.push(e)
    if (e.tool === GET) {
      if (e.session_id === 'self') {
        return { result: [], text: JSON.stringify(world.sessions[world.sid] ?? { sessionId: 'local_self', title: 'Eski iş' }) }
      }
      return { result: [], text: JSON.stringify({ sessionId: e.session_id, isRunning: world.running[e.session_id] ?? true }) }
    }
    if (e.tool === START) {
      world.k += 1
      const id = `local_child-000${world.k}`
      world.sessions[`c${world.k}`] = { sessionId: id, parentSessionId: world.sessions[world.sid]?.sessionId }
      return { result: [], text: `Started session "${e.title}" (session_id: ${id}, name: alt-${world.k})` }
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
  on('fs.write', ($: any, e: any) => {
    world.files[e.path] = { text: e.text, mtimeMs: clock.now() }
    return { value: undefined }
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
  on('ui.log', () => ({ value: undefined }))
  on('ui.toast', ($: any, e: any) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })

  return { world, clock }
}

type World = ReturnType<typeof setup>['world']

// Records and chain settings, per RECORD_BACKEND (store-probe.md: file).
const recFile = (id: string) => orkestraRecordFile(HOME, id)
const rec = (world: World, id: string): any => {
  if (RECORD_BACKEND === 'store') return world.store[`orkestra:${id}`]
  const file = world.files[recFile(id)]
  return file === undefined ? undefined : JSON.parse(file.text)
}
const ayar = (world: World, id: string): any => {
  if (RECORD_BACKEND === 'store') return world.store[`${ZINCIR_AYAR_PREFIX}${id}`]
  const file = world.files[zincirAyarFile(HOME, id)]
  return file === undefined ? undefined : JSON.parse(file.text)
}
const seedRec = (world: World, clock: any, id: string, value: unknown) => {
  if (RECORD_BACKEND === 'store') world.store[`orkestra:${id}`] = value
  else world.files[recFile(id)] = { text: JSON.stringify(value), mtimeMs: clock.now() }
}
const seedAyar = (world: World, clock: any, id: string, value: unknown) => {
  if (RECORD_BACKEND === 'store') world.store[`${ZINCIR_AYAR_PREFIX}${id}`] = value
  else world.files[zincirAyarFile(HOME, id)] = { text: JSON.stringify(value), mtimeMs: clock.now() }
}
const writeHandoff = (world: World, clock: any, file: string, text: string) => {
  world.files[file] = { text, mtimeMs: clock.now() }
}

const start = ($: any) => $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
/** Switches to the session `sid`: a fresh engine load (module vars reset, O18). */
const as = async ($: any, world: World, sid: string) => {
  world.sid = sid
  await start($)
}
const devir = async ($: any, args: string) =>
  (
    await $.command.run({
      command: 'devir',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 100 },
    })
  ).text as string
const phase = async ($: any) => devir($, '')

let turnSeq = 0
const typed = ($: any, text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false })
const machine = ($: any, text: string) => $.prompt.submit({ text, origin: { kind: 'task-notification' }, wait: false })
/** TRIGGER command: the person types `/devir-otonom <görev>`. */
const go = ($: any, task: string) =>
  $.prompt.submit({
    text: `/devir-otonom ${task}`,
    command: { name: 'devir-otonom', args: task },
    origin: { kind: 'composer' },
    wait: false,
  })
const turnBegin = ($: any) => $.turn.start({ text: '', turnId: `tt${++turnSeq}` })
const turnEnd = ($: any, isAborted = false, answer = 'ok') =>
  $.turn.complete({
    answer,
    durationMs: 1,
    isAborted,
    turnId: `tt${turnSeq}`,
    reason: isAborted ? 'aborted' : 'answer',
  })
const bash = ($: any) => $.tool.call({ tool: 'Bash', command: 'ls' })
const agentCall = ($: any) => $.tool.call({ tool: 'Agent', prompt: 'x', description: 'araştır' })
const stop = ($: any, tasks: Task[] | undefined = []) =>
  $.classic.Stop({ stop_hook_active: false, background_tasks: tasks })
const callsOf = (world: World, tool: string) => world.calls.filter((c: any) => c.tool === tool)
const selfGets = (world: World) => callsOf(world, GET).filter((c: any) => c.session_id === 'self')
const startSession = ($: any, extra: Record<string, unknown> = {}) =>
  $.tool.call({
    tool: START,
    initiation: 'user_asked',
    context: 'fresh',
    title: 'model başlığı',
    background: 'kısa',
    prompt: 'Adım listesini uygula',
    ...extra,
  })
const handOff = ($: any, extra: Record<string, unknown> = {}) =>
  $.tool.call({ tool: HAND_OFF, prompt: 'çatal', ...extra })
const sections = async ($: any) =>
  (
    await $.prompt.compose({
      model: 'claude-test',
      promptModel: 'claude-test',
      surfaces: ['terminal'],
      tools: [],
      outputStyle: null,
      traits: [],
    })
  ).sections as { id: string; text: string; scope: string }[]
const mountBand = ($: any) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND } as any)

const SUBAGENT: Task = { id: 'a1', type: 'subagent', status: 'running', description: 'araştır' }
const WORKFLOW: Task = { id: 'w1', type: 'workflow', status: 'pending', description: 'denetim' }

/** As main: start the chain, its typed turn, child 1; then switch to c1. */
const chainToChild = async ($: any, world: World) => {
  await as($, world, 'main')
  await go($, TASK)
  await turnBegin($)
  const started = await startSession($)
  expect(started.deny).toBeUndefined()
  await as($, world, 'c1')
}

/** In the current child: a typed turn that crosses the threshold mid-turn (the Bash result carries the handoff). */
const childTrip = async ($: any, world: World, clock: any, percent = 70) => {
  world.percent = 10
  await typed($, 'iş')
  await turnBegin($)
  world.percent = percent
  const got = await bash($)
  await clock.advance(100)
  return got
}

/** c1 tripped, its file written (`Kalan: var` unless given), the Stop: phase `ready`. */
const childReady = async ($: any, world: World, clock: any, file = FILE_C1, text = HANDOFF_VAR) => {
  await childTrip($, world, clock)
  writeHandoff(world, clock, file, text)
  expect((await stop($, [])).block).toBeUndefined()
  expect(await phase($)).toContain('aşama: ready')
}

describe('orkestra alt', () => {
  test('(B1) alt sohbet rolü parentSessionId + ana kayıttan çözülür, kendi kaydını yazar; ana bitmiş/yoksa pasif', async ($, on) => {
    const { world, clock } = setup(on)
    await chainToChild($, world)
    await typed($, 'iş')
    expect(rec(world, C1)).toMatchObject({ role: 'alt', parent: 'local_main', n: 1, sid: 'c1', localId: C1, status: 'working' })
    expect(await devir($, 'otonom')).toBe(`Orkestra: alt sohbet 1/100 (ana: local_main) · durum working`)
    // Race: the main record still says `starting: true` with no childId.
    seedRec(world, clock, 'local_m3', {
      role: 'ana', sid: 'm3', localId: 'local_m3', task: 'iş', title: 'iş', n: 0,
      starting: true, startingAt: NOW, isHeld: true, startedAt: 0, at: 0,
    })
    world.sessions.r1 = { sessionId: 'local_r1', parentSessionId: 'local_m3' }
    await as($, world, 'r1')
    await typed($, 'iş')
    expect(rec(world, 'local_r1')).toMatchObject({ role: 'alt', parent: 'local_m3', n: 1, status: 'working' })
    // An ended parent, and an absent one: the chat stays normal and passive.
    seedRec(world, clock, 'local_m4', {
      role: 'ana', sid: 'm4', localId: 'local_m4', task: 'iş', title: 'iş', n: 1,
      childId: 'local_p1', ended: 'bitti', isHeld: true, startedAt: 0, at: 0,
    })
    world.sessions.p1 = { sessionId: 'local_p1', parentSessionId: 'local_m4' }
    world.sessions.p2 = { sessionId: 'local_p2', parentSessionId: 'local_yok' }
    for (const sid of ['p1', 'p2']) {
      await as($, world, sid)
      await typed($, 'iş')
      await turnBegin($)
      world.percent = 95
      const got = await bash($)
      expect(got.context ?? []).toEqual([])
      expect((await stop($, [SUBAGENT])).block).toBeUndefined()
      await turnEnd($)
      world.percent = 10
      expect(rec(world, `local_${sid}`)).toBeUndefined()
      expect(Object.keys(world.store).filter(k => k.startsWith('devir:'))).toEqual([])
      expect(await devir($, 'otonom')).toContain('Bu sohbet orkestra modunda değil')
    }
  })

  test('(B1b) ana kayıt dosyası yarım JSON iken rol alt olmaz ve önbelleğe girmez; geçerli kayıtla alt olur (O10, O16)', async ($, on) => {
    const { world, clock } = setup(on)
    world.sessions.t1 = { sessionId: 'local_t1', parentSessionId: 'local_m5' }
    world.files[recFile('local_m5')] = { text: '{"role":"an', mtimeMs: NOW }
    await as($, world, 't1')
    expect(await devir($, 'otonom')).toContain('Bu sohbet orkestra modunda değil')
    expect(rec(world, 'local_t1')).toBeUndefined()
    expect(world.conv?.role).toBeUndefined()
    seedRec(world, clock, 'local_m5', {
      role: 'ana', sid: 'm5', localId: 'local_m5', task: 'iş', title: 'iş', n: 1,
      childId: 'local_t1', isHeld: true, startedAt: 0, at: 0,
    })
    expect(await devir($, 'otonom')).toBe('Orkestra: alt sohbet 1/100 (ana: local_m5) · durum working')
    expect(rec(world, 'local_t1')).toMatchObject({ role: 'alt', parent: 'local_m5', n: 1, status: 'working' })
    expect(world.conv?.role).toBe('alt')
  })

  test('(B2) ana sohbetin başlatmadan önceki dene 3 değeri alt sohbete geçer (zincir esik 20 üstünde): %5 devreder', async ($, on) => {
    const { world, clock } = setup(on)
    await as($, world, 'main')
    await devir($, 'dene 3')
    await go($, TASK)
    expect(rec(world, 'local_main')).toMatchObject({ role: 'ana', testThreshold: 3 })
    await turnBegin($)
    expect((await startSession($)).deny).toBeUndefined()
    expect(await devir($, 'esik 20')).toBe(chainEsikText(20))
    expect(ayar(world, 'local_main')).toMatchObject({ esik: 20 })
    await as($, world, 'c1')
    const got = await childTrip($, world, clock, 5)
    expect(got.context).toEqual([managedHandoff(3, FILE_C1, true)])
    expect(world.conv?.testThreshold).toBe(3)
  })

  test("(B2b) alt sohbetin kendi /devir dene 50'si miras kalan 3'ü yener", async ($, on) => {
    const { world, clock } = setup(on)
    await as($, world, 'main')
    await devir($, 'dene 3')
    await go($, TASK)
    await turnBegin($)
    await startSession($)
    await as($, world, 'c1')
    await typed($, 'iş')
    expect(world.conv?.testThreshold).toBe(3)
    expect(await devir($, 'dene 50')).toContain('%50')
    await turnBegin($)
    world.percent = 40
    expect((await bash($)).context ?? []).toEqual([])
    world.percent = 55
    expect((await bash($)).context).toEqual([managedHandoff(50, FILE_C1, true)])
    await clock.advance(100)
  })

  test('(B3) yazılan ilk turda eşik: managedHandoff; dosya yoksa fileMissingText(false); taze dosyayla ready, START_NOW/READY_BAND yok', async ($, on) => {
    const { world, clock } = setup(on)
    await chainToChild($, world)
    const got = await childTrip($, world, clock, 70)
    expect(got.context).toEqual([managedHandoff(60, FILE_C1, true)])
    expect(got.context).not.toContain(inTurnHandoff(60, FILE_C1, true))
    expect((await stop($, [])).block).toBe(fileMissingText(FILE_C1, false))
    writeHandoff(world, clock, FILE_C1, HANDOFF_VAR)
    const done = await stop($, [])
    expect(done.block).toBeUndefined()
    expect(done.block).not.toBe(START_NOW)
    expect(await phase($)).toContain('aşama: ready')
    await turnEnd($)
    expect(await phase($)).toContain('aşama: ready')
    expect(world.toasts).not.toContain(READY_BAND)
    const ui = await mountBand($)
    expect(JSON.stringify(await ui.drawn())).not.toContain(READY_BAND)
    await ui.unmount()
    expect(rec(world, C1)).toMatchObject({ role: 'alt', status: 'ready', file: FILE_C1 })
    expect(world.statuses.at(-1)).toContain('Orkestra alt sohbet 1 · ')
  })

  test('(B4) alt sohbette start_session ve hand_off reddedilir (boşta, hazırken, alt ajandan); /devir-otonom bırakılır', async ($, on) => {
    const { world, clock } = setup(on)
    await chainToChild($, world)
    expect(callsOf(world, START)).toHaveLength(1)
    expect(callsOf(world, START)[0].prompt).toContain(managedChildNote(1, 100))
    await typed($, 'iş')
    await turnBegin($)
    expect((await startSession($)).deny).toBe(MANAGED_START_DENY)
    expect((await handOff($)).deny).toBe(MANAGED_START_DENY)
    expect((await startSession($, { agentId: 'a1' })).deny).toBe(MANAGED_START_DENY)
    expect((await handOff($, { agentId: 'a1' })).deny).toBe(MANAGED_START_DENY)
    await turnEnd($)
    const before = world.typed.length
    const dropped = await go($, 'x')
    expect(dropped.drop).toBe(ROLE_ALT_DROP)
    expect(world.typed).toHaveLength(before)
    expect(rec(world, C1)).toMatchObject({ role: 'alt', status: 'finished' })
    expect(await devir($, 'otonom dur')).toBe(CHILD_DUR)
    expect(callsOf(world, START)).toHaveLength(1)
  })

  test('(B4b) hazır alt sohbette de start_session/hand_off reddedilir', async ($, on) => {
    const { world, clock } = setup(on)
    await chainToChild($, world)
    await childReady($, world, clock)
    expect((await startSession($)).deny).toBe(MANAGED_START_DENY)
    expect((await handOff($)).deny).toBe(MANAGED_START_DENY)
    expect((await startSession($, { agentId: 'a1' })).deny).toBe(MANAGED_START_DENY)
    expect(callsOf(world, START)).toHaveLength(1)
    expect(Object.keys(world.store).filter(k => k.startsWith('devredildi:'))).toEqual([])
  })

  test('(B5) hazır alt sohbette yazılan mesaj nextMessageNote almaz, devir yeniden talep edilmez', async ($, on) => {
    const { world, clock } = setup(on)
    await chainToChild($, world)
    await childReady($, world, clock)
    await turnEnd($)
    await typed($, 'bir şey daha')
    const last = world.typed.at(-1)!
    expect(last.text).toBe('bir şey daha')
    expect(last.context).toEqual([])
    expect(last.context).not.toContain(nextMessageNote(FILE_C1, true, true))
    expect(await phase($)).toContain('aşama: ready')
    expect(rec(world, C1)).toMatchObject({ status: 'ready', file: FILE_C1 })
  })

  test('(B6) boşta biten tur: finished + report (3000 karakter); sonraki boş tur üzerine yazmaz', async ($, on) => {
    const { world } = setup(on)
    await chainToChild($, world)
    await typed($, 'iş')
    await turnBegin($)
    const answer = 'r'.repeat(3500) + 's'.repeat(500)
    await turnEnd($, false, answer)
    const got = rec(world, C1)
    expect(got).toMatchObject({ role: 'alt', status: 'finished' })
    expect(got.report).toBe(answer.slice(0, 3000))
    expect(got.report).toHaveLength(3000)
    expect(got.isAborted).toBeUndefined()
    await typed($, 'başka')
    await turnBegin($)
    await turnEnd($, true, 'başka cevap')
    expect(rec(world, C1)).toEqual(got)
  })

  test('(B6b) Esc ile biten boş tur: finished + isAborted', async ($, on) => {
    const { world } = setup(on)
    await chainToChild($, world)
    await typed($, 'iş')
    await turnBegin($)
    await turnEnd($, true, 'yarım')
    expect(rec(world, C1)).toMatchObject({ status: 'finished', report: 'yarım', isAborted: true })
  })

  test('(B7) ana n 2 olunca hazır alt sohbet 1 done olur; Agent artık reddedilmez', async ($, on) => {
    const { world, clock } = setup(on)
    await chainToChild($, world)
    await childReady($, world, clock)
    expect((await agentCall($)).deny).toBe(DRAIN_DENY)
    await turnEnd($)
    world.percent = 10
    await as($, world, 'main')
    expect(String((await stop($, [])).block)).toContain('alt sohbet 1 devir dosyasını yazdı')
    expect((await startSession($, { prompt: 'devam' })).deny).toBeUndefined()
    expect(rec(world, 'local_main')).toMatchObject({ n: 2, childId: C2 })
    await as($, world, 'c1')
    expect((await agentCall($)).deny).toBeUndefined()
    expect(await phase($)).toContain('aşama: done')
  })

  test('(B8) as main / as c1 geçişlerinde modül durumu taşınmaz (timeoutFor, orkestraStartBlocks)', async ($, on) => {
    const { world, clock } = setup(on)
    await as($, world, 'main')
    await go($, TASK)
    await turnBegin($)
    // Three start blocks per N, then the turn end passes; a fresh load starts the count again.
    for (let i = 0; i < 3; i += 1) expect((await stop($, [])).block).toContain('ANA sohbet')
    expect((await stop($, [])).block).toBeUndefined()
    await as($, world, 'main')
    await turnBegin($)
    expect((await stop($, [])).block).toContain('ANA sohbet')
    expect((await startSession($)).deny).toBeUndefined()
    await as($, world, 'c1')
    await childTrip($, world, clock)
    expect((await stop($, [SUBAGENT])).block).toBe(waitText([{ id: 'a1', description: 'araştır' }]))
    await clock.advance(31 * 60 * 1000)
    expect((await stop($, [SUBAGENT])).block).toBe(timeoutText([{ id: 'a1', description: 'araştır' }]))
    world.percent = 10
    await as($, world, 'main')
    await turnBegin($)
    expect((await stop($, [SUBAGENT])).block).toBe(orkestraWaitText(1))
  })

  test('(B9) tam zincir: c1 Kalan: var -> ana c2yi c1 dosyasıyla açar -> c2 Kalan: yok -> ana bitti özeti', async ($, on) => {
    const { world, clock } = setup(on)
    await chainToChild($, world)
    await childReady($, world, clock, FILE_C1, HANDOFF_VAR)
    await turnEnd($)
    world.percent = 10
    await as($, world, 'main')
    await turnBegin($)
    expect(String((await stop($, [])).block)).toContain(`${TASK} · 2`)
    expect((await startSession($, { prompt: 'devam' })).deny).toBeUndefined()
    const starts = callsOf(world, START)
    expect(starts.map((c: any) => c.title)).toEqual([`${TASK} · 1`, `${TASK} · 2`])
    expect(starts[1].prompt.startsWith(HANDOFF_VAR)).toBe(true)
    expect(starts[1].prompt).toContain(managedChildNote(2, 100))
    expect(world.sessions.c2).toEqual({ sessionId: C2, parentSessionId: 'local_main' })
    expect((await stop($, [])).block).toBe(orkestraWaitText(2))
    await as($, world, 'c2')
    await typed($, 'iş')
    expect(rec(world, C2)).toMatchObject({ role: 'alt', parent: 'local_main', n: 2, status: 'working' })
    await turnBegin($)
    world.percent = 70
    expect((await bash($)).context).toEqual([managedHandoff(60, FILE_C2, true)])
    await clock.advance(100)
    writeHandoff(world, clock, FILE_C2, HANDOFF_YOK)
    expect((await stop($, [])).block).toBeUndefined()
    expect(rec(world, C2)).toMatchObject({ status: 'ready', file: FILE_C2 })
    await turnEnd($)
    world.percent = 10
    await as($, world, 'main')
    await turnBegin($)
    const end = await stop($, [])
    expect(end.block).toBe(orkestraEndText('bitti', 2, undefined, FILE_C2, C2, 100))
    expect(rec(world, 'local_main')).toMatchObject({ n: 2, ended: 'bitti' })
    expect((await stop($, [])).block).toBeUndefined()
    expect((await startSession($)).deny).toBe(ORKESTRA_END_DENY)
    expect(callsOf(world, START)).toHaveLength(2)
  })

  test('(B10) ebeveynsiz sohbet: yükleme başına tek get_session self, yalnızca kimlik: anahtarı, pasif', async ($, on) => {
    const { world, clock } = setup(on)
    world.sid = 's1'
    await start($)
    await typed($, 'iş')
    await turnBegin($)
    world.percent = 90
    expect((await bash($)).context ?? []).toEqual([])
    expect((await stop($, [SUBAGENT])).block).toBeUndefined()
    await turnEnd($)
    await clock.advance(1000)
    expect(selfGets(world)).toHaveLength(1)
    expect(Object.keys(world.store).sort()).toEqual(['esik', 'kimlik:s1'])
    expect(world.store['kimlik:s1']).toBe('local_self')
    expect(world.statuses.length).toBeGreaterThan(0)
    expect(world.statuses.every(s => s === undefined)).toBe(true)
    expect(Object.keys(world.files)).toEqual([])
  })

  test('(B11) devir sürerken (dosya yok) zincir kapanınca: Agent geçer, idle, conv alanları kalır, kayıt cancelled; ana kapatildi biter', async ($, on) => {
    const { world, clock } = setup(on)
    await chainToChild($, world)
    await devir($, 'dene 65')
    await childTrip($, world, clock, 70)
    expect(await phase($)).toContain('aşama: handoff_running')
    seedAyar(world, clock, 'local_main', { isClosed: true, at: NOW })
    expect((await agentCall($)).deny).toBeUndefined()
    const held = world.conv
    expect(held).toMatchObject({ phase: 'idle', role: 'alt', localId: C1, parentId: 'local_main', childN: 1, testThreshold: 65 })
    expect(rec(world, C1)).toMatchObject({ status: 'cancelled' })
    expect(rec(world, C1).file).toBeUndefined()
    await turnEnd($)
    expect(rec(world, C1)).toMatchObject({ status: 'cancelled' })
    world.percent = 10
    await as($, world, 'main')
    await turnBegin($)
    expect((await stop($, [])).block).toBe(orkestraEndText('kapatildi', 1, undefined, undefined, C1))
    expect(rec(world, 'local_main')).toMatchObject({ ended: 'kapatildi' })
    expect(await devir($, 'ac')).toBe(AC_CHAIN_STOPPED)
    expect((await startSession($)).deny).toBe(ORKESTRA_END_DENY)
    expect(callsOf(world, START)).toHaveLength(1)
  })

  test('(B11b) hazırken zincir kapanınca: idle, kayıt cancelled ve dosyasız; ana relay etmez, kapatildi biter', async ($, on) => {
    const { world, clock } = setup(on)
    await chainToChild($, world)
    await childReady($, world, clock)
    await turnEnd($)
    seedAyar(world, clock, 'local_main', { isClosed: true, at: NOW })
    expect((await agentCall($)).deny).toBeUndefined()
    expect(world.conv).toMatchObject({ phase: 'idle', role: 'alt', localId: C1, parentId: 'local_main', childN: 1 })
    expect(rec(world, C1)).toMatchObject({ status: 'cancelled' })
    expect(rec(world, C1).file).toBeUndefined()
    world.percent = 10
    await as($, world, 'main')
    await turnBegin($)
    expect((await stop($, [])).block).toBe(orkestraEndText('kapatildi', 1, undefined, undefined, C1))
    expect(await devir($, 'ac')).toBe(AC_CHAIN_STOPPED)
    expect((await startSession($)).deny).toBe(ORKESTRA_END_DENY)
    expect(callsOf(world, START)).toHaveLength(1)
  })

  test('(B11c) alt sohbette /devir kapat: zincir kapanır, kayıt cancelled, v1.0.1 yanıtı + KAPAT_CHAIN; sonra simdi AC_CHAIN_STOPPED', async ($, on) => {
    const { world, clock } = setup(on)
    await chainToChild($, world)
    await childTrip($, world, clock, 70)
    const reply = await devir($, 'kapat')
    expect(reply).toBe(
      `Otomatik devir kapatıldı; bu sohbetin süren devri iptal edildi. Alt ajan ve Workflow yeniden başlatılabilir; yazılmış devir dosyası yerinde kalır. ${KAPAT_CHAIN}`,
    )
    expect(ayar(world, 'local_main')).toMatchObject({ isClosed: true })
    expect(rec(world, C1)).toMatchObject({ status: 'cancelled' })
    expect(rec(world, C1).file).toBeUndefined()
    expect(world.conv).toMatchObject({ phase: 'idle', role: 'alt', parentId: 'local_main' })
    expect(await devir($, 'simdi')).toBe(AC_CHAIN_STOPPED)
    expect(world.conv?.isForced).toBeUndefined()
    expect('acik' in world.store).toBe(false)
  })

  test('(B12) Workflow çalışırken turn.complete hazır yapmaz (D21a); long-chat bölümü alt sohbette, orkestra bölümü anada', async ($, on) => {
    const { world, clock } = setup(on)
    await chainToChild($, world)
    // Idle compose in c1 (role resolved first): the chain default 60, not the old global esik 40.
    await typed($, 'hazırlık')
    const idle = await sections($)
    expect(idle.at(-1)?.id).toBe(LONG_CHAT_SECTION_ID)
    expect(LONG_CHAT_SECTION_ID).toBe('otomatik-devir:long-chat')
    expect(idle.at(-1)?.text).toBe(longChatNote(60))
    expect(idle.at(-1)?.text).toContain("%60'a")
    expect(longChatNote(70)).toContain("%70'e")
    expect(idle.some(s => s.id === ORKESTRA_SECTION_ID)).toBe(false)
    await childTrip($, world, clock, 70)
    writeHandoff(world, clock, FILE_C1, HANDOFF_VAR)
    expect(world.agents).toEqual([])
    expect((await stop($, [WORKFLOW])).block).toBe(waitText([{ id: 'w1', description: 'denetim' }]))
    await turnEnd($)
    expect(await phase($)).toContain('aşama: handoff_running')
    expect(rec(world, C1)).toMatchObject({ status: 'working' })
    await machine($, 'workflow bitti')
    await turnBegin($)
    expect((await stop($, [])).block).toBeUndefined()
    expect(await phase($)).toContain('aşama: ready')
    expect(rec(world, C1)).toMatchObject({ status: 'ready', file: FILE_C1 })
    world.percent = 10
    await as($, world, 'main')
    const main = await sections($)
    expect(main.at(-1)?.id).toBe(ORKESTRA_SECTION_ID)
    expect(main.some(s => s.id === LONG_CHAT_SECTION_ID)).toBe(false)
  })

  test('(B13) iki zincir: eşik, kapatma ve drain yalnızca kendi zincirinde', async ($, on) => {
    const { world, clock } = setup(on)
    world.sessions.main2 = { sessionId: 'local_main2', title: 'Ana 2' }
    await as($, world, 'main')
    await go($, TASK)
    await turnBegin($)
    expect((await startSession($)).deny).toBeUndefined()
    await as($, world, 'main2')
    await go($, 'ikinci iş')
    await turnBegin($)
    expect((await startSession($)).deny).toBeUndefined()
    expect(world.sessions.c2).toEqual({ sessionId: C2, parentSessionId: 'local_main2' })
    seedAyar(world, clock, 'local_main', { esik: 30, at: NOW })
    seedAyar(world, clock, 'local_main2', { esik: 70, at: NOW })
    // c1 (chain A, esik 30): the idle long-chat note names %30, then it trips at 50.
    await as($, world, 'c1')
    await typed($, 'iş')
    expect((await sections($)).at(-1)?.text).toBe(longChatNote(30))
    await turnBegin($)
    world.percent = 50
    expect((await bash($)).context).toEqual([managedHandoff(30, FILE_C1, true)])
    await clock.advance(100)
    // c2 (chain B, esik 70): nothing at 50; its own chain's esik 40 is read live.
    await as($, world, 'c2')
    world.percent = 10
    await typed($, 'iş')
    await turnBegin($)
    world.percent = 50
    expect((await bash($)).context ?? []).toEqual([])
    expect(await devir($, 'esik 40')).toBe(chainEsikText(40))
    expect(ayar(world, 'local_main2')).toMatchObject({ esik: 40 })
    expect(ayar(world, 'local_main')).toMatchObject({ esik: 30 })
    expect((await bash($)).context).toEqual([managedHandoff(40, FILE_C2, true)])
    await clock.advance(100)
    // /devir kapat in c1 stops chain A only.
    await as($, world, 'c1')
    expect(await devir($, 'kapat')).toContain(KAPAT_CHAIN)
    expect(ayar(world, 'local_main')).toMatchObject({ isClosed: true })
    expect(rec(world, C1)).toMatchObject({ status: 'cancelled' })
    await as($, world, 'c2')
    expect(ayar(world, 'local_main2').isClosed).toBeUndefined()
    expect(await phase($)).toContain('aşama: handoff_running')
    expect(rec(world, C2)).toMatchObject({ status: 'working' })
    expect((await agentCall($)).deny).toBe(DRAIN_DENY)
    expect(world.store.esik).toBe(40)
    expect('acik' in world.store).toBe(false)
    expect('otonomLimit' in world.store).toBe(false)
  })
})
