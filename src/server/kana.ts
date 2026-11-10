import { isDeepStrictEqual } from 'node:util';
import { z } from 'zod';
import type { Card } from 'ts-fsrs';
import type { Database } from './db';
import { nextCard, reviewSchedule, ReviewError } from './reviews';
import { catalogFor } from '../shared/catalog';
import type { Course } from '../shared/types';
import { kanaEntries, kanaItemKey, type KanaStudyItem, type KanaOverview, type KanaResult, type KanaSubmission } from '../shared/kana-study';

export const kanaQuerySchema = z.object({ script: z.enum(['hiragana','katakana']).default('hiragana'), direction: z.enum(['sign-reading','reading-sign']).default('sign-reading'), due: z.enum(['true','false']).default('false') }).strict();
export const kanaSubmissionSchema = z.object({ attemptId: z.uuid(), script: z.enum(['hiragana','katakana']), direction: z.enum(['sign-reading','reading-sign']), glyph: z.string().min(1).max(3), version: z.number().int().nonnegative(), rating: z.union([z.literal(1),z.literal(2),z.literal(3),z.literal(4)]), mode: z.enum(['learn','review','practice']) }).strict();
type State = { version: number; card: Card; due: Date | string };
const restored = (state: State): Card => ({ ...state.card, due: new Date(state.due), ...(state.card.last_review ? { last_review: new Date(state.card.last_review) } : {}) });
function itemFor(entry: Pick<KanaStudyItem,'script'|'direction'|'glyph'|'reading'>, state: State | undefined, now: Date, attempts = 0, errors = 0): KanaStudyItem {
 return { ...entry, version: state?.version ?? 0, due: state ? new Date(state.due).toISOString() : null, schedule: reviewSchedule(state ? restored(state) : null, now), attempts, errors };
}
export async function kanaOverview(database: Pick<Database,'sql'>, owner: string, course: Course, query: z.infer<typeof kanaQuerySchema>, now = new Date()): Promise<KanaOverview> {
 const [states, attempts] = await Promise.all([
  database.sql`select * from kana_states where user_id=${owner}`,
  database.sql`select payload->>'script' as script,payload->>'direction' as direction,payload->>'glyph' as glyph,count(*)::int as attempts,count(*) filter(where payload->>'rating'='1')::int as errors from kana_attempts where user_id=${owner} group by 1,2,3`,
 ]);
 const stateMap = new Map<string, State>(states.map((state: any) => [kanaItemKey(state), state]));
 const attemptMap = new Map<string, {attempts:number;errors:number}>(attempts.map((attempt: any) => [kanaItemKey(attempt), attempt]));
 const allDue = query.due === 'true';
 const items = (allDue ? ['hiragana','katakana'] as const : [query.script]).flatMap(script =>
  (allDue ? ['sign-reading','reading-sign'] as const : [query.direction]).flatMap(direction => kanaEntries(catalogFor(course), script).flatMap(entry => {
   const identity = { ...entry, script, direction }, key = kanaItemKey(identity), state = stateMap.get(key), stats = attemptMap.get(key);
   if (allDue && (!state || new Date(state.due) > now)) return [];
   return [itemFor(identity, state, now, stats?.attempts, stats?.errors)];
  })));
 const future = states.filter((row: any) => new Date(row.due) > now).map((row: any) => new Date(row.due).toISOString()).sort();
 return { items: allDue ? items.sort((a,b) => a.due!.localeCompare(b.due!)) : items, dueCount: states.filter((row: any) => new Date(row.due) <= now).length, nextDue: future[0] ?? null };
}
export async function submitKana(database: Database, owner: string, course: Course, input: KanaSubmission): Promise<KanaResult> {
 const entry = kanaEntries(catalogFor(course), input.script).find(entry => entry.glyph === input.glyph);
 if (!entry) throw new ReviewError('INVALID_KANA','Знак отсутствует в этой азбуке.');
 return database.sql.begin(async tx => {
  await tx`select pg_advisory_xact_lock(hashtext(${'kana:'+owner}))`;
  const [previous] = await tx`select user_id,payload,result from kana_attempts where attempt_id=${input.attemptId}`;
  if (previous) {
   if (previous.user_id !== owner || !isDeepStrictEqual(previous.payload,input)) throw new ReviewError('KANA_CONFLICT','Первоначальный ответ отличается от повторного.',409);
   return previous.result as KanaResult;
  }
  const [state] = await tx`select version,card,due from kana_states where user_id=${owner} and script=${input.script} and direction=${input.direction} and glyph=${input.glyph}`;
  if (input.mode !== 'practice' && (state?.version ?? 0) !== input.version) throw new ReviewError('KANA_CONFLICT','Карточка уже изменена в другой вкладке. Загрузите актуальное расписание.',409);
  if (input.mode === 'review' && !state) throw new ReviewError('KANA_CONFLICT','Сначала добавьте знак в изучение.',409);
  const now = new Date(), scheduled = input.mode !== 'practice' && (!state || new Date(state.due) <= now);
  let updated = state;
  if (scheduled) {
   const card = nextCard(state ? restored(state) : null, input.rating, now), version = (state?.version ?? 0) + 1;
   await tx`insert into kana_states(user_id,script,direction,glyph,version,card,due) values(${owner},${input.script},${input.direction},${input.glyph},${version},${card},${card.due}) on conflict(user_id,script,direction,glyph) do update set version=excluded.version,card=excluded.card,due=excluded.due`;
   updated = { version, card, due: card.due };
  }
  const [stats] = await tx`select count(*)::int as attempts,count(*) filter(where payload->>'rating'='1')::int as errors from kana_attempts where user_id=${owner} and payload->>'script'=${input.script} and payload->>'direction'=${input.direction} and payload->>'glyph'=${input.glyph}`;
  const result: KanaResult = { attemptId: input.attemptId, scheduled, item: itemFor({ ...entry,script:input.script,direction:input.direction },updated,now,stats.attempts+1,stats.errors+Number(input.rating===1)) };
  await tx`insert into kana_attempts(attempt_id,user_id,payload,result) values(${input.attemptId},${owner},${input},${result})`;
  return result;
 }) as Promise<KanaResult>;
}
