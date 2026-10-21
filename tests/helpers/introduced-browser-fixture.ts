import type { Page } from '@playwright/test';
import type { Database } from '../../src/server/db';
import { nextCard } from '../../src/server/reviews';
import type { Course } from '../../src/shared/types';

// Historical fixtures are isolated UUID accounts; manual lesson flags are not learning evidence.
export async function seedAcceptedHistory(database: Database, course: Course, email: string, wordIds: string[], skillIds: string[]) {
  if (!/-[0-9a-f-]{36}@example\.test$/.test(email)) throw new Error('Accepted history requires an isolated UUID fixture.');
  const [learner] = await database.sql`select id from users where email=${email}`;
  if (!learner) throw new Error('Fixture learner missing.');
  const entries = [...wordIds.flatMap(id => ['ja-ru', 'ru-ja', 'listening'].map(mode => ({ id, mode, version: 1 }))), ...skillIds.map(id => ({ id, mode: 'grammar', version: Math.max(1, course.exercises.filter(exercise => exercise.skillId === id).length) }))];
  const rows = entries.map(entry => {
    let card = nextCard(null, 3, new Date('2024-01-01T00:00:00Z'));
    for (let count = 1; count < entry.version; count++) card = nextCard(card, 3, new Date(Date.UTC(2024, 0, 1 + count)));
    return { item_id: entry.id, mode: entry.mode, version: entry.version, card };
  });
  if (rows.length) await database.sql`insert into review_states(user_id,item_id,mode,version,card,due,introduced_at) select ${learner.id}, r.item_id, r.mode, r.version, r.card, (r.card->>'due')::timestamptz, '2024-01-01T00:00:00Z'::timestamptz from jsonb_to_recordset(${rows}::jsonb) as r(item_id text,mode text,version int,card jsonb)`;
}

export async function openRepeat(page: Page) {
  await page.getByRole('navigation', { name: 'Разделы' }).getByRole('button', { name: 'Повторение', exact: true }).click();
  await page.getByRole('button', { name: 'Начать повторение', exact: true }).click();
}
