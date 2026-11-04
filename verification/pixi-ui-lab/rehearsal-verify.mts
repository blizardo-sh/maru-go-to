import assert from 'node:assert/strict';
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { SQL } from 'bun';
import { fingerprint } from './rehearsal-audit';
import { contentId, currentPublication } from './.local/rehearsal-20261028/server-release/src/server/publications';
import { learningOverview } from './.local/rehearsal-20261028/server-release/src/server/learning';
import { settingsFor } from './.local/rehearsal-20261028/server-release/src/server/material';
import { listsFor } from './.local/rehearsal-20261028/server-release/src/server/words';
import { progressFor } from './.local/rehearsal-20261028/server-release/src/server/reviews';
const root = new URL('./.local/rehearsal-20261028/', import.meta.url);
const runtime = JSON.parse(readFileSync(new URL('runtime.json', root), 'utf8'));
assert.equal(new URL(runtime.database).hostname, '127.0.0.1');
assert.equal(new URL(runtime.database).pathname, '/japanese_pixi_work');
const before = JSON.parse(readFileSync(new URL('initial-audit.json', root), 'utf8'));
const target = JSON.parse(readFileSync(new URL('login.json', root), 'utf8'))[1].id;
const realDate = Date, comparisonAnchor = new Date().toISOString();
// Due checks share one instant; SQL "today" must remain in the same UTC day.
globalThis.Date = new Proxy(Date, { construct(target, args) { return Reflect.construct(target, args.length ? args : [comparisonAnchor]); }, get(target, key) { return key === 'now' ? () => new realDate(comparisonAnchor).getTime() : Reflect.get(target, key); } });
const baseline = new SQL(runtime.baseline), work = new SQL(runtime.database);
const tableRows = (sql: SQL, table: string) => sql.unsafe(`select to_jsonb(t)::text as row from "${table}" t order by to_jsonb(t)::text`);
try {
  assert.deepEqual(await fingerprint(baseline), before.baseline, 'Immutable baseline changed');
  const users = await baseline`select id from users order by id`;
  const study = ['preferences', 'word_lists', 'personal_words', 'review_states', 'review_attempts', 'learning_states', 'learning_attempts', 'counter_progress', 'study_progress'];
  const course = await currentPublication({ sql: baseline } as any);
  const allowedLessons = new Set(['marugoto.starter-a1.lesson.01', 'marugoto.starter-a1.lesson.02']);
  const allowedItems = new Set(course.words.filter(word => word.lessonIds.some(id => allowedLessons.has(id))).map(word => word.id));
  for (const skill of course.skills) if (skill.lessonIds.some(id => allowedLessons.has(id))) allowedItems.add(skill.id);
  let preservedHistory = 0, addedAttempts = 0, preservedStudyRows = 0;
  for (const table of study) {
    const original = (await tableRows(baseline, table)).map((r: any) => r.row as string);
    const current = (await tableRows(work, table)).map((r: any) => r.row as string);
    const currentSet = new Set(current), originalSet = new Set(original);
    for (const row of original) {
      const value = JSON.parse(row);
      const mutable = value.user_id === target && ['review_states', 'learning_states', 'study_progress'].includes(table) &&
        (table === 'learning_states' ? allowedLessons.has(value.lesson_id) : allowedItems.has(value.item_id));
      if (!mutable) { assert.ok(currentSet.has(row), `Existing ${table} row changed unexpectedly`); preservedStudyRows++; }
      if (table.endsWith('_attempts')) preservedHistory++;
    }
    for (const row of current) if (!originalSet.has(row)) {
      const value = JSON.parse(row); assert.equal(value.user_id, target, `Other pupil changed in ${table}`);
      if (table === 'learning_states' || table === 'learning_attempts') assert.ok(allowedLessons.has(value.lesson_id));
      else assert.ok(allowedItems.has(value.item_id), `Unexpected material changed in ${table}`);
      if (table.endsWith('_attempts')) addedAttempts++;
      else assert.ok(['review_states', 'learning_states', 'study_progress'].includes(table));
    }
  }
  // Auth secrets/sessions differ locally by design; identities and published content do not.
  for (const table of ['users', 'content_active', 'content_publications', 'access_links', 'registration_links', 'verifications']) {
    assert.deepEqual(await tableRows(work, table), await tableRows(baseline, table), `Unexpected ${table} change`);
  }
  for (const { id } of users) if (id !== target) {
    const a = { sql: baseline } as any, b = { sql: work } as any;
    assert.deepEqual(await learningOverview(a, id, course), await learningOverview(b, id, course));
    assert.deepEqual(await settingsFor(a, id), await settingsFor(b, id));
    assert.deepEqual(await listsFor(a, id), await listsFor(b, id));
    const progress = (value: any) => ({ ...value, introducedWordIds: [...value.introducedWordIds].sort(), introducedSkillIds: [...value.introducedSkillIds].sort(), counters: [...value.counters].sort((a, b) => a.counterId.localeCompare(b.counterId)) });
    assert.deepEqual(progress(await progressFor(a, id, course)), progress(await progressFor(b, id, course)));
  }
  let assets = 0;
  for (const publication of await baseline`select id,bundle from content_publications`) {
    assert.equal(contentId(publication.bundle), publication.id);
    for (const asset of publication.bundle.assets) {
      let path = join(root.pathname, 'content/media', asset.path.slice(1));
      if (!existsSync(path)) path = join(root.pathname, 'server-release/public', asset.path.slice(1));
      const bytes = readFileSync(path); assert.equal(bytes.length, asset.bytes);
      assert.equal(createHash('sha256').update(bytes).digest('hex'), asset.sha256); assets++;
    }
  }
  assert.equal(new realDate().toISOString().slice(0, 10), comparisonAnchor.slice(0, 10), 'UTC day changed during comparison; rerun');
  const report = { at: new realDate().toISOString(), comparisonAnchor, snapshot: runtime.snapshot, source: runtime.source,
    dumpSha256: createHash('sha256').update(readFileSync(new URL('database.dump', root))).digest('hex'), postgres: '18.6',
    initialCloneIdentical: before.identical, baselineStillIdentical: true, pupilCount: users.length, otherPupilsUnchanged: users.length - 1,
    preservedStudyRows, preservedHistoryRows: preservedHistory, addedLocalAttempts: addedAttempts,
    userIdentitiesUnchanged: true, publicationsUnchanged: true, publicationAssetHashChecks: assets,
    otherPupilsApiProgressSettingsListsRoutesEqual: true, priorAttemptsUnchanged: true,
    localAuthException: 'Only working-clone passwords/sessions of two profiles; original user identities and baseline retained',
    browser: JSON.parse(readFileSync(new URL('browser-report.json', root), 'utf8')),
    protocol: JSON.parse(readFileSync(new URL('protocol-report.json', root), 'utf8')),
    safari: JSON.parse(readFileSync(new URL('safari-report.json', root), 'utf8')),
    waiting: JSON.parse(readFileSync(new URL('waiting-report.json', root), 'utf8')),
    offlineRegression: { chromeLayouts: ['390x844', '320x640', '1280x900', '844x390'], externalVideoPlayback: 'timed-out; HTTP HEAD/Range available; no CSP violation', fullSuitePassed: false } };
  writeFileSync(new URL('./checks-connected-2026-10-28.json', import.meta.url), JSON.stringify(report, null, 2) + '\n');
  console.log(JSON.stringify({ passed: true, pupils: report.pupilCount, otherPupilsUnchanged: report.otherPupilsUnchanged, preservedHistory, assets }));
} finally { globalThis.Date = realDate; await baseline.close(); await work.close(); }
