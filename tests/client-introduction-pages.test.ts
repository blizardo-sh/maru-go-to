import { expect, test } from 'bun:test';
import { introductionPages } from '../src/client/canvas/album-intro';

test('explanations keep every word, paragraph and Japanese example when paged', () => {
  const copy = 'Вежливое приветствие утром.\n\nおはようございます、せんせい。\nДоброе утро, учитель.';
  const pages = introductionPages(copy, 32, text => text.length);
  expect(pages.length).toBeGreaterThan(1);
  expect(pages.every(page => page.length <= 32)).toBe(true);
  expect(pages.join(' ').replace(/\s+/g, ' ')).toBe(copy.replace(/\s+/g, ' '));
  expect(introductionPages(copy, 500, text => text.length)).toEqual([copy]);
  expect(introductionPages('', 40, text => text.length)).toEqual(['']);
});
