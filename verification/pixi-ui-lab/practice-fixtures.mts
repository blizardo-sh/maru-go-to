import { writeFileSync } from 'node:fs';
import { loadCourse } from './.local/rehearsal-20261028/server-release/src/server/course';
import { learningParts } from './.local/rehearsal-20261028/server-release/src/shared/learning';
import { learningWordChoices } from './.local/rehearsal-20261028/server-release/src/shared/learningChoices';
const course = loadCourse(), route = course.learning!.find(route => route.lessonId.endsWith('.02'))!;
const parts = route.goals.flatMap(goal => goal.parts), familiar = parts[0]!.words.map(intro => intro.wordId), introduced = parts[1]!.words;
const baseline = learningParts(route).flat().filter(step => step.kind === 'word-practice' && step.partId === parts[1]!.id).map(step => {
  if (step.kind !== 'word-practice') throw new Error('Unexpected step');
  return { id: step.id, wordId: step.wordId, mode: step.mode, choices: learningWordChoices(course, route, step) };
});
const ids = new Set([...familiar, ...introduced.map(word => word.wordId), ...baseline.flatMap(card => card.choices)]);
writeFileSync(new URL('./practice-fixtures.json', import.meta.url), JSON.stringify({ source: 'Public b378 course only; controlled familiar group, no learner state', familiar, introduced, baseline, words: course.words.filter(word => ids.has(word.id)) }, null, 2) + '\n');
