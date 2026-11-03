import { describe, expect, test } from 'bun:test';
import { readFileSync } from 'node:fs';
import { loadCourse } from '../src/server/course';
import { basicKana, smallKana, voicedKana, yoonKana } from '../src/shared/kana';
import { kanaChoices, kanaDeck, type KanaManifest } from '../src/client/kanaPractice';
import { sourceSpelling } from '../src/client/JapaneseText';

const manifest: KanaManifest = JSON.parse(readFileSync(new URL('../public/audio/kana-manifest.json', import.meta.url), 'utf8'));
const all = [...basicKana, ...voicedKana, ...yoonKana, ...smallKana].flatMap(row => row.cells.flatMap(cell => cell?.reading ? [cell] : []));
describe('reference drill presentation boundaries', () => {
  test('a selected vowel row contains both formats and never borrows an unrelated recording', () => {
    const selected = basicKana[0]!.cells.flatMap(cell => cell ? [cell] : []), before = structuredClone(selected);
    const deck = kanaDeck(selected, manifest); expect(deck).toHaveLength(10); expect(selected).toEqual(before);
    expect(deck.filter(question => question.format === 'reading')).toHaveLength(5); expect(deck.filter(question => question.format === 'listening')).toHaveLength(5);
    for (const question of deck) { expect(selected.some(entry => entry.kana === question.kana)).toBe(true); if (question.format === 'listening') expect(question.audioUrl).toBe(manifest.entries[question.kana]!.audioUrl); }
    const noRecordings = kanaDeck(selected, { entries: {} }); expect(noRecordings).toHaveLength(5); expect(noRecordings.every(question => question.format === 'reading')).toBe(true);
    expect(kanaDeck(all, manifest)).toHaveLength(20); expect(kanaDeck([], manifest)).toEqual([]);
  });
  test('reading and listening alternatives are unique by answer, including modern homophones', () => {
    for (const entry of all) for (const format of ['reading', 'listening'] as const) {
      const audio = manifest.entries[entry.kana]!; if (format === 'listening' && !audio.audioUrl) continue;
      const question = { ...entry, ...audio, format }, choices = kanaChoices(question, all, manifest);
      expect(choices).toHaveLength(4); expect(choices.some(choice => choice.kana === question.kana)).toBe(true);
      const keys = choices.map(choice => format === 'reading' ? choice.reading : manifest.entries[choice.kana]!.soundKey);
      expect(new Set(keys).size).toBe(4); expect(keys.filter(key => key === (format === 'reading' ? question.reading : question.soundKey))).toHaveLength(1);
    }
  });
  test('mixed Japanese text uses reviewed spellings while preserving unknown or draft-only kanji', () => {
    const course = loadCourse(), family = course.forms.find(form => form.surface === '家族' && form.reviewStatus !== 'draft')!; expect(family).toBeDefined();
    const source = { words: [], forms: [family] };
    const rendered = sourceSpelling('家族と未知𠮷', source); expect(rendered.surface).toBe('家族と未知𠮷'); expect(rendered.kana).toBe(family.kana + 'と未知𠮷'); expect(rendered.segments.slice(0, family.segments.length)).toEqual(family.segments);
    expect(sourceSpelling('家族', { words: [], forms: [{ ...family, reviewStatus: 'draft' }] }).kana).toBe('家族');
    expect(sourceSpelling('Неизвестный текст', source).kana).toBe('Неизвестный текст');
  });
});
