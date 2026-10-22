import type { Segment, Word } from './types';

export const counterKinds = ['image-counter', 'counter-image', 'reading-choice', 'listening-image', 'recall'] as const;
export type CounterKind = typeof counterKinds[number];
export type CounterId = 'mai' | 'hon' | 'satsu' | 'ko' | 'tsu' | 'nin' | 'sai';
export interface CounterDefinition { id: CounterId; surface: string; kana: string; title: string; explanation: string; maximum: number }
export const counterDefinitions: CounterDefinition[] = [
  { id: 'mai', surface: '枚', kana: 'まい', title: 'Плоские предметы', explanation: 'Листы, платки, рубашки, диски и другие тонкие плоские предметы.', maximum: 9_999_999 },
  { id: 'hon', surface: '本', kana: 'ほん', title: 'Длинные предметы', explanation: 'Зонтики, карандаши, бананы, бутылки. Обратите внимание на いっぽん・さんぼん・ろっぽん.', maximum: 9_999_999 },
  { id: 'satsu', surface: '冊', kana: 'さつ', title: 'Книги и тетради', explanation: 'Книги, тетради и журналы. Один — いっさつ, восемь — はっさつ.', maximum: 9_999_999 },
  { id: 'ko', surface: '個', kana: 'こ', title: 'Небольшие предметы', explanation: 'Яйца, чашки, часы и другие отдельные небольшие предметы.', maximum: 9_999_999 },
  { id: 'tsu', surface: 'つ', kana: 'つ', title: 'Общий счёт до десяти', explanation: 'Общий способ считать предметы: ひとつ・ふたつ・みっつ. После десяти используется подходящее другое счётное слово.', maximum: 10 },
  { id: 'nin', surface: '人', kana: 'にん', title: 'Люди', explanation: 'Один человек — ひとり, двое — ふたり, четверо — よにん. Большие группы тоже считаются с 人.', maximum: 9_999_999 },
  { id: 'sai', surface: '歳', kana: 'さい', title: 'Возраст', explanation: 'Возраст одного человека. Один год — いっさい, восемь — はっさい, двадцать — はたち. Здесь практикуем возраст от 1 до 120 лет.', maximum: 120 },
];

export interface CounterObject { id: string; tile: number; kanas: string[]; counters: CounterId[] }
// Object categories follow the Marugoto A1 appendix; vocabulary IDs still come from the learner's course.
export const counterObjects: CounterObject[] = [
  { id: 'person', tile: 0, kanas: ['ひと', 'こども', 'おんなのこ', 'がくせい', 'ともだち', 'せんせい'], counters: ['nin', 'sai'] },
  { id: 'book', tile: 1, kanas: ['ほん'], counters: ['satsu'] },
  { id: 'notebook', tile: 2, kanas: ['ノート'], counters: ['satsu'] },
  { id: 'umbrella', tile: 3, kanas: ['かさ'], counters: ['hon'] },
  { id: 'pencil', tile: 4, kanas: ['えんぴつ', 'ペン', 'ボールペン'], counters: ['hon'] },
  { id: 'bottle', tile: 5, kanas: ['ワイン', 'ビール'], counters: ['hon'] },
  { id: 'egg', tile: 6, kanas: ['たまご'], counters: ['ko', 'tsu'] },
  { id: 'banana', tile: 7, kanas: ['バナナ'], counters: ['hon'] },
  { id: 'apple', tile: 8, kanas: ['りんご'], counters: ['ko', 'tsu'] },
  { id: 'cake', tile: 9, kanas: ['ケーキ', 'チーズケーキ'], counters: ['ko', 'tsu'] },
  { id: 'sandwich', tile: 10, kanas: ['サンドイッチ'], counters: ['ko', 'tsu'] },
  { id: 'riceball', tile: 11, kanas: ['おにぎり'], counters: ['ko', 'tsu'] },
  { id: 'orange', tile: 12, kanas: ['みかん', 'オレンジ'], counters: ['ko', 'tsu'] },
  { id: 'bag', tile: 13, kanas: ['かばん', 'バッグ'], counters: ['tsu'] },
  { id: 'box', tile: 14, kanas: ['はこ'], counters: ['ko', 'tsu'] },
  { id: 'paper', tile: 15, kanas: ['かみ'], counters: ['mai'] },
  { id: 'shirt', tile: 16, kanas: ['ティーシャツ', 'シャツ'], counters: ['mai'] },
  { id: 'plate', tile: 17, kanas: ['さら', 'おさら'], counters: ['mai'] },
  { id: 'disc', tile: 18, kanas: ['シーディー', 'シーディー（CD）', 'ディーブイディー'], counters: ['mai'] },
  { id: 'handkerchief', tile: 19, kanas: ['ハンカチ'], counters: ['mai'] },
  { id: 'chair', tile: 20, kanas: ['いす'], counters: ['tsu'] },
  { id: 'table', tile: 21, kanas: ['つくえ', 'テーブル'], counters: ['tsu'] },
  { id: 'cup', tile: 22, kanas: ['ティーカップ', 'コップ'], counters: ['ko', 'tsu'] },
  { id: 'dictionary', tile: 23, kanas: ['じしょ'], counters: ['satsu'] },
  { id: 'magazine', tile: 24, kanas: ['ざっし'], counters: ['satsu'] },
];
export function objectFor(word: Word): CounterObject | undefined {
  if (word.kind !== 'word' || /суффикс|счетный|счётный/.test(word.meaningRu)) return;
  return counterObjects.find(object => object.kanas.includes(word.kana));
}
export function counterWords(words: Word[], introduced: Set<string>): Word[] {
  return words.filter(word => word.lessonIds.length > 0 && word.reviewStatus !== 'draft' && introduced.has(word.id) && !!objectFor(word));
}

export const numberRanges = [[1, 10], [11, 99], [100, 999], [1000, 9999], [10000, 99999], [100000, 999999], [1000000, 9999999]] as const;
const samples = [
  Array.from({ length: 10 }, (_, i) => i + 1),
  [...Array.from({ length: 10 }, (_, i) => i + 11), 21, 24, 28, 30, 40, 50, 60, 70, 80, 90, 99],
  [100, 101, 108, 110, 120, 121, 180, 200, 210, 250, 300, 360, 400, 500, 600, 630, 680, 700, 800, 810, 900, 999],
  [1000, 1001, 1004, 1008, 1010, 1030, 1100, 1234, 2000, 3000, 3600, 4000, 5000, 6000, 7000, 8000, 8100, 8800, 9000, 9999],
  [10000, 10001, 10004, 10008, 10010, 10100, 11000, 12345, 20000, 30000, 30300, 40000, 50000, 60000, 70000, 80000, 80800, 90000, 99000, 99999],
  [100000, 100001, 100004, 100008, 100010, 100100, 101000, 110000, 123456, 200000, 300000, 360000, 400000, 500000, 600000, 700000, 800000, 880000, 900000, 999999],
  [1000000, 1000001, 1000004, 1000008, 1000010, 1000100, 1001000, 1010000, 1100000, 1234567, 2000000, 3000000, 3600000, 4000000, 5000000, 6000000, 7000000, 8000000, 9000000, 9999999],
];
export function numbersFor(counter: CounterDefinition, level: number): number[] {
  if (counter.id === 'sai' && level === 2) return Array.from({ length: 21 }, (_, i) => 100 + i);
  return (samples[level] ?? []).filter(n => n <= counter.maximum);
}
export function levelFor(n: number): number { return numberRanges.findIndex(([low, high]) => n >= low && n <= high); }
const digits = ['', 'いち', 'に', 'さん', 'よん', 'ご', 'ろく', 'なな', 'はち', 'きゅう'];
export function numberReading(n: number): string {
  if (!Number.isSafeInteger(n) || n < 1 || n > 9_999_999) throw new Error('Количество должно быть от 1 до 9 999 999.');
  if (n >= 10000) return numberReading(Math.floor(n / 10000)) + 'まん' + (n % 10000 ? numberReading(n % 10000) : '');
  const thousands = Math.floor(n / 1000), hundreds = Math.floor(n / 100) % 10, tens = Math.floor(n / 10) % 10;
  return (thousands ? ({ 1: 'せん', 3: 'さんぜん', 8: 'はっせん' }[thousands] ?? digits[thousands] + 'せん') : '')
    + (hundreds ? ({ 1: 'ひゃく', 3: 'さんびゃく', 6: 'ろっぴゃく', 8: 'はっぴゃく' }[hundreds] ?? digits[hundreds] + 'ひゃく') : '')
    + (tens ? (tens === 1 ? '' : digits[tens]) + 'じゅう' : '') + digits[n % 10];
}
const general = ['ひとつ', 'ふたつ', 'みっつ', 'よっつ', 'いつつ', 'むっつ', 'ななつ', 'やっつ', 'ここのつ', 'とお'];
export function counterReading(id: CounterId, n: number): string {
  const counter = counterDefinitions.find(counter => counter.id === id);
  if (!counter || n > counter.maximum) throw new Error('Недопустимое количество для суффикса.');
  if (id === 'tsu') { if (!Number.isInteger(n) || n < 1) throw new Error('Неверное количество.'); return general[n - 1]!; }
  if (id === 'nin' && n <= 2) return n === 1 ? 'ひとり' : n === 2 ? 'ふたり' : numberReading(n);
  if (id === 'sai' && n === 20) return 'はたち';
  const number = numberReading(n);
  if (id === 'mai') return number + 'まい';
  if (id === 'nin') return (n % 10 === 4 ? number.slice(0, -2) + 'よ' : number) + 'にん';
  const endings: Record<string, string> = id === 'hon'
    ? { 'いち': 'いっぽん', 'さん': 'さんぼん', 'ろく': 'ろっぽん', 'はち': 'はっぽん', 'じゅう': 'じゅっぽん', 'ひゃく': 'ひゃっぽん', 'びゃく': 'びゃっぽん', 'ぴゃく': 'ぴゃっぽん', 'せん': 'せんぼん', 'ぜん': 'ぜんぼん', 'まん': 'まんぼん' }
    : id === 'ko' ? { 'いち': 'いっこ', 'ろく': 'ろっこ', 'はち': 'はっこ', 'じゅう': 'じゅっこ', 'ひゃく': 'ひゃっこ', 'びゃく': 'びゃっこ', 'ぴゃく': 'ぴゃっこ' }
    : { 'いち': 'いっ' + counter.kana, 'はち': 'はっ' + counter.kana, 'じゅう': 'じゅっ' + counter.kana };
  for (const [ending, replacement] of Object.entries(endings)) if (number.endsWith(ending)) return number.slice(0, -ending.length) + replacement;
  return number + counter.kana;
}
export function readingVariants(id: CounterId, n: number): string[] {
  const reading = counterReading(id, n), variants = [reading];
  if (reading.includes('じゅっ')) variants.push(reading.replace('じゅっ', 'じっ'));
  if (id === 'ko' && n % 10 === 8) variants.push(numberReading(n) + 'こ');
  if (id === 'nin' && n % 10 === 7) variants.push(numberReading(n).slice(0, -2) + 'しちにん');
  if (id === 'sai' && n === 20) variants.push('にじゅっさい', 'にじっさい');
  return [...new Set(variants)];
}
export function counterAnswer(counter: CounterDefinition, quantity: number | null): { surface: string; kana: string; segments: Segment[] } {
  const surface = quantity === null ? counter.surface : counter.id === 'tsu' && quantity === 10 ? '十' : `${quantity}${counter.surface}`;
  const kana = quantity === null ? counter.kana : counterReading(counter.id, quantity);
  return { surface, kana, segments: [{ surface, reading: kana }] };
}
export interface CounterHistory { quantity: number; kind: CounterKind; confident: boolean }
export interface CounterProgress { counterId: CounterId; level: number; history: CounterHistory[] }
export function advanceCounter(progress: CounterProgress, attempt: CounterHistory): CounterProgress {
  if (levelFor(attempt.quantity) !== progress.level) return progress;
  const history = [...progress.history, attempt].slice(-20);
  const counter = counterDefinitions.find(counter => counter.id === progress.counterId)!;
  const ready = history.length === 20 && history.filter(attempt => attempt.confident).length >= 18
    && new Set(history.map(attempt => attempt.quantity)).size >= 10 && history.filter(attempt => attempt.kind === 'recall').length >= 3;
  return ready && numbersFor(counter, progress.level + 1).length ? { ...progress, level: progress.level + 1, history: [] } : { ...progress, history };
}
export interface CounterChoice { key: string; label: string; object?: CounterObject; word?: Word; quantity?: number; age?: boolean }
export interface CounterCard {
  definition: CounterDefinition; kind: CounterKind; quantity: number | null; level: number; word: Word; object: CounterObject;
  answer: ReturnType<typeof counterAnswer>; options: CounterChoice[]; acceptedKeys: string[]; introduction: boolean; audioUrl?: string;
  examples: (ReturnType<typeof counterAnswer> & { audioUrl?: string })[];
}
export const counterTarget = (id: CounterId, kind: CounterKind, n: number | null) => `${id}/${kind}/${n ?? 0}`;
export function parseCounterTarget(target: string): { definition: CounterDefinition; kind: CounterKind; quantity: number | null } | null {
  const [id, kind, amount, extra] = target.split('/'), definition = counterDefinitions.find(counter => counter.id === id);
  const n = Number(amount), category = kind === 'image-counter' || kind === 'counter-image';
  if (!definition || extra !== undefined || !counterKinds.includes(kind as CounterKind) || String(n) !== amount || !Number.isSafeInteger(n) || (category ? n !== 0 : n < 1 || n > definition.maximum)) return null;
  return { definition, kind: kind as CounterKind, quantity: category ? null : n };
}
function shuffled<T>(items: T[], seed: string): T[] {
  let state = [...seed].reduce((n, char) => (Math.imul(n, 31) + char.charCodeAt(0)) >>> 0, 1);
  const result = [...items];
  for (let i = result.length - 1; i > 0; i--) { state = (Math.imul(state, 1664525) + 1013904223) >>> 0; const j = state % (i + 1); [result[i], result[j]] = [result[j]!, result[i]!]; }
  return result;
}
export function makeCounterCard(target: string, wordId: string, words: Word[], seed: string, introduction = false): CounterCard | null {
  const parsed = parseCounterTarget(target), word = words.find(word => word.id === wordId), object = word && objectFor(word);
  if (!parsed || !word || !object || !object.counters.includes(parsed.definition.id)) return null;
  const { definition, kind, quantity } = parsed, age = definition.id === 'sai';
  const answer = counterAnswer(definition, quantity); let options: CounterChoice[] = [], acceptedKeys: string[] = [];
  if (kind === 'image-counter') {
    options = shuffled(counterDefinitions, seed).map(counter => ({ key: counter.id, label: `${counter.surface} · ${counter.kana}` }));
    acceptedKeys = age ? ['sai'] : object.counters.filter(id => id !== 'sai');
  } else if (kind === 'counter-image') {
    const possible = words.map(candidate => ({ word: candidate, object: objectFor(candidate) })).filter((entry): entry is { word: Word; object: CounterObject } => !!entry.object);
    const wrong = shuffled(possible.filter(entry => !entry.object.counters.includes(definition.id)), seed).slice(0, 3);
    options = shuffled([{ word, object }, ...wrong], seed + 'images').map(entry => ({ key: entry.word.id, label: entry.word.meaningRu, word: entry.word, object: entry.object, quantity: 1, age: entry.object.id === 'person' && age }));
    acceptedKeys = [word.id];
  } else if (kind !== 'recall') {
    const alternatives = shuffled(numbersFor(definition, levelFor(quantity!)).filter(n => n !== quantity), seed).slice(0, 3);
    const amounts = shuffled([quantity!, ...alternatives], seed + 'numbers');
    options = amounts.map(n => kind === 'reading-choice' ? { key: counterReading(definition.id, n), label: counterReading(definition.id, n) }
      : { key: String(n), label: word.meaningRu, word, object, quantity: n, age });
    acceptedKeys = kind === 'reading-choice' ? readingVariants(definition.id, quantity!) : [String(quantity)];
  }
  if (kind !== 'recall' && options.length < 2) return null;
  return { definition, kind, quantity, level: quantity === null ? 0 : levelFor(quantity), word, object, answer, options, acceptedKeys, introduction, examples: [1, 3, 8].map(n => counterAnswer(definition, n)) };
}
