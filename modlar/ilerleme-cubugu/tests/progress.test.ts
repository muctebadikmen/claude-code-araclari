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
