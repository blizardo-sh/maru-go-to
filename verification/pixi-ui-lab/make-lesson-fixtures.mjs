import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, readdirSync, existsSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { loadCourse } from '../../src/server/course.ts';
import { learningParts } from '../../src/shared/learning.ts';
import { learningWordChoices } from '../../src/shared/learningChoices.ts';

const course = loadCourse(), wordMap = new Map(course.words.map(word => [word.id, word]));
const formMap = new Map(course.forms.map(form => [form.id, form]));
const words = new Map(), constructions = new Map();
function addWord(id) {
  const word = wordMap.get(id); assert.ok(word?.audioUrl);
  assert.ok(existsSync(new URL('../../public' + word.audioUrl, import.meta.url)));
  const { surface, kana, segments, meaningRu, audioUrl } = word;
  words.set(id, { id, surface, kana, segments, meaningRu, audioUrl });
}
const lessons = course.learning.map(route => {
  const lesson = course.lessons.find(value => value.id === route.lessonId), choices = {};
  for (const step of learningParts(route).flat()) {
    if (step.kind === 'word-intro') addWord(step.wordId);
    if (step.kind === 'word-practice') {
      choices[step.id] = learningWordChoices(course, route, step);
      choices[step.id].forEach(addWord);
    }
  }
  for (const part of route.goals.flatMap(goal => goal.parts)) if (part.construction) {
    const intro = part.construction, exercise = course.exercises.find(value => value.id === intro.exerciseId);
    assert.ok(exercise);
    const tokens = exercise.tokens.map(token => {
      const form = formMap.get(token.formId); assert.ok(form);
      return { id: token.id, surface: form.surface, kana: form.kana,
        identity: JSON.stringify([form.wordId, form.surface, form.kana]) };
    });
    const byId = new Map(tokens.map(token => [token.id, token]));
    constructions.set(intro.exerciseId, { ...intro, promptRu: exercise.promptRu, tokens, sentenceEnd: exercise.sentenceEnd,
      acceptedOrders: exercise.acceptedOrders.map(order => order.map(id => tokens.findIndex(token => token.id === id))),
      acceptedIdentities: exercise.acceptedOrders.map(order => order.map(id => byId.get(id).identity)),
      acceptedTexts: exercise.acceptedOrders.map(order => order.map(id => byId.get(id).surface).join('') + exercise.sentenceEnd) });
  }
  const { authored, ...definition } = route;
  return { id: lesson.id, number: lesson.number, title: lesson.title, topic: lesson.topic, route: definition,
    choices, videos: lesson.videos ?? [] };
});
assert.equal(lessons.length, 18);
const learningDir = new URL('../../materials/learning/', import.meta.url);
const sha = value => createHash('sha256').update(value).digest('hex');
const result = { source: 'Read-only loadCourse(), learningParts(), learningWordChoices(); complete authored routes, no API/DB',
  courseSha256: sha(readFileSync(new URL('../../materials/course.json', import.meta.url))),
  learningSha256: Object.fromEntries(readdirSync(learningDir).filter(name => /^lesson-\d{2}\.json$/.test(name)).sort().map(name => [name, sha(readFileSync(new URL(name, learningDir)))])),
  lessons, words: [...words.values()], constructions: [...constructions.values()] };
writeFileSync(new URL('./lesson-fixtures.json', import.meta.url), JSON.stringify(result, null, 2) + '\n');
console.log(JSON.stringify({ lessons: lessons.length, words: words.size, constructions: constructions.size,
  steps: lessons.map(lesson => ({ lesson: lesson.number, steps: learningParts(lesson.route).flat().length })) }));
