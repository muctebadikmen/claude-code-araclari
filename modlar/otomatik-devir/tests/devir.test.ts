import { describe, expect, mock, test } from 'claude-code/testing'

import {
  COMPACT_INSTRUCTIONS,
  CONTINUE_PREFIX,
  continuationText,
  END_TURN_NOTE,
  handoffFile,
  KEEP_DONE,
  MAX_COMPACT_FAILS,
  MAX_WAIT_MS,
  nudgeText,
  RESEND_PREFIX,
  RESUME_NOTE,
  SHELL_WAIT_MS,
  TOAST_COMPACT,
  TOAST_DONE,
  TOAST_MISSING,
  TOAST_WAIT,
  toastUndelivered,
  WAIT_TICK_MS,
  windDownText,
} from '../hooks/register'

const NOW = 1_000_000
const SID = 's1'
const FILE = handoffFile('/proj', SID)
const KEY = `sohbet:${SID}`
const PROMPT_TEXT = '# Devam\nAdım 3 ile devam et: testleri yaz.'

type Agent = { id: string; description: string; type: string; status: string }
type Task = { id: string; type: string; status: string; description: string }

/** The world beneath the mod: session, fill, agents, files, store, and what the mod asked of it. */
const setup = (on: any) => {
  const world = {
    sid: SID,
    root: '/proj',
    percent: 10 as number | undefined,
    store: {} as Record<string, unknown>,
    files: {} as Record<string, { text: string; mtimeMs: number }>,
    agents: [] as Agent[],
    submitted: [] as { text: string; asUser?: boolean; context?: readonly string[] }[],
    compacts: [] as { instructions?: string }[],
    order: [] as string[],
    compactMode: 'ok' as 'ok' | 'reject' | 'skip',
    onCompact: undefined as undefined | (() => Promise<void>),
    dropPlugin: false,
    toasts: [] as string[],
    statuses: [] as (string | undefined)[],
    commands: [] as any[],
    fills: [] as string[],
    runs: [] as string[][],
    logs: [] as string[],
  }
  const clock = mock.clock(on, { now: NOW })
  const clone = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
  on('store.get', (_: any, e: any) => ({ value: clone(world.store[e.key]) }))
  on('store.set', (_: any, e: any) => {
    world.store[e.key] = clone(e.value)
    return { value: undefined }
  })
  on('session.start', (_: any, e: any) => ({ cwd: e.cwd }))
  on('session.end', (_: any, e: any) => ({ sessionId: e.sessionId }))
  on('session.id', () => ({ value: world.sid }))
  on('session.root', () => ({ value: world.root }))
  on('session.cwd', () => ({ value: world.root }))
  on('session.usage', () => ({ value: { startedAt: 0, context: { window: 100, percent: world.percent }, rateLimits: [] } }))
  on('session.measure', (_: any, e: any) => ({ changed: e.changed }))
  on('session.compact', async (_: any, e: any) => {
    if (world.compactMode === 'reject') throw new Error('a turn is running')
    world.compacts.push({ instructions: e.instructions })
    world.order.push('compact')
    if (world.onCompact !== undefined) await world.onCompact()
    if (world.compactMode === 'skip') return { skip: 'vetoed' }
    return { messages: [{ role: 'user', text: 'özet', toolUses: [] }] }
  })
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('classic.Stop', () => ({}))
  on('command.register', (_: any, e: any) => {
    world.commands.push(e)
    return { value: { command: e.name } }
  })
  on('command.run', () => ({}))
  on('agent.list', () => ({ value: world.agents }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('prompt.submit', (_: any, e: any) => {
    if (world.dropPlugin && e.origin?.kind === 'plugin') return { drop: 'host limit' }
    world.submitted.push({ text: e.text, asUser: e.origin?.asUser, context: e.context })
    world.order.push('submit')
    return { text: e.text, context: e.context }
  })
  on('prompt.fill', (_: any, e: any) => {
    world.fills.push(e.text)
    return { isFilled: true }
  })
  on('fs.stat', (_: any, e: any) => {
    const f = world.files[e.path]
    if (f === undefined) throw new Error('ENOENT')
    return { value: { kind: 'file', size: f.text.length, mtimeMs: f.mtimeMs, isLink: false } }
  })
  on('fs.read', (_: any, e: any) => {
    const f = world.files[e.path]
    if (f === undefined) throw new Error('ENOENT')
    return { value: f.text }
  })
  on('fs.write', (_: any, e: any) => {
    world.files[e.path] = { text: e.text, mtimeMs: clock.now() }
    return { value: undefined }
  })
  on('fs.list', (_: any, e: any) => ({
    value: Object.keys(world.files)
      .filter(p => p.startsWith(`${e.path}/`) && !p.slice(e.path.length + 1).includes('/'))
      .map(p => ({ name: p.slice(e.path.length + 1), kind: 'file', size: 1, mtimeMs: world.files[p]!.mtimeMs, isLink: false })),
  }))
  on('process.run', (_: any, e: any) => {
    world.runs.push([...e.argv])
    if (e.argv[0] === 'mv') {
      const [, from, to] = e.argv
      world.files[to] = world.files[from]!
      delete world.files[from]
    }
    if (e.argv[0] === 'rm') for (const p of e.argv.slice(2)) delete world.files[p]
    return { value: { exitCode: 0, stdout: '', stderr: '' } }
  })
  on('ui.toast', (_: any, e: any) => {
    world.toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.status', (_: any, e: any) => {
    world.statuses.push(e.text)
    return { value: undefined }
  })
  on('ui.log', (_: any, e: any) => {
    world.logs.push(e.text)
    return { value: undefined }
  })
  return { world, clock }
}

const devir = async ($: any, args: string): Promise<string> =>
  (await $.command.run({ command: 'devir', args, origin: { kind: 'composer' }, presentation: { isFullscreen: false, columns: 100 } }))
    .text
const start = ($: any) => $.session.start({ cwd: '/proj', surface: 'terminal', isInteractive: true })
let seq = 0
const turnBegin = ($: any) => $.turn.start({ text: 'iş', turnId: `t${++seq}` })
const turnEnd = async ($: any, clock: any, extra: Record<string, unknown> = {}) => {
  await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: `t${seq}`, reason: 'answer', ...extra })
  await clock.advance(100)
}
const bash = ($: any, extra: Record<string, unknown> = {}) => $.tool.call({ tool: 'Bash', command: 'ls', ...extra })
const measure = ($: any, percent: number) =>
  $.session.measure({ context: { window: 100, percent }, rateLimits: [], changed: ['context'] })
const stop = ($: any, tasks: Task[] = []) => $.classic.Stop({ stop_hook_active: false, background_tasks: tasks })
const typed = ($: any, text: string) => $.prompt.submit({ text, origin: { kind: 'composer' }, wait: false } as never)
const writeFile = (world: any, clock: any, text = PROMPT_TEXT, file = FILE) => {
  world.files[file] = { text, mtimeMs: clock.now() }
}
const chat = (world: any): any => world.store[KEY]
const continuations = (world: any) => world.submitted.filter((s: any) => s.text.startsWith(CONTINUE_PREFIX))

/** On at 60%, a turn running, the fill crossing it: the next main-loop result delivers. */
const windDownMidTurn = async ($: any, world: any) => {
  await devir($, 'ac')
  await turnBegin($)
  world.percent = 65
  return bash($)
}

describe('otomatik-devir v2', () => {
  test('kapalıyken (varsayılan) hiçbir şey yapmaz', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await turnBegin($)
    world.percent = 95
    expect((await bash($)).context ?? []).toEqual([])
    await measure($, 95)
    await turnEnd($, clock)
    await clock.advance(10 * WAIT_TICK_MS)
    expect(world.submitted).toEqual([])
    expect(world.compacts).toEqual([])
    expect(world.toasts).toEqual([])
    expect(world.statuses.every(s => s === undefined)).toBe(true)
    expect(chat(world)).toBeUndefined()
    expect(await devir($, '')).toContain('kapalı')
  })

  test('/devir ac, esik, kapat, simdi ve durum; komut turun içinde hemen çalışır (M1)', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    expect(world.commands[0]).toMatchObject({ name: 'devir', immediate: true })
    world.percent = 34
    expect(await devir($, 'ac')).toContain('eşik %60')
    expect(chat(world)).toMatchObject({ isOn: true, threshold: 60, phase: 'idle' })
    expect(world.toasts).toContain('Devir açıldı (eşik %60)')
    expect(world.statuses.at(-1)).toBe('Devir açık · eşik %60 · şu an %34')
    expect(await devir($, '')).toBe('Devir açık · eşik %60 · şu an %34 · aşama: izleniyor')
    expect(await devir($, 'ac 70')).not.toContain('Uyarı')
    expect(await devir($, 'ac 85')).toContain('Uyarı')
    expect(await devir($, 'ac 10')).toContain('20-90')
    expect(chat(world).threshold).toBe(85)
    expect(await devir($, 'esik 45')).toBe('Bu sohbetin devir eşiği %45.')
    expect(await devir($, 'esik 95')).toContain('Kullanım')
    expect(await devir($, 'esik')).toContain('Kullanım')
    expect(chat(world).threshold).toBe(45)
    expect(await devir($, 'xyz')).toContain('Kullanım')
    expect(await devir($, 'kapat')).toBe('Devir bu sohbette kapatıldı.')
    expect(chat(world).isOn).toBe(false)
    expect(world.statuses.at(-1)).toBeUndefined()
    expect(await devir($, 'simdi')).toContain('kapalı')
    expect(world.submitted).toEqual([])
    // simdi while idle: the wind-down is submitted as a prompt, regardless of the fill.
    await devir($, 'ac')
    expect(await devir($, 'simdi')).toContain('Devir başlatıldı')
    await clock.advance(100)
    expect(world.submitted.map(s => s.text)).toEqual([windDownText(FILE)])
    expect(chat(world)).toMatchObject({ phase: 'winding', isDelivered: true, startedAt: NOW, file: FILE })
    expect(await devir($, 'simdi')).toContain('zaten')
    expect(await devir($, '')).toContain(`aşama: işler bitiriliyor · dosya: ${FILE}`)
    expect(world.statuses.at(-1)).toBe('Devir: işler bitiriliyor…')
    // m9: the handoff folder is created and git-ignored.
    expect(world.files['/proj/.workflow/devir/.gitignore']?.text).toBe('*\n')
  })

  test('eşik geçilince devir bir kez başlar ve mesaj turun içinde bir kez iletilir (m1)', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await devir($, 'ac')
    await turnBegin($)
    world.percent = 30
    expect((await bash($)).context ?? []).toEqual([])
    world.percent = 65
    // Three parallel results right after the crossing, no measurement first: one start, one delivery.
    const got = await Promise.all([bash($), bash($), bash($)])
    expect(got.flatMap(r => r.context ?? [])).toEqual([windDownText(FILE)])
    expect((await bash($)).context ?? []).toEqual([])
    // A subagent's tool result never carries it.
    expect((await bash($, { agentId: 'a1' })).context ?? []).toEqual([])
    await measure($, 66)
    await clock.advance(100)
    expect(world.submitted).toEqual([])
    expect(world.toasts.filter(t => t.startsWith('Devir başladı'))).toHaveLength(1)
    expect(chat(world)).toMatchObject({ phase: 'winding', isDelivered: true, startedAt: NOW })
  })

  test('simdi ile hemen ardından başlayan tur: mesaj yalnızca bir kez iletilir', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await devir($, 'ac')
    await devir($, 'simdi')
    await turnBegin($)
    expect((await bash($)).context).toEqual([windDownText(FILE)])
    await clock.advance(100)
    expect(world.submitted).toEqual([])
  })

  test('boştayken eşik geçilirse mesaj prompt olarak gönderilir', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await devir($, 'ac 50')
    world.percent = 55
    await measure($, 55)
    await clock.advance(100)
    expect(world.submitted.map(s => s.text)).toEqual([windDownText(FILE)])
    await measure($, 56)
    await clock.advance(100)
    expect(world.submitted).toHaveLength(1)
  })

  test('dosya hazır ve iş yok: sıkıştır, sonra dosya metnini gönder; eski dosyalar budanır', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    for (let i = 1; i <= KEEP_DONE + 1; i += 1) writeFile(world, clock, 'eski', `/proj/.workflow/devir/x.done-2026-01-0${i}.md`)
    expect((await windDownMidTurn($, world)).context).toEqual([windDownText(FILE)])
    await clock.advance(5000)
    writeFile(world, clock)
    await stop($)
    await turnEnd($, clock)
    expect(world.compacts).toEqual([{ instructions: COMPACT_INSTRUCTIONS }])
    expect(COMPACT_INSTRUCTIONS).toContain('next step')
    expect(world.order).toEqual(['compact', 'submit'])
    expect(world.submitted).toEqual([{ text: continuationText(PROMPT_TEXT), asUser: true, context: undefined }])
    expect(world.toasts).toContain(TOAST_DONE)
    expect(chat(world)).toMatchObject({ isOn: true, phase: 'idle', floor: 65, handoffs: 1 })
    // The used file is kept under a new name; only the newest KEEP_DONE used files stay.
    expect(world.files[FILE]).toBeUndefined()
    const done = Object.keys(world.files).filter(p => p.includes('.done-'))
    expect(done).toHaveLength(KEEP_DONE)
    expect(done.some(p => /\/s1\.done-.+\.md$/.test(p))).toBe(true)
    expect(world.files['/proj/.workflow/devir/x.done-2026-01-01.md']).toBeUndefined()
  })

  test('sıkıştırma sırasında giren prompt devam prompt\'unu taşır, ikinci kez gönderilmez (M3)', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    writeFile(world, clock)
    world.onCompact = async () => {
      await typed($, 'ne oluyor?')
    }
    await turnEnd($, clock)
    expect(world.submitted).toEqual([
      { text: 'ne oluyor?', asUser: undefined, context: [continuationText(PROMPT_TEXT)] },
    ])
    expect(world.toasts).toContain(TOAST_DONE)
    expect(chat(world).phase).toBe('idle')
  })

  test('sıkıştırma sonrası eşik tekrarı: boşluk ve yeniden kurma (m6)', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await devir($, 'ac 20')
    await turnBegin($)
    world.percent = 25
    await bash($)
    writeFile(world, clock)
    await turnEnd($, clock)
    expect(chat(world)).toMatchObject({ phase: 'idle', floor: 25 })
    // Stale high fill right after the compaction: no new wind-down.
    await turnBegin($)
    expect((await bash($)).context ?? []).toEqual([])
    // The baseline after compaction is 15: the next one needs 30 (floor + gap), not 20.
    world.percent = 15
    await measure($, 15)
    world.percent = 25
    expect((await bash($)).context ?? []).toEqual([])
    world.percent = 30
    expect((await bash($)).context).toEqual([windDownText(FILE)])
  })

  test('alt ajan (waiting dahil) ya da workflow çalışırken bekler, sonuçlar işlenince devreder (M2, m5)', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    writeFile(world, clock)
    world.agents = [{ id: 'a1', description: 'araştır', type: 'general-purpose', status: 'waiting' }]
    await turnEnd($, clock)
    expect(world.compacts).toEqual([])
    expect(world.submitted).toEqual([])
    expect(chat(world).waitingSince).toBeDefined()
    expect(world.statuses.at(-1)).toBe('Devir: alt ajanlar bekleniyor…')
    // A notification turn: the agent is done, but a workflow is still in flight.
    world.agents = [{ ...world.agents[0]!, status: 'completed' }]
    await turnBegin($)
    await stop($, [{ id: 'w1', type: 'workflow', status: 'running', description: 'denetim' }])
    await turnEnd($, clock)
    expect(world.compacts).toEqual([])
    await clock.advance(WAIT_TICK_MS)
    expect(world.compacts).toEqual([])
    // The workflow's notification turn: nothing in flight now.
    await turnBegin($)
    await stop($)
    await turnEnd($, clock)
    expect(world.order).toEqual(['compact', 'submit'])
    expect(continuations(world)).toHaveLength(1)
  })

  test('zamanlayıcı sıkıştırmaz: iş bitince modele bir tur verir, o turun sonunda devreder; 60 dakikada duraklar (m5)', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    writeFile(world, clock)
    world.agents = [{ id: 'a1', description: 'x', type: 'general-purpose', status: 'running' }]
    await turnEnd($, clock)
    await clock.advance(WAIT_TICK_MS)
    world.agents = []
    await clock.advance(3 * WAIT_TICK_MS)
    expect(world.compacts).toEqual([])
    expect(world.submitted.map(s => s.text)).toEqual([nudgeText(FILE)])
    await turnBegin($)
    await stop($)
    await turnEnd($, clock)
    expect(world.order).toEqual(['submit', 'compact', 'submit'])

    // A second wind-down whose agent never ends: paused after MAX_WAIT_MS.
    world.percent = 10
    await measure($, 10)
    await windDownMidTurn($, world)
    writeFile(world, clock)
    world.agents = [{ id: 'a2', description: 'y', type: 'general-purpose', status: 'running' }]
    await turnEnd($, clock)
    await clock.advance(MAX_WAIT_MS + WAIT_TICK_MS)
    expect(world.compacts).toHaveLength(1)
    expect(world.toasts).toContain(TOAST_WAIT)
    expect(chat(world).phase).toBe('paused')
    // m2: the model is told to go back to normal work.
    expect(world.submitted.at(-1)?.text).toBe(RESUME_NOTE)
  })

  test('arka plan shell\'i sınırlı süre beklenir (m9)', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    writeFile(world, clock)
    const shell = { id: 'b1', type: 'shell', status: 'running', description: 'npm test' }
    await stop($, [shell])
    await turnEnd($, clock)
    expect(world.compacts).toEqual([])
    await clock.advance(SHELL_WAIT_MS)
    await turnBegin($)
    await stop($, [shell])
    await turnEnd($, clock)
    expect(world.compacts).toHaveLength(1)
  })

  test('dosya yazılıp tur sürerse bir kez "turu bitir" hatırlatması (m4)', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    expect((await bash($)).context ?? []).toEqual([])
    writeFile(world, clock)
    world.agents = [{ id: 'a1', description: 'x', type: 'general-purpose', status: 'running' }]
    expect((await bash($)).context ?? []).toEqual([])
    world.agents = []
    const [a, b] = await Promise.all([bash($), bash($)])
    expect([...(a.context ?? []), ...(b.context ?? [])]).toEqual([END_TURN_NOTE])
    expect((await bash($)).context ?? []).toEqual([])
  })

  test('dosya yoksa bir kez yeniden gönderir, sonra duraklar, bildirir ve modeli işe döndürür (m2)', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    // A file older than the wind-down (an earlier handoff's) does not count.
    world.files[FILE] = { text: 'eski devir', mtimeMs: NOW - 600_000 }
    await clock.advance(5000)
    await windDownMidTurn($, world)
    await turnEnd($, clock)
    expect(world.submitted.map(s => s.text)).toEqual([RESEND_PREFIX + windDownText(FILE)])
    await turnBegin($)
    await turnEnd($, clock)
    expect(world.toasts).toContain(TOAST_MISSING)
    expect(chat(world)).toMatchObject({ phase: 'paused', isOn: true })
    expect(world.statuses.at(-1)).toBe('Devir duraklatıldı · /devir simdi')
    expect(world.submitted.map(s => s.text)).toEqual([RESEND_PREFIX + windDownText(FILE), RESUME_NOTE])
    // No loop: later turns and timers send nothing more, even over the threshold.
    await turnBegin($)
    expect((await bash($)).context ?? []).toEqual([])
    await turnEnd($, clock)
    await clock.advance(10 * WAIT_TICK_MS)
    expect(world.submitted).toHaveLength(2)
    expect(world.compacts).toEqual([])
    expect(await devir($, '')).toContain('duraklatıldı')
  })

  test('/devir kapat süren devri iptal eder ve modele turun içinde bir kez söyler', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    expect(await devir($, 'kapat')).toContain('iptal')
    expect((await bash($)).context).toEqual([RESUME_NOTE])
    expect((await bash($)).context ?? []).toEqual([])
    writeFile(world, clock)
    await turnEnd($, clock)
    await clock.advance(10 * WAIT_TICK_MS)
    expect(world.compacts).toEqual([])
    expect(world.submitted).toEqual([])
    expect(chat(world)).toMatchObject({ isOn: false, phase: 'idle' })
  })

  test('kapat boştayken iletilmiş mesajı bir sonraki prompt ile iptal eder', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await devir($, 'ac')
    await devir($, 'simdi')
    await clock.advance(100)
    await devir($, 'kapat')
    expect((await typed($, 'devam et')).context).toEqual([RESUME_NOTE])
    expect((await typed($, 'sonra')).context ?? []).toEqual([])
  })

  test('kapat, tur sonunu ve süren sıkıştırmayı yener (M1)', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    writeFile(world, clock)
    // Queued right at the turn end, before the mod's own after-turn work.
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: `t${seq}`, reason: 'answer' })
    await devir($, 'kapat')
    await clock.advance(100)
    expect(world.compacts).toEqual([])
    // During the compaction itself: nothing is submitted after it.
    await devir($, 'ac')
    await devir($, 'simdi')
    await turnBegin($)
    await bash($)
    writeFile(world, clock)
    world.onCompact = async () => {
      world.onCompact = undefined
      await devir($, 'kapat')
    }
    await turnEnd($, clock)
    expect(world.compacts).toHaveLength(1)
    expect(continuations(world)).toEqual([])
    expect(chat(world)).toMatchObject({ isOn: false, phase: 'idle' })
    expect(world.files[FILE]).toBeDefined()
  })

  test('devam prompt\'u düşerse dosya kalır, dürüst bildirir, /devir simdi gönderir (m3)', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    writeFile(world, clock)
    world.dropPlugin = true
    await turnEnd($, clock)
    expect(world.compacts).toHaveLength(1)
    expect(world.toasts).toContain(toastUndelivered(FILE))
    expect(world.toasts).not.toContain(TOAST_DONE)
    expect(world.fills).toEqual([continuationText(PROMPT_TEXT)])
    expect(world.files[FILE]?.text).toBe(PROMPT_TEXT)
    expect(chat(world)).toMatchObject({ phase: 'paused', undeliveredFile: FILE })
    world.dropPlugin = false
    expect(await devir($, 'simdi')).toContain('gönderiliyor')
    await clock.advance(100)
    expect(world.logs).toEqual([])
    expect(world.toasts.at(-1)).toContain('gönderildi')
    expect(continuations(world)).toHaveLength(1)
    expect(world.files[FILE]).toBeUndefined()
    expect(chat(world)).toMatchObject({ phase: 'idle' })
  })

  test('devir sürerken Claude\'un kendi sıkıştırması: mesaj turun içinde yeniden iletilir (M4)', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    expect((await bash($)).context ?? []).toEqual([])
    await $.session.compact({ trigger: 'auto', messages: [{ role: 'user', text: 'x', toolUses: [] }] } as never)
    expect((await bash($)).context).toEqual([windDownText(FILE)])
    expect((await bash($)).context ?? []).toEqual([])
    // Re-delivery is not a re-send: a turn end without the file still gets its one re-send.
    await turnEnd($, clock)
    expect(world.submitted.map(s => s.text)).toEqual([RESEND_PREFIX + windDownText(FILE)])
  })

  test('kök değişse de dosya yolu devrin başındaki kalır (m7)', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    world.root = '/proj/.worktrees/wt'
    writeFile(world, clock)
    await turnEnd($, clock)
    expect(world.order).toEqual(['compact', 'submit'])
  })

  test('/clear: durum satırı temizlenir, yeni oturumda komut yeniden kaydedilir (m8)', async ($, on) => {
    const { world } = setup(on)
    await start($)
    await devir($, 'ac')
    expect(world.statuses.at(-1)).toContain('Devir açık')
    await $.session.end({ reason: 'clear', sessionId: SID } as never)
    expect(world.statuses.at(-1)).toBeUndefined()
    world.sid = 's2'
    await measure($, 5)
    expect(world.commands.length).toBe(2)
    expect(await devir($, '')).toContain('kapalı')
  })

  test('alt ajanın turn.complete olayı yok sayılır', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    writeFile(world, clock)
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 'sub1', reason: 'answer', agentId: 'a1' })
    await clock.advance(10 * WAIT_TICK_MS)
    expect(world.compacts).toEqual([])
    expect(world.submitted).toEqual([])
    await turnEnd($, clock)
    expect(world.order).toEqual(['compact', 'submit'])
  })

  test('kesilen (Esc) turda hiçbir şey yapılmaz', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    writeFile(world, clock)
    await turnEnd($, clock, { isAborted: true, reason: 'aborted' })
    expect(world.compacts).toEqual([])
    expect(world.submitted).toEqual([])
  })

  test('sıkıştırma reddedilirse sınırlı dener, sonra duraklar; atlanırsa göndermez', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    writeFile(world, clock)
    world.compactMode = 'reject'
    for (let i = 0; i < MAX_COMPACT_FAILS + 2; i += 1) {
      await turnEnd($, clock)
      await turnBegin($)
    }
    expect(world.toasts).toContain(TOAST_COMPACT)
    expect(chat(world).phase).toBe('paused')
    expect(continuations(world)).toEqual([])

    world.compactMode = 'skip'
    await devir($, 'simdi')
    await bash($)
    writeFile(world, clock)
    await turnEnd($, clock)
    expect(world.compacts).toHaveLength(1)
    expect(continuations(world)).toEqual([])
    expect(chat(world).phase).toBe('paused')
  })

  test('ayarlar sohbete aittir ve yeniden başlatmada (sıkıştırma, yeniden yükleme) kalır', async ($, on) => {
    const { world } = setup(on)
    await start($)
    await devir($, 'ac 75')
    await start($)
    expect(await devir($, '')).toContain('eşik %75')
    world.store['sohbet:s2'] = { isOn: false, threshold: 30, phase: 'idle' }
    expect(chat(world)).toMatchObject({ isOn: true, threshold: 75 })
  })
})
