import type { Orthography, Segment, Word, WordForm } from '../shared/types';

export function Japanese({ value, mode }: { value: { surface: string; kana: string; segments: Segment[] }; mode: Orthography }) {
  return <span lang="ja" className="jp">{mode === 'kana' ? value.kana : mode === 'kanji' ? value.surface : value.segments.length ? value.segments.map((segment, index) => segment.reading && segment.reading !== segment.surface ? <ruby key={index}>{segment.surface}<rt>{segment.reading}</rt></ruby> : <span key={index}>{segment.surface}</span>) : value.surface}</span>;
}

const orthographies: [Orthography, string][] = [['kana', 'Кана'], ['furigana', 'С фуриганой'], ['kanji', 'Кандзи']];

export function DisplayControl({ mode, onChange, disabled }: { mode: Orthography; onChange: (value: Orthography) => void; disabled: boolean }) { return <label><span>Японское написание</span><select value={mode} onChange={event => onChange(event.target.value as Orthography)} disabled={disabled}>{orthographies.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>; }

/** Alternate spellings must belong to this lexeme and the same spoken form. */
export function verifiedKanji(word: Word, forms: WordForm[]): string | undefined {
  if (/\p{Script=Han}/u.test(word.surface)) return word.surface;
  return forms.find(form => form.wordId === word.id && form.kana === word.kana && form.reviewStatus !== 'draft' && /\p{Script=Han}/u.test(form.surface))?.surface;
}
