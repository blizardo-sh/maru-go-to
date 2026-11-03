import type { Course, Orthography, Segment } from '../shared/types';
import { Japanese } from './Japanese';

/** Reading comes only from reviewed course spellings, never from a guessed kanji reading. */
export function sourceSpelling(text: string, course: Pick<Course, 'words' | 'forms'>, spellings: { surface: string; segments: Segment[] }[] = []) {
  const values = [...spellings, ...[...course.forms, ...course.words].filter(value => value.reviewStatus !== 'draft')].sort((a, b) => b.surface.length - a.surface.length);
  const segments: Segment[] = [];
  for (let offset = 0; offset < text.length;) {
    const value = values.find(value => value.surface && text.startsWith(value.surface, offset));
    if (value) { segments.push(...value.segments); offset += value.surface.length; }
    else { const character = String.fromCodePoint(text.codePointAt(offset)!); segments.push({ surface: character }); offset += character.length; }
  }
  return { surface: text, kana: segments.map(segment => segment.reading ?? segment.surface).join(''), segments };
}

export function JapaneseText({ text, course, mode, spellings }: { text: string; course: Pick<Course, 'words' | 'forms'>; mode: Orthography; spellings?: { surface: string; segments: Segment[] }[] }) {
  return <>{text.split(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]+)/u).map((piece, index) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(piece) ? <Japanese key={index} value={sourceSpelling(piece, course, spellings)} mode={mode} /> : piece)}</>;
}
