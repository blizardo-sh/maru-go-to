// M8: historical assertions replayed against root sources and main build, isolated synthetic clone.
import './guard.mjs';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { connectDatabase } from '../../src/server/db';
import { currentPublication } from '../../src/server/publications';
import { createLink, consumeLink } from '../../src/server/auth';
import { learningParts } from '../../src/shared/learning';
const path = new URL('./.local/runtime.json', import.meta.url), runtime = JSON.parse(readFileSync(path, 'utf8')), url = new URL(runtime.database);
assert.equal(url.hostname, '127.0.0.1'); assert.match(url.pathname, /^\/japanese_pixi_m8_published_[0-9]+$/);
const db = connectDatabase(url.href);
try {
  const course = await currentPublication(db);
  const choices = course.learning!.flatMap(route => learningParts(route).flatMap((steps, partIndex) => steps.filter(step => step.kind === 'construction-practice' && step.mode === 'grammar').map(step => ({ route, partIndex, step, exercise: course.exercises.find(exercise => step.kind === 'construction-practice' && exercise.id === step.exerciseId)! }))));
  choices.sort((a,b) => b.exercise.tokens.length - a.exercise.tokens.length);
  const chosen = choices[0]!; assert.ok(chosen.exercise.tokens.length > 4);
  runtime.workspaceUsers = [];
  for (let i = 0; i < 2; i++) {
    const email = `m6-workspace-${crypto.randomUUID()}@example.test`, password = crypto.randomUUID() + crypto.randomUUID();
    const link = await createLink(db, 'invite', email, null); assert.equal(await consumeLink(db, 'invite', link.token, password, 'Проверка M6'), true);
    const owner = (await db.sql`select id from users where email=${email}`)[0]!.id, parts = learningParts(chosen.route);
    const state = { partIndex: chosen.partIndex, completedStepIds: parts.slice(0,chosen.partIndex + 1).flat().filter(step => step.id !== chosen.step.id && step.kind !== 'part-complete' && step.kind !== 'video').map(step => step.id), pendingStepIds: [chosen.step.id, ...parts[chosen.partIndex]!.filter(step => step.kind === 'part-complete' || step.kind === 'video').map(step => step.id)], recallPolicy: 'recall-v1' };
    await db.sql`insert into learning_states(user_id,lesson_id,publication_id,route_version,version,state) values(${owner},${chosen.route.lessonId},${course.publicationId!},${chosen.route.version},1,${state})`;
    runtime.workspaceUsers.push({ email, password });
  }
  runtime.workspaceLesson = chosen.route.lessonId; runtime.workspaceExercise = chosen.exercise;
  writeFileSync(path, JSON.stringify(runtime), { mode: 0o600 }); console.log(JSON.stringify({ syntheticWorkspaceProfiles: 2, longestPublishedGuidedExerciseTokens: chosen.exercise.tokens.length }));
} finally { await db.sql.close(); }
