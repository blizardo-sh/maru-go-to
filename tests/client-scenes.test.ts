import { expect, test } from 'bun:test';
import { chooseScene, sceneIds } from '../src/client/scenes';
import { selectSceneDecor } from '../src/client/sceneDecor';
import { companionState, type CardActivity } from '../src/client/companion';

test('the five scenes have equal random intervals and may repeat across new sessions', () => {
  const counts = new Map(sceneIds.map(id => [id, 0]));
  for (let index = 0; index < 100; index++) { const scene = chooseScene(() => (index + .5) / 100); counts.set(scene, counts.get(scene)! + 1); }
  expect([...counts.values()]).toEqual([20, 20, 20, 20, 20]);
  expect(chooseScene(() => .99)).toBe(chooseScene(() => .99));
  expect(chooseScene(() => 0)).toBe('room');
});

test('draft feedback never turns into saved success and stale card activity cannot follow a transition', () => {
  const activity: CardActivity = { reviewId: 'old-card', activity: 'draft-correct', key: 'old:4' };
  expect(companionState({ reviewId: 'old-card', activity, feedback: null, completed: 0, total: 2 }).pose).toBe('explain');
  expect(companionState({ reviewId: 'next-card', activity, feedback: null, completed: 1, total: 2 }).pose).toBe('neutral');
  expect(companionState({ reviewId: 'next-card', activity, feedback: { kind: 'good', attemptId: 'confirmed-attempt' }, completed: 1, total: 2 })).toMatchObject({ pose: 'success', key: 'confirmed-attempt' });
  expect(companionState({ reviewId: 'next-card', activity, feedback: { kind: 'again', attemptId: 'confirmed-again' }, completed: 1, total: 2 }).pose).toBe('encourage');
});

test('only a real completed nonempty plan rests; active audio stays attentive', () => {
  expect(companionState({ activity: null, feedback: null, completed: 0, total: 0 }).activity).toBe('idle');
  expect(companionState({ activity: null, feedback: null, completed: 2, total: 2 }).activity).toBe('complete');
  expect(companionState({ reviewId: 'audio', activity: { reviewId: 'audio', activity: 'listening', key: 'audio:playing' }, feedback: { kind: 'good', attemptId: 'previous' }, completed: 1, total: 3 }).activity).toBe('listening');
});


test('scene decoration follows local clock boundaries and offers valid sets in all five worlds', () => {
  const cases = [[5, 'evening'], [6, 'morning'], [11, 'morning'], [12, 'day'], [17, 'day'], [18, 'evening'], [23, 'evening']] as const;
  for (const [hour, period] of cases) expect(selectSceneDecor('room', new Date(2026, 9, 21, hour, 0)).period).toBe(period);
  const allowed = new Set(['brushes', 'inkstone', 'tea', 'teapot', 'dango', 'sakura-mochi', 'dorayaki', 'linen']);
  const seen = new Set<string>();
  for (const scene of sceneIds) for (const hour of [6, 12, 18]) {
    const decor = selectSceneDecor(scene, new Date(2026, 9, 21, hour, 0));
    expect(decor.props).toHaveLength(4); expect(new Set(decor.props).size).toBe(4);
    for (const prop of decor.props) { expect(allowed.has(prop)).toBe(true); seen.add(prop); }
  }
  expect(seen).toEqual(allowed);
});
