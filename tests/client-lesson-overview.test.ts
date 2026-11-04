import { describe, expect, test } from 'bun:test';
import type { LearningState } from '../src/shared/learning';
import { confirmedStages, lessonPagePlan, stageSummary } from '../src/client/canvas/lesson-overview';

const parts = [{ partId: 'a', totalSteps: 10 }, { partId: 'b', totalSteps: 30 }];
const saved = (patch: Partial<LearningState>) => patch as LearningState;
describe('server-confirmed lesson stage display', () => {
  test('new lesson has empty segments with route totals', () => {
    expect(confirmedStages(parts)).toEqual(parts.map(part => ({ ...part, completedSteps: 0 })));
    expect(stageSummary(confirmedStages(parts))).toEqual({ percent: 0, finished: 0, count: 2 });
  });
  test('keeps equal stage segments and their partial fills', () => {
    const stages = confirmedStages(parts, saved({ partProgress: [{ partId: 'b', completedSteps: 5, totalSteps: 30 }, { partId: 'a', completedSteps: 10, totalSteps: 10 }] }));
    expect(stageSummary(stages)).toEqual({ percent: 58, finished: 1, count: 2 });
  });
  test('uses the pinned route boundaries when the current catalog has changed', () => {
    const pinned = [{ partId: 'old-first', completedSteps: 8, totalSteps: 8 }, { partId: 'old-second', completedSteps: 0, totalSteps: 4 }, { partId: 'old-third', completedSteps: 3, totalSteps: 3 }];
    expect(confirmedStages(parts, saved({ partProgress: pinned }))).toEqual(pinned);
    expect(stageSummary(confirmedStages(parts, saved({ partProgress: pinned })))).toEqual({ percent: 67, finished: 2, count: 3 });
  });
  test('does not invent stage progress from a cursor or total alone', () => {
    expect(stageSummary(confirmedStages(parts, saved({ partIndex: 1, completedSteps: 15 })))).toEqual({ percent: 0, finished: 0, count: 2 });
  });
  test('completed legacy state fills stages; malformed counts are bounded', () => {
    expect(stageSummary(confirmedStages(parts, saved({ completed: true })))).toEqual({ percent: 100, finished: 2, count: 2 });
    expect(confirmedStages(parts, saved({ partProgress: [{ partId: 'a', completedSteps: 50, totalSteps: 10 }, { partId: 'b', completedSteps: -5, totalSteps: 30 }] })).map(p => p.completedSteps)).toEqual([10, 0]);
  });
});
describe('lesson leaves without scrolling', () => {
  test('all 18 lessons fit a normal desktop spread', () => {
    expect(lessonPagePlan(18, 2, 458, 44.1)).toMatchObject({ capacity: 18, pages: 1 });
    expect(lessonPagePlan(18, 2, 624, 44.1)).toMatchObject({ capacity: 18, pages: 1 });
  });
  test('short leaves cover all lessons once, without exceeding their height', () => {
    for (const [sides, height, row] of [[1, 300, 72], [2, 180, 48], [1, 450, 64]]) {
      const plan = lessonPagePlan(18, sides!, height!, row!);
      const visited = Array.from({ length: plan.pages }, (_, page) => Array.from({ length: plan.capacity }, (_, index) => page * plan.capacity + index).filter(index => index < 18)).flat();
      expect(visited).toEqual(Array.from({ length: 18 }, (_, i) => i));
      expect(plan.rows * row! + (plan.rows - 1) * 4).toBeLessThanOrEqual(height!);
    }
  });
});
