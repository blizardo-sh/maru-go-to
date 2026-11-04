import type { Exercise, WordForm } from '../../shared/types';

export function misplacedTokens(exercise: Exercise, forms: WordForm[], order: string[]): string[] {
  const tokens = new Map(exercise.tokens.map(t => [t.id, t.formId])), formMap = new Map(forms.map(f => [f.id, f]));
  const identity = (id: string) => { const form = formMap.get(tokens.get(id) ?? ''); return form ? JSON.stringify([form.wordId, form.surface, form.kana]) : null; };
  let best = [...order];
  for (const accepted of exercise.acceptedOrders) {
    if (accepted.length !== order.length) continue;
    const wrong = order.filter((id, index) => !identity(id) || identity(id) !== identity(accepted[index]!));
    if (wrong.length < best.length) best = wrong;
  }
  return best;
}
