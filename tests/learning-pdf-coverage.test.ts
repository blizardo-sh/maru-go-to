import { expect, test } from 'bun:test';
import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import coverage from '../materials/pdf-coverage-l03-l04.json';
import audit from '../verification/vocabulary-l03-l04/audit.json';
import { loadCourse } from '../src/server/course';
import { learningParts } from '../src/shared/learning';
import { confusableLearningWords, learningWordChoices } from '../src/shared/learningChoices';
import { counterReading, makeCounterCard } from '../src/shared/counters';
import { counterAudio } from '../src/server/counter-audio';

const course = loadCourse();
const prefix = 'marugoto.starter-a1.';
const root = new URL('../', import.meta.url);
const audioFile = (url: string) => {
  const bytes = readFileSync(new URL('public' + url, root));
  expect(bytes.subarray(4, 8).toString()).toBe('ftyp');
  expect(bytes.length).toBeGreaterThan(100);
};

test('all 103 supplied PDF positions are explicit guided targets, not substring matches in examples', () => {
  expect(coverage.version).toBe('2026-10-24.1');
  expect(coverage.positions).toHaveLength(103);
  expect(new Set(coverage.positions.map(row => `${row.lessonNumber}/${row.position}`)).size).toBe(103);
  expect(coverage.sources.map(source => source.sha256)).toEqual(audit.sources.filter(source => source.path.startsWith('user-provided/')).map(source => source.sha256));
  for (const [lessonNumber, count] of [[3, 46], [4, 57]] as const) {
    const route = course.learning!.find(route => route.lessonId === prefix + `lesson.0${lessonNumber}`)!;
    expect(route.version).toBe(coverage.version);
    expect(coverage.positions.filter(row => row.lessonNumber === lessonNumber).map(row => row.position).sort((a, b) => a - b)).toEqual(Array.from({ length: count }, (_, i) => i + 1));
    for (const goal of route.goals) for (const part of goal.parts) expect(part.words.length).toBeLessThanOrEqual(5);
  }
  for (const row of coverage.positions) {
    const original = audit.rows.find(item => item.lesson === row.lessonNumber && item.position === row.position)!;
    expect([row.page, row.pdfKana, row.english]).toEqual([original.page, original.kana, original.english]);
    const route = course.learning!.find(route => route.lessonId === prefix + `lesson.0${row.lessonNumber}`)!;
    const covered = row.coverage;
    if (covered.kind === 'counter') {
      const step = learningParts(route).flat().find(step => step.kind === 'counter-practice' && step.partId === covered.partId && step.counterId === covered.counterId && step.quantity === covered.quantity && step.wordId === covered.wordId);
      expect(step).toBeDefined();
      expect(step?.id).toBe(`${covered.partId}:counter:nin:${covered.quantity}`);
      continue;
    }
    for (const wordId of [covered.wordId!, ...(covered.variantWordIds ?? [])]) {
      const word = course.words.find(word => word.id === wordId)!;
      expect(word).toBeDefined(); expect(word.reviewStatus).not.toBe('draft'); expect(word.lessonIds).toContain(route.lessonId);
      const introduction = route.goals.flatMap(goal => goal.parts.flatMap(part => part.words)).find(item => item.wordId === wordId)!;
      expect(introduction).toBeDefined(); expect(introduction.explanationRu.trim().length).toBeGreaterThan(10);
      expect(introduction.example.meaningRu.trim().length).toBeGreaterThan(2);
      audioFile(word.audioUrl!); audioFile(introduction.example.audioUrl);
      const steps = learningParts(route).flat().filter(step => step.kind === 'word-practice' && step.wordId === wordId);
      expect(steps.map(step => step.kind === 'word-practice' && step.mode).sort()).toEqual(['ja-ru', 'listening', 'ru-ja']);
    }
    for (const formId of covered.formIds ?? []) expect(course.forms.some(form => form.id === formId && [covered.wordId!, ...(covered.variantWordIds ?? [])].includes(form.wordId) && form.reviewStatus !== 'draft')).toBe(true);
  }
});

test('each PDF word has four prepared, distinct, comparable choices in all three formats', () => {
  for (const lessonNumber of [3, 4]) {
    const route = course.learning!.find(route => route.lessonId === prefix + `lesson.0${lessonNumber}`)!;
    for (const step of learningParts(route).flat()) if (step.kind === 'word-practice') {
      const ids = learningWordChoices(course, route, step);
      expect(ids).toHaveLength(4); expect(new Set(ids).size).toBe(4); expect(ids).toContain(step.wordId);
      const choices = ids.map(id => course.words.find(word => word.id === id)!);
      expect(new Set(choices.map(word => word.kind)).size).toBe(1);
      for (let i = 0; i < choices.length; i++) for (let j = i + 1; j < choices.length; j++) expect(confusableLearningWords(choices[i]!, choices[j]!)).toBe(false);
    }
  }
});

test('five and six people are graded counting tasks with explicit irregular readings and real audio', () => {
  const rows = coverage.positions.filter(row => row.coverage.kind === 'counter');
  expect(rows.map(row => row.pdfKana).sort()).toEqual(['ごにん', 'ろくにん']);
  for (const row of rows) {
    const entry = row.coverage;
    expect(counterReading('nin', entry.quantity!)).toBe(row.pdfKana);
    const card = makeCounterCard(`nin/reading-choice/${entry.quantity}`, entry.wordId!, course.words, 'pdf-coverage');
    expect(card).not.toBeNull();
    expect(card!.acceptedKeys).toContain(row.pdfKana);
    expect(card!.options.some(option => card!.acceptedKeys.includes(option.key))).toBe(true);
    expect(card!.options.some(option => !card!.acceptedKeys.includes(option.key))).toBe(true);
    const sound = counterAudio(course.catalog!.counters.definitions.find(definition => definition.id === 'nin')!, entry.quantity!, course.catalog);
    expect(sound).toBeTruthy(); audioFile(sound!);
  }
});

test('targeted drafts, short variants, missing questions and lexical は keep their own meanings/readings', () => {
  for (const suffix of ['a269082034ac2170', '6c1513d2349d25fd', '6206f3c0ca0ee870', '2839da6ecbf6a5fd', '23f1417336b4ad34', '579b97a4ede59ac6']) {
    expect(course.words.find(word => word.id === prefix + 'word.' + suffix)?.reviewStatus).toBe('source-checked');
  }
  const teacher = course.forms.find(form => form.id === prefix + 'form.72709f1ee2b22e2c')!;
  expect(teacher.kana).toBe('こうむいん'); expect(teacher.segments).toEqual([{ surface: 'こうむいん' }]);
  for (const [surface, meaning] of [['ことば', 'слово; язык'], ['おなまえは？', 'как вас зовут?'], ['なんですか', 'что это?'], ['だれですか', 'кто это?'], ['すごいですね', 'вот это здорово!']]) {
    expect(course.words.find(word => word.surface === surface)?.meaningRu).toBe(meaning);
  }
  const route = course.learning!.find(route => route.lessonId === prefix + 'lesson.04')!;
  const young = route.goals.flatMap(goal => goal.parts.flatMap(part => part.words)).find(item => item.wordId.endsWith('51ff5fb63a7d9b66'))!.example;
  expect(young.surface).toBe('はははわかいです。'); expect(young.audioText).toBe('ははわわかいです。');
  const name = course.words.find(word => word.surface === 'おなまえは？')!;
  expect(name.kana).toBe('おなまえは？'); expect(name.audioText).toBe('おなまえわ');
  const file = createHash('sha256').update('Kyoko:150:' + young.audioText).digest('hex').slice(0, 20) + '.m4a';
  expect(young.audioUrl).toBe('/audio/learning/' + file);
  expect(statSync(new URL('public' + young.audioUrl, root)).size).toBeGreaterThan(100);
});
