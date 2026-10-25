import { Japanese } from '../../Japanese';
import type { Orthography, Segment, Word } from '../../../shared/types';
import { course } from './catalog';

export type Spelling = { surface: string; kana: string; segments: Segment[] };
const readings = new Map<string, Set<string>>();
for (const form of course.forms.filter(value => value.reviewStatus !== 'draft' && /\p{Script=Han}/u.test(value.surface))) {
  const values = readings.get(form.surface) ?? new Set<string>(); values.add(form.kana); readings.set(form.surface, values);
}
const unambiguous = course.forms.filter(value => value.reviewStatus !== 'draft' && readings.get(value.surface)?.size === 1).sort((a,b) => b.surface.length - a.surface.length);

export function spelling(text: string): Spelling {
  const form = course.forms.find(value => value.surface === text && value.reviewStatus !== 'draft');
  if (form) return form;
  const word = course.words.find(value => value.surface === text);
  if (word) return word;
  const segments: Segment[] = [];
  for (let offset = 0; offset < text.length;) {
    const known = unambiguous.find(value => text.startsWith(value.surface, offset));
    if (known) { segments.push(...known.segments); offset += known.surface.length; }
    else { const character = String.fromCodePoint(text.codePointAt(offset)!); segments.push({ surface: character }); offset += character.length; }
  }
  return { surface: text, kana: segments.map(value => value.reading ?? value.surface).join(''), segments };
}

export function wordSpelling(word: Word): Spelling {
  return course.forms.find(value => value.wordId === word.id && value.kana === word.kana && value.reviewStatus !== 'draft' && /\p{Script=Han}/u.test(value.surface)) ?? word;
}

/** Only Japanese runs receive Japanese typography; Russian controls keep the body font. */
export function MixedText({ text, mode = 'furigana' }: { text: string; mode?: Orthography }) {
  return <>{text.split(/([\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}ー々]+)/u).map((piece, index) => /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}]/u.test(piece) ? <Japanese key={index} value={spelling(piece)} mode={mode} /> : piece)}</>;
}
