import { test, expect } from 'bun:test';
import { loadCourse } from '../src/server/course';
import { catalogFor, defaultCatalog, validateCatalog } from '../src/shared/catalog';
import { learningParts } from '../src/shared/learning';
import { confusableLearningWords, learningWordChoices } from '../src/shared/learningChoices';
import { counterTarget, makeCounterCard, objectFor } from '../src/shared/counters';
import { getWordIllustration } from '../src/shared/word-illustrations';
import { withPersonalPractice } from '../src/server/personal-practice';

const prepared = loadCourse();
test('publication rejects broken authored references before learners see the catalog', () => {
  expect(() => validateCatalog(prepared)).not.toThrow();
  const reject = (change: (course: typeof prepared) => void) => { const course = structuredClone(prepared); change(course); expect(() => validateCatalog(course)).toThrow('Invalid catalog'); };
  reject(course => { delete course.catalog; });
  reject(course => { course.catalog!.quiz.choices[course.words[0]!.id] = ['missing', 'missing', 'missing']; });
  reject(course => { course.catalog!.quiz.equivalent = [['only one']]; });
  reject(course => { course.catalog!.counters.objects[0]!.counters = ['unknown' as 'nin']; });
  for (const [id,maximum] of [['nin',6],['hon',1],['tsu',11],['sai',121]] as const) reject(course => { course.catalog!.counters.definitions.find(counter => counter.id === id)!.maximum = maximum; });
  reject(course => { course.catalog!.counterAtlas!.cells[course.catalog!.counters.objects[0]!.id] = [0, 0, 999999, 2]; });
  reject(course => { course.catalog!.illustrations.assets[0]!.width = Infinity; });
  reject(course => { delete course.catalog!.kanaAudio!.entries[course.catalog!.kana.basic[0]!.cells[0]!.kana]; });
  reject(course => { course.catalog!.particleSkills['は'] = ['missing']; });
  reject(course => { course.catalog!.personalPractice.skillId = 'missing'; });
});

test('word practice uses the selected publication choice table and equivalence rules', () => {
  const course = structuredClone(prepared), route = course.learning![0]!, step = learningParts(route).flat().find(step => step.kind === 'word-practice')!;
  const choices = learningWordChoices(course, route, step);
  expect(choices).toHaveLength(4);
  expect(new Set(choices)).toEqual(new Set([step.wordId, ...course.catalog!.quiz.choices[step.wordId]!]));
  delete course.catalog!.quiz.choices[step.wordId];
  expect(() => learningWordChoices(course, route, step)).toThrow();
  expect(defaultCatalog.quiz.choices[step.wordId]).toHaveLength(3);
  const left = { ...course.words[0]!, kana: 'あか', surface: 'あか', meaningRu: 'алый' }, right = { ...course.words[1]!, kana: 'あお', surface: 'あお', meaningRu: 'лазоревый', kind: left.kind };
  const catalog = course.catalog!;
  expect(confusableLearningWords(left, right, catalog)).toBe(false);
  catalog.quiz.equivalent.push([left.kana, right.kana]);
  expect(confusableLearningWords(left, right, catalog)).toBe(true);
});

test('counter metadata and illustration lookups stay local to their publication', () => {
  const catalog = structuredClone(defaultCatalog), original = prepared.words.find(word => objectFor(word)?.counters.includes('nin'))!;
  const custom = { ...original, id: 'synthetic-person', kana: 'てすとじんぶつ', surface: 'てすとじんぶつ' };
  const object = catalog.counters.objects.find(object => object.id === objectFor(original)!.id)!;
  object.kanas.push(custom.kana); catalog.counters.definitions.find(definition => definition.id === 'nin')!.title = 'Публикационное пояснение';
  expect(objectFor(custom)).toBeUndefined();
  const card = makeCounterCard(counterTarget('nin', 'reading-choice', 5), custom.id, [custom], 'publication', false, catalog)!;
  expect(card.word.id).toBe(custom.id); expect(card.definition.title).toBe('Публикационное пояснение'); expect(card.answer.kana).toBe('ごにん');
  const asset = catalog.illustrations.assets[0]!, id = asset.cells[0]!.wordIds[0]!;
  const before = getWordIllustration(id)!.src; asset.src = '/content/publication/custom.webp';
  expect(getWordIllustration(id, catalog)!.src).toBe(asset.src); expect(getWordIllustration(id)!.src).toBe(before);
});

test('personal noun exercises use authored template references instead of fixed words', () => {
  const course = structuredClone(prepared), noun = { ...course.words.find(word => word.pos === 'noun')!, id: 'synthetic-personal-word', kind: 'word' as const, reviewStatus: 'reviewed' as const };
  course.catalog!.personalPractice.promptRu = 'Материал: {meaningRu}';
  course.catalog!.personalPractice.thisFormId = course.catalog!.personalPractice.copulaFormId;
  const exercise = withPersonalPractice(course, [noun]).exercises.find(exercise => exercise.id === `${noun.id}.example.nominal-label`)!;
  expect(exercise.promptRu).toBe(`Материал: ${noun.meaningRu}`); expect(exercise.tokens[0]!.formId).toBe(course.catalog!.personalPractice.thisFormId);
  expect(catalogFor(course)).toBe(course.catalog!); expect(catalogFor({})).toBe(defaultCatalog);
});
