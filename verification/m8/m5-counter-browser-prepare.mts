// M8: historical assertions replayed against root sources and main build, isolated synthetic clone.
import './guard.mjs';
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { connectDatabase } from '../../src/server/db';
import { currentPublication } from '../../src/server/publications';
import { createLink, consumeLink } from '../../src/server/auth';
import { introduceTraining, nextCard, reviewId } from '../../src/server/reviews';
import { objectFor } from '../../src/shared/counters';
const path = new URL('./.local/runtime.json', import.meta.url), runtime = JSON.parse(readFileSync(path, 'utf8')), url = new URL(runtime.database);
assert.equal(url.hostname, '127.0.0.1'); assert.match(url.pathname, /^\/japanese_pixi_m8_published_[0-9]+$/);
const db = connectDatabase(url.href);
try {
  const course = await currentPublication(db); runtime.counterBrowserUsers = [];
  for (let i = 0; i < 2; i++) {
    const email = `m5-counter-browser-${crypto.randomUUID()}@example.test`, password = crypto.randomUUID() + crypto.randomUUID();
    const link = await createLink(db, 'invite', email, null); assert.equal(await consumeLink(db, 'invite', link.token, password, 'Проверка M5'), true);
    const owner = (await db.sql`select id from users where email=${email}`)[0]!.id;
    const words = course.words.filter(word => word.reviewStatus !== 'draft' && objectFor(word, course.catalog));
    for (const word of words) { const card = nextCard(null, 3, new Date()); await db.sql`insert into review_states(user_id,item_id,mode,version,card,due) values(${owner},${word.id},'ja-ru',1,${card},${card.due})`; }
    const word = words.find(word => objectFor(word, course.catalog)?.counters.includes('hon'))!;
    await introduceTraining(db, owner, course, [reviewId('counter', 'hon/recall/8', word.id + '|' + crypto.randomUUID())], 'learning');
    runtime.counterBrowserUsers.push({ email, password });
  }
  writeFileSync(path, JSON.stringify(runtime), { mode: 0o600 }); console.log('Two new synthetic counter profiles ready in M5 disposable clone.');
} finally { await db.sql.close(); }
