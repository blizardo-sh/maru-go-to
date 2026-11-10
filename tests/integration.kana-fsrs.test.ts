import { afterAll, expect, test, describe } from 'bun:test';
import { connectDatabase } from '../src/server/db';
import { loadCourse } from '../src/server/course';
import { kanaOverview, kanaQuerySchema, submitKana } from '../src/server/kana';
import { nextCard } from '../src/server/reviews';
import { disposableDatabase } from './helpers/disposable-database';
import type { KanaSubmission } from '../src/shared/kana-study';
const url=process.env.JAPANESE_INTEGRATION_DATABASE_URL;
if(url&&!disposableDatabase(new URL(url)))throw new Error('Disposable localhost test DB only');
(url?describe:describe.skip)('kana FSRS persists independently and exactly once',()=>{
 const db=connectDatabase(url!),course=loadCourse(),users:string[]=[];
 async function learner(){const id=crypto.randomUUID();users.push(id);await db.sql`insert into users(id,name,email) values(${id},'Kana test',${id+'@example.test'})`;return id;}
 const input=(patch:Partial<KanaSubmission>={}):KanaSubmission=>({attemptId:crypto.randomUUID(),script:'hiragana',direction:'sign-reading',glyph:'あ',version:0,rating:3,mode:'learn',...patch});
 afterAll(async()=>{for(const id of users)await db.sql`delete from users where id=${id}`;await db.sql.close();});
 test('previews match all four grades; reads enroll nothing; no word review rows',async()=>{
  for(const rating of [1,2,3,4] as const){const owner=await learner();const overview=await kanaOverview(db,owner,course,kanaQuerySchema.parse({}));expect(overview.dueCount).toBe(0);expect(overview.items.find(item=>item.glyph==='あ')?.due).toBeNull();
   const result=await submitKana(db,owner,course,input({rating}));expect(result.scheduled).toBe(true);expect(result.item.version).toBe(1);
   const [state]=await db.sql`select card from kana_states where user_id=${owner}`;const expected=nextCard(null,rating,new Date(state.card.last_review));expect(state.card.due).toBe(expected.due.toISOString());expect(state.card.reps).toBe(1);
   expect(await db.sql`select 1 from review_states where user_id=${owner}`).toHaveLength(0);expect(await db.sql`select 1 from review_attempts where user_id=${owner}`).toHaveLength(0);
  }
 });
 test('exact retry and concurrent duplicate save one attempt; conflicting payload and stale tab rejected',async()=>{
  const owner=await learner(),payload=input();const results=await Promise.all([submitKana(db,owner,course,payload),submitKana(db,owner,course,payload)]);expect(results[0]).toEqual(results[1]);expect(await db.sql`select 1 from kana_attempts where user_id=${owner}`).toHaveLength(1);
  await expect(submitKana(db,owner,course,{...payload,rating:1})).rejects.toMatchObject({code:'KANA_CONFLICT'});
  await expect(submitKana(db,owner,course,input())).rejects.toMatchObject({code:'KANA_CONFLICT'});
  const other=await learner();await expect(submitKana(db,other,course,payload)).rejects.toMatchObject({code:'KANA_CONFLICT'});
 });
 test('practice never enrolls or changes FSRS; script and direction are independent; all due bypasses selected script',async()=>{
  const owner=await learner();const practice=await submitKana(db,owner,course,input({mode:'practice'}));expect(practice.scheduled).toBe(false);expect(practice.item.due).toBeNull();
  await submitKana(db,owner,course,input());await submitKana(db,owner,course,input({script:'katakana',glyph:'ア'}));await submitKana(db,owner,course,input({direction:'reading-sign'}));
  const before=await db.sql`select * from kana_states where user_id=${owner} order by script,direction`;
  await submitKana(db,owner,course,input({mode:'practice',rating:1}));await submitKana(db,owner,course,input({mode:'learn',version:1,rating:4}));
  expect(await db.sql`select * from kana_states where user_id=${owner} order by script,direction`).toEqual(before);
  await db.sql`update kana_states set due=now()-interval '1 minute' where user_id=${owner}`;
  const due=await kanaOverview(db,owner,course,kanaQuerySchema.parse({script:'katakana',due:'true'}));expect(due.items).toHaveLength(3);expect(due.dueCount).toBe(3);
  const reviewed=await submitKana(db,owner,course,input({version:1,mode:'review',rating:2}));expect(reviewed.item.version).toBe(2);
  await expect(submitKana(db,owner,course,input({glyph:'ア'}))).rejects.toMatchObject({code:'INVALID_KANA'});
 });
});
