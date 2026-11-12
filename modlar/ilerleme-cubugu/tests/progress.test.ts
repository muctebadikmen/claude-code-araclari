import { expect, test } from 'claude-code/testing'

import {
  genericSteps,
  ledgerUnread,
  leadIds,
  mergeProgress,
  mySkillSteps,
  parseMsPlan,
  parseProgress,
  parseState,
  planDirsFromState,
} from '../hooks/progress'

// The pure parsers (spec: .workflow/research/progress-formats.md §7 fixtures).

const PLAN = [
  '# PLAN',
  '## Phase 1: Dalga W1',
  '- id: T0',
  '  goal: Destek dosyalarını taşı (AUD-1)',
  '- id: T1',
  '  goal: Arama apostrofu. Ikinci cümle',
  '  status: DONE (merge abc1234)',
  '- id: T2',
  '  goal: Geri al görünümü',
  '- id: T3',
  '  goal: Sürüm artır',
  '- id: G1',
  '  goal: Kapı onarımı',
].join('\n')

type Step = { id: string; content: string; status: string }

const summary = (steps: Step[]) => {
  const done = steps.filter(one => one.status === 'completed').length
  const current = steps.find(one => one.status === 'in_progress') ?? steps.find(one => one.status !== 'completed')
  return {
    done,
    total: steps.length,
    running: steps.filter(one => one.status === 'in_progress').map(one => one.id),
    current: current?.content,
  }
}

const mySkill = (state: string, source = PLAN) => {
  const plan = parseMsPlan(source)
  if (!plan) throw new Error('plan not parsed')
  return summary(mySkillSteps(plan, parseState(state, new Set(plan.ids))))
}

test('plan: id satırları, goal başlıkları, status: DONE', async () => {
  const plan = parseMsPlan(PLAN)
  expect(plan?.ids).toEqual(['T0', 'T1', 'T2', 'T3', 'G1'])
  expect(plan?.titles.get('T0')).toBe('Destek dosyalarını taşı')
  expect(plan?.titles.get('T1')).toBe('Arama apostrofu')
  expect([...(plan?.done ?? [])]).toEqual(['T1'])
  expect(parseMsPlan('- id: T1\n  goal: tek')).toBeUndefined()
  expect(parseMsPlan('- id: <name>\n- id: <name>')).toBeUndefined()
  expect(parseMsPlan('- id: T5\n- id: T5a\n- id: T66i')?.ids).toEqual(['T5', 'T5a', 'T66i'])
  // a ledger of `- [x] T<n> — …` marks those ids done
  expect([...(parseMsPlan('- id: T1\n- id: T2\n## İlerleme\n- [x] T1 — bitti\n- [ ] T2 — sırada')?.done ?? [])]).toEqual(['T1'])
})

test('F1: sıkışık Done satırı + gürültü', async () => {
  const state = [
    'Active skill: my-skill-execute',
    '## Done',
    '- [x] Start-up: dal açıldı',
    '- [x] Birleşen (3/5): T0 923a0f26 · T1 9f8e7d6c · G1 4cc4693c8',
    '## In progress',
    '- T2 — uygulandı, inceleme DAĞITILMADI (blocked by AUD-47, T3; S2 timer, X97, K-1, D-3)',
    '## Remaining',
    '- W4: T3 T9',
    '## Gotchas',
    '- T3→T2: …W4 S2 T3…',
  ].join('\n')
  expect(mySkill(state)).toEqual({ done: 3, total: 5, running: ['T2'], current: 'T2 · Geri al görünümü' })
})

test('F2: Done kazanır (bayat In progress)', async () => {
  const state = [
    'Active skill: my-skill-execute',
    '## Done',
    '- [x] Birleşen: T0 923a0f26 · T1 9f8e7d6c',
    '## In progress',
    '- T1 — rapor geldi (stale)',
    '## Remaining',
    '- W2: T2 T3 G1',
  ].join('\n')
  expect(mySkill(state)).toEqual({ done: 2, total: 5, running: [], current: 'T2 · Geri al görünümü' })
})

test('F3: şablon Done satırları ve baş listeleri', async () => {
  const state = [
    'Active skill: my-skill-execute',
    '## Done',
    '- [x] T0 — taşındı (923a0f2)',
    '- [x] T1, T2 — birleşti',
    '## Remaining',
    '- T3 — sürüm',
    '- W9: G1',
  ].join('\n')
  expect(mySkill(state)).toEqual({ done: 3, total: 5, running: [], current: 'T3 · Sürüm artır' })
  expect(leadIds('W4: T1 T15 T18', new Set(['T1', 'T15', 'T18']))).toEqual(['T1', 'T15', 'T18'])
  expect(leadIds('T2 — blocked by AUD-47 and T3 (S2 timer)', new Set(['T2', 'T3']))).toEqual(['T2'])
  expect(leadIds('(Remaining içinden: T2 T3)', new Set(['T2', 'T3']))).toEqual([])
})

test('F6: iş yok — bitti, başlamadı; orchestrate açıkken sürüyor', async () => {
  const finished = 'Phase: TAMAMLANDI — rapor hazır\nActive skill: none\n## Done\n- [x] T0 — a (923a0f2)\n## In progress\n'
  expect(mySkill(finished).total).toBe(0)
  const unstarted = 'Phase: Plan (0/5)\nActive skill: my-skill-masterplan\n## Remaining\n- W1: T0 T1\n'
  const fresh = PLAN.replace('  status: DONE (merge abc1234)\n', '')
  expect(mySkill(unstarted, fresh).total).toBe(0)
  // nothing done yet, but execute is running it: shown
  const execute = 'Active skill: my-skill-execute\n## Remaining\n- W1: T0 T1\n'
  expect(mySkill(execute, fresh)).toMatchObject({ done: 0, total: 5, current: 'T0 · Destek dosyalarını taşı' })
  const orchestrate = 'Phase: Diagnose + spec (1/3)\nActive skill: none (orchestrate)\n## In progress\n- T2 — sürüyor\n'
  expect(mySkill(orchestrate)).toMatchObject({ done: 1, total: 5, running: ['T2'] })
})

test('plan dizini: STATE Plan: satırı > plans/<dir>/PLAN.md anışı > Goal ipucu', async () => {
  const dirs = ['eski', 'onarim', 'yeni']
  expect(planDirsFromState('## Files\n- Plan: .workflow/plans/onarim/PLAN.md\n', dirs)).toEqual(['onarim'])
  expect(planDirsFromState('bkz. plans/eski/PLAN.md\n## Files\n- plans/yeni/PLAN.md\n', dirs)).toEqual(['yeni', 'eski'])
  expect(planDirsFromState('# STATE\nGoal: onarim PLAN.md T0..T135\n## Done\n', dirs)).toEqual(['onarim'])
  expect(planDirsFromState('- Plan: .workflow/plans/yok/PLAN.md\n', dirs)).toEqual([])
})

test('genel merdiven: kutucuklar, numaralı başlıklar, numaralı liste, STATE maddeleri', async () => {
  // F4: [~] is running, [-] is dropped
  expect(summary(genericSteps('- [x] a\n- [x] b\n- [ ] c\n- [~] d\n- [ ] e\n- [-] f\n', false))).toMatchObject({
    done: 2,
    total: 5,
    current: 'd',
  })
  // F5 headings
  expect(summary(genericSteps('## 1. Schema ✅\n## 2. API 🔄\n## 3. UI\n## Notes\n', false))).toMatchObject({
    done: 1,
    total: 3,
    current: 'API 🔄',
  })
  // F5 ordered list
  expect(summary(genericSteps('1. ~~Install deps~~\n2. Build [done]\n3. Test\n4. Ship\n', false))).toMatchObject({
    done: 2,
    total: 4,
    current: 'Test',
  })
  // a numbered list with no status marker is prose
  expect(genericSteps('# Notes\n1. one\n2. two\n3. three\n', false)).toEqual([])
  // generic STATE: open box under an in-progress heading is running (Turkish heading)
  expect(summary(genericSteps('## Tamamlanan\n- [x] a\n## Devam ediyor\n- [ ] b\n## Kalan\n- [ ] c\n', true))).toMatchObject({
    done: 1,
    total: 3,
    running: ['plan-3'],
  })
  // generic STATE without boxes: plain bullets under known sections
  expect(summary(genericSteps('## Done\n- a\n## In progress\n- b\n## Notes\n- not a step\n', true))).toMatchObject({
    done: 1,
    total: 2,
    current: 'b',
  })
  expect(genericSteps('## Done\n- a\n## In progress\n- b\n', false)).toEqual([])
})

test('inceleme: iç içe kutucuklar sayılır, "tamamlanmadı" bitti sayılmaz', async () => {
  // nested sub-task boxes (4-space and tab indent) count, as before the my-skill parser
  expect(summary(genericSteps('- [x] a\n    - [x] a1\n    - [ ] a2\n\t- [ ] a3\n- [ ] b\n', false))).toMatchObject({
    done: 2,
    total: 5,
    current: 'a2',
  })
  // "tamamlanmadı" (not finished) and "tamamen" are not done marks; whole words are
  expect(summary(genericSteps('1. Şema tamamlandı\n2. API tamamlanmadı\n3. UI tamamen yeni\n4. Test bitti\n', false))).toMatchObject({
    done: 2,
    total: 4,
    current: 'API tamamlanmadı',
  })
  const plan = parseMsPlan('- id: T1\n  status: tamamlanmadı\n- id: T2\n  status: tamamlandı\n- id: T3\n  status: DONE (abc1234)')
  expect([...(plan?.done ?? [])]).toEqual(['T2', 'T3'])
})

const sorted = (set: Set<string>) => [...set].sort()

test('PROGRESS.md defteri: [x] [~] [>] [/] [!] [-] [ ], yalnız planın kimlikleri', async () => {
  const ids = new Set(['T1', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7', 'T12'])
  const ledger = [
    '# progress',
    '## Phase 0',
    '- [x] T1 — 97e8e0eb — dev: none',
    '  - [x] T12 — 92c9f37d — nested, any indent',
    '- [~] T2 — running',
    '- [>] T3 — running',
    '- [/] T4 — running',
    '- [!] T5 — BLOCKED on owner',
    '- [-] T6 — retired',
    '- [ ] T7 —',
    '- [x] T99 — not in the plan',
    '- [x] T1a — another id',
    '- [x] T5–T7 — a range names no id',
    '- [x] AT2 — other prefix',
  ].join('\n')
  const got = parseProgress(ledger, ids)
  expect(sorted(got.done)).toEqual(['T1', 'T12'])
  expect(sorted(got.inProgress)).toEqual(['T2', 'T3', 'T4'])
  expect(sorted(got.blocked)).toEqual(['T5'])
  expect(sorted(got.dropped)).toEqual(['T6'])
  expect(got.marksRunning).toBe(true)
  // marked twice: done beats running
  expect(sorted(parseProgress('- [~] T2 — a\n- [x] T2 — b', ids).inProgress)).toEqual([])
  expect(parseProgress('- [x] T1 — a\n- [ ] T2 —', ids).marksRunning).toBe(false)
})

test('PROGRESS.md defteri: notlardaki "; T4" kuyruğu T4\'ü bitirmez', async () => {
  const ids = new Set(['T3', 'T4', 'T12'])
  const got = parseProgress('- [x] T3 — abc123 — dev: none; T4\n- [x] **T12** — def456', ids)
  expect(sorted(got.done)).toEqual(['T12', 'T3'])
})

test('PROGRESS + STATE: düşen görev toplamdan çıkar, geçiş dönemi STATE koşanları', async () => {
  const plan = parseMsPlan(PLAN)
  if (!plan) throw new Error('plan not parsed')
  const ids = new Set(plan.ids)
  const state = parseState(
    'Active skill: my-skill-execute\n## Done\n- (ledger: PROGRESS.md)\n## In progress\n- Running: T0, T2 (x); T3 (y)\n',
    ids,
  )
  // no running mark in the ledger: STATE's In progress less the ledger's done / dropped / blocked
  const ledger = parseProgress('- [x] T0 — abc1234\n- [-] G1 — retired\n- [!] T3 — owner\n', ids)
  expect(summary(mySkillSteps(plan, mergeProgress(ledger, state)))).toEqual({
    done: 2, // T0 from the ledger, T1 from PLAN.md's own status: DONE
    total: 4,
    running: ['T2'],
    current: 'T2 · Geri al görünümü',
  })
  // a running mark in the ledger: STATE's In progress no longer counts
  const marked = parseProgress('- [x] T0 — abc1234\n- [~] T3 — now\n', ids)
  expect(summary(mySkillSteps(plan, mergeProgress(marked, state))).running).toEqual(['T3'])
  // terminal phase with nothing running still hides the bar, as without a ledger
  const finished = parseState('Phase: TAMAMLANDI\nActive skill: none\n', ids)
  expect(mySkillSteps(plan, mergeProgress(ledger, finished))).toEqual([])
})

test('In progress: noktalı virgülden sonraki çıplak liste, etiket notu, BLOCKED satırı', async () => {
  const ids = new Set(['T21', 'T23', 'T24', 'T65', 'T90', 'T134', 'T175', 'T241', 'T244', 'T245', 'T253', 'T260', 'T267', 'T269', 'T300'])
  const state = [
    '## In progress',
    '- Implementers running: T65, T244, T21, T23 (from session 2); T90, T300, T267, T269, T260 (base e92bb69c).',
    '- Session 4 in flight (ids in .workflow/dispatch/agents-v3.txt): implementers T134, T175, T241 (base 38a40fc0); fix/doc-echo (T24 residual gaps).',
    '- BLOCKED on owner: T245, T253',
    '- Gate blockers: G1 (T24) needs owner decisions T245 + T253',
  ].join('\n')
  expect(sorted(parseState(state, ids).inProgress)).toEqual(
    ['T21', 'T23', 'T65', 'T90', 'T134', 'T175', 'T241', 'T244', 'T260', 'T267', 'T269', 'T300'].sort(),
  )
  // a later clause with prose is no list: "T2 … ; T15 bekliyor" stays T2
  expect(leadIds('T2 — BLOCKING: S2 timer; T15 bekliyor', new Set(['T2', 'T15']))).toEqual(['T2'])
})

test('güvenlik ağı: execute koşuyor, Done dolu ama planın kimliği yok', async () => {
  const ids = new Set(['T1', 'T2'])
  const unread = parseState('Active skill: my-skill-execute\n## Done\n- (ledger elsewhere)\n## In progress\n- T2 — x\n', ids)
  expect(ledgerUnread(unread)).toBe(true)
  expect(ledgerUnread(parseState('Active skill: my-skill-execute\n## Done\n- [x] T1 — abc1234\n', ids))).toBe(false)
  expect(ledgerUnread(parseState('Active skill: my-skill-execute\n## Done\n\n## In progress\n', ids))).toBe(false)
  expect(ledgerUnread(parseState('Active skill: none\n## Done\n- (ledger elsewhere)\n', ids))).toBe(false)
})

// --- 0.4.0 fixes: I1 (plan dir), I3b (ended STATE), I4 (Done crediting), I5 (safety net) ---

test('I1: Plan: satırı süslü parantez biçimi ve çıplak plans/<dizin>/ anışı dizini bulur', async () => {
  const dirs = ['eski', 'yeni']
  // a template-shaped STATE: header first, so the header/Goal hint cannot name the dir
  const at = (body: string) => `# STATE\nActive skill: my-skill-execute\nGoal: bir iş\n\n${body}`
  expect(planDirsFromState(at('## Files\n- Plan: .workflow/plans/eski/{PLAN,PROMPT,PROGRESS}.md\n'), dirs)).toEqual(['eski'])
  expect(planDirsFromState(at('## Files\n- Plan: .workflow/plans/eski/\n'), dirs)).toEqual(['eski'])
  expect(planDirsFromState(at('## Done\n- Progress: .workflow/plans/yeni/PROGRESS.md — 1/3 merged\n'), dirs)).toEqual(['yeni'])
  expect(planDirsFromState(at('## Gotchas\n- bkz. plans/yeni/ klasörü\n'), dirs)).toEqual(['yeni'])
  // the Plan: line wins even when another dir is mentioned more often
  const both = at('## Done\n- Progress: .workflow/plans/yeni/PROGRESS.md\n- yeni: plans/yeni/ \n## Files\n- Plan: .workflow/plans/eski/{PLAN,PROGRESS}.md\n')
  expect(planDirsFromState(both, dirs)[0]).toBe('eski')
  // dirs that do not exist are still ignored
  expect(planDirsFromState(at('- Plan: .workflow/plans/yok/{PLAN,PROGRESS}.md\n'), dirs)).toEqual([])
})

test('I3b: biten iş başlığı olan STATE.md genel merdivenden adım vermez', async () => {
  const boxes = '## Done\n- [x] a\n## Remaining\n- [ ] b\n- [ ] c\n'
  expect(genericSteps(boxes, true)).toHaveLength(3)
  for (const header of [
    'Phase: T21 bitti\nActive skill: none',
    'Phase: DONE (3/3)',
    'Phase: SAMPLE BUILD DONE 2026-11-10',
    'Phase: SAMPLE BUILD DONE 2026-11-10 (alan açık, 38 kayıt eklendi). Next: onay',
    'Active skill: none — shipped',
    'Active skill: none (waiting on client)',
    'Phase: Tamamlandı',
    'Phase: v3 COMPLETE',
    'Phase: yayında, PUBLISHED',
  ]) {
    expect(genericSteps(`${header}\n${boxes}`, true), header).toEqual([])
  }
  // still open: a running phase, orchestrate, a fraction that is not full, "done" inside prose
  for (const header of [
    'Phase: Execute (1/3)',
    'Active skill: none (orchestrate)\nPhase: Diagnose (1/3)',
    'Active skill: my-skill-execute\nPhase: Execute',
    'Phase: W1 TAMAM ama kapısı kırmızı',
    'Phase: 2 (done 1/3)',
  ]) {
    expect(genericSteps(`${header}\n${boxes}`, true), header).toHaveLength(3)
  }
  // other files are never judged by this header rule
  expect(genericSteps(`Phase: DONE (3/3)\n${boxes}`, false)).toHaveLength(3)
})

test('I4: Done iç içe maddeleri, aralıklar (T2–T19) ve In progress altındaki [x]', async () => {
  const ids = new Set(Array.from({ length: 30 }, (_, i) => `T${i + 1}`))
  const state = parseState(
    [
      '## Done',
      '- T1 spike PASS',
      '  - T2–T4, T6-T8 merged',
      '      - T10..T12 merged (nested deeper)',
      '        - T20 too deep to count',
      '- T14 → T15 ve T28—T30 tamam',
      '## In progress',
      '- [x] T22 — SIGNED OFF',
      '- [ ] T23 — koşuyor',
      '  - T24 nested notes under In progress stay out',
    ].join('\n'),
    ids,
  )
  expect([...state.done].sort((a, b) => Number(a.slice(1)) - Number(b.slice(1))).join(' ')).toBe(
    'T1 T2 T3 T4 T6 T7 T8 T10 T11 T12 T14 T15 T22 T28 T29 T30',
  )
  expect([...state.inProgress]).toEqual(['T23'])
  // a range outside the plan's ids credits only what the plan has; the expansion is capped
  const wide = parseState('## Done\n- T1–T99999 merged\n', new Set(['T1', 'T500', 'T501']))
  expect([...wide.done].sort()).toEqual([])
  // different prefixes are no range
  expect(parseState('## Done\n- T1–U3 x\n', new Set(['T1', 'T2', 'U3'])).done.has('T2')).toBe(false)
  // nested bullets are not extra steps for the generic STATE reader
  expect(genericSteps('## Done\n- a\n  - sub\n## Remaining\n- b\n', true)).toHaveLength(2)
})

test('I5: yalnız kimliksiz kurulum satırı olan Done güvenlik ağını tetiklemez', async () => {
  const ids = new Set(['T1', 'T2'])
  const head = 'Active skill: my-skill-execute\n'
  // a checked setup line with no task id (branch, base) is no ledger the bar failed to read
  expect(ledgerUnread(parseState(`${head}## Done\n- [x] Branch + BASE kaydı (1a2b3c4d)\n## In progress\n- T2 — x\n`, ids))).toBe(false)
  // ids that are not the plan's: unreadable
  expect(ledgerUnread(parseState(`${head}## Done\n- [x] Branch + BASE (1a2b3c4d)\n- [x] Z9 — başka plan\n`, ids))).toBe(true)
  // a plan id present: read, no warning
  expect(ledgerUnread(parseState(`${head}## Done\n- [x] Branch (1a2b3c4d)\n- [x] T1 — abc1234\n`, ids))).toBe(false)
})

// --- round 2 (review): bounded ranges, open-when-in-doubt headers, plan-dir order, nested Done ---

test('R2-1: aralık genişletme sınırlı: dev sayılar, ters aralık, 500\'den geniş aralık hiçbir şey saymaz', async () => {
  const ids = new Set(['T1', 'T2', 'T3', 'T500'])
  const credited = (done: string) => [...parseState(`## Done\n- ${done}\n`, ids).done].sort()
  expect(credited('T9007199254740993-T9007199254741999 merged')).toEqual([])
  expect(credited(`T${'9'.repeat(320)}-T${'9'.repeat(320)} merged`)).toEqual([])
  expect(credited('T3-T1 merged')).toEqual([])
  expect(credited('T2-T2 merged')).toEqual([])
  expect(credited('T1–T99999 merged')).toEqual([])
  expect(credited('T1–T500 merged')).toEqual(['T1', 'T2', 'T3', 'T500'])
  expect(credited('T1..T3 merged')).toEqual(['T1', 'T2', 'T3'])
})

test('R2-2: şüphede iş AÇIK sayılır; yalnız gerçekten biten başlık çubuğu gizler', async () => {
  const boxes = '## Done\n- [x] a\n## Remaining\n- [ ] b\n- [ ] c\n'
  const steps = (header: string) => genericSteps(`${header}\n${boxes}`, true).length
  for (const header of [
    'Phase: Complete the migration',
    'Phase: done-criteria review (1/4)',
    'Phase: done-criteria review',
    'Phase: published checklist',
    'Phase: shipping prep (2/3)',
    'Phase: Faz 3 tamamlandı (Faz 4 sürüyor)',
    'Active skill: my-skill-execute\nPhase: Execute — T12 DONE',
    'Phase: Execute T21 done (T22 next)',
    'Phase: Execute (3/5)',
    'Phase: site-v2 build (2/4)',
    'Active skill: my-skill-audit\nPhase: mods audit — report delivered (6/6)',
    'Active skill: none\nPhase: Execute (2/5)',
    'Active skill: none-yet',
    'Phase: v1 shipped 2026-11-10 (v2 in progress)',
  ]) {
    expect(steps(header), header).toBe(3)
  }
  for (const header of [
    'Active skill: none',
    'Active skill: none — shipped',
    'Active skill: none (waiting on client)',
    'Active skill: none (orchestrate)',
    'Phase: DONE (3/3)',
    'Active skill: none\nPhase: T21 bitti',
    'Active skill: orchestrate (örnek)\nPhase: SAMPLE BUILD DONE 2026-11-10 (alan açık)',
  ]) {
    expect(steps(header), header).toBe(0)
  }
})

// --- round 3: a done word next to a running word, or after a part label, ends only that part ---

test('R3-1: bitti kelimesinin yanında süren iş sözü ya da parça etiketi işi AÇIK tutar', async () => {
  const boxes = '## Done\n- [x] a\n## Remaining\n- [ ] b\n- [ ] c\n'
  const steps = (header: string) => genericSteps(`${header}\n${boxes}`, true).length
  const orch = 'Active skill: my-skill-orchestrate\n'
  for (const header of [
    // N1: a running word after the done word (before the first `.` or `(`) or before it
    `${orch}Phase: tamamlandı — Faz 4 başlıyor`,
    'Active skill: orchestrate\nPhase: Audit DONE 2026-11-12, fixes next',
    `${orch}Phase: Review done, verifying`,
    'Active skill: orchestrate\nPhase: next: deploy; build done',
    `${orch}Phase: DONE — sıradaki T4`,
    `${orch}Phase: shipped, 2 remaining`,
    // N1: the done word right after a part label finishes only that part
    `${orch}Phase: Execute — Faz 2 tamamlandı`,
    'Active skill: orchestrate\nPhase: Execute — T3 bitti',
    `${orch}Phase: Faz 1 DONE`,
    'Active skill: orchestrate (site build)\nPhase: Wave A done',
    'Active skill: my-skill-ship\nPhase: Wave 2 shipped',
    'Active skill: orchestrate\nPhase: F1b done',
    'Active skill: orchestrate\nPhase: Step 3 complete',
    // the review's required-open lines and its adversarial lines, still open
    'Phase: Complete the migration',
    'Phase: done-criteria review (1/4)',
    'Phase: done-criteria review',
    'Phase: published checklist',
    'Phase: shipping prep (2/3)',
    'Phase: Faz 3 tamamlandı (Faz 4 sürüyor)',
    'Active skill: my-skill-execute\nPhase: Execute — T12 DONE',
    'Phase: Execute T21 done (T22 next)',
    'Phase: Execute (3/5)',
    'Phase: site-v2 build (2/4)',
    'Active skill: my-skill-audit\nPhase: mods audit — report delivered (6/6)',
    'Active skill: orchestrate\nPhase: wave 1 DONE, wave 2 running',
    'Active skill: my-skill-ship\nPhase: Build done; deploy pending',
    'Active skill: orchestrate\nPhase: Review completed (fixes todo)',
    'Active skill: my-skill-ship\nPhase: done · now verifying',
    'Active skill: none-yet\nPhase: Execute (5/5) done, verify next',
  ]) {
    expect(steps(header), header).toBe(3)
  }
  for (const header of [
    'Active skill: none',
    'Active skill: none — shipped',
    'Active skill: none (waiting on client)',
    'Phase: DONE (3/3)',
    'Active skill: none\nPhase: T21 bitti',
    // "Active skill: none" alone ends the job, part label or not
    'Active skill: none\nPhase: Wave 2 shipped',
    // `Next` after the first `.` is a note about later work, not this job
    'Active skill: orchestrate\nPhase: REBUILD DONE 2026-11-10 (details here). Next: owner to-dos',
    'Phase: v3 COMPLETE',
    'Active skill: orchestrate\nPhase: v3 COMPLETE',
  ]) {
    expect(steps(header), header).toBe(0)
  }
})

test('R2-3: plan dizini sırası: Plan: satırı, sonra başlıktaki anış, sonra gövde; sayıma bakılmaz', async () => {
  const dirs = ['eski', 'guncel']
  const state = [
    '# STATE',
    'Progress: .workflow/plans/guncel/PROGRESS.md — 4 [x]',
    '## Done',
    '- bitti: plans/guncel/PROGRESS.md',
    '## Files',
    '- Arşiv: .workflow/plans/eski/PLAN.md',
    '- eski notlar: plans/eski/tools/ ve plans/eski/PROMPT.md',
  ].join('\n')
  expect(planDirsFromState(state, dirs)).toEqual(['guncel', 'eski'])
  // a Plan: line still wins over the header
  expect(planDirsFromState(`${state}\n- Plan: .workflow/plans/eski/{PLAN,PROGRESS}.md`, dirs)[0]).toBe('eski')
})

test('R2-4: iç içe Done maddesi "T2 blocked" T2\'yi bitirmez; I5: sayısal kimlikli defter uyarır', async () => {
  const ids = new Set(['T1', 'T2', 'T3'])
  const state = parseState('## Done\n- T1 merged\n  - T2 blocked on owner\n  - T3 merged\n', ids)
  expect([...state.done].sort()).toEqual(['T1', 'T3'])
  const head = 'Active skill: my-skill-execute\n'
  expect(ledgerUnread(parseState(`${head}## Done\n- [x] 12 — abc1234\n- [x] 13 — bcd2345\n`, ids))).toBe(true)
  expect(ledgerUnread(parseState(`${head}## Done\n- [x] Branch + BASE kaydı (1a2b3c4d)\n`, ids))).toBe(false)
})
