import assert from 'node:assert/strict';
import { writeFileSync, readFileSync, mkdirSync } from 'node:fs';
import { createHash } from 'node:crypto';
import { LessonFlow, lessonCatalog } from './lesson-flow.ts';

const sha = value => createHash('sha256').update(value).digest('hex');
assert.equal(sha(readFileSync(new URL('../../materials/course.json', import.meta.url))), lessonCatalog.courseSha256);
for (const [name, expected] of Object.entries(lessonCatalog.learningSha256)) assert.equal(sha(readFileSync(new URL('../../materials/learning/' + name, import.meta.url))), expected);
mkdirSync(new URL('./test-results/', import.meta.url), { recursive: true });
const flow = new LessonFlow(), results = [];
for (const lesson of lessonCatalog.lessons) {
  flow.open(lesson.id); flow.start(); let retried = false, steps = 0;
  const modes = new Set();
  while (!flow.progress().finished) {
    assert.ok(++steps < 500, 'A lesson must reach its end');
    const step = flow.step, ticket = flow.ticket(); assert.ok(step);
    let action = 'continue';
    if (step.kind === 'word-intro') {
      const first = flow.word.id;
      if (flow.part.words.length > 1) { assert.equal(flow.introduce(ticket, 1), true); assert.notEqual(flow.word.id, first); assert.equal(flow.introduce(ticket, 1), false, 'Stale intro event must be ignored'); }
      assert.equal(flow.advance(flow.ticket(), 'start-practice'), true); continue;
    }
    if (step.kind === 'word-practice' || step.kind === 'construction-practice') {
      modes.add(`${step.kind}/${step.mode}`); action = 'remember';
      if (step.kind === 'word-practice') { assert.equal(flow.choices.length, 4); assert.equal(flow.choices.filter(word => word.id === step.wordId).length, 1); }
      if (step.kind === 'construction-practice' && step.mode === 'grammar') {
        const exercise = flow.construction;
        const order = exercise.acceptedOrders[0];
        assert.equal(flow.checkConstruction(order), true);
        assert.equal(flow.checkConstruction([], exercise.example.surface), true);
        assert.equal(flow.checkConstruction([], 'неверно'), false);
      }
      if (!retried) { action = 'again'; retried = true; }
    }
    if (step.kind === 'video') { assert.ok(flow.video?.mediaUrl.startsWith('https://a1.marugotoweb.jp/')); action = 'skip'; }
    assert.equal(flow.advance(ticket, action), true);
    assert.equal(flow.advance(ticket, action), false, 'Repeated activation must not skip the next step');
  }
  assert.equal(flow.progress().percent, 100); assert.equal(flow.session.again, 1);
  const revision = flow.session.revision; flow.active = false; flow.start(); assert.equal(flow.session.revision, revision);
  results.push({ lesson: lesson.number, completed: flow.progress().completed, modes: [...modes], repeat: 'returned before completion', staleEvents: 'ignored' });
}
flow.open(lessonCatalog.lessons[0].id); flow.start(true); assert.equal(flow.progress().percent, 0);
assert.throws(() => flow.open('not-a-lesson'));
writeFileSync(new URL('./test-results/lesson-model.json', import.meta.url), JSON.stringify({ date: new Date().toISOString(), lessons: results }, null, 2) + '\n');
console.log(`All ${results.length} complete lesson routes passed; repeat, resume, restart and stale events passed.`);
