import { expect, test } from 'bun:test';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { loadCourse } from '../src/server/course';
import { defaultSettings } from '../src/server/material';
import { Trainings } from '../src/client/Trainings';
import { Textbook } from '../src/client/Textbook';
import { Reference } from '../src/client/Reference';
import { inTrainingSection } from '../src/client/learning';
import type { Snapshot, StudySource } from '../src/client/types';
import type { SceneSound } from '../src/client/sceneSound';

const counts = { due: 0, learned: 0, reviewedToday: 0 };
const data: Snapshot = { course: loadCourse(), settings: defaultSettings, lists: [], progress: { counters: [], introducedWordIds: [], introducedSkillIds: [], completedLessons: 0, totalLessons: 18, wordsIntroducedToday: 0, skillsIntroducedToday: 0, byMode: { 'ja-ru': counts, 'ru-ja': counts, listening: counts, grammar: counts, counter: counts } } };
const sound: SceneSound = { state: 'muted', cue() {}, unlock() {}, setSpeechPlaying() {} };
const hub = (snapshot = data) => renderToStaticMarkup(createElement(Trainings, { data: snapshot, sound, onCounters() {}, onTopic() {}, onConstruction() {} }));
test('training catalog owns all standalone trainers while textbook starts directly with lessons', () => {
  const html = hub();
  for (const title of ['Тренировки', 'Счётные суффиксы', 'Вопросительные выражения', 'Часы и минуты', 'Тренировать хирагану', 'Тренировать катакану', 'Конструкции']) expect(html).toContain(title);
  expect(html).toContain('data-testid="train-construction" disabled');
  expect(html).not.toContain('Личные списки');
  const textbook = renderToStaticMarkup(createElement(Textbook, { data, onLearn() {}, onTrain() {} }));
  expect((textbook.match(/data-testid="learn-lesson"/g) ?? [])).toHaveLength(18);
  expect(textbook).not.toContain('counter-course'); expect(textbook).not.toContain('thematic-sections'); expect(textbook).not.toContain('train-kana');
});
test('construction selection is limited to learned skills; reference remains lookup and personal lists', () => {
  const skill = data.course.skills[0]!, snapshot = { ...data, progress: { ...data.progress, introducedSkillIds: [skill.id] } };
  const html = hub(snapshot); expect(html).toContain(`value="${skill.id}"`); expect(html).not.toContain('data-testid="train-construction" disabled');
  const reference = renderToStaticMarkup(createElement(Reference, { data: snapshot, refresh: async () => {}, onTrain() {} }));
  expect(reference).toContain('Хирагана'); expect(reference).toContain('Изученные конструкции'); expect(reference).toContain('Личные списки'); expect(reference).not.toContain('train-kana'); expect(reference).not.toContain('train-construction');
});
test('session section mapping moves topics, counters and constructions without moving lessons or personal lists', () => {
  const sources: StudySource[] = [{ kind: 'topic', topicId: 'questions' }, { kind: 'topic', topicId: 'time' }, { kind: 'counters' }, { kind: 'construction', skillId: 'learned', mode: 'ja-ru' }, { kind: 'guided', lessonId: 'lesson' }, { kind: 'lesson', lessonId: 'lesson' }, { kind: 'review' }, { kind: 'list', listId: 'private' }];
  expect(sources.map(inTrainingSection)).toEqual([true, true, true, true, false, false, false, false]);
});
