import type { Exercise, WordForm } from './types';

export function matchesPreparedAnswer(exercise: Exercise, forms: WordForm[], tokenIds: string[], tokenForms?: Record<string, string>): boolean {
  const tokens = new Map(exercise.tokens.map(token => [token.id, token.formId]));
  if (new Set(tokenIds).size !== tokenIds.length || tokenIds.some(id => !tokens.has(id))) return false;
  const formMap = new Map(forms.map(form => [form.id, form]));
  const identity = (formId: string | undefined) => {
    const form = formId ? formMap.get(formId) : undefined;
    return form ? JSON.stringify([form.wordId, form.surface, form.kana]) : null;
  };
  const selected = tokenIds.map(id => identity(tokenForms?.[id] ?? tokens.get(id)));
  return selected.every(value => value !== null) && exercise.acceptedOrders.some(order =>
    order.length === selected.length && order.every((id, index) => identity(tokens.get(id)) === selected[index]));
}
