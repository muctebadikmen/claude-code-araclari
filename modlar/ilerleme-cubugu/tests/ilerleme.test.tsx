import { expect, mock, test } from 'claude-code/testing'
import type { TestBody } from 'claude-code/testing'

type TestEngine = Parameters<TestBody>[0]
type TestOn = Parameters<TestBody>[1]

// a prompt as the engine raises it: typed in the composer, or a plugin's (otomatik-devir's) own
const prompt = (text: string, by: 'composer' | 'plugin' = 'composer') => ({
  text,
  wait: false,
  origin: by === 'composer' ? { kind: 'composer' as const } : { kind: 'plugin' as const, name: 'otomatik-devir', asUser: true as const },
})

const PLUGIN = 'ilerleme-cubugu'
const BAND = {
  plugin: PLUGIN,
  component: 'AbovePrompt',
  props: {
    hasSurvey: false,
    isWorking: true,
    maxRows: 12,
    bodyColumns: 100,
    scroll: { offset: 0, bodyRows: 11 },
    view: {},
  },
} as const

const command = (args: string) => ({
  command: 'ilerleme',
  args,
  origin: { kind: 'composer' as const },
  presentation: { isFullscreen: false, columns: 100 },
})

const todos = (statuses: string[]) => ({
  tool: 'TodoWrite',
  todos: statuses.map((status, i) => ({
    content: `Adım ${i + 1}`,
    activeForm: `Adım ${i + 1} yapılıyor`,
    status,
  })),
})

test('görev listesi çubuğu, tamamlanma, gizleme', async ($, on) => {
  const clock = mock.clock(on, { now: 1_000_000 })
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine</Text>
  })
  on('fs.list', () => Promise.reject(new Error('ENOENT')))
  on('fs.stat', () => Promise.reject(new Error('ENOENT')))
  on('tool.call', () => ({ result: {}, text: 'ok' }))

  await $.tool.call(todos(['completed', 'in_progress', 'pending']) as never)
  await clock.advance(6 * 60_000)

  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const line = await ui.find({ key: 'toggle' })
    expect(line?.text).toBe('▓░░ 1/3 · %33 · Şu an: Adım 2 yapılıyor')
    expect(line?.text).not.toContain(' dk')
    await ui.press({ key: 'toggle' })
    expect((await ui.find({ text: /^● Adım 2/ }))?.text).toBe('● Adım 2')
    expect((await ui.find({ text: /^✓ Adım 1/ }))?.text).toBe('✓ Adım 1')
    expect((await ui.find({ text: /^○ Adım 3/ }))?.text).toBe('○ Adım 3')
    await ui.press({ key: 'toggle' })
    await ui.unmount()
  }

  await $.tool.call(todos(['completed', 'completed', 'completed']) as never)
  expect(toasts).toEqual(['✓ Tamamlandı'])

  const done = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await done.find({ key: 'toggle' }))?.text).toBe('▓▓▓ 3/3 · %100 · ✓ Tamamlandı')
  expect((await done.find({ key: 'toggle' }))?.text).not.toContain(' dk')
  await done.unmount()

  await clock.advance(5000)
  const gone = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await gone.find({ key: 'toggle' })).toBeUndefined()
  await gone.unmount()

  await $.tool.call(todos(['pending', 'pending']) as never)
  const again = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await again.find({ key: 'toggle' }))?.text).toBe('░░ 0/2 · %0 · Şu an: Adım 1')
  await again.unmount()

  const hidden = await $.command.run(command('gizle'))
  expect(hidden.text).toContain('gizlendi')
  const off = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await off.find({ key: 'toggle' })).toBeUndefined()
  await off.unmount()

  await $.command.run(command('GÖSTER'))
  const on2 = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await on2.find({ key: 'toggle' })).toBeDefined()
  await on2.unmount()

  expect((await $.command.run(command('xyz'))).text).toContain('Kullanım')
})

test('görev listesi yokken PLAN.md kutucukları', async ($, on) => {
  mock.clock(on, { now: 5_000_000 })
  // stands in for core's own drawing, which the band hook now always asks for via next(e)
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine</Text>
  })
  let source = '# Plan\n- [x] Şema\n- [X] API\n- [ ] Form doğrulaması\n- [ ] Testler\n'
  let mtimeMs = 1
  on('ui.toast', () => ({ value: undefined }))
  on('fs.list', () => Promise.reject(new Error('ENOENT')))
  on('fs.stat', (_, e) =>
    e.path.endsWith('/PLAN.md') && !e.path.includes('.workflow')
      ? { value: { kind: 'file' as const, size: source.length, mtimeMs, isLink: false } }
      : Promise.reject(new Error('ENOENT')),
  )
  on('fs.read', () => ({ value: source }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))

  await $.tool.call({ tool: 'Edit', file_path: 'PLAN.md', old_string: 'a', new_string: 'b' } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'toggle' }))?.text).toBe('▓▓░░ 2/4 · %50 · Şu an: Form doğrulaması')
  expect((await ui.find({ key: 'toggle' }))?.text).not.toContain(' dk')
  await ui.unmount()

  source = source.replace('- [ ] Form', '- [x] Form')
  mtimeMs = 2
  await $.tool.call({ tool: 'Edit', file_path: 'PLAN.md', old_string: 'a', new_string: 'b' } as never)
  const next = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect((await next.find({ key: 'toggle' }))?.text).toBe('▓▓▓░ 3/4 · %75 · Şu an: Testler')
  await next.unmount()
})

test('TaskCreate / TaskUpdate', async ($, on) => {
  mock.clock(on, { now: 9_000_000 })
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine</Text>
  })
  on('fs.list', () => Promise.reject(new Error('ENOENT')))
  on('fs.stat', () => Promise.reject(new Error('ENOENT')))
  let next = 1
  on('tool.call', (_, e) =>
    String(e.tool) === 'TaskCreate' ? { result: { task: { id: String(next++) } }, text: 'ok' } : { result: {}, text: 'ok' },
  )

  await $.tool.call({ tool: 'TaskCreate', subject: 'Model', description: 'm' } as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Görünüm', description: 'g' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'in_progress', activeForm: 'Model yazılıyor' } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'toggle' }))?.text).toBe('░░ 0/2 · %0 · Şu an: Model yazılıyor')
  await ui.unmount()

  await $.tool.call({ tool: 'TaskUpdate', taskId: '2', status: 'deleted' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed' } as never)
  expect(toasts).toEqual(['✓ Tamamlandı'])
})

// Shared AbovePrompt band: this mod's rows come first, the drawing beneath (next(e)) after.
// A Button's press handle is minted per draw, so trees are compared without it.
const plain = (tree: unknown): unknown =>
  JSON.parse(JSON.stringify(tree, (key, value) => (key === 'handle' ? undefined : value)))

test('bant paylaşımı: kendi satırlar + alttaki çizim, boşken yalnız alttaki', async ($, on) => {
  const clock = mock.clock(on, { now: 2_000_000 })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Box, Button } = $.ui.resolve(e)
    return (
      <Box key="beneath">
        <Button key="btn-0" label="Devam" hotkey="1" onPress={() => undefined} />
      </Box>
    )
  })
  on('fs.list', () => Promise.reject(new Error('ENOENT')))
  on('fs.stat', () => Promise.reject(new Error('ENOENT')))
  on('tool.call', () => ({ result: {}, text: 'ok' }))

  const beneathOnly = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const tree = plain(await ui.drawn())
    await ui.unmount()
    return tree
  }

  // (b) nothing to show yet: exactly the drawing beneath
  const reference = await beneathOnly()
  expect(reference).toMatchObject({ type: 'Box', props: { key: 'beneath' } })

  // (a) own content: the drawing beneath FIRST (another mod's buttons can never be
  // pushed out of the band by an opened step list), then the bar, nothing swallowed
  await $.tool.call(todos(['completed', 'in_progress']) as never)
  for (const surface of ['terminal', 'desktop'] as const) {
    const ui = await $.ui.mount({ ...BAND, surface })
    const tree = plain(await ui.drawn()) as { type: string; children?: unknown[] }
    expect(tree.type).toBe('Box')
    expect(tree.children?.[0]).toEqual(reference)
    expect(tree.children?.[1]).toMatchObject({ type: 'Button', props: { key: 'toggle' } })
    expect((await ui.find({ key: 'toggle' }))?.text).toBe('▓░ 1/2 · %50 · Şu an: Adım 2 yapılıyor')
    expect(await ui.find({ type: 'Button', text: 'Devam' })).toBeDefined()
    // (c) the toggle never grabs the focus ring of the shared band
    expect((await ui.find({ key: 'toggle' }))?.props.autoFocus).toBeUndefined()
    await ui.press({ key: 'toggle' })
    const open = plain(await ui.drawn()) as { children?: unknown[] }
    expect(open.children?.[0]).toEqual(reference)
    expect(open.children?.[1]).toMatchObject({ type: 'Button', props: { key: 'toggle' } })
    expect(open.children?.[2]).toMatchObject({ type: 'Text', children: ['✓', ' ', 'Adım 1'] })
    expect(open.children).toHaveLength(4)
    await ui.press({ key: 'toggle' })
    await ui.unmount()
  }

  // (b) hidden: exactly the drawing beneath
  await $.command.run(command('gizle'))
  expect(await beneathOnly()).toEqual(reference)
  await $.command.run(command('göster'))

  // (b) a survey holds the band: exactly the drawing beneath
  const survey = await $.ui.mount({ ...BAND, surface: 'terminal', props: { ...BAND.props, hasSurvey: true } })
  expect(plain(await survey.drawn())).toEqual(reference)
  await survey.unmount()

  // (b) done and past the hide delay: exactly the drawing beneath
  await $.tool.call(todos(['completed', 'completed']) as never)
  await clock.advance(5000)
  expect(await beneathOnly()).toEqual(reference)
})

test('alt ajan: TaskUpdate sayılır, TodoWrite ana listeyi ezmez', async ($, on) => {
  mock.clock(on, { now: 7_000_000 })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine</Text>
  })
  on('fs.list', () => Promise.reject(new Error('ENOENT')))
  on('fs.stat', () => Promise.reject(new Error('ENOENT')))
  let id = 1
  on('tool.call', (_, e) =>
    String(e.tool) === 'TaskCreate' ? { result: { task: { id: String(id++) } }, text: 'ok' } : { result: {}, text: 'ok' },
  )

  await $.tool.call({ tool: 'TaskCreate', subject: 'Model', description: 'm' } as never)
  await $.tool.call({ tool: 'TaskCreate', subject: 'Görünüm', description: 'g' } as never)
  await $.tool.call({ tool: 'TaskUpdate', taskId: '1', status: 'completed', agentId: 'alt-1' } as never)
  await $.tool.call({ ...todos(['pending']), agentId: 'alt-1' } as never)

  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'toggle' }))?.text).toBe('▓░ 1/2 · %50 · Şu an: Görünüm')
  await ui.unmount()
})

test('session.start iki kez gelse de tek zamanlayıcı', async ($, on) => {
  const clock = mock.clock(on, { now: 3_000_000 })
  let lists = 0
  on('fs.list', () => {
    lists++
    return Promise.reject(new Error('ENOENT'))
  })
  on('fs.stat', () => Promise.reject(new Error('ENOENT')))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('command.register', () => ({ value: undefined }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }))

  // the plan files are read on the timer only once this chat engaged them
  await $.prompt.submit(prompt('.workflow/STATE.md oku, devam et'))
  const start = { cwd: '/proje', surface: 'terminal' as const, isInteractive: true }
  await $.session.start(start)
  await $.session.start(start)
  const before = lists
  await clock.advance(5000)
  expect(lists - before).toBe(1)
})

test('/clear sonrası eski görev listesi taşınmaz', async ($, on) => {
  mock.clock(on, { now: 4_000_000 })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine</Text>
  })
  on('fs.list', () => Promise.reject(new Error('ENOENT')))
  on('fs.stat', () => Promise.reject(new Error('ENOENT')))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))

  await $.tool.call(todos(['completed', 'in_progress']) as never)
  const before = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await before.find({ key: 'toggle' })).toBeDefined()
  await before.unmount()

  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never)
  const after = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect(await after.find({ key: 'toggle' })).toBeUndefined()
  expect(await after.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await after.unmount()
})

// my-skill workflow: the active plan lists tasks as `- id: T1` (no checkboxes) and the
// progress lives in .workflow/STATE.md; an older plan must not stand in for it.
test('my-skill .workflow: STATE.md ilerlemesi, eski plan devreye girmez', async ($, on) => {
  mock.clock(on, { now: 6_000_000 })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine</Text>
  })
  const files: Record<string, { source: string; mtimeMs: number }> = {
    '.workflow/plans/eski-bitti/PLAN.md': { source: '- [x] T1 — eski\n- [x] T2 — eski\n', mtimeMs: 5 },
    '.workflow/plans/eski-yarim/PLAN.md': { source: '- [x] T1 — çok eski\n- [ ] T2 — yarım kaldı\n', mtimeMs: 10 },
    '.workflow/plans/yeni/PLAN.md': { source: '# PLAN yeni\n## Phase 1\n- id: T1\n  goal: x\n- id: T2\n', mtimeMs: 30 },
    '.workflow/STATE.md': {
      source: [
        '# STATE',
        'Phase: Phase 1 (1/3)',
        '## Done',
        '- [x] T1 — form (merge f1902d64)',
        '- [x] T2 — yardım',
        '## In progress',
        '- [ ] T6 — Implement T6 (opus)',
        '- [ ] T7 — Implement T7 (opus)',
        '## Remaining',
        '- [ ] T10 — site',
        '## Decisions',
        '| # | Q | A |',
      ].join('\n'),
      mtimeMs: 40,
    },
  }
  on('fs.list', (_, e) =>
    e.path.endsWith('/.workflow/plans')
      ? { value: ['eski-bitti', 'eski-yarim', 'yeni'].map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) }
      : Promise.reject(new Error('ENOENT')),
  )
  // the engine hands hooks the path resolved against the session's cwd
  const fileAt = (path: string) => Object.entries(files).find(([name]) => path.endsWith(`/${name}`))?.[1]
  on('fs.stat', (_, e) => {
    const file = fileAt(e.path)
    return file
      ? { value: { kind: 'file' as const, size: file.source.length, mtimeMs: file.mtimeMs, isLink: false } }
      : Promise.reject(new Error('ENOENT'))
  })
  on('fs.read', (_, e) => {
    const file = fileAt(e.path)
    return file ? { value: file.source } : Promise.reject(new Error('ENOENT'))
  })
  on('tool.call', () => ({ result: {}, text: 'ok' }))

  // STATE.md is the newest file with checkboxes; `## In progress` items are the current step
  await $.tool.call({ tool: 'Edit', file_path: '.workflow/STATE.md', old_string: 'a', new_string: 'b' } as never)
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  expect((await ui.find({ key: 'toggle' }))?.text).toBe('▓▓░░░ 2/5 · %40 · Şu an: T6 — Implement T6 (opus)')
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ text: /^● T6/ }))?.text).toBe('● T6 — Implement T6 (opus)')
  expect((await ui.find({ text: /^○ T10/ }))?.text).toBe('○ T10 — site')
  await ui.unmount()

  // without STATE.md: the newest plan has no checkboxes, so nothing of ours is shown,
  // not the older half-done plan
  delete files['.workflow/STATE.md']
  await $.tool.call({ tool: 'Bash', command: 'mv .workflow/STATE.md .workflow/STATE-arsiv.md' } as never)
  const gone = await $.ui.mount({ ...BAND, surface: 'desktop' })
  expect(await gone.find({ key: 'toggle' })).toBeUndefined()
  expect(await gone.find({ type: 'Text', text: 'engine' })).toBeDefined()
  await gone.unmount()
})

// --- engagement: the plan-file bar belongs to the chat that engaged it ---

// kuran-shaped: `- id:` plan, compact Done line of `T<n> <sha>` pairs, a stale
// In progress (T48 already merged), wave labels and AUD-/K-/D-/S2/X97 noise
const KURAN_PLAN = [
  '# PLAN onarim',
  '## Phase 1: Dalga W1 (temel)',
  '- id: T0',
  '  goal: Destek dosyalarını taşı (AUD-1, AUD-2)',
  '  status: DONE (merge 923a0f26)',
  '- id: T63',
  '  goal: Arama apostrofu. İkinci cümle',
  '- id: T2',
  '  goal: Geri al görünümü',
  '## Phase 2: Dalga W4 (sürüm)',
  '- id: T1',
  '  goal: Sürüm artır',
  '- id: T15',
  '  goal: Kapı onarımı',
  '- id: T48',
  '  goal: Grup sekmesi katılma',
].join('\n')

const KURAN_STATE = [
  '# STATE',
  'Updated: 2026-10-05 (handoff)',
  'Active skill: my-skill-execute',
  'Phase: W2–W4 karışık; W1 TAMAM ama kapısı kırmızı → G1',
  'Goal: onarim PLAN.md T0..T48',
  '',
  '## Done',
  '- [x] Start-up: dal açıldı (base 77d9b3e3)',
  '- [x] Birleşen (3/6 + G1, görev sha = merge commit): T0 923a0f26 · T63 a80ac0f2 · G1 4cc4693c8 · T48 54c2ab2e5',
  '',
  '## In progress (worktree .worktrees/<id>, branch task/<id>)',
  '- T48 — uygulandı + İNCELEME PASS (64733dfdf), BİRLEŞTİRİLMEDİ → doğrudan `merge.sh T48`',
  '- T2 — uygulandı (261ddfccc) ama BLOCKING: S2 timer, AUD-47, X97, K-11, D-3; T15 bekliyor',
  '- (Remaining içinden şu an çalıştırılabilir olanlar: T1 T15 (W4))',
  '',
  '## Remaining (henüz hiç başlatılmamış)',
  '- W4: T1 T15',
  '- Zamanlayıcı: plans/onarim/exec-scripts/sched.py',
  '',
  '## Gotchas',
  '- T33→T1: W4 S2 X97 T15 T1',
  '',
  '## Files',
  '- Plan: .workflow/plans/onarim/PLAN.md',
].join('\n')

const KURAN_LINE = '▓▓▓░░░ 3/6 · %50 · Şu an: T2 · Geri al görünümü'
const HANDOFF = 'Devam ediyoruz. First read .workflow/HANDOFF.md and .workflow/STATE.md. Then invoke the `my-skill-execute` skill.'

// a project with an open my-skill job on disk; returns a handle on the session id
const kuranProject = (on: TestOn) => {
  const files: Record<string, { source: string; mtimeMs: number }> = {
    '.workflow/plans/eski/PLAN.md': { source: '- id: T1\n  goal: eski\n- id: T2\n', mtimeMs: 5 },
    '.workflow/plans/onarim/PLAN.md': { source: KURAN_PLAN, mtimeMs: 20 },
    '.workflow/STATE.md': { source: KURAN_STATE, mtimeMs: 30 },
  }
  const session = { id: 's1' }
  const toasts: string[] = []
  on('ui.toast', (_, e) => {
    toasts.push(e.text)
    return { value: undefined }
  })
  on('ui.render', ($, e) => {
    const { Text } = $.ui.resolve(e)
    return <Text key="engine">engine</Text>
  })
  on('fs.list', (_, e) =>
    e.path.endsWith('/.workflow/plans')
      ? { value: ['eski', 'onarim'].map(name => ({ name, kind: 'dir' as const, size: 0, mtimeMs: 0, isLink: false })) }
      : Promise.reject(new Error('ENOENT')),
  )
  const fileAt = (path: string) => Object.entries(files).find(([name]) => path.endsWith(`/${name}`))?.[1]
  on('fs.stat', (_, e) => {
    const file = fileAt(e.path)
    return file
      ? { value: { kind: 'file' as const, size: file.source.length, mtimeMs: file.mtimeMs, isLink: false } }
      : Promise.reject(new Error('ENOENT'))
  })
  on('fs.read', (_, e) => {
    const file = fileAt(e.path)
    return file ? { value: file.source } : Promise.reject(new Error('ENOENT'))
  })
  on('session.id', () => ({ value: session.id }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', (_, e) => ({ sessionId: e.sessionId }))
  on('command.register', () => ({ value: undefined }) as never)
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('skill.prompt', (_, e) => ({ text: e.text }))
  on('tool.call', () => ({ result: {}, text: 'ok' }))
  return { files, session, toasts }
}

const START = { cwd: '/proje', surface: 'terminal' as const, isInteractive: true }

const toggleText = async ($: TestEngine, surface: 'terminal' | 'desktop' = 'terminal') => {
  const ui = await $.ui.mount({ ...BAND, surface })
  const line = (await ui.find({ key: 'toggle' }))?.text
  const beneath = await ui.find({ type: 'Text', text: 'engine' })
  await ui.unmount()
  expect(beneath).toBeDefined()
  return line
}

test('yeni chat aynı projede: açık STATE.md olsa da bağlanana kadar çubuk yok', async ($, on) => {
  const clock = mock.clock(on, { now: 10_000_000 })
  kuranProject(on)

  await $.session.start(START)
  await clock.advance(5000)
  expect(await toggleText($)).toBeUndefined()

  // talking about something else does not engage either
  await $.prompt.submit(prompt('fix the CSS of the settings page'))
  await $.skill.prompt({ skill: 'commit', text: '' })
  await $.tool.call({ tool: 'Read', file_path: 'lib/main.dart' } as never)
  await clock.advance(5000)
  expect(await toggleText($)).toBeUndefined()

  // a task list is this chat's own: it shows with no engagement
  await $.tool.call(todos(['completed', 'pending']) as never)
  expect(await toggleText($)).toBe('▓░ 1/2 · %50 · Şu an: Adım 2')
})

test('devir prompt.submit çubuğu hemen gösterir (kuran biçimi: 3/6, şu an T2)', async ($, on) => {
  mock.clock(on, { now: 11_000_000 })
  kuranProject(on)
  await $.session.start(START)
  expect(await toggleText($)).toBeUndefined()

  await $.prompt.submit(prompt(HANDOFF, 'plugin'))
  for (const surface of ['terminal', 'desktop'] as const) expect(await toggleText($, surface)).toBe(KURAN_LINE)

  // the detail list is in plan order: done ✓, current ●, pending ○
  const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
  await ui.press({ key: 'toggle' })
  expect((await ui.find({ text: /^✓ T0/ }))?.text).toBe('✓ T0 · Destek dosyalarını taşı')
  expect((await ui.find({ text: /^✓ T48/ }))?.text).toBe('✓ T48 · Grup sekmesi katılma')
  expect((await ui.find({ text: /^● T2/ }))?.text).toBe('● T2 · Geri al görünümü')
  expect((await ui.find({ text: /^○ T15/ }))?.text).toBe('○ T15 · Kapı onarımı')
  await ui.unmount()

  // hot reload: session.start again, $.state stays, so the bar stays
  await $.session.start(START)
  expect(await toggleText($)).toBe(KURAN_LINE)
})

test('Read (alt ajan dahil) ve my-skill becerisi bağlar', async ($, on) => {
  mock.clock(on, { now: 12_000_000 })
  const { session } = kuranProject(on)

  await $.tool.call({ tool: 'Read', file_path: '.workflow/STATE.md', agentId: 'alt-1' } as never)
  expect(await toggleText($)).toBe(KURAN_LINE)

  session.id = 's2'
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never)
  expect(await toggleText($)).toBeUndefined()
  await $.tool.call({ tool: 'Read', file_path: '.workflow/STATE.md' } as never)
  expect(await toggleText($)).toBe(KURAN_LINE)

  session.id = 's3'
  await $.session.end({ reason: 'clear', sessionId: 's2', resume: { id: 's2' } } as never)
  await $.skill.prompt({ skill: 'my-skill-execute', text: '' })
  expect(await toggleText($)).toBe(KURAN_LINE)
})

test('/clear plan çubuğunu düşürür; ardından devir prompt\'u geri getirir', async ($, on) => {
  const clock = mock.clock(on, { now: 13_000_000 })
  const { session } = kuranProject(on)
  await $.session.start(START)
  await $.prompt.submit(prompt(HANDOFF))
  expect(await toggleText($)).toBe(KURAN_LINE)

  // otomatik-devir's chain: /clear (new session id) → prompt.submit of the handoff text
  session.id = 's2'
  await $.session.end({ reason: 'clear', sessionId: 's1', resume: { id: 's1' } } as never)
  expect(await toggleText($)).toBeUndefined()
  await clock.advance(5000)
  expect(await toggleText($)).toBeUndefined()

  await $.prompt.submit(prompt(HANDOFF, 'plugin'))
  expect(await toggleText($)).toBe(KURAN_LINE)
})

test('inceleme: yeni chat bitmiş planı bağlayınca ne çubuk ne "✓ Tamamlandı"', async ($, on) => {
  const clock = mock.clock(on, { now: 14_000_000 })
  const { files, toasts } = kuranProject(on)
  // every plan id merged: the job is over before this chat began
  const state = files['.workflow/STATE.md']
  if (!state) throw new Error('fixture')
  state.source = state.source.replace(
    '- [x] Birleşen (3/6 + G1, görev sha = merge commit): T0 923a0f26 · T63 a80ac0f2 · G1 4cc4693c8 · T48 54c2ab2e5',
    '- [x] Birleşen (6/6): T0 923a0f26 · T63 a80ac0f2 · T2 b1c2d3e4 · T1 c2d3e4f5 · T15 d3e4f5a6 · T48 54c2ab2e5',
  )

  await $.session.start(START)
  await $.prompt.submit(prompt(HANDOFF))
  await clock.advance(5000)
  expect(await toggleText($)).toBeUndefined()
  expect(toasts).toEqual([])
})

test('/ilerleme GİZLE ve GIZLE de çubuğu gizler, GÖSTER geri getirir', async ($, on) => {
  mock.clock(on, { now: 2_000_000 })
  on('ui.toast', () => ({ value: undefined }))
  on('ui.render', ($, e) => {
    const { Box } = $.ui.resolve(e)
    return <Box key="beneath" />
  })
  on('fs.list', () => Promise.reject(new Error('ENOENT')))
  on('fs.stat', () => Promise.reject(new Error('ENOENT')))
  on('tool.call', () => ({ result: {}, text: 'ok' }))

  await $.tool.call(todos(['completed', 'in_progress']) as never)
  const bar = async () => {
    const ui = await $.ui.mount({ ...BAND, surface: 'terminal' })
    const found = await ui.find({ key: 'toggle' })
    await ui.unmount()
    return found
  }
  expect(await bar()).toBeDefined()
  for (const hide of ['GİZLE', 'GIZLE']) {
    await $.command.run(command(hide))
    expect(await bar()).toBeUndefined()
    await $.command.run(command('GÖSTER'))
    expect(await bar()).toBeDefined()
  }
})
