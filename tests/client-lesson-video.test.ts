import { expect, test } from 'bun:test';
import { captionAt } from '../src/client/videoCaptions';
import { course, validateCourse } from '../src/shared/course';
import { createElement } from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { Textbook } from '../src/client/Textbook';
import { LessonVideoLibrary } from '../src/client/LessonVideo';
import { defaultSettings } from '../src/server/material';
import type { Snapshot } from '../src/client/types';
import type { LessonVideo, VideoCaption } from '../src/shared/types';

const captions: VideoCaption[] = [
  { startSeconds: 0, endSeconds: 1, text: null },
  { startSeconds: 1, endSeconds: 2.5, text: 'おはよう。' },
  { startSeconds: 2.5, endSeconds: 4, text: 'おはようございます。' },
  { startSeconds: 5, endSeconds: 6, text: 'こんにちは。' },
  { startSeconds: 6, endSeconds: null, text: null },
];
const video: LessonVideo = {
  id: 'marugoto.starter-a1.lesson.01', canDoId: 1, variant: 'practice',
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
  const withVideo = () => { const copy = structuredClone(course); copy.lessons[0]!.videos = copy.lessons[0]!.videos!.map(item => item.id === video.id ? structuredClone(video) : item); return copy; };
  const target = (copy: typeof course) => copy.lessons[0]!.videos!.find(item => item.id === video.id)!;
  validateCourse(withVideo());
  for (const [key, value] of [
    ['sourceUrl', 'javascript:alert(1)'], ['sourceUrl', 'https://a1.marugotoweb.jp/en/can-do23.php'],
    ['mediaUrl', 'https://example.test/video.mp4'], ['mediaUrl', 'https://a1.marugotoweb.jp/en/assets/movies/topics/cando_03_01.mp4'],
    ['captionsSourceUrl', 'https://example.test/captions.xml'], ['captionsSourceUrl', 'https://a1.marugotoweb.jp/en/assets/data/topics/cando_03_01.xml'], ['title', ' '], ['captionNote', ' '],
  ] as const) {
    const invalid = withVideo(); target(invalid)[key] = value;
    expect(() => validateCourse(invalid)).toThrow('video');
  }
  for (const invalidCaptions of [
    [], [{ startSeconds: -1, endSeconds: 1, text: 'あ' }], [{ startSeconds: NaN, endSeconds: 1, text: 'あ' }],
    [{ startSeconds: 1, endSeconds: 1, text: 'あ' }], [{ startSeconds: 0, endSeconds: Infinity, text: 'あ' }],
    [{ startSeconds: 0, endSeconds: null, text: 'あ' }], [{ startSeconds: 0, endSeconds: 1, text: ' ' }],
    [{ startSeconds: 0, endSeconds: 3, text: 'あ' }, { startSeconds: 2, endSeconds: 4, text: 'い' }],
    [{ startSeconds: 0, endSeconds: null, text: null }, { startSeconds: 2, endSeconds: 4, text: 'い' }],
  ]) {
    const invalid = withVideo(); target(invalid).captions = invalidCaptions;
    expect(() => validateCourse(invalid)).toThrow('video caption');
  }
});

test('all official dialogue entries are listed in the textbook without eager media elements', () => {
  const snapshot: Snapshot = { course, settings: defaultSettings, lists: [], learning: [], progress: { counters: [], introducedWordIds: [], introducedSkillIds: [], completedLessons: 0, totalLessons: 18, wordsIntroducedToday: 0, skillsIntroducedToday: 0, byMode: { 'ja-ru': {due:0,learned:0,reviewedToday:0}, 'ru-ja': {due:0,learned:0,reviewedToday:0}, listening: {due:0,learned:0,reviewedToday:0}, grammar: {due:0,learned:0,reviewedToday:0}, counter: {due:0,learned:0,reviewedToday:0} } } };
  const html = renderToStaticMarkup(createElement(Textbook, { data: snapshot, onLearn() {}, onTrain() {} }));
  const videos = course.lessons.flatMap(lesson => lesson.videos ?? []);
  expect(course.lessons.every(lesson => (lesson.videos?.length ?? 0) > 1)).toBe(true);
  expect(videos).toHaveLength(80);
  expect(html.match(/data-testid="lesson-video-library"/g)).toHaveLength(18);
  for (const material of videos) expect(html).toContain(`value="${material.id}"`);
  expect(html).not.toContain('<video');
  const two = renderToStaticMarkup(createElement(LessonVideoLibrary, { materials: [video, { ...video, id: 'fixture.challenge', variant: 'challenge', title: 'Вторая сценка' }] }));
  expect(two).toContain('Вторая сценка'); expect(two).toContain('Попробуйте сами'); expect(two).toContain('Сценка'); expect(two).not.toContain('<video');
});

test('the original four clip identities and honest classroom-caption gap remain available', () => {
  const lessons = course.lessons.slice(0, 4);
  const original = lessons.map(lesson => lesson.videos!.find(material => material.id === lesson.id)!);
  expect(original.every(Boolean)).toBe(true);
  expect(original.map(material => material.sourceUrl)).toEqual([1, 3, 5, 7].map(id => `https://a1.marugotoweb.jp/en/can-do${id}.php`));
  for (const { captions } of original) {
    expect(captions[captionAt(captions, .2)]?.text).toBeNull();
    expect(captions.some(caption => caption.text?.includes('★') || caption.text?.includes('*'))).toBe(false);
  }
  const classroom = original[1]!;
  expect(classroom.captions[captionAt(classroom.captions, 5.5)]?.text).toBeNull();
  expect(classroom.captionNote).toContain('5,5–9 с');
  expect(classroom.captions[captionAt(classroom.captions, 9)]?.text).toContain('ゆっくり');
});
