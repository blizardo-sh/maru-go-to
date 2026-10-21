import { expect, test } from 'bun:test';
import { isCurrentAnalysis, shuffledTokens } from '../src/client/study';

test('a late response for A cannot become the analysis of edited phrase B', () => {
  expect(isCurrentAnalysis({ revision: 1, text: 'A' }, 2, 'B')).toBe(false);
  expect(isCurrentAnalysis({ revision: 2, text: 'A' }, 2, 'B')).toBe(false);
  expect(isCurrentAnalysis({ revision: 2, text: 'B' }, 2, 'B')).toBe(true);
});


test('exercise bank shuffle keeps both repeated-particle instances and leaves the source order intact', () => {
  const ids = ['wa-1', 'word', 'wa-2', 'verb'];
  const bank = shuffledTokens(ids);
  expect([...bank].sort()).toEqual([...ids].sort());
  expect(new Set(bank).size).toBe(ids.length);
  expect(ids).toEqual(['wa-1', 'word', 'wa-2', 'verb']);
  expect(shuffledTokens([])).toEqual([]);
});
