import type { CourseCatalog } from './catalog';
import { katakana } from './kana';
import type { Rating, ReviewSchedule } from './types';

export type KanaScript = 'hiragana' | 'katakana';
export type KanaDirection = 'sign-reading' | 'reading-sign';
export type KanaMode = 'learn' | 'review' | 'practice';
export type KanaStudyItem = {
 script: KanaScript; direction: KanaDirection; glyph: string; reading: string;
 version: number; due: string | null; schedule: ReviewSchedule; attempts: number; errors: number;
};
export type KanaOverview = { items: KanaStudyItem[]; dueCount: number; nextDue: string | null };
export type KanaSubmission = Pick<KanaStudyItem, 'script' | 'direction' | 'glyph' | 'version'> & {
 attemptId: string; rating: Rating; mode: KanaMode;
};
export type KanaResult = { attemptId: string; scheduled: boolean; item: KanaStudyItem };
export const kanaItemKey = (item: Pick<KanaStudyItem, 'script' | 'direction' | 'glyph'>) => [item.script, item.direction, item.glyph].join(':');

export function kanaEntries(catalog: CourseCatalog, script: KanaScript) {
 return [...new Map(['basic', 'voiced', 'yoon'].flatMap(group => catalog.kana[group as 'basic' | 'voiced' | 'yoon']
  .flatMap(row => row.cells.flatMap(entry => entry?.reading ? [{ glyph: script === 'katakana' ? katakana(entry.kana) : entry.kana, reading: entry.reading }] : [])))
  .map(entry => [entry.glyph, entry])).values()];
}
