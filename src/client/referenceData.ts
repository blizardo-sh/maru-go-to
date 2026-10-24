import type { Course, Exercise } from '../shared/types';

export { basicKana, voicedKana, yoonKana, smallKana, katakana, type KanaEntry, type KanaRow } from '../shared/kana';

import { defaultCatalog } from '../shared/catalog';
export const particleSkills = defaultCatalog.particleSkills;

export function exampleValue(course: Course, exercise: Exercise) {
  const forms = new Map(course.forms.map(form => [form.id, form]));
  const tokens = new Map(exercise.tokens.map(token => [token.id, token]));
  const selected = (exercise.acceptedOrders[0] ?? exercise.tokens.map(token => token.id)).map(id => forms.get(tokens.get(id)?.formId ?? '')).filter(form => !!form);
  return { surface: selected.map(form => form.surface).join('') + exercise.sentenceEnd, kana: selected.map(form => form.kana).join('') + exercise.sentenceEnd, segments: [...selected.flatMap(form => form.segments), { surface: exercise.sentenceEnd }] };
}

export function examplesFor(course: Course, skillId: string, particle?: string): Exercise[] {
  return course.exercises.filter(exercise => exercise.skillId === skillId && (!particle || exercise.tokens.some(token => { const form = course.forms.find(value => value.id === token.formId); return form?.surface === particle; })));
}
