import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadCourse } from '../../src/server/course.ts';
import { counterKinds, makeCounterCard, counterDefinitions, objectFor } from '../../src/shared/counters.ts';
import { counterAudio } from '../../src/server/counter-audio.ts';

const course = loadCourse();
const previous = JSON.parse(readFileSync(new URL('./fixtures.json', import.meta.url)));
const introductions = course.learning.flatMap(lesson => lesson.goals.flatMap(goal => goal.parts.flatMap(part => part.words)));
function previewWord(word) {
  return { id: word.id, surface: word.surface, kana: word.kana, segments: word.segments, meaningRu: word.meaningRu,
    audioUrl: word.audioUrl ?? null, introduction: introductions.find(intro => intro.wordId === word.id) ?? null,
    illustration: previous.words.find(value => value.id === word.id)?.illustration ?? null };
}
const words = previous.words.map(value => {
  const word = course.words.find(word => word.id === value.id);
  assert.ok(word?.audioUrl && existsSync(new URL('../../public' + word.audioUrl, import.meta.url)));
  return previewWord(word);
});
const available = course.words.filter(word => word.reviewStatus !== 'draft');
const pencil = available.find(word => objectFor(word)?.id === 'pencil') ?? available.find(word => objectFor(word)?.counters.includes('hon'));
assert.ok(pencil);
const counterCards = counterKinds.map(kind => {
  const category = kind === 'image-counter' || kind === 'counter-image';
  const card = makeCounterCard(`hon/${kind}/${category ? 0 : 3}`, pencil.id, course.words.filter(word => word.reviewStatus !== 'draft'), 'pixi-overhead-v2');
  assert.ok(card);
  return { ...card, audioUrl: counterAudio(card.definition, card.quantity) ?? null, examples: card.examples.map((example, index) => ({ ...example, audioUrl: counterAudio(card.definition, [1, 3, 8][index]) ?? null })) };
});
const video = course.lessons.flatMap(lesson => lesson.videos ?? []).find(video => video.mediaUrl.endsWith('/cando_01_01.mp4'));
assert.ok(video?.captions.length);
assert.equal(counterCards.length, 5);
assert.equal(course.lessons.length, 18);
assert.ok(counterCards.find(card => card.kind === 'listening-image').audioUrl);
const result = {
  source: 'loadCourse() + makeCounterCard() + existing counterAudio() paths; read-only snapshot',
  courseSha256: createHash('sha256').update(readFileSync(new URL('../../materials/course.json', import.meta.url))).digest('hex'),
  words, construction: previous.construction, counterCards, counterDefinition: counterDefinitions.find(definition => definition.id === 'hon'),
  lessons: course.lessons.map(lesson => ({ id: lesson.id, number: lesson.number, title: lesson.title, topic: lesson.topic,
    words: course.words.filter(word => word.lessonIds.includes(lesson.id) && word.reviewStatus !== 'draft').length,
    previewWords: course.words.filter(word => word.lessonIds.includes(lesson.id) && word.reviewStatus !== 'draft' && word.audioUrl).slice(0, 4).map(previewWord) })),
  video,
};
writeFileSync(new URL('./paper-fixtures.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ words: words.length, counters: counterCards.map(card => ({ kind: card.kind, options: card.options.length, audio: card.audioUrl })), lessons: result.lessons.length, video: video.id }));
