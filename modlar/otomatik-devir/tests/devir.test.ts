import { describe, expect, mock, test } from 'claude-code/testing'

import {
  ABORT_CHECKS,
  ABORT_WAIT_MS,
  COMPACT_INSTRUCTIONS,
  COMPACT_RETRY_MS,
  CONTINUE_PREFIX,
  continuationText,
  END_NOTE_MS,
  END_TURN_NOTE,
  handoffFile,
  KEEP_DONE,
  MAX_COMPACT_FAILS,
  RESEND_PREFIX,
  RESUME_NOTE,
  TOAST_DONE,
  TOAST_GAVE_UP,
  toastUndelivered,
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
    dropTyped: false,
    onSet: undefined as undefined | ((key: string, value: any) => Promise<void>),
    toasts: [] as string[],
    statuses: [] as (string | undefined)[],
    commands: [] as any[],
    fills: [] as string[],
    runs: [] as string[][],
    logs: [] as string[],
    aborts: [] as string[],
  }
  const clock = mock.clock(on, { now: NOW })
  const clone = (v: unknown) => (v === undefined ? undefined : JSON.parse(JSON.stringify(v)))
  on('store.get', (_: any, e: any) => ({ value: clone(world.store[e.key]) }))
  on('store.set', async (_: any, e: any) => {
    if (world.onSet !== undefined) await world.onSet(e.key, e.value)
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
    if (world.compactMode === 'reject') {
      if (world.onCompact !== undefined) await world.onCompact()
      throw new Error('a turn is running')
    }
    world.compacts.push({ instructions: e.instructions })
    world.order.push('compact')
    if (world.onCompact !== undefined) await world.onCompact()
    if (world.compactMode === 'skip') return { skip: 'vetoed' }
    return { messages: [{ role: 'user', text: 'özet', toolUses: [] }] }
  })
  on('turn.start', (_: any, e: any) => ({ turnId: e.turnId }))
  on('turn.complete', (_: any, e: any) => ({ text: e.answer }))
  on('turn.step', async function* (_: any, e: any) {
    return { turnId: e.turnId, index: e.index, answer: '', toolUses: [] }
  })
  on('turn.abort', (_: any, e: any) => {
    world.aborts.push(e.turnId)
    return { value: undefined }
  })
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
    if (world.dropTyped && e.origin?.kind === 'composer') return { drop: 'dropped beneath' }
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
/** One model request of a main-loop turn (an observer sees it before its tool calls). */
const step = async ($: any, turnId = `t${seq}`, agentId?: string) => {
  for await (const _ of $.turn.step({ turnId, index: 0, model: 'm', messageCount: 1, agentId })) void _
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
const ctx = async (p: Promise<any>): Promise<readonly string[]> => (await p).context ?? []

describe('otomatik-devir v2', () => {
  test('kapalıyken (varsayılan) hiçbir şey yapmaz', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await turnBegin($)
    world.percent = 95
    expect(await ctx(bash($))).toEqual([])
    await measure($, 95)
    await turnEnd($, clock)
    await clock.advance(10 * 60_000)
    expect(world.submitted).toEqual([])
    expect(world.compacts).toEqual([])
    expect(world.toasts).toEqual([])
    expect(world.statuses.every(s => s === undefined)).toBe(true)
    expect(chat(world)).toBeUndefined()
    expect(await devir($, '')).toContain('kapalı')
  })

  test('/devir ac, esik, kapat, simdi ve durum; komut turun içinde hemen çalışır', async ($, on) => {
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
    expect(await devir($, 'esik 45')).toBe('Bu sohbetin devir eşiği %45.')
    expect(await devir($, 'esik 95')).toContain('Kullanım')
    expect(chat(world).threshold).toBe(45)
    expect(await devir($, 'xyz')).toContain('Kullanım')
    expect(await devir($, 'kapat')).toBe('Devir bu sohbette kapatıldı.')
    expect(world.statuses.at(-1)).toBeUndefined()
    expect(await devir($, 'simdi')).toContain('kapalı')
    expect(world.submitted).toEqual([])
    await devir($, 'ac')
    expect(await devir($, 'simdi')).toContain('Devir başlatıldı')
    await clock.advance(100)
    expect(world.submitted.map(s => s.text)).toEqual([windDownText(FILE)])
    expect(chat(world)).toMatchObject({ phase: 'winding', deliveredAt: NOW + 50, deliveries: 1, file: FILE })
    expect(await devir($, 'simdi')).toContain('zaten')
    expect(await devir($, '')).toContain(`aşama: işler bitiriliyor · dosya: ${FILE}`)
    expect(world.statuses.at(-1)).toBe('Devir: işler bitiriliyor…')
    expect(world.files['/proj/.workflow/devir/.gitignore']?.text).toBe('*\n')
  })

  test('eşik geçilince devir bir kez başlar, paralel sonuçlarda mesaj bir kez iletilir', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await devir($, 'ac')
    await turnBegin($)
    world.percent = 30
    expect(await ctx(bash($))).toEqual([])
    world.percent = 65
    const got = await Promise.all([bash($), bash($), bash($)])
    expect(got.flatMap(r => r.context ?? [])).toEqual([windDownText(FILE)])
    expect(await ctx(bash($))).toEqual([])
    expect(await ctx(bash($, { agentId: 'a1' }))).toEqual([])
    await measure($, 66)
    await clock.advance(100)
    expect(world.submitted).toEqual([])
    expect(world.toasts.filter(t => t.startsWith('Devir başladı'))).toHaveLength(1)
  })

  test('simdi ile hemen ardından başlayan tur: mesaj yalnızca bir kez iletilir', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await devir($, 'ac')
    await devir($, 'simdi')
    await turnBegin($)
    expect(await ctx(bash($))).toEqual([windDownText(FILE)])
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

  test('canlı senaryo: dosya alt ajanlar ve shell\'ler sürerken yazıldı → tur sonunda hemen sıkıştır + gönder', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    for (let i = 1; i <= KEEP_DONE + 1; i += 1) writeFile(world, clock, 'eski', `/proj/.workflow/devir/x.done-2026-01-0${i}.md`)
    await clock.advance(1000)
    expect(await ctx(windDownMidTurn($, world))).toEqual([windDownText(FILE)])
    world.agents = Array.from({ length: 5 }, (_, i) => ({ id: `a${i}`, description: 'iş', type: 'general-purpose', status: 'running' }))
    await clock.advance(60_000)
    writeFile(world, clock)
    await stop($, [{ id: 'b1', type: 'shell', status: 'running', description: 'içerik üretimi (saatler)' }])
    await turnEnd($, clock)
    expect(world.compacts).toEqual([{ instructions: COMPACT_INSTRUCTIONS }])
    expect(world.order).toEqual(['compact', 'submit'])
    expect(world.submitted).toEqual([{ text: continuationText(PROMPT_TEXT), asUser: true, context: undefined }])
    expect(world.toasts).toContain(TOAST_DONE)
    expect(chat(world)).toMatchObject({ isOn: true, phase: 'idle', floor: 65, handoffs: 1 })
    expect(world.statuses.at(-1)).toContain('Devir açık')
    // The used file is kept under a new name; only the newest KEEP_DONE used files stay.
    expect(world.files[FILE]).toBeUndefined()
    const done = Object.keys(world.files).filter(p => p.includes('.done-'))
    expect(done).toHaveLength(KEEP_DONE)
    expect(done.some(p => /\/s1\.done-.+\.md$/.test(p))).toBe(true)
  })

  test('tek uzun tur: +%10\'da yeniden iletim (en çok 3), dosya → turu bitir notu → 3 araç sonra abort → sıkıştır + gönder', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    expect(await ctx(windDownMidTurn($, world))).toEqual([windDownText(FILE)])
    const turnId = `t${seq}`
    world.percent = 70
    expect(await ctx(bash($))).toEqual([])
    world.percent = 75
    expect(await ctx(bash($))).toEqual([windDownText(FILE)])
    world.percent = 80
    expect(await ctx(bash($))).toEqual([])
    world.percent = 85
    expect(await ctx(bash($))).toEqual([windDownText(FILE)])
    world.percent = 95
    expect(await ctx(bash($))).toEqual([])
    expect(chat(world).deliveries).toBe(3)
    await clock.advance(1000)
    writeFile(world, clock)
    const [a, b] = await Promise.all([bash($), bash($)])
    expect([...(a.context ?? []), ...(b.context ?? [])]).toEqual([END_TURN_NOTE])
    await bash($)
    await bash($)
    await clock.advance(100)
    expect(world.aborts).toEqual([])
    await bash($)
    await clock.advance(100)
    expect(world.aborts).toEqual([turnId])
    expect(world.compacts).toEqual([])
    // The abort ends the turn: its end (isAborted) is the handoff's turn end.
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId, reason: 'aborted' })
    await clock.advance(100)
    expect(world.order).toEqual(['compact', 'submit'])
    expect(continuations(world)).toHaveLength(1)
    await clock.advance(10_000)
    expect(world.compacts).toHaveLength(1)
  })

  test('turu bitir notundan 10 dakika sonra tek araç sonucu da abort ettirir; abort sonu gelmezse mod kendisi devreder', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    writeFile(world, clock)
    expect(await ctx(bash($))).toEqual([END_TURN_NOTE])
    await clock.advance(END_NOTE_MS)
    await bash($)
    await clock.advance(100)
    expect(world.aborts).toEqual([`t${seq}`])
    // No turn.complete arrives: the mod re-checks, then drives the turn end itself (bounded).
    await clock.advance(ABORT_WAIT_MS)
    expect(world.compacts).toEqual([])
    await clock.advance(ABORT_WAIT_MS * ABORT_CHECKS)
    expect(world.order).toEqual(['compact', 'submit'])
  })

  test('son iletimden önce yazılmış (eski) dosya kullanılmaz', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    writeFile(world, clock, 'saatler önceki devir')
    await clock.advance(5000)
    await windDownMidTurn($, world)
    expect(await ctx(bash($))).toEqual([])
    await turnEnd($, clock)
    expect(world.compacts).toEqual([])
    expect(world.submitted.map(s => s.text)).toEqual([RESEND_PREFIX + windDownText(FILE)])
  })

  test('eski sürümden kalan "winding" kaydı temiz yeniden başlar; eski dosya gönderilmez', async ($, on) => {
    const { world, clock } = setup(on)
    world.store[KEY] = {
      isOn: true,
      threshold: 60,
      phase: 'winding',
      isDelivered: true,
      startedAt: NOW - 6 * 3600_000,
      file: FILE,
      resends: 1,
      waitingSince: NOW - 6 * 3600_000,
      isNudged: true,
    }
    world.files[FILE] = { text: 'eski devir', mtimeMs: NOW - 6 * 3600_000 }
    await start($)
    await turnBegin($)
    world.percent = 71
    expect(await ctx(bash($))).toEqual([windDownText(FILE)])
    expect(chat(world)).toMatchObject({ deliveredAt: NOW, deliveries: 1, resends: 0 })
    await turnEnd($, clock)
    expect(world.compacts).toEqual([])
    expect(world.submitted.map(s => s.text)).toEqual([RESEND_PREFIX + windDownText(FILE)])
  })

  test('vazgeçme: bir yeniden gönderimden sonra boşa döner, modeli işe döndürür, eşik yukarıda yeniden kurulur', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    await turnEnd($, clock)
    await turnBegin($)
    await turnEnd($, clock)
    expect(world.toasts).toContain(TOAST_GAVE_UP)
    expect(chat(world)).toMatchObject({ phase: 'idle', isOn: true, floor: 65 })
    expect(world.submitted.map(s => s.text)).toEqual([RESEND_PREFIX + windDownText(FILE), RESUME_NOTE])
    expect(world.statuses.at(-1)).toContain('Devir açık')
    // No loop: over the threshold but under floor + gap, nothing starts.
    await turnBegin($)
    world.percent = 70
    expect(await ctx(bash($))).toEqual([])
    await turnEnd($, clock)
    expect(world.submitted).toHaveLength(2)
    // Re-armed: the fill dropped to 50, so the next wind-down starts at 65.
    await measure($, 50)
    await turnBegin($)
    world.percent = 66
    expect(await ctx(bash($))).toEqual([windDownText(FILE)])
  })

  test('Claude\'un kendi sıkıştırması (doluluk düşer) mesajı turun içinde yeniden iletir', async ($, on) => {
    const { world } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    world.percent = 30
    expect(await ctx(bash($))).toEqual([windDownText(FILE)])
    expect(await ctx(bash($))).toEqual([])
  })

  test('sıkıştırma sonrası eşik tekrarı: boşluk ve yeniden kurma (eşik 20)', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await devir($, 'ac 20')
    await turnBegin($)
    world.percent = 25
    await bash($)
    writeFile(world, clock)
    await turnEnd($, clock)
    expect(chat(world)).toMatchObject({ phase: 'idle', floor: 25 })
    await turnBegin($)
    expect(await ctx(bash($))).toEqual([])
    world.percent = 15
    await measure($, 15)
    world.percent = 25
    expect(await ctx(bash($))).toEqual([])
    world.percent = 30
    expect(await ctx(bash($))).toEqual([windDownText(FILE)])
  })

  test('/devir kapat süren devri iptal eder ve modele turun içinde bir kez söyler', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    expect(await devir($, 'kapat')).toContain('iptal')
    expect(await ctx(bash($))).toEqual([RESUME_NOTE])
    expect(await ctx(bash($))).toEqual([])
    writeFile(world, clock)
    await turnEnd($, clock)
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

  test('kapat, tur sonunu ve süren sıkıştırmayı yener', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    writeFile(world, clock)
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: `t${seq}`, reason: 'answer' })
    await devir($, 'kapat')
    await clock.advance(100)
    expect(world.compacts).toEqual([])
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

  test('sıkıştırma sırasında giren prompt devam prompt\'unu taşır, ikinci kez gönderilmez', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    writeFile(world, clock)
    world.onCompact = async () => {
      await typed($, 'ne oluyor?')
    }
    await turnEnd($, clock)
    expect(world.submitted).toEqual([{ text: 'ne oluyor?', asUser: undefined, context: [continuationText(PROMPT_TEXT)] }])
    expect(world.toasts).toContain(TOAST_DONE)
  })

  test('devam prompt\'u düşerse dosya kalır, prompt kutusuna konur, dürüstçe bildirilir', async ($, on) => {
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
    expect(chat(world)).toMatchObject({ phase: 'idle', isOn: true })
  })

  test('kök değişse de dosya yolu devrin başındaki kalır', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    world.root = '/proj/.worktrees/wt'
    writeFile(world, clock)
    await turnEnd($, clock)
    expect(world.order).toEqual(['compact', 'submit'])
  })

  test('/clear: durum satırı temizlenir, yeni oturumda komut yeniden kaydedilir', async ($, on) => {
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

  test('alt ajanın turn.complete olayı ve kişinin Esc\'i yok sayılır', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    writeFile(world, clock)
    await $.turn.complete({ answer: 'ok', durationMs: 1, isAborted: false, turnId: 'sub1', reason: 'answer', agentId: 'a1' })
    await clock.advance(100)
    await turnEnd($, clock, { isAborted: true, reason: 'aborted' })
    expect(world.compacts).toEqual([])
    expect(world.submitted).toEqual([])
    await turnBegin($)
    await turnEnd($, clock)
    expect(world.order).toEqual(['compact', 'submit'])
  })

  test('sıkıştırma reddedilirse sınırlı dener, sonra vazgeçer; atlanırsa göndermez', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    writeFile(world, clock)
    world.compactMode = 'reject'
    for (let i = 0; i < MAX_COMPACT_FAILS + 2; i += 1) {
      await turnEnd($, clock)
      await turnBegin($)
    }
    expect(world.toasts).toContain(TOAST_GAVE_UP)
    expect(chat(world).phase).toBe('idle')
    expect(continuations(world)).toEqual([])

    world.compactMode = 'skip'
    await devir($, 'simdi')
    await bash($)
    writeFile(world, clock)
    await turnEnd($, clock)
    expect(world.compacts).toHaveLength(1)
    expect(continuations(world)).toEqual([])
    expect(chat(world).phase).toBe('idle')
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

  // Review 2: one test per finding.

  /** Wind-down delivered, file written, end note given; returns the running turn's id. */
  const toEndNote = async ($: any, world: any, clock: any) => {
    await windDownMidTurn($, world)
    writeFile(world, clock)
    expect(await ctx(bash($))).toEqual([END_TURN_NOTE])
    return `t${seq}`
  }

  test('M1: kendi abort\'undan sonra geç gelen araç sonucu devri durdurmaz', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    const turnId = await toEndNote($, world, clock)
    for (let i = 0; i < 3; i += 1) await bash($)
    await clock.advance(100)
    expect(world.aborts).toEqual([turnId])
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId, reason: 'aborted' })
    await bash($) // the cut call's hook settles after the turn's end
    await clock.advance(100)
    expect(world.order).toEqual(['compact', 'submit'])
  })

  test('M2: abort sonu 5 sn\'den geç gelse de kendi abort\'u sayılır; eski turun sonu yeni turu silmez', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    const turnId = await toEndNote($, world, clock)
    for (let i = 0; i < 3; i += 1) await bash($)
    await clock.advance(100)
    await clock.advance(ABORT_WAIT_MS + 2000)
    expect(world.compacts).toEqual([])
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId, reason: 'aborted' })
    await clock.advance(100)
    expect(world.order).toEqual(['compact', 'submit'])
    // A late end of an older turn does not end the new one.
    await turnBegin($)
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId, reason: 'aborted' })
    await devir($, 'simdi')
    await clock.advance(100)
    expect(world.submitted.map(s => s.text)).not.toContain(windDownText(FILE))
    expect(await ctx(bash($))).toEqual([windDownText(FILE)])
  })

  test('M3: boştayken başarısız sıkıştırma beklemeyle yeniden denenir, sonra vazgeçilir', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    writeFile(world, clock)
    world.compactMode = 'reject'
    await turnEnd($, clock)
    expect(chat(world).compactFails).toBe(1)
    world.compactMode = 'ok'
    await clock.advance(COMPACT_RETRY_MS)
    expect(world.order).toEqual(['compact', 'submit'])
    // Every retry fails: bounded, then the give-up resumes the work.
    await devir($, 'esik 20')
    await devir($, 'simdi')
    await clock.advance(100)
    writeFile(world, clock)
    world.compactMode = 'reject'
    await turnBegin($)
    await turnEnd($, clock)
    await clock.advance(COMPACT_RETRY_MS * MAX_COMPACT_FAILS * MAX_COMPACT_FAILS)
    expect(world.toasts).toContain(TOAST_GAVE_UP)
    expect(chat(world).phase).toBe('idle')
    expect(world.submitted.at(-1)?.text).toBe(RESUME_NOTE)
  })

  test('M4: Esc\'ten sonra kişinin yeni turu not almadan kesilmez; her tur kendi notunu ve sayacını alır', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await toEndNote($, world, clock)
    await bash($)
    await bash($)
    await turnEnd($, clock, { isAborted: true, reason: 'aborted' })
    await turnBegin($)
    expect(await ctx(bash($))).toEqual([END_TURN_NOTE])
    await clock.advance(100)
    expect(world.aborts).toEqual([])
    for (let i = 0; i < 3; i += 1) await bash($)
    await clock.advance(100)
    expect(world.aborts).toEqual([`t${seq}`])
  })

  test('M5: üst sınıra ulaşılmış olsa da Claude\'un kendi sıkıştırması (düşüş) yeniden iletir', async ($, on) => {
    const { world } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    for (const p of [75, 85]) {
      world.percent = p
      expect(await ctx(bash($))).toEqual([windDownText(FILE)])
    }
    expect(chat(world).deliveries).toBe(3)
    world.percent = 95
    expect(await ctx(bash($))).toEqual([])
    world.percent = 30
    expect(await ctx(bash($))).toEqual([windDownText(FILE)])
  })

  test('M6: tur ortasında yeniden yüklenen mod turu turn.step\'ten tanır: prompt kuyruğa girmez, abort çalışır', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await devir($, 'ac')
    await step($, 'tx') // reloaded inside turn tx: its turn.start was before the mod
    await devir($, 'simdi')
    await clock.advance(100)
    expect(world.submitted).toEqual([])
    expect(await ctx(bash($))).toEqual([windDownText(FILE)])
    writeFile(world, clock)
    expect(await ctx(bash($))).toEqual([END_TURN_NOTE])
    for (let i = 0; i < 3; i += 1) await bash($)
    await clock.advance(100)
    expect(world.aborts).toEqual(['tx'])
    await step($, 'sub', 'a1') // a subagent's step does not change the main turn
    await $.turn.complete({ answer: '', durationMs: 1, isAborted: true, turnId: 'tx', reason: 'aborted' })
    await clock.advance(100)
    expect(world.order).toEqual(['compact', 'submit'])
  })

  test('m1: sıkıştırmadan hemen sonraki iletimde doluluk yoksa ilk ölçüm temel alınır', async ($, on) => {
    const { world } = setup(on)
    await start($)
    await devir($, 'ac')
    await turnBegin($)
    await devir($, 'simdi')
    world.percent = undefined
    expect(await ctx(bash($))).toEqual([windDownText(FILE)])
    world.percent = 40
    expect(await ctx(bash($))).toEqual([])
    expect(chat(world).deliveredPercent).toBe(40)
    world.percent = 52
    expect(await ctx(bash($))).toEqual([windDownText(FILE)])
  })

  test('m2: kapat\'tan kalan iptal notu yeni devri bozmaz', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await devir($, 'ac')
    await devir($, 'simdi')
    await clock.advance(100)
    await devir($, 'kapat')
    expect(chat(world).isResumeNoteDue).toBe(true)
    await devir($, 'ac')
    await devir($, 'simdi')
    await clock.advance(100)
    expect(chat(world).isResumeNoteDue).toBe(false)
    await turnBegin($)
    expect(await ctx(bash($))).toEqual([])
  })

  test('m3: abort planlandıktan hemen sonra kapat, abort\'u iptal eder', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await toEndNote($, world, clock)
    for (let i = 0; i < 3; i += 1) await bash($)
    await devir($, 'kapat')
    await clock.advance(ABORT_WAIT_MS * (ABORT_CHECKS + 1))
    expect(world.aborts).toEqual([])
    expect(world.compacts).toEqual([])
  })

  test('m4: kayıt yazımları sıralıdır; araç sonucunun yazımı kapat\'ı geri almaz', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await toEndNote($, world, clock)
    let closing: Promise<string> | undefined
    world.onSet = async (_key, value) => {
      if (value.toolsSinceEndNote !== 1 || closing !== undefined) return
      closing = devir($, 'kapat') // the person's immediate command lands between a load and its write
      for (let i = 0; i < 200; i += 1) await Promise.resolve()
    }
    await bash($)
    await closing
    world.onSet = undefined
    expect(chat(world)).toMatchObject({ isOn: false, phase: 'idle' })
    await bash($)
    await bash($)
    await clock.advance(100)
    expect(world.aborts).toEqual([])
  })

  test('m5: yeni tur başladığı için reddedilen sıkıştırma sayılmaz', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    writeFile(world, clock)
    world.compactMode = 'reject'
    world.onCompact = async () => {
      world.onCompact = undefined
      await turnBegin($)
    }
    await turnEnd($, clock)
    expect(chat(world).compactFails ?? 0).toBe(0)
    world.compactMode = 'ok'
    await turnEnd($, clock)
    expect(world.order).toEqual(['compact', 'submit'])
  })

  test('m6: sıkıştırma sırasında giren prompt düşerse devam prompt\'u yine gönderilir', async ($, on) => {
    const { world, clock } = setup(on)
    await start($)
    await windDownMidTurn($, world)
    writeFile(world, clock)
    world.dropTyped = true
    world.onCompact = async () => {
      await typed($, 'ne oluyor?')
    }
    await turnEnd($, clock)
    expect(continuations(world)).toEqual([{ text: continuationText(PROMPT_TEXT), asUser: true, context: undefined }])
    expect(world.toasts).toContain(TOAST_DONE)
  })
})
