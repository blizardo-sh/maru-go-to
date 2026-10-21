import { expect, test } from 'bun:test';
import { captionAt } from '../src/client/videoCaptions';
import { course, validateCourse } from '../src/shared/course';
import type { LessonVideo, VideoCaption } from '../src/shared/types';

const captions: VideoCaption[] = [
  { startSeconds: 0, endSeconds: 1, text: null },
  { startSeconds: 1, endSeconds: 2.5, text: 'おはよう。' },
  { startSeconds: 2.5, endSeconds: 4, text: 'おはようございます。' },
  { startSeconds: 5, endSeconds: 6, text: 'こんにちは。' },
  { startSeconds: 6, endSeconds: null, text: null },
];
const video: LessonVideo = {
  title: 'Приветствие', sourceUrl: 'https://a1.marugotoweb.jp/en/can-do1.php',
  mediaUrl: 'https://a1.marugotoweb.jp/en/assets/movies/topics/cando_01_01.mp4',
  captionsSourceUrl: 'https://a1.marugotoweb.jp/en/assets/data/topics/cando_01_01.xml', captions,
};

test('video captions use media time at boundaries, gaps and backwards seeks without retaining old text', () => {
  const textAt = (time: number) => captions[captionAt(captions, time)]?.text ?? null;
  expect([0, 1, 2.499, 2.5, 4, 5, 6, 20, 1.1].map(textAt)).toEqual([
    null, 'おはよう。', 'おはよう。', 'おはようございます。', null, 'こんにちは。', null, null, 'おはよう。',
  ]);
  for (const time of [-1, NaN, Infinity]) expect(captionAt(captions, time)).toBe(-1);
  expect(captionAt([], 1)).toBe(-1);
});

test('lesson video validates its official lesson source, bounded intervals and blank end', () => {
  const withVideo = () => { const copy = structuredClone(course); copy.lessons[0]!.video = structuredClone(video); return copy; };
  validateCourse(withVideo());
  for (const [key, value] of [
    ['sourceUrl', 'javascript:alert(1)'], ['sourceUrl', 'https://a1.marugotoweb.jp/en/can-do23.php'],
    ['mediaUrl', 'https://example.test/video.mp4'], ['mediaUrl', 'https://a1.marugotoweb.jp/en/assets/movies/topics/cando_03_01.mp4'],
    ['captionsSourceUrl', 'https://example.test/captions.xml'], ['captionsSourceUrl', 'https://a1.marugotoweb.jp/en/assets/data/topics/cando_03_01.xml'], ['title', ' '], ['captionNote', ' '],
  ] as const) {
    const invalid = withVideo(); invalid.lessons[0]!.video![key] = value;
    expect(() => validateCourse(invalid)).toThrow('video');
  }
  for (const invalidCaptions of [
    [], [{ startSeconds: -1, endSeconds: 1, text: 'あ' }], [{ startSeconds: NaN, endSeconds: 1, text: 'あ' }],
    [{ startSeconds: 1, endSeconds: 1, text: 'あ' }], [{ startSeconds: 0, endSeconds: Infinity, text: 'あ' }],
    [{ startSeconds: 0, endSeconds: null, text: 'あ' }], [{ startSeconds: 0, endSeconds: 1, text: ' ' }],
    [{ startSeconds: 0, endSeconds: 3, text: 'あ' }, { startSeconds: 2, endSeconds: 4, text: 'い' }],
    [{ startSeconds: 0, endSeconds: null, text: null }, { startSeconds: 2, endSeconds: 4, text: 'い' }],
  ]) {
    const invalid = withVideo(); invalid.lessons[0]!.video!.captions = invalidCaptions;
    expect(() => validateCourse(invalid)).toThrow('video caption');
  }
});

test('the first four lessons have source-linked video without invented scene or masked-phrase captions', () => {
  const lessons = course.lessons.filter(lesson => lesson.video);
  expect(lessons.map(lesson => lesson.number)).toEqual([1, 2, 3, 4]);
  expect(lessons.map(lesson => lesson.video!.sourceUrl)).toEqual([1, 3, 5, 7].map(id => `https://a1.marugotoweb.jp/en/can-do${id}.php`));
  expect(lessons.map(lesson => lesson.video!.captions.filter(caption => caption.text).length)).toEqual([12, 2, 8, 6]);
  for (const lesson of lessons) {
    const { captions } = lesson.video!;
    expect(captions[captionAt(captions, .2)]?.text).toBeNull();
    expect(captions.some(caption => caption.text?.includes('★') || caption.text?.includes('*'))).toBe(false);
  }
  const classroom = lessons[1]!.video!;
  expect(classroom.captions[captionAt(classroom.captions, 5.5)]?.text).toBeNull();
  expect(classroom.captionNote).toContain('5,5–9 с');
  expect(classroom.captions[captionAt(classroom.captions, 9)]?.text).toContain('ゆっくり');
});
