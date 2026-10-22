import { expect, test } from 'bun:test';
import { advanceCounter, counterDefinitions, counterKinds, counterReading, counterTarget, counterWords, makeCounterCard, numberReading, numbersFor, objectFor, parseCounterTarget, readingVariants, type CounterHistory, type CounterId, type CounterProgress } from '../src/shared/counters';
import { counterAudio } from '../src/server/counter-audio';
import { course } from '../src/shared/course';
import { advanceDeck } from '../src/client/study';
import type { ReviewItem } from '../src/shared/types';

test('Marugoto A1 tables: all seven counters preserve the authored readings 1–10', () => {
  const readings: Record<CounterId, string[]> = {
    mai: 'いちまい にまい さんまい よんまい ごまい ろくまい ななまい はちまい きゅうまい じゅうまい'.split(' '),
    hon: 'いっぽん にほん さんぼん よんほん ごほん ろっぽん ななほん はっぽん きゅうほん じゅっぽん'.split(' '),
    satsu: 'いっさつ にさつ さんさつ よんさつ ごさつ ろくさつ ななさつ はっさつ きゅうさつ じゅっさつ'.split(' '),
    ko: 'いっこ にこ さんこ よんこ ごこ ろっこ ななこ はっこ きゅうこ じゅっこ'.split(' '),
    tsu: 'ひとつ ふたつ みっつ よっつ いつつ むっつ ななつ やっつ ここのつ とお'.split(' '),
    nin: 'ひとり ふたり さんにん よにん ごにん ろくにん ななにん はちにん きゅうにん じゅうにん'.split(' '),
    sai: 'いっさい にさい さんさい よんさい ごさい ろくさい ななさい はっさい きゅうさい じゅっさい'.split(' '),
  };
  for (const counter of counterDefinitions) for (let n = 1; n <= 10; n++) expect(counterReading(counter.id, n)).toBe(readings[counter.id][n - 1]!);
  expect(readingVariants('ko', 8)).toEqual(['はっこ', 'はちこ']);
  expect(readingVariants('nin', 7)).toContain('しちにん');
  expect(readingVariants('hon', 20)).toContain('にじっぽん');
});

test('large quantities preserve number joins and semantic limits', () => {
  for (const [n, reading] of [[300, 'さんびゃく'], [600, 'ろっぴゃく'], [800, 'はっぴゃく'], [3000, 'さんぜん'], [8000, 'はっせん'], [10000, 'いちまん'], [1000000, 'ひゃくまん'], [9999999, 'きゅうひゃくきゅうじゅうきゅうまんきゅうせんきゅうひゃくきゅうじゅうきゅう']] as const) expect(numberReading(n)).toBe(reading);
  expect(counterReading('hon', 100)).toBe('ひゃっぽん');
  expect(counterReading('hon', 1000)).toBe('せんぼん');
  expect(counterReading('hon', 10000)).toBe('いちまんぼん');
  expect(counterReading('nin', 14)).toBe('じゅうよにん');
  expect(counterReading('sai', 20)).toBe('はたち');
  expect(counterReading('sai', 120)).toBe('ひゃくにじゅっさい');
  expect(() => counterReading('tsu', 11)).toThrow(); expect(() => counterReading('sai', 121)).toThrow();
  for (const n of [0, -1, 1.5, NaN, Infinity, 10_000_000]) expect(() => numberReading(n)).toThrow();
  for (const counter of counterDefinitions) for (let level = 0; level < 7; level++) for (const n of numbersFor(counter, level)) expect(counterReading(counter.id, n)).toMatch(/^[ぁ-ゖ]+$/u);
});

test('only introduced textbook objects unlock practice; lexical homophones remain separate', () => {
  const book = course.words.find(word => word.kana === 'ほん' && word.meaningRu === 'книга')!;
  const suffix = course.words.find(word => word.kana === 'ほん' && /суффикс/.test(word.meaningRu))!;
  const personal = { ...book, id: 'personal.private', lessonIds: [] };
  expect(objectFor(suffix)).toBeUndefined();
  expect(counterWords([book, suffix, personal], new Set([suffix.id, personal.id]))).toEqual([]);
  expect(counterWords([book, suffix, personal], new Set([book.id]))).toEqual([book]);
  const words = course.words.filter(word => objectFor(word) && word.reviewStatus !== 'draft');
  for (const kind of counterKinds) {
    const card = makeCounterCard(counterTarget('satsu', kind, kind === 'image-counter' || kind === 'counter-image' ? null : 3), book.id, words, 'fixed-seed')!;
    expect(card.word.id).toBe(book.id); expect(card.definition.id).toBe('satsu');
    if (kind !== 'recall') expect(card.options.some(option => card.acceptedKeys.includes(option.key))).toBe(true);
    for (const option of card.options) if (option.word) expect(words.some(word => word.id === option.word!.id)).toBe(true);
  }
  expect(makeCounterCard('sai/recall/121', book.id, words, 'seed')).toBeNull();
  expect(parseCounterTarget('hon/recall/01')).toBeNull();
  expect(parseCounterTarget('hon/image-counter/')).toBeNull();
  expect(makeCounterCard('satsu/recall/3', personal.id, [book], 'seed')).toBeNull();
});

test('whole-expression audio is packaged for every authored number, suffix and introduction example', () => {
  for (const counter of counterDefinitions) {
    expect(counterAudio(counter, null)).toBeDefined();
    for (let level = 0; level < 7; level++) for (const quantity of numbersFor(counter, level)) expect(counterAudio(counter, quantity)).toBeDefined();
  }
});

test('a tier needs all four thresholds and failed retries do not replace its first answers', () => {
  const initial: CounterProgress = { counterId: 'hon', level: 0, history: [] };
  const attempts: CounterHistory[] = Array.from({ length: 20 }, (_, index) => ({ quantity: index % 10 + 1, kind: index < 3 ? 'recall' : 'reading-choice', confident: index >= 2 }));
  const apply = (list: CounterHistory[]) => list.reduce(advanceCounter, initial);
  expect(apply(attempts)).toMatchObject({ level: 1, history: [] });
  expect(apply(attempts.slice(0, 19)).level).toBe(0);
  expect(apply(attempts.map((item, index) => index === 2 ? { ...item, confident: false } : item)).level).toBe(0);
  expect(apply(attempts.map(item => ({ ...item, quantity: item.quantity === 10 ? 9 : item.quantity }))).level).toBe(0);
  expect(apply(attempts.map((item, index) => index === 2 ? { ...item, kind: 'reading-choice' } : item)).level).toBe(0);
  expect(advanceCounter(initial, { quantity: 11, kind: 'recall', confident: true })).toBe(initial);
  expect(attempts.reduce(advanceCounter, { ...initial, counterId: 'tsu' as const }).level).toBe(0);
  const age: CounterProgress = { counterId: 'sai', level: 2, history: [] };
  expect(attempts.map(item => ({ ...item, quantity: 100 + item.quantity })).reduce(advanceCounter, age).level).toBe(2);
});

test('qualifying samples reach millions gradually and stop at the final tier', () => {
  const counter = counterDefinitions.find(counter => counter.id === 'hon')!;
  let progress: CounterProgress = { counterId: 'hon', level: 0, history: [] };
  for (let level = 0; level < 7; level++) {
    const quantities = numbersFor(counter, level);
    for (let index = 0; index < 20; index++) progress = advanceCounter(progress, { quantity: quantities[index % quantities.length]!, kind: index < 3 ? 'recall' : 'reading-choice', confident: true });
    expect(progress.level).toBe(Math.min(level + 1, 6));
  }
});

test('returning a failed card preserves the deck size and updates its acknowledged version', () => {
  const word = course.words[0]!;
  const cards: ReviewItem[] = Array.from({ length: 5 }, (_, i) => ({ id: String(i), targetId: word.id, mode: 'ja-ru', word, version: 0, due: '2026-10-22T00:00:00Z', isNew: true }));
  const result = { attemptId: 'attempt', status: 'scheduled' as const, version: 1, nextDue: '2026-10-23T00:00:00Z' };
  const failed = advanceDeck(cards, true, result);
  expect(failed.map(card => card.id)).toEqual(['1', '2', '3', '0', '4']);
  expect(failed[3]).toMatchObject({ version: 1, due: result.nextDue, isNew: false });
  expect(advanceDeck(cards, false)).toHaveLength(4); expect(cards).toHaveLength(5);
  expect(advanceDeck([cards[0]!], true, result)).toHaveLength(1);
  expect(advanceDeck([], true)).toEqual([]);
});
