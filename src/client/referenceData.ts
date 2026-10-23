import type { Course, Exercise } from '../shared/types';

export { basicKana, voicedKana, yoonKana, smallKana, katakana, type KanaEntry, type KanaRow } from '../shared/kana';

// These are indexes into existing course explanations, not new grammar rules.
export const particleSkills: Record<string, string[]> = {
  'は': ['wa_identity'], 'が': ['ga_ability', 'ga_liking', 'inanimate_existence', 'ga_desire'],
  'も': ['mo_addition'], 'と': ['to_noun_list', 'companion_residence'],
  'の': ['no_relation', 'no_spatial_relation'], 'を': ['o_object', 'boarding', 'noun_o_kudasai'],
  'で': ['de_activity_place', 'de_event_place', 'route_transport'],
  'に': ['ni_residence', 'ni_action_time', 'ni_event_time', 'ni_purpose', 'ageru', 'morau'],
  'から': ['kara_made_time', 'route_transport', 'kara_reason'], 'まで': ['kara_made_time', 'route_transport'],
  'か': ['wa_identity', 'price_question'],
};

export function exampleValue(course: Course, exercise: Exercise) {
  const forms = new Map(course.forms.map(form => [form.id, form]));
  const tokens = new Map(exercise.tokens.map(token => [token.id, token]));
  const selected = (exercise.acceptedOrders[0] ?? exercise.tokens.map(token => token.id)).map(id => forms.get(tokens.get(id)?.formId ?? '')).filter(form => !!form);
  return { surface: selected.map(form => form.surface).join('') + exercise.sentenceEnd, kana: selected.map(form => form.kana).join('') + exercise.sentenceEnd, segments: [...selected.flatMap(form => form.segments), { surface: exercise.sentenceEnd }] };
}

export function examplesFor(course: Course, skillId: string, particle?: string): Exercise[] {
  return course.exercises.filter(exercise => exercise.skillId === skillId && (!particle || exercise.tokens.some(token => { const form = course.forms.find(value => value.id === token.formId); return form?.surface === particle; })));
}
