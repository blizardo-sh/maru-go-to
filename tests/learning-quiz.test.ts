import { expect, test } from 'bun:test';
import { loadCourse } from '../src/server/course';
import { advanceLearningState, currentLearningStep, initialLearningState, learningParts, startLearningPractice } from '../src/shared/learning';
import { confusableLearningWords, learningWordChoices } from '../src/shared/learningChoices';
import { learningFixture } from './helpers/learning-fixture';
import { preparedLearningChoices } from '../src/shared/preparedLearningChoices';

test('group start acknowledges only remaining intros, mixes every word/format once, and preserves construction/video boundaries', () => {
  const course = loadCourse(); const route = course.learning![0]!;
  const original = initialLearningState(route);
  const partiallyIntroduced = advanceLearningState(route, original, 'continue');
  const saved = structuredClone(partiallyIntroduced);
  const next = startLearningPractice(route, partiallyIntroduced);
  expect(partiallyIntroduced).toEqual(saved);
  const definitions = learningParts(route)[0]!;
  expect(next.completedStepIds).toEqual(definitions.filter(step => step.kind === 'word-intro').map(step => step.id));
  expect(next.wordQuiz).toBe(true);
  const practice = next.pendingStepIds.map(id => definitions.find(step => step.id === id)!).filter(step => step.kind === 'word-practice');
  expect(practice).toHaveLength(15);
  expect(new Set(practice.map(step => step.id)).size).toBe(15);
  for (let i = 1; i < practice.length; i++) expect(practice[i]!.wordId).not.toBe(practice[i - 1]!.wordId);
  for (const word of route.goals[0]!.parts[0]!.words) expect(practice.filter(step => step.wordId === word.wordId).map(step => step.mode).sort()).toEqual(['ja-ru', 'listening', 'ru-ja']);
  expect(next.pendingStepIds.filter(id => !practice.some(step => step.id === id))).toEqual(saved.pendingStepIds.filter(id => definitions.find(step => step.id === id)?.kind !== 'word-intro' && !practice.some(step => step.id === id)));
  expect(startLearningPractice(route, saved)).toEqual(next);
  expect(() => startLearningPractice(route, next)).toThrow('introduction');
  expect(currentLearningStep(route, saved)?.id).toBe(saved.pendingStepIds[0]!);
  expect(route.version).toBe('2026-10-21.1');
});

test('legacy single-intro continue and already started retry queue remain unchanged; new quiz state uses the existing retry rule', () => {
  const route = learningFixture().learning[0]!;
  let state = initialLearningState(route);
  state = advanceLearningState(route, state, 'continue');
  expect(state.completedStepIds).toHaveLength(1);
  expect(currentLearningStep(route, state)?.kind).toBe('word-intro');
  state = startLearningPractice(route, state);
  const difficult = currentLearningStep(route, state)!;
  state = advanceLearningState(route, state, 'again');
  const saved = structuredClone(state);
  expect(currentLearningStep(route, state)?.id).not.toBe(difficult.id);
  expect(state.pendingStepIds).toContain(difficult.id);
  expect(state.completedStepIds).not.toContain(difficult.id);
  expect(() => startLearningPractice(route, state)).toThrow();
  expect(state).toEqual(saved);
  for (let round = 0; round < 6; round++) {
    while (currentLearningStep(route, state)?.id !== difficult.id) {
      const step = currentLearningStep(route, state)!;
      expect(['video', 'part-complete']).not.toContain(step.kind);
      state = advanceLearningState(route, state, step.kind.endsWith('practice') ? 'remember' : 'continue');
    }
    state = advanceLearningState(route, state, round === 5 ? 'remember' : 'again');
  }
  expect(currentLearningStep(route, state)?.kind).toBe('video');
});

test('all authored word placements have four stable, distinct prepared choices in each format', () => {
  const course = loadCourse(); const reloaded = loadCourse(); let questions = 0; const targets = new Set<string>();
  for (const route of course.learning!) for (const step of learningParts(route).flat()) if (step.kind === 'word-practice') {
    const ids = learningWordChoices(course, route, step);
    expect(ids).toHaveLength(4); expect(new Set(ids).size).toBe(4); expect(ids).toContain(step.wordId);
    expect(learningWordChoices(reloaded, reloaded.learning!.find(item => item.lessonId === route.lessonId)!, structuredClone(step))).toEqual(ids);
    const words = ids.map(id => course.words.find(word => word.id === id)!);
    const target = course.words.find(word => word.id === step.wordId)!;
    expect(target.lessonIds).toContain(route.lessonId);
    for (const word of words) { expect(word.reviewStatus).not.toBe('draft'); expect(word.kind).toBe(target.kind); }
    for (let i = 0; i < words.length; i++) for (let j = i + 1; j < words.length; j++) expect(confusableLearningWords(words[i]!, words[j]!)).toBe(false);
    targets.add(step.wordId); questions++;
  }
  expect(questions).toBe(course.learning!.flatMap(route=>route.goals.flatMap(goal=>goal.parts.flatMap(part=>part.words))).length*3); expect(targets.size).toBeGreaterThanOrEqual(348); expect(preparedLearningChoices.size).toBe(targets.size);
});

test('politeness, shared meanings and equivalent readings cannot create a false wrong answer', () => {
  const course = loadCourse(); const bySurface = (surface: string) => course.words.find(word => word.surface === surface)!;
  for (const [a, b] of [['ちち', 'おとうさん'], ['はは', 'おかあさん'], ['ありがとう', 'ありがとうございます'], ['うち', 'いえ'], ['そして', 'それから'], ['なまえ', 'おなまえ'], ['すき', 'だいすき'], ['かっこいい', 'すてき']]) {
    const left = bySurface(a!) ?? { ...bySurface('なまえ'), id: a!, surface: a!, kana: a!, meaningRu: a! };
    const right = bySurface(b!) ?? { ...left, id: b!, surface: b!, kana: b!, meaningRu: b! };
    expect(confusableLearningWords(left, right)).toBe(true);
    expect(confusableLearningWords(right, left)).toBe(true);
  }
  const word = bySurface('ねこ');
  expect(confusableLearningWords({ ...word, id: 'father', surface: '父', kana: 'ちち', meaningRu: 'мой отец' }, { ...word, id: 'polite-father', surface: 'お父さん', kana: 'おとうさん', meaningRu: 'отец (уважительно)' })).toBe(true);
  expect(confusableLearningWords(word, { ...word, id: 'another', surface: '猫', kana: 'ネコ' })).toBe(true);
  expect(confusableLearningWords(word, { ...word, id: 'another', surface: '違う', kana: 'ちがう', meaningRu: 'кошка' })).toBe(true);
  const repeat = course.words.find(word => word.kana === 'もういちどおねがいします。')!;
  const listen = course.words.find(word => word.kana === 'きいてください。')!;
  expect(confusableLearningWords(repeat, listen)).toBe(false);
  expect(confusableLearningWords(listen, repeat)).toBe(false);
  const please = { ...word, id: 'please', surface: 'どうぞ', kana: 'どうぞ', meaningRu: 'пожалуйста' };
  expect(confusableLearningWords(please, { ...please, id: 'equivalent', surface: 'どうぞお願いします', kana: 'どうぞおねがいします' })).toBe(true);
  const courtesy = { ...please, id: 'courtesy', surface: '別の表現', kana: 'べつのひょうげん', meaningRu: 'пожалуйста; прошу вас' };
  expect(confusableLearningWords(please, courtesy)).toBe(true);
  expect(confusableLearningWords(courtesy, please)).toBe(true);
  expect(confusableLearningWords({ ...repeat, id: 'duplicate-meaning', surface: '別の表現', kana: 'べつのひょうげん' }, repeat)).toBe(true);
});

test('prepared choices distinguish people, age, clock time, writing systems and whole requests', () => {
  const course = loadCourse();
  const examples = [
    { lesson: 4, target: 'ふたり', allowed: ['ひとり', 'ふたり', 'さんにん', 'よにん'] },
    { lesson: 4, target: 'さんさい', allowed: ['いっさい', 'にさい', 'さんさい', 'よんさい'] },
    { lesson: 9, target: 'しちじ', allowed: ['ごじ', 'しちじ', 'くじ', 'じゅういちじ'] },
    { lesson: 1, target: 'ひらがな', allowed: ['ひらがな', 'カタカナ', 'かんじ', 'ローマじ'] },
    { lesson: 4, target: 'こども', allowed: ['かぞく', 'こども', 'ともだち', 'ひと'] },
    { lesson: 4, target: 'ちち', allowed: ['ちち', 'はは', 'あに', 'あね'] },
    { lesson: 5, target: 'おちゃ', allowed: ['おちゃ', 'コーヒー', 'みず', 'ジュース'] },
    { lesson: 6, target: 'ひとつ', allowed: ['ひとつ', 'ふたつ', 'みっつ', 'よっつ'] },
    { lesson: 8, target: 'うえ', allowed: ['うえ', 'した', 'なか', 'よこ'] },
    { lesson: 10, target: 'きんようび', allowed: ['きんようび', 'どようび', 'にちようび', 'げつようび'] },
    { lesson: 11, target: 'ときどき', allowed: ['いつも', 'よく', 'あまり', 'ときどき'] },
    { lesson: 12, target: 'むりょう', allowed: ['むりょう', 'やすい', 'たかい', 'ゆうりょう'] },
    { lesson: 13, target: 'バス', allowed: ['タクシー', 'バス', 'でんしゃ', 'ひこうき'] },
    { lesson: 14, target: 'みぎ', allowed: ['みぎ', 'ひだり', 'まっすぐ', 'うしろ'] },
    { lesson: 15, target: 'かいます', allowed: ['あげます', 'もらいます', 'かいます', 'つかいます'] },
    { lesson: 16, target: 'サイズ', allowed: ['いろ', 'サイズ', 'かたち', 'ねだん'] },
    { lesson: 18, target: 'きょうと', allowed: ['とうきょう', 'きょうと', 'おおさか', 'ソウル'] },
    // Calendar-month choices need the same unit, not four relative month offsets.
    { lesson: 12, target: 'らいげつ', allowed: ['らいげつ', 'こんげつ', 'せんげつ', 'いちがつ'] },
    { lesson: 15, target: 'きょねん', allowed: ['きょねん', 'ことし', 'らいねん', 'まいとし'] },
    { lesson: 18, target: 'ことし', allowed: ['きょねん', 'ことし', 'らいねん', 'まいとし'] },
    { lesson: 15, target: 'ほしい', allowed: ['ほしい', 'わかります', 'できます', 'つかれます'] },
    { lesson: 12, target: 'ざんねん', allowed: ['ざんねん', 'うれしい', 'たいへん', 'だいじょうぶ'] },
  ];
  for (const example of examples) {
    const route = course.learning!.find(route => course.lessons.find(lesson => lesson.id === route.lessonId)!.number === example.lesson)!;
    const steps = learningParts(route).flat().filter(step => step.kind === 'word-practice' && course.words.find(word => word.id === step.wordId)!.kana === example.target);
    expect(steps).toHaveLength(3);
    for (const step of steps) if (step.kind === 'word-practice') {
      const words = learningWordChoices(course, route, step).map(id => course.words.find(word => word.id === id)!);
      expect(words.map(word => word.kana).sort()).toEqual([...example.allowed].sort());
    }
  }
  const route = course.learning![1]!;
  const step = learningParts(route).flat().find(step => step.kind === 'word-practice' && course.words.find(word => word.id === step.wordId)!.kana === 'もういちどおねがいします。')!;
  if (step.kind !== 'word-practice') throw new Error('Missing prepared request.');
  const words = learningWordChoices(course, route, step).map(id => course.words.find(word => word.id === id)!);
  expect(words.map(word => word.kind)).toEqual(['phrase', 'phrase', 'phrase', 'phrase']);
  expect(words.map(word => word.kana).sort()).toEqual(['もういちどおねがいします。', 'もうすこしゆっくりいってください。', 'きいてください。', 'あそびにきてください'].sort());
});

test('unprepared, withdrawn and ambiguous choices fail closed instead of using unrelated anchors', () => {
  const course = loadCourse(); const route = course.learning![0]!;
  const step = learningParts(route).flat().find(step => step.kind === 'word-practice')!;
  if (step.kind !== 'word-practice') throw new Error('Missing word practice.');
  const magazine = course.words.find(word => word.kana === 'ざっし')!;
  expect(() => learningWordChoices(course, route, { ...step, wordId: magazine.id })).toThrow('Missing prepared quiz choices');
  const choices = learningWordChoices(course, route, step);
  const candidateId = choices.find(id => id !== step.wordId)!;
  for (const change of ['withdrawn', 'meaning', 'kind'] as const) {
    const modified = structuredClone(course); const candidate = modified.words.find(word => word.id === candidateId)!;
    if (change === 'withdrawn') candidate.reviewStatus = 'draft';
    if (change === 'meaning') candidate.meaningRu = modified.words.find(word => word.id === step.wordId)!.meaningRu;
    if (change === 'kind') candidate.kind = candidate.kind === 'word' ? 'phrase' : 'word';
    expect(() => learningWordChoices(modified, route, step)).toThrow('Invalid prepared quiz choice');
  }
  expect(learningWordChoices(course, route, step)).toEqual(choices);
});
