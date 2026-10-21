import { expect, test } from 'bun:test';
import { loadCourse } from '../src/server/course';
import { evaluateTarget } from '../src/server/reviews';
import { learningParts } from '../src/shared/learning';

const course = loadCourse();

test('all 18 published routes cover their lesson goals and existing construction placements with complete audio-backed introductions', () => {
  expect(course.learning).toHaveLength(18);
  for (const lesson of course.lessons) {
    const route = course.learning!.find(item => item.lessonId === lesson.id)!;
    const goals = new Set(route.goals.flatMap(goal => goal.canDoIds));
    expect(lesson.canDoIds.every(id => goals.has(id))).toBe(true);
    const parts = route.goals.flatMap(goal => goal.parts);
    const exerciseIds = parts.flatMap(part => part.construction ? [part.construction.exerciseId] : []);
    for (const skill of course.skills.filter(skill => skill.lessonIds.includes(lesson.id))) {
      expect(exerciseIds.some(id => course.exercises.find(exercise => exercise.id === id)?.skillId === skill.id)).toBe(true);
    }
    expect(parts.every(part => part.words.length <= 5)).toBe(true);
    expect(learningParts(route).flat().filter(step => step.kind === 'word-practice')).toHaveLength(parts.reduce((count, part) => count + part.words.length * 3, 0));
    if (lesson.number <= 2) expect(exerciseIds).toHaveLength(0);
  }
});

test('every published worked construction and its authored equivalent answer are accepted by authoritative grading', () => {
  const skills = new Set<string>();
  let checked = 0;
  for (const route of course.learning!) for (const goal of route.goals) for (const part of goal.parts) {
    if (!part.construction) continue;
    const exercise = course.exercises.find(item => item.id === part.construction!.exerciseId)!;
    const skill = course.skills.find(item => item.id === exercise.skillId)!;
    expect(skill.reviewStatus).not.toBe('draft'); expect(exercise.reviewStatus).not.toBe('draft');
    for (const token of exercise.tokens) expect(course.forms.find(form => form.id === token.formId)?.reviewStatus).not.toBe('draft');
    for (const tokenIds of exercise.acceptedOrders) expect(evaluateTarget(course, exercise.id, { tokenIds, revision: 0 }).outcome).toBe('correct');
    skills.add(skill.id); checked++;
  }
  expect(checked).toBeGreaterThanOrEqual(course.skills.length);
  expect(skills.size).toBe(course.skills.length);
});

test('lesson one starts with ready greetings and script context while keeping illustrative nouns in the supplementary dictionary', () => {
  const first = course.lessons.find(lesson => lesson.number === 1)!;
  const route = course.learning!.find(item => item.lessonId === first.id)!;
  const coreIds = new Set(route.goals.flatMap(goal => goal.parts.flatMap(part => part.words.map(word => word.wordId))));
  for (const surface of ['おはようございます', 'こんにちは', 'こんばんは', 'ありがとうございます']) {
    const word = course.words.find(word => word.surface === surface && word.lessonIds.includes(first.id))!;
    expect(coreIds.has(word.id)).toBe(true); expect(word.reviewStatus).not.toBe('draft'); expect(word.audioUrl).toBeTruthy();
  }
  for (const meaning of ['журнал', 'газет', 'яйц']) {
    const entries = course.words.filter(word => word.lessonIds.includes(first.id) && word.meaningRu.toLowerCase().includes(meaning));
    expect(entries.length).toBeGreaterThan(0);
    expect(entries.every(word => !coreIds.has(word.id))).toBe(true);
  }
});
