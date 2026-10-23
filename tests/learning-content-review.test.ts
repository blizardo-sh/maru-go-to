import { expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { loadCourse } from '../src/server/course';

const course = loadCourse();
const route = (number: number) => course.learning!.find(item => item.lessonId.endsWith(`.${String(number).padStart(2, '0')}`))!;
const construction = (number: number, suffix: string) => route(number).goals.flatMap(goal => goal.parts).find(part => part.construction?.exerciseId.endsWith(suffix))!.construction!;
const examples = course.learning!.flatMap(lesson => lesson.goals.flatMap(goal => goal.parts.flatMap(part => [
  ...part.words.map(word => word.example), ...(part.construction ? [part.construction.example] : []),
])));

test('the stable の exercise names the sister’s child and its worked example matches the same tokens and scene', () => {
  const id = 'marugoto.starter-a1.example.no_relation.l04.1';
  const example = construction(4, 'no_relation.l04.1');
  const exercise = course.exercises.find(item => item.id === id)!;
  const tokens = new Map(exercise.tokens.map(token => [token.id, course.forms.find(form => form.id === token.formId)!.surface]));
  expect(example.example.surface).toBe('あねのこどもです。');
  expect(example.example.meaningRu).toBe('Это ребёнок моей старшей сестры.');
  expect(exercise.translationRu).toBe(example.example.meaningRu);
  expect(exercise.acceptedOrders.map(order => order.map(id => tokens.get(id)).join('') + exercise.sentenceEnd)).toContain(example.example.surface);
  expect(example.breakdown.map(item => item.text)).toEqual(['あね', 'の', 'こども', 'です']);
  expect(route(4).goals[1]!.introductionRu).toContain('старшая сестра');
  expect(route(4).goals[1]!.introductionRu).toMatch(/отдельн/);
});

test('family counting and age scenes identify whose children are discussed without changing the Japanese answers', () => {
  expect(examples.find(item => item.surface === 'こどもはひとりです。')!.meaningRu).toBe('У меня один ребёнок.');
  expect(construction(4, 'to_noun_list.l04.1').explanationRu).toContain('фотографии');
  for (const suffix of ['age_count.l04.1', 'age_count.l04.2']) {
    const exercise = course.exercises.find(item => item.id.endsWith(suffix))!;
    expect(exercise.contextRu).toContain('своего ребёнка');
  }
  expect(construction(4, 'age_count.l04.1').example.surface).toBe('こどもはさんさいです。');
  expect(examples.some(item => item.surface === 'ひとりですんでいます。')).toBe(true);
  const familyContext = route(4).goals[0]!.introductionRu!;
  expect(familyContext).toContain('формальном');
  expect(familyContext).toContain('неформальной');
  expect(course.words.find(item => item.id === 'marugoto.starter-a1.word.2d31dd8d68a3ada0')!.meaningRu).toContain('(мой)');
  expect(course.words.find(item => item.id === 'marugoto.starter-a1.word.fa352771e8199249')!.meaningRu).toContain('чей-то');
});

test('です explains politeness after an i-adjective and retains its noun-predicate explanation', () => {
  for (const [number, suffix] of [[6, 'adjective_predicate.l06.1'], [7, 'adjective_predicate.l07.1']] as const) {
    expect(construction(number, suffix).breakdown.find(item => item.text === 'です')!.explanationRu).toBe('Делает высказывание вежливым.');
  }
  expect(construction(6, 'favourite_category.l06.1').breakdown.find(item => item.text === 'です')!.explanationRu).toBe('Вежливое завершение именной фразы.');
});

test('contextual glossary fixes distinguish どれ from a two-item choice without removing other valid meanings', () => {
  for (const suffix of ['610ff8cd8119e844', '10ae214081105f7a']) {
    expect(course.words.find(item => item.id.endsWith(suffix))!.meaningRu).toBe('который / какой из нескольких (обычно трёх и более)');
  }
  expect(course.words.find(item => item.id.endsWith('c9d4d4653b20a5a8'))!.meaningRu).toContain('и, а также');
  expect(course.words.find(item => item.id.endsWith('9d9b9a953567fc8b'))!.meaningRu).toContain('зал');
  for (const [suffix, relation] of [['ageru.l15.2', 'своей старшей сестре'], ['morau.l15.2', 'от своей старшей сестры']]) {
    const context = course.exercises.find(item => item.id.endsWith(suffix!))!.contextRu;
    expect(context).toContain(relation!);
    expect(context).toContain('о себе');
  }
});

test('げんかん means прихожая in both the base corpus and lesson overlay', () => {
  const id = 'marugoto.starter-a1.word.88121d92f170ba02';
  const base = JSON.parse(readFileSync(new URL('../materials/course.json', import.meta.url), 'utf8'));
  const lesson = JSON.parse(readFileSync(new URL('../materials/learning/lesson-08.json', import.meta.url), 'utf8'));
  for (const words of [base.words, lesson.authored.words]) {
    const word = words.find((item: { id: string }) => item.id === id);
    expect(word.surface).toBe('げんかん');
    expect(word.kana).toBe('げんかん');
    expect(word.meaningRu).toBe('прихожая');
  }
  expect(course.words.find(word => word.id === id)!.meaningRu).toBe('прихожая');
});

test('full-phrase pronunciation overrides preserve lexical は and へ while reading particles in context', () => {
  for (const [kana, audioText] of [
    ['はははとうきょうにすんでいます。', 'ははわとうきょうにすんでいます。'],
    ['あのみせははやいです。', 'あのみせわはやいです。'],
    ['へやはひろいです。', 'へやわひろいです。'],
    ['あさごはんにパンをたべます。', 'あさごはんにパンおたべます。'],
    ['こんにちは、たなかさん。', 'こんにちわ、たなかさん。'],
    ['そうじはたいへんでした。', 'そうじわたいへんでした。'],
  ]) {
    const matches = examples.filter(item => item.kana === kana);
    expect(matches.length).toBeGreaterThan(0);
    for (const example of matches) expect(example.audioText).toBe(audioText);
  }
  for (const example of examples.filter(item => ['おはようございます、せんせい。', 'はい、わかりました。', 'きのうはなびをみました。', 'はやいですから。'].includes(item.kana))) {
    expect(example.audioText ?? example.kana).not.toContain('わなび');
    expect(example.audioText ?? example.kana).not.toContain('わやい');
    expect(example.audioText ?? example.kana).not.toContain('おわよう');
    expect(example.audioText ?? example.kana).not.toContain('わい、');
  }
  expect(construction(4, 'no_relation.l04.1').example.audioText).toBe('あねのこどもです。');
});

test('prepared choice supplements do not become learning targets or erase stable family spellings', () => {
  const core = new Set(course.learning!.flatMap(lesson => lesson.goals.flatMap(goal => goal.parts.flatMap(part => part.words.map(word => word.wordId)))));
  const supplements = course.words.filter(word => /\.(age-|pronoun-|supplement-)/.test(word.id));
  expect(supplements.length).toBeGreaterThanOrEqual(7);
  for (const word of supplements) {
    expect(word.reviewStatus).toBe('source-checked');
    expect(core.has(word.id)).toBe(false);
    expect(course.forms.some(form => form.wordId === word.id && form.surface === word.surface && form.kana === word.kana)).toBe(true);
  }
  expect(course.words.find(word => word.id.endsWith('0d387f5f793f1e8a'))!.kind).toBe('word');
  expect(course.words.find(word => word.id.endsWith('07ab7fc730f6f2bb'))!.kana).toBe('はは');
  for (const word of course.words.filter(word => word.kana === 'はなします')) expect(word.audioText ?? word.kana).toBe('はなします');
});
