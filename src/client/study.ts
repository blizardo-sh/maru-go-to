import type { ReviewItem, ReviewResult } from '../shared/types';

export function advanceDeck(items: ReviewItem[], repeat: boolean, result?: ReviewResult): ReviewItem[] {
  const [current, ...rest] = items;
  if (repeat && current && current.mode !== 'grammar') {
    rest.splice(Math.min(3, rest.length), 0, { ...current, ...(result ? { version: result.version, due: result.nextDue, isNew: false } : {}) });
  }
  return rest;
}

export function isCurrentAnalysis(result: { revision: number; text: string }, revision: number, text: string): boolean {
  return result.revision === revision && result.text === text;
}

export function shuffledTokens(ids: string[]): string[] {
  const shuffled = [...ids];
  for (let index = shuffled.length - 1; index > 0; index--) {
    const other = Math.floor(Math.random() * (index + 1));
    [shuffled[index], shuffled[other]] = [shuffled[other]!, shuffled[index]!];
  }
  return shuffled;
}

export function gestureRating(horizontal: number, vertical: number): 1 | 3 | null {
  if (Math.abs(horizontal) < 64 || Math.abs(horizontal) < Math.abs(vertical) * 1.25) return null;
  return horizontal > 0 ? 3 : 1;
}
