import { expect, test } from 'bun:test';
import { gestureRating } from '../src/client/study';

test('only a deliberate horizontal card gesture grades a card', () => {
  expect(gestureRating(80, 12)).toBe(3);
  expect(gestureRating(-80, 12)).toBe(1);
  expect(gestureRating(12, 80)).toBeNull();
  expect(gestureRating(63, 0)).toBeNull();
  expect(gestureRating(70, 65)).toBeNull();
  expect(gestureRating(0, 0)).toBeNull();
});
