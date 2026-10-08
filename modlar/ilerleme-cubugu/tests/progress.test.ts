import { expect, test } from 'claude-code/testing'

import {
  genericSteps,
  leadIds,
  mySkillSteps,
  parseMsPlan,
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
