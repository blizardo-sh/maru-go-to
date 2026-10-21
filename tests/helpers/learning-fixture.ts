import { course as corpus } from '../../src/shared/course';
import type { GuidedLesson, LearningExample } from '../../src/shared/learning';
import type { Course } from '../../src/shared/types';

export function learningFixture(): Course & { learning: GuidedLesson[] } {
  const course = structuredClone(corpus);
  const lesson = course.lessons.find(item => item.number === 3)!;
  const words = course.words.filter(word => word.lessonIds.includes(lesson.id) && word.reviewStatus !== 'draft').slice(0, 3);
  for (const word of words) word.audioUrl = '/audio/fixture.m4a';
  const exercise = course.exercises.find(item => item.lessonId === lesson.id)!;
  exercise.reviewStatus = 'reviewed';
  course.skills.find(skill => skill.id === exercise.skillId)!.reviewStatus = 'reviewed';
  for (const token of exercise.tokens) course.forms.find(form => form.id === token.formId)!.reviewStatus = 'reviewed';
  const forms = exercise.acceptedOrders.find(order => order.length === exercise.tokens.length)!.map(id => course.forms.find(form => form.id === exercise.tokens.find(token => token.id === id)!.formId)!);
  const example: LearningExample = {
    surface: forms.map(form => form.surface).join('') + exercise.sentenceEnd,
    kana: forms.map(form => form.kana).join('') + exercise.sentenceEnd,
    segments: [...forms.flatMap(form => form.segments), ...(exercise.sentenceEnd ? [{ surface: exercise.sentenceEnd }] : [])],
    meaningRu: exercise.translationRu ?? exercise.promptRu,
    audioUrl: '/audio/learning/fixture-example.m4a',
  };
  const introduction = (index: number) => ({ wordId: words[index]!.id, explanationRu: 'Учебный пример для проверки механики.', example: { surface: words[index]!.surface, kana: words[index]!.kana, segments: words[index]!.segments, meaningRu: words[index]!.meaningRu, audioUrl: '/audio/learning/fixture-word.m4a' } });
  return { ...course, learning: [{ lessonId: lesson.id, version: 'fixture-v1', titleRu: lesson.title, goals: [
    { id: 'fixture-goal-1', titleRu: 'Знакомство', canDoIds: [lesson.canDoIds[0]!], parts: [{ id: 'fixture-part-1', words: [introduction(0), introduction(1)], construction: { exerciseId: exercise.id, explanationRu: 'Правило учебного примера.', example, breakdown: [{ text: forms[0]!.surface, explanationRu: 'Первая часть примера.' }] } }], ...(lesson.video ? { videoIds: [lesson.id] } : {}) },
    { id: 'fixture-goal-2', titleRu: 'Продолжение', canDoIds: [lesson.canDoIds[0]!], parts: [{ id: 'fixture-part-2', words: [introduction(2)] }] },
  ] }] };
}
