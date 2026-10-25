import { describe, expect, mock, test } from 'claude-code/testing'

import {
  AC_CHAIN_OPEN,
  AC_CHAIN_STOPPED,
  chainEsikText,
  childTitle,
  DEFAULT_LIMIT,
  HANDED_PREFIX,
  KAPAT_CHAIN,
  KIMLIK_PREFIX,
  managedChildNote,
  NORMAL_INFO,
  normalDeneText,
  ORKESTRA_END_DENY,
  ORKESTRA_PAUSED_BAND,
  ORKESTRA_PAUSED_DENY,
  ORKESTRA_PREFIX,
  orkestraBusyDeny,
  orkestraCapDeny,
  orkestraEndText,
  orkestraLimit,
  orkestraRecordFile,
  orkestraRelayText,
  orkestraResumeNote,
  orkestraStalledBand,
  orkestraStartNote,
  orkestraWaitText,
  OTONOM_MARKER,
  RECORD_BACKEND,
  RUN_PREFIX,
  START_HINT,
  UNKNOWN_CHILD,
  ZINCIR_AYAR_PREFIX,
  zincirAyarFile,
} from '../hooks/register.tsx'

// v1.1 orkestra, the main chat's side (T5: O1-O9, O16, O19, O21, O22 main side;
// Decisions 18, 20, 22). store-probe.md: BACKEND file, TRIGGER command.

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

type Task = { id: string; type: string; status: string; description: string }
type Session = { sessionId: string; title?: string; parentSessionId?: string }

/**
 * The world beneath the mod (v1.test.tsx's setup, extended): several chats
 * (`world.sessions`, the one running is `world.sid`), start_session that
 * registers each child under the chat that started it, and a file system the
 * mod writes its records into (BACKEND file).
 */
const setup = (on: any, store: Record<string, unknown> = { esik: 40 }) => {
  const tools = [START, GET, DETACH, HAND_OFF]
  const commands = [SKILL]
  const world = {
    sid: 'main',
    sessions: { main: { sessionId: 'local_main', title: 'Ana' } } as Record<string, Session>,
    // A child's isRunning by local id (get_session); unset is running.
    running: {} as Record<string, boolean>,
    // start_session's count over all chains.
    k: 0,
    percent: 10 as number | undefined,
    store: {} as Record<string, unknown>,
    typed: [] as { text: string; context: readonly string[]; command?: unknown }[],
    toasts: [] as string[],
    logs: [] as string[],
    statuses: [] as (string | undefined)[],
    calls: [] as any[],
    agents: [] as { id: string; description: string; type: string; status: string }[],
    files: {} as Record<string, { text: string; mtimeMs: number }>,
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
  on('command.list', () => ({
    value: commands.map(name => ({ name, description: '', source: 'plugin' })),
  }))
  on('command.run', () => ({}))
  on('skill.prompt', ($: any, e: any) => ({ text: e.text }))
  on('agent.list', () => ({ value: world.agents }))
  on('tool.list', () => ({ value: tools.map(name => ({ name, description: '', mcp: true })) }))
  on('tool.check', () => ({ decision: 'allow' }))
  on('tool.call', ($: any, e: any) => {
    world.calls.push(e)
    if (e.tool === GET) {
      if (e.session_id === 'self') {
        return {
          result: [],
          text: JSON.stringify(world.sessions[world.sid] ?? { sessionId: 'local_self', title: 'Eski iş' }),
        }
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
  on('fs.exists', ($: any, e: any) => ({ value: world.files[e.path] !== undefined }))
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
    world.typed.push({ text: e.text, context: e.context ?? [], command: e.command })
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

type World = ReturnType<typeof setup>['world']
type Clock = ReturnType<typeof setup>['clock']

const devir = async ($: any, args: string): Promise<string> =>
  (
    await $.command.run({
      command: 'devir',
      args,
      origin: { kind: 'composer' },
      presentation: { isFullscreen: false, columns: 100 },
    })
  ).text as string

const start = ($: any) => $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
/** Switches to chat `sid`: a fresh engine load there (session.start resets module vars, O18). */
const as = async ($: any, world: World, sid: string) => {
  world.sid = sid
  await start($)
}
/** A chat of its own (no parent): `local_<sid>`. */
const chat = (world: World, sid: string) => {
  world.sessions[sid] ??= { sessionId: `local_${sid}`, title: sid }
}

let turnSeq = 0
const typed = ($: any, text: string, extra: Record<string, unknown> = {}) =>
  $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false, ...extra })
const machine = ($: any, text: string) => $.prompt.submit({ text, origin: { kind: 'task-notification' }, wait: false })
/** The active trigger (store-probe.md TRIGGER: command): `/devir-otonom <görev>`. */
const go = ($: any, task: string, extra: Record<string, unknown> = {}) =>
  $.prompt.submit({
    text: `/devir-otonom ${task}`,
    command: { name: 'devir-otonom', args: task },
    origin: { kind: 'composer' },
    wait: false,
    ...extra,
  })
const turnBegin = ($: any) => $.turn.start({ text: '', turnId: `tt${++turnSeq}` })
const turnEnd = ($: any, isAborted = false) =>
  $.turn.complete({
    answer: 'ok',
    durationMs: 1,
    isAborted,
    turnId: `tt${turnSeq}`,
    reason: isAborted ? 'aborted' : 'answer',
  })
const bash = ($: any) => $.tool.call({ tool: 'Bash', command: 'ls' })
const stop = ($: any, tasks: Task[] | undefined = []) =>
  $.classic.Stop({ stop_hook_active: false, background_tasks: tasks })
const callsOf = (world: World, tool: string) => world.calls.filter((c: any) => c.tool === tool)
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
const mountBand = ($: any) =>
  $.ui.mount({ plugin: PLUGIN, surface: 'terminal', component: 'AbovePrompt', props: BAND } as any)

const parse = (file: { text: string } | undefined) => (file === undefined ? undefined : JSON.parse(file.text))
/** A chat's orchestration record, per RECORD_BACKEND. */
const rec = (world: World, localId: string): any =>
  RECORD_BACKEND === 'store'
    ? world.store[`${ORKESTRA_PREFIX}${localId}`]
    : parse(world.files[orkestraRecordFile(HOME, localId)])
const seedRec = (world: World, clock: Clock, localId: string, value: Record<string, unknown>) => {
  if (RECORD_BACKEND === 'store') world.store[`${ORKESTRA_PREFIX}${localId}`] = value
  else world.files[orkestraRecordFile(HOME, localId)] = { text: JSON.stringify(value), mtimeMs: clock.now() }
}
/** A chain's settings (Decision 22), per RECORD_BACKEND. */
const ayar = (world: World, localId: string): any =>
  RECORD_BACKEND === 'store'
    ? world.store[`${ZINCIR_AYAR_PREFIX}${localId}`]
    : parse(world.files[zincirAyarFile(HOME, localId)])
const seedAyar = (world: World, clock: Clock, localId: string, value: Record<string, unknown>) => {
  if (RECORD_BACKEND === 'store') world.store[`${ZINCIR_AYAR_PREFIX}${localId}`] = value
  else world.files[zincirAyarFile(HOME, localId)] = { text: JSON.stringify(value), mtimeMs: clock.now() }
}

const childId = (k: number) => `local_child-000${k}`
const childFile = (k: number) => `/proj/.workflow/handoff/c${k}.md`
/** Child k's own record (its one writer is the child; written here directly). */
const seedChild = (
  world: World,
  clock: Clock,
  k: number,
  parent: string,
  n: number,
  status: 'working' | 'ready' | 'finished' | 'cancelled',
  extra: Record<string, unknown> = {},
) =>
  seedRec(world, clock, childId(k), {
    role: 'alt',
    parent,
    n,
    sid: `c${k}`,
    localId: childId(k),
    status,
    at: clock.now(),
    ...extra,
  })
const handoffText = (k: number, kalan: 'var' | 'yok') => `Kalan: ${kalan}\n\n# Devir\nalt sohbet ${k} buraya kadar geldi`
/** Child k wrote its handoff file and its record is `ready`. */
const readyChild = (world: World, clock: Clock, k: number, parent: string, n: number, kalan: 'var' | 'yok' = 'var') => {
  world.files[childFile(k)] = { text: handoffText(k, kalan), mtimeMs: clock.now() }
  seedChild(world, clock, k, parent, n, 'ready', { file: childFile(k) })
}

/** Chat `sid` starts a chain with `task` and the model opens child 1 in that typed turn. */
const chainUp = async ($: any, world: World, sid: string, task = TASK) => {
  chat(world, sid)
  await as($, world, sid)
  await go($, task)
  await turnBegin($)
  const got = await startSession($, { prompt: 'Adım listesini uygula' })
  expect(got.deny).toBeUndefined()
  return world.k
}

const SUBAGENT: Task = { id: 'a1', type: 'subagent', status: 'running', description: 'araştır' }

describe('orkestra ana', () => {
  test('(A1) /devir-otonom: ana kayıt, kimlik, başlatma notu; komut olduğu gibi iletilir, gövdeye not eklenir', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await go($, TASK)
    await clock.advance(100)
    expect(rec(world, 'local_main')).toMatchObject({ role: 'ana', n: 0, isHeld: true, task: TASK, localId: 'local_main' })
    expect(world.store[`${KIMLIK_PREFIX}main`]).toBe('local_main')
    const [sent] = world.typed
    expect(sent?.text).toBe(`/devir-otonom ${TASK}`)
    expect(sent?.command).toEqual({ name: 'devir-otonom', args: TASK })
    expect(sent?.context).toContain(orkestraStartNote(childTitle(TASK, 1)))
    // O1b: the rendered body comes back with the start note appended.
    const body = `${OTONOM_MARKER}\nBu sohbet otonom bir zincirin ANA sohbeti.\n\nGörev: ${TASK}`
    const got: any = await $.skill.prompt({ skill: 'devir-otonom', text: body } as any)
    expect(got.text).toBe(`${body}\n\n${orkestraStartNote(childTitle(TASK, 1))}`)
  })

  test('(A1b) orkestra: takma adı, ad alanlı komut ve ORKESTRA: (büyük harf, boşluk) zinciri başlatır', async ($, on) => {
    const { world, clock } = setup(on)
    chat(world, 'x2')
    await as($, world, 'x2')
    await typed($, `orkestra: ${TASK}`)
    expect(rec(world, 'local_x2')).toMatchObject({ role: 'ana', n: 0, isHeld: true, task: TASK })
    expect(world.typed.at(-1)?.text).toBe(TASK)
    expect(world.typed.at(-1)?.context).toContain(orkestraStartNote(childTitle(TASK, 1)))

    chat(world, 'x3')
    await as($, world, 'x3')
    await go($, TASK, { command: { name: 'otomatik-devir:devir-otonom', args: TASK } })
    expect(rec(world, 'local_x3')).toMatchObject({ role: 'ana', n: 0, task: TASK })
    expect(world.typed.at(-1)?.context).toContain(orkestraStartNote(childTitle(TASK, 1)))

    chat(world, 'x4')
    await as($, world, 'x4')
    await typed($, '   ORKESTRA: x')
    expect(rec(world, 'local_x4')).toMatchObject({ role: 'ana', n: 0, task: 'x' })
    await clock.advance(100)
  })

  test('(A2) boş görev: düşürülür, kayıt yok', async ($, on) => {
    const { world } = setup(on)
    await start($)
    const got: any = await go($, '')
    expect(String(got.drop)).toContain('Görev boş')
    expect(rec(world, 'local_main')).toBeUndefined()
    expect(ayar(world, 'local_main')).toBeUndefined()
  })

  test('(A2b) canlı ana sohbette ikinci /devir-otonom düşürülür, kayıt değişmez', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await go($, TASK)
    await clock.advance(100)
    const before = rec(world, 'local_main')
    const got: any = await go($, 'x')
    expect(String(got.drop)).toContain('zaten çalışıyor')
    expect(rec(world, 'local_main')).toEqual(before)
  })

  test('(A3) devredildi:main varsa başlatma düşürülür, kayıt yok', async ($, on) => {
    const { world } = setup(on, {
      esik: 40,
      [`${HANDED_PREFIX}main`]: { handoffId: 'm-old', startedId: 'local_old', file: '/proj/x.md', at: 1 },
    })
    await start($)
    const got: any = await go($, TASK)
    expect(String(got.drop)).toContain('zaten devredildi')
    expect(rec(world, 'local_main')).toBeUndefined()
  })

  test('(A4) acik:false başlatmayı durdurmaz; acik yazılmaz, zincir ayarı taze yazılır', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, acik: false })
    await start($)
    await go($, TASK)
    await clock.advance(100)
    expect(rec(world, 'local_main')).toMatchObject({ role: 'ana', n: 0, isHeld: true })
    expect(world.store.acik).toBe(false)
    expect(ayar(world, 'local_main')).toEqual({ at: NOW })
  })

  test('(A5) çalışan bir turun üstüne yazılan /devir-otonom da başlatır', async ($, on) => {
    const { world } = setup(on)
    await start($)
    await turnBegin($)
    await go($, TASK, { turnId: `tt${turnSeq}` })
    expect(rec(world, 'local_main')).toMatchObject({ role: 'ana', n: 0, isHeld: true, task: TASK })
    expect(world.typed.at(-1)?.context).toContain(orkestraStartNote(childTitle(TASK, 1)))
  })

  test('(A6) eşik üstündeki ana sohbet devredilmez: araç sonucu ve Stop v1 devri açmaz; /devir simdi reddedilir', async ($, on) => {
    const { world, clock } = setup(on)
    await chainUp($, world, 'main')
    expect(await devir($, 'esik 40')).toBe(chainEsikText(40))
    expect(ayar(world, 'local_main')).toMatchObject({ esik: 40 })
    world.percent = 90
    expect((await bash($)).context ?? []).toEqual([])
    expect((await stop($, [])).block).toBe(orkestraWaitText(1))
    expect(world.store[`${RUN_PREFIX}main`]).toBeUndefined()
    expect(await devir($, 'simdi')).toBe('Ana sohbet devredilmez (orkestra modu).')
    expect((await bash($)).context ?? []).toEqual([])
    await clock.advance(100)
    expect(world.store[`${RUN_PREFIX}main`]).toBeUndefined()
  })

  test('(A7) alt sohbet 1: başlık, user_asked, fresh, görev ve yönetim notu; boş prompt yalnızca görev', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await go($, TASK)
    await turnBegin($)
    const got = await startSession($, { prompt: 'Adım listesini uygula', initiation: 'offer', context: 'inherit' })
    expect(got.deny).toBeUndefined()
    const [sent] = callsOf(world, START)
    expect(sent.title).toBe(`${TASK} · 1`)
    expect(sent.initiation).toBe('user_asked')
    expect(sent.context).toBe('fresh')
    expect(sent.prompt.startsWith('Adım listesini uygula')).toBe(true)
    expect(sent.prompt).toContain(`## Kullanıcının asıl isteği\n${TASK}`)
    expect(sent.prompt).toContain(managedChildNote(1, 100))
    expect(rec(world, 'local_main')).toMatchObject({ n: 1, childId: childId(1) })
    await clock.advance(100)
    expect(Object.keys(world.store).filter(key => key.startsWith(HANDED_PREFIX))).toEqual([])
    expect(callsOf(world, DETACH)).toHaveLength(0)

    chat(world, 'm2')
    await as($, world, 'm2')
    await go($, TASK)
    await turnBegin($)
    expect((await startSession($, { prompt: '' })).deny).toBeUndefined()
    expect(callsOf(world, START)[1].prompt).toBe(TASK + managedChildNote(1, 100))
    expect(rec(world, 'local_m2')).toMatchObject({ n: 1, childId: childId(2) })
  })

  test('(A8) çocuk çalışırken Stop her seferinde bekleme metni verir (sınırsız), alt ajan olsa da', async ($, on) => {
    const { world, clock } = setup(on)
    const k = await chainUp($, world, 'main')
    seedChild(world, clock, k, 'local_main', 1, 'working')
    for (let i = 0; i < 5; i += 1) expect((await stop($, [])).block).toBe(orkestraWaitText(1))
    expect((await stop($, [SUBAGENT])).block).toBe(orkestraWaitText(1))
  })

  test('(A9) çocuk çalışırken ikinci açış reddedilir; eşzamanlı iki açıştan biri geçer; eski starting engellemez', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await go($, TASK)
    await turnBegin($)
    const both = await Promise.all([startSession($), startSession($)])
    expect(callsOf(world, START)).toHaveLength(1)
    expect(both.filter((r: any) => r.deny === undefined)).toHaveLength(1)
    expect(both.filter((r: any) => r.deny === orkestraBusyDeny(1))).toHaveLength(1)
    // Child 1 works: a further start is refused.
    expect((await startSession($)).deny).toBe(orkestraBusyDeny(1))
    expect(callsOf(world, START)).toHaveLength(1)

    chat(world, 'm2')
    await as($, world, 'm2')
    await go($, TASK)
    const base = rec(world, 'local_m2')
    // A start in flight 60 s ago still blocks.
    seedRec(world, clock, 'local_m2', { ...base, starting: true, startingAt: clock.now() - 60_000 })
    await as($, world, 'm2')
    expect((await startSession($)).deny).toBe(orkestraBusyDeny(1))
    // 121 s back it is a crash mid-start: the next start is forwarded.
    seedRec(world, clock, 'local_m2', { ...base, starting: true, startingAt: clock.now() - 121_000 })
    await as($, world, 'm2')
    expect((await startSession($)).deny).toBeUndefined()
    expect(callsOf(world, START)).toHaveLength(2)
    expect(rec(world, 'local_m2')).toMatchObject({ n: 1, childId: childId(2) })
  })

  test('(A10) çocuk ready (Kalan: var): Stop sıradakini ister, araç sonucu bir kez taşır; açış dosya + not', async ($, on) => {
    const { world, clock } = setup(on)
    const k = await chainUp($, world, 'main')
    readyChild(world, clock, k, 'local_main', 1)
    const relay = orkestraRelayText(2, `${TASK} · 2`)
    expect((await stop($, [])).block).toBe(relay)
    expect((await bash($)).context).toEqual([relay])
    expect((await bash($)).context ?? []).toEqual([])
    expect((await startSession($, { prompt: 'sıradaki' })).deny).toBeUndefined()
    const sent = callsOf(world, START)[1]
    expect(sent.title).toBe(`${TASK} · 2`)
    expect(sent.prompt).toBe(handoffText(k, 'var') + managedChildNote(2, 100))
    expect(rec(world, 'local_main')).toMatchObject({ n: 2, childId: childId(2) })
  })

  test('(A11) Kalan: yok, finished ve /devir otonom dur zinciri bitirir; bitince açış reddedilir', async ($, on) => {
    const { world, clock } = setup(on)
    const k1 = await chainUp($, world, 'main')
    readyChild(world, clock, k1, 'local_main', 1)
    expect((await startSession($)).deny).toBeUndefined()
    const k2 = world.k
    readyChild(world, clock, k2, 'local_main', 2, 'yok')
    // A start before the Stop: the chain is over.
    expect((await startSession($)).deny).toBe(ORKESTRA_END_DENY)
    expect(callsOf(world, START)).toHaveLength(2)
    const end = orkestraEndText('bitti', 2, undefined, childFile(k2), childId(k2), 100)
    expect((await stop($, [])).block).toBe(end)
    expect(rec(world, 'local_main')).toMatchObject({ ended: 'bitti' })
    expect((await stop($, [])).block).toBeUndefined()
    expect((await bash($)).context ?? []).toEqual([])
    expect((await startSession($)).deny).toBe(ORKESTRA_END_DENY)
    expect(callsOf(world, START)).toHaveLength(2)

    // finished: the same end, with the child's report.
    const k3 = await chainUp($, world, 'm2')
    seedChild(world, clock, k3, 'local_m2', 1, 'finished', { report: 'hepsi bitti' })
    expect((await stop($, [])).block).toBe(orkestraEndText('bitti', 1, 'hepsi bitti', undefined, childId(k3), 100))
    expect(rec(world, 'local_m2')).toMatchObject({ ended: 'bitti' })
    expect((await stop($, [])).block).toBeUndefined()

    // /devir otonom dur, then ready: durduruldu.
    const k4 = await chainUp($, world, 'm3')
    expect(await devir($, 'otonom dur')).toBe('Zincir şu anki alt sohbetten sonra duracak.')
    readyChild(world, clock, k4, 'local_m3', 1)
    expect((await startSession($)).deny).toBe(ORKESTRA_END_DENY)
    expect((await stop($, [])).block).toBe(orkestraEndText('durduruldu', 1, undefined, childFile(k4), childId(k4), 100))
    expect(rec(world, 'local_m3')).toMatchObject({ ended: 'durduruldu' })
    expect((await stop($, [])).block).toBeUndefined()
  })

  test('(A12) Esc zinciri duraklatır; bant, Stop, açış; makine turu duraklatık tutar; yazılan mesaj sürdürür ve not olur', async ($, on) => {
    const { world, clock } = setup(on)
    const k = await chainUp($, world, 'main')
    seedChild(world, clock, k, 'local_main', 1, 'working')
    await turnEnd($, true)
    await clock.advance(100)
    expect(rec(world, 'local_main')).toMatchObject({ isHeld: false })
    expect(world.statuses.at(-1)).toBe('Orkestra duraklatıldı')
    const ui = await mountBand($)
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain(ORKESTRA_PAUSED_BAND)
    expect(drawn).toContain('"below"')
    expect(drawn.indexOf(ORKESTRA_PAUSED_BAND)).toBeLessThan(drawn.indexOf('"below"'))
    await ui.unmount()
    expect((await stop($, [])).block).toBeUndefined()
    expect((await startSession($)).deny).toBe(ORKESTRA_PAUSED_DENY)
    // A machine turn keeps it paused.
    await machine($, 'görev bildirimi')
    await turnBegin($)
    expect((await stop($, [])).block).toBeUndefined()
    await turnEnd($)
    expect(rec(world, 'local_main')).toMatchObject({ isHeld: false })
    // The person types "devam": resumed, no note.
    await typed($, 'devam')
    expect(world.typed.at(-1)?.context).toContain(orkestraResumeNote(1, 'working'))
    expect(rec(world, 'local_main').isHeld).toBe(true)
    expect(rec(world, 'local_main').pendingMessage).toBeUndefined()
    await turnBegin($)
    expect((await stop($, [])).block).toBe(orkestraWaitText(1))
    // Anything else typed becomes the next child's note.
    await typed($, 'şunu da ekle')
    expect(world.typed.at(-1)?.context).toContain(orkestraResumeNote(1, 'working'))
    expect(rec(world, 'local_main')).toMatchObject({ isHeld: true, pendingMessage: 'şunu da ekle' })
    readyChild(world, clock, k, 'local_main', 1)
    expect((await startSession($)).deny).toBeUndefined()
    const sent = callsOf(world, START)[1]
    expect(sent.prompt).toBe(`${handoffText(k, 'var')}\n\n## Kullanıcının notu\nşunu da ekle${managedChildNote(2, 100)}`)
    expect(rec(world, 'local_main').pendingMessage).toBeUndefined()
  })

  test('(A13) /devir otonom metinleri; normal sohbette dur; ana sohbette dene 5 kayda yazılır', async ($, on) => {
    const { world } = setup(on)
    chat(world, 'n1')
    await as($, world, 'n1')
    const notOrchestrated = await devir($, 'otonom')
    expect(notOrchestrated).toContain(`sınır ${DEFAULT_LIMIT} alt sohbet`)
    expect(notOrchestrated).toContain(START_HINT)
    expect(await devir($, 'otonom dur')).toBe(notOrchestrated)

    await chainUp($, world, 'main')
    const status = await devir($, 'otonom')
    expect(status).toContain('ana sohbet')
    expect(status).toContain(`görev "${TASK}"`)
    expect(status).toContain('alt sohbet 1/100')
    expect(await devir($, 'dene 5')).toContain('Zincirin deneme eşiği %5')
    expect(rec(world, 'local_main')).toMatchObject({ testThreshold: 5 })
  })

  test('(A14) zincir ortasında yeniden yükleme rolü, n ve isHeld kaydı korur', async ($, on) => {
    const { world, clock } = setup(on)
    const k = await chainUp($, world, 'main')
    seedChild(world, clock, k, 'local_main', 1, 'working')
    const before = rec(world, 'local_main')
    await as($, world, 'main')
    expect(rec(world, 'local_main')).toMatchObject({ role: 'ana', n: before.n, isHeld: true })
    expect(await devir($, 'otonom')).toContain('alt sohbet 1/100')
    expect(await devir($, 'otonom')).toContain('tutuluyor')
    expect((await stop($, [])).block).toBe(orkestraWaitText(1))
    expect(await devir($, 'simdi')).toBe('Ana sohbet devredilmez (orkestra modu).')
  })

  test('(A15) yanıt vermeyen çocuk: iki kontrol en az 4 dk arayla; durdu sonu, bant; çalışırsa sayaç sıfırlanır', async ($, on) => {
    const { world, clock } = setup(on)
    const k = await chainUp($, world, 'main')
    const id = childId(k)
    seedChild(world, clock, k, 'local_main', 1, 'working')
    world.running[id] = false
    const gets = () => callsOf(world, GET).filter((c: any) => c.session_id === id).length
    expect((await stop($, [])).block).toBe(orkestraWaitText(1))
    expect(gets()).toBe(1)
    await clock.advance(60_000)
    expect((await stop($, [])).block).toBe(orkestraWaitText(1))
    expect(gets()).toBe(1)
    await clock.advance(5 * 60_000)
    expect((await stop($, [])).block).toBe(orkestraEndText('durdu', 1, undefined, undefined, id))
    expect(gets()).toBe(2)
    expect(rec(world, 'local_main')).toMatchObject({ ended: 'durdu' })
    await clock.advance(100)
    const ui = await mountBand($)
    const drawn = JSON.stringify(await ui.drawn())
    expect(drawn).toContain(orkestraStalledBand(1))
    expect(drawn.indexOf(orkestraStalledBand(1))).toBeLessThan(drawn.indexOf('"below"'))
    await ui.unmount()
    expect((await stop($, [])).block).toBeUndefined()

    // Running in between: the count resets, no end.
    const k2 = await chainUp($, world, 'm2')
    const id2 = childId(k2)
    seedChild(world, clock, k2, 'local_m2', 1, 'working')
    world.running[id2] = false
    expect((await stop($, [])).block).toBe(orkestraWaitText(1))
    await clock.advance(5 * 60_000)
    world.running[id2] = true
    expect((await stop($, [])).block).toBe(orkestraWaitText(1))
    await clock.advance(5 * 60_000)
    world.running[id2] = false
    expect((await stop($, [])).block).toBe(orkestraWaitText(1))
    expect(rec(world, 'local_m2').ended).toBeUndefined()

    // A ready child, or an unknown child id: no GET.
    const k3 = await chainUp($, world, 'm3')
    readyChild(world, clock, k3, 'local_m3', 1)
    const before = callsOf(world, GET).filter((c: any) => c.session_id !== 'self').length
    await clock.advance(5 * 60_000)
    expect((await stop($, [])).block).toBe(orkestraRelayText(2, `${TASK} · 2`))
    chat(world, 'm4')
    await as($, world, 'm4')
    await go($, TASK)
    seedRec(world, clock, 'local_m4', { ...rec(world, 'local_m4'), n: 1, childId: UNKNOWN_CHILD })
    await as($, world, 'm4')
    await clock.advance(5 * 60_000)
    expect((await stop($, [])).block).toBe(orkestraWaitText(1))
    await clock.advance(5 * 60_000)
    expect((await stop($, [])).block).toBe(orkestraWaitText(1))
    expect(callsOf(world, GET).filter((c: any) => c.session_id !== 'self').length).toBe(before)
  })

  test('(A16) sınır: varsayılan 100, sinir sonu, 101. açış ret; limit sıkıştırılır; zincirde canlı okunur', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    expect(await orkestraLimit($ as any, 'local_main')).toBe(100)
    seedRec(world, clock, 'local_main', {
      role: 'ana',
      sid: 'main',
      localId: 'local_main',
      task: 'büyük iş',
      title: 'büyük iş',
      n: 100,
      isHeld: true,
      childId: 'local_child-0100',
      startedAt: 1,
      at: 1,
    })
    world.files['/proj/c100.md'] = { text: 'Kalan: var\n\nsürüyor', mtimeMs: clock.now() }
    seedRec(world, clock, 'local_child-0100', {
      role: 'alt',
      parent: 'local_main',
      n: 100,
      sid: 'c100',
      localId: 'local_child-0100',
      status: 'ready',
      file: '/proj/c100.md',
      at: 1,
    })
    await as($, world, 'main')
    const end = orkestraEndText('sinir', 100, undefined, '/proj/c100.md', 'local_child-0100', 100)
    expect(end).toContain('sınır 100')
    expect((await stop($, [])).block).toBe(end)
    expect(rec(world, 'local_main')).toMatchObject({ ended: 'sinir' })
    expect((await startSession($)).deny).toBe(orkestraCapDeny(100))
    expect(callsOf(world, START)).toHaveLength(0)

    expect(await devir($, 'otonom limit 5')).toBe('Orkestra: sınır 5 alt sohbet.')
    expect(ayar(world, 'local_main')).toMatchObject({ limit: 5 })
    expect(world.store.otonomLimit).toBeUndefined()
    expect(await devir($, 'otonom limit 0')).toBe('Orkestra: sınır 1 alt sohbet.')
    expect(ayar(world, 'local_main')).toMatchObject({ limit: 1 })
    expect(await devir($, 'otonom limit 5000')).toBe('Orkestra: sınır 1000 alt sohbet.')
    expect(ayar(world, 'local_main')).toMatchObject({ limit: 1000 })
    expect(await devir($, 'otonom limit abc')).toContain('Kullanım: /devir')
    expect(ayar(world, 'local_main')).toMatchObject({ limit: 1000 })

    // Limit 2: child 2 ready ends the chain at the limit.
    const run2 = async (sid: string) => {
      chat(world, sid)
      await as($, world, sid)
      await go($, 'iki adım')
      expect(await devir($, 'otonom limit 2')).toBe('Orkestra: sınır 2 alt sohbet.')
      await turnBegin($)
      expect((await startSession($)).deny).toBeUndefined()
      readyChild(world, clock, world.k, `local_${sid}`, 1)
      expect((await stop($, [])).block).toBe(orkestraRelayText(2, 'iki adım · 2'))
      expect((await startSession($)).deny).toBeUndefined()
      readyChild(world, clock, world.k, `local_${sid}`, 2)
      return world.k
    }
    const k2 = await run2('m2')
    expect((await stop($, [])).block).toBe(orkestraEndText('sinir', 2, undefined, childFile(k2), childId(k2), 2))
    expect(rec(world, 'local_m2')).toMatchObject({ ended: 'sinir' })
    expect((await startSession($)).deny).toBe(orkestraCapDeny(2))

    // Raised to 3 in child 2 before that Stop: the relay goes on (read live).
    const k3 = await run2('m3')
    await as($, world, `c${k3}`)
    expect(await devir($, 'otonom limit 3')).toBe('Orkestra: sınır 3 alt sohbet.')
    expect(ayar(world, 'local_m3')).toMatchObject({ limit: 3 })
    await as($, world, 'm3')
    expect((await stop($, [])).block).toBe(orkestraRelayText(3, 'iki adım · 3'))
    expect(await devir($, 'otonom')).toContain('alt sohbet 2/3')
    expect(world.store.otonomLimit).toBeUndefined()
  })

  test('(A17) acik:false normal sohbet: dene 3 saklanır, zincir onu alır, acik yazılmaz; /devir ac hiçbir şey yazmaz', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, acik: false })
    await start($)
    expect(await devir($, 'dene 3')).toBe(normalDeneText(3))
    await go($, 'x')
    await clock.advance(100)
    expect(world.store.acik).toBe(false)
    expect(rec(world, 'local_main')).toMatchObject({ role: 'ana', testThreshold: 3 })
    const main = rec(world, 'local_main')
    const settings = ayar(world, 'local_main')
    expect(await devir($, 'ac')).toBe(AC_CHAIN_OPEN)
    expect(rec(world, 'local_main')).toMatchObject({ n: main.n, isHeld: main.isHeld })
    expect(ayar(world, 'local_main')).toEqual(settings)
    expect(world.store.acik).toBe(false)
  })

  test('(A18) /devir kapat zinciri durdurur; iptal edilen çocuk; duraklatık zincirde kapanış; açış reddi', async ($, on) => {
    const { world, clock } = setup(on)
    const k = await chainUp($, world, 'main')
    seedChild(world, clock, k, 'local_main', 1, 'working')
    const reply = await devir($, 'kapat')
    expect(reply.endsWith(KAPAT_CHAIN)).toBe(true)
    expect(ayar(world, 'local_main')).toMatchObject({ isClosed: true })
    expect(world.store.acik).toBeUndefined()
    const end = orkestraEndText('kapatildi', 1, undefined, undefined, childId(k))
    expect((await bash($)).context).toEqual([end])
    expect((await bash($)).context ?? []).toEqual([])
    expect((await stop($, [])).block).toBe(end)
    expect(rec(world, 'local_main')).toMatchObject({ ended: 'kapatildi' })
    expect((await stop($, [])).block).toBeUndefined()
    expect((await startSession($)).deny).toBe(ORKESTRA_END_DENY)
    expect(callsOf(world, START)).toHaveLength(1)
    expect(await devir($, 'ac')).toBe(AC_CHAIN_STOPPED)
    expect(rec(world, 'local_main')).toMatchObject({ ended: 'kapatildi' })
    expect(ayar(world, 'local_main')).toMatchObject({ isClosed: true })

    // A cancelled child with the chain open: kapatildi, no relay.
    const k2 = await chainUp($, world, 'm2')
    seedChild(world, clock, k2, 'local_m2', 1, 'cancelled')
    expect((await stop($, [])).block).toBe(orkestraEndText('kapatildi', 1, undefined, undefined, childId(k2)))
    expect(rec(world, 'local_m2')).toMatchObject({ ended: 'kapatildi' })

    // Paused, then closed: the typed "devam" gets the end text, not the resume note.
    const k3 = await chainUp($, world, 'm3')
    seedChild(world, clock, k3, 'local_m3', 1, 'working')
    await turnEnd($, true)
    seedAyar(world, clock, 'local_m3', { isClosed: true, at: clock.now() })
    await typed($, 'devam')
    const end3 = orkestraEndText('kapatildi', 1, undefined, undefined, childId(k3))
    expect(world.typed.at(-1)?.context).toContain(end3)
    expect(world.typed.at(-1)?.context).not.toContain(orkestraResumeNote(1, 'working'))
    expect(rec(world, 'local_m3')).toMatchObject({ ended: 'kapatildi' })

    // The same with a machine turn's Stop in between: it passes and writes the end.
    const k4 = await chainUp($, world, 'm4')
    seedChild(world, clock, k4, 'local_m4', 1, 'working')
    await turnEnd($, true)
    seedAyar(world, clock, 'local_m4', { isClosed: true, at: clock.now() })
    await machine($, 'görev bildirimi')
    await turnBegin($)
    expect((await stop($, [])).block).toBeUndefined()
    expect(rec(world, 'local_m4')).toMatchObject({ ended: 'kapatildi' })
    await turnEnd($)
    const end4 = orkestraEndText('kapatildi', 1, undefined, undefined, childId(k4))
    await typed($, 'devam')
    expect(world.typed.at(-1)?.context.filter(c => c === end4)).toHaveLength(1)
    await typed($, 'ne oldu')
    expect(world.typed.at(-1)?.context ?? []).not.toContain(end4)

    // Closed with child 1 working: the model's start is refused before any end is written.
    const k5 = await chainUp($, world, 'm5')
    seedChild(world, clock, k5, 'local_m5', 1, 'working')
    seedAyar(world, clock, 'local_m5', { isClosed: true, at: clock.now() })
    const starts = callsOf(world, START).length
    expect((await startSession($)).deny).toBe(ORKESTRA_END_DENY)
    expect(callsOf(world, START)).toHaveLength(starts)
    expect(rec(world, 'local_m5').ended).toBeUndefined()
    expect((await stop($, [])).block).toBe(orkestraEndText('kapatildi', 1, undefined, undefined, childId(k5)))
    expect((await stop($, [])).block).toBeUndefined()
  })

  test('(A19) ana sohbet %80 ve üstü: aktarım noktasında dolu sonu; %79 aktarım; çocuk çalışırken bekleme; kısa metinler', async ($, on) => {
    const { world, clock } = setup(on)
    const k = await chainUp($, world, 'main')
    readyChild(world, clock, k, 'local_main', 1)
    world.percent = 85
    const end = orkestraEndText('dolu', 1, undefined, childFile(k), childId(k), 100)
    expect(end).toContain('ana sohbet dolu')
    expect(end).toContain(childFile(k))
    expect(end).toContain(START_HINT)
    expect((await stop($, [])).block).toBe(end)
    expect(rec(world, 'local_main')).toMatchObject({ ended: 'dolu' })
    expect((await startSession($)).deny).toBe(ORKESTRA_END_DENY)

    world.percent = 10
    const k2 = await chainUp($, world, 'm2')
    readyChild(world, clock, k2, 'local_m2', 1)
    world.percent = 79
    expect((await stop($, [])).block).toBe(orkestraRelayText(2, `${TASK} · 2`))

    world.percent = 10
    const k3 = await chainUp($, world, 'm3')
    seedChild(world, clock, k3, 'local_m3', 1, 'working')
    world.percent = 99
    expect((await stop($, [])).block).toBe(orkestraWaitText(1))
    expect(rec(world, 'local_m3').ended).toBeUndefined()

    expect(orkestraWaitText(1).length).toBeLessThanOrEqual(400)
    const relay = orkestraRelayText(2, `${'x'.repeat(40)} · 2`)
    expect(relay.length).toBeLessThanOrEqual(400)
    expect(relay).toContain('mod doldurur')
  })

  test('(A20) normal sohbet: /devir, simdi tek satır NORMAL_INFO; dene normalDeneText; ana sohbette zincirin dene metni', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, acik: true })
    chat(world, 'n1')
    await as($, world, 'n1')
    world.percent = 90
    expect(await devir($, '')).toBe(NORMAL_INFO)
    world.store.acik = false
    expect(await devir($, '')).toBe(NORMAL_INFO)
    world.store.acik = true
    expect(await devir($, 'simdi')).toBe(NORMAL_INFO)
    await typed($, 'iş')
    expect(world.typed.at(-1)?.context ?? []).toEqual([])
    await turnBegin($)
    expect((await bash($)).context ?? []).toEqual([])
    expect((await stop($, [])).block).toBeUndefined()
    await clock.advance(100)
    expect(world.store[`${RUN_PREFIX}n1`]).toBeUndefined()
    expect(await devir($, 'dene 5')).toBe(normalDeneText(5))

    world.percent = 10
    await chainUp($, world, 'main')
    expect((await devir($, 'dene 5')).startsWith('Zincirin deneme eşiği %5: ')).toBe(true)
  })

  test('(A21) iki zincir: eşik, sınır ve kapat yalnızca kendi zincirinde; yeni zincir taze ayar', async ($, on) => {
    const { world, clock } = setup(on, { esik: 40, acik: true })
    const k1 = await chainUp($, world, 'main', 'birinci iş')
    world.sessions.main2 = { sessionId: 'local_main2', title: 'Ana 2' }
    const k2 = await chainUp($, world, 'main2', 'ikinci iş')
    expect(world.sessions[`c${k2}`]?.parentSessionId).toBe('local_main2')
    seedChild(world, clock, k1, 'local_main', 1, 'working')
    seedChild(world, clock, k2, 'local_main2', 1, 'working')

    await as($, world, 'main')
    expect(await devir($, 'esik 30')).toBe(chainEsikText(30))
    expect(ayar(world, 'local_main')).toMatchObject({ esik: 30 })
    expect(ayar(world, 'local_main2')?.esik).toBeUndefined()
    expect(await devir($, 'otonom limit 5')).toBe('Orkestra: sınır 5 alt sohbet.')
    await as($, world, 'main2')
    expect(await devir($, 'otonom')).toContain('alt sohbet 1/100')

    await as($, world, 'main')
    expect((await devir($, 'kapat')).endsWith(KAPAT_CHAIN)).toBe(true)
    expect((await stop($, [])).block).toBe(orkestraEndText('kapatildi', 1, undefined, undefined, childId(k1)))
    expect(rec(world, 'local_main')).toMatchObject({ ended: 'kapatildi' })

    await as($, world, 'main2')
    expect((await stop($, [])).block).toBe(orkestraWaitText(1))
    readyChild(world, clock, k2, 'local_main2', 1)
    expect((await stop($, [])).block).toBe(orkestraRelayText(2, 'ikinci iş · 2'))
    expect(rec(world, 'local_main2').ended).toBeUndefined()

    await as($, world, 'main')
    expect(await devir($, 'ac')).toBe(AC_CHAIN_STOPPED)
    expect(ayar(world, 'local_main')).toMatchObject({ isClosed: true })
    await as($, world, 'main2')
    expect(await devir($, 'ac')).toBe(AC_CHAIN_OPEN)
    expect(ayar(world, 'local_main2')?.isClosed).toBeUndefined()

    await as($, world, 'main')
    await go($, 'yeni')
    await clock.advance(100)
    const fresh = ayar(world, 'local_main')
    expect(fresh.esik).toBeUndefined()
    expect(fresh.limit).toBeUndefined()
    expect(fresh.isClosed).toBeUndefined()
    expect(rec(world, 'local_main')).toMatchObject({ role: 'ana', n: 0, task: 'yeni' })
    expect(rec(world, 'local_main').ended).toBeUndefined()
    expect(world.store.esik).toBe(40)
    expect(world.store.acik).toBe(true)
    expect('otonomLimit' in world.store).toBe(false)
  })
})
