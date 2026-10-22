import { expect, test } from 'bun:test';
import { loadCourse } from '../src/server/course';

test('five family kanji aliases have verified readings/provenance while the original kana words and forms stay primary', () => {
  const course = loadCourse();
  const source = 'https://marugoto.jpf.go.jp/assets/docs/download/intermediate2/MarugotoIntermediate2KanjiList.pdf';
  for (const [kana, kanji, page, entry] of [
    ['かぞく', '家族', 3, 236], ['ちち', '父', 1, 67], ['はは', '母', 1, 68], ['あに', '兄', 3, 230], ['あね', '姉', 3, 232],
  ] as const) {
    const word = course.words.find(word => word.surface === kana)!;
    expect(word.kana).toBe(kana);
    const forms = course.forms.filter(form => form.wordId === word.id);
    expect(forms.some(form => form.surface === kana && form.kana === kana)).toBe(true);
    const aliases = forms.filter(form => form.surface === kanji);
    expect(aliases).toHaveLength(1);
    const alias = aliases[0]!;
    expect(alias.reviewStatus).toBe('reviewed');
    expect(alias.kana).toBe(kana);
    expect(alias.lessonIds).toEqual(word.lessonIds);
    expect(alias.segments.map(segment => segment.surface).join('')).toBe(kanji);
    expect(alias.segments.map(segment => segment.reading ?? segment.surface).join('')).toBe(kana);
    expect(alias.sourceRefs).toContainEqual({ part: 'rikai', url: source, page, entry: `${entry} ${kanji} ${kana}`, label: `Marugoto · сводный Kanji Word List · №${entry}` });
  }
});
