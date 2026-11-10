import { afterAll,beforeAll,describe,expect,test } from 'bun:test';
import { connectDatabase } from '../src/server/db';
import { loadCourse } from '../src/server/course';
import { trainingQueue,introduceTraining,submitReview,reviewQueue,reviewId,nextCard } from '../src/server/reviews';
import { disposableDatabase } from './helpers/disposable-database';
import type { ReviewItem,Rating,ReviewSubmission } from '../src/shared/types';
const url=process.env.JAPANESE_INTEGRATION_DATABASE_URL;
(url?describe:describe.skip)('two independent A1 visual FSRS directions',()=>{
 const course=loadCourse(),users:string[]=[];let db:ReturnType<typeof connectDatabase>;
 beforeAll(()=>{if(!disposableDatabase(new URL(url!)))throw new Error('Disposable local DB only');db=connectDatabase(url!);});
 afterAll(async()=>{if(!db)return;for(const id of users)await db.sql`delete from users where id=${id}`;await db.sql.close();});
 async function learner(){const id=crypto.randomUUID();users.push(id);await db.sql`insert into users(id,name,email) values(${id},'Visual test',${id+'@example.test'})`;return id;}
 const answer=(item:ReviewItem,rating:Rating):ReviewSubmission=>({attemptId:crypto.randomUUID(),reviewId:item.id,version:item.version,mode:item.mode as 'picture-word'|'word-meaning',rating});
 test('read-only queue has both directions, shows new introduction, enrolls only a successfully learned pair and retries once',async()=>{
  const user=await learner(),context={lessonId:'marugoto.starter-a1.lesson.01',visualWords:true};
  const queue=await trainingQueue(db,user,course,context),first=queue.items[0]!,pair=queue.items.filter(i=>i.targetId===first.targetId);
  expect(pair.map(i=>i.mode).sort()).toEqual(['picture-word','word-meaning']);expect(pair.every(i=>i.preparation?.scope==='visual')).toBe(true);
  expect(await db.sql`select 1 from review_states where user_id=${user}`).toEqual([]);expect((await reviewQueue(db,user,course,'mixed')).items).toEqual([]);
  await expect(submitReview(db,user,course,answer(first,3))).rejects.toMatchObject({code:'LEARN_FIRST'});
  await introduceTraining(db,user,course,pair.map(i=>i.id),'learning');
  const wrong=await submitReview(db,user,course,answer(pair[0]!,1));expect(wrong.status).toBe('learning');
  const hard=answer(pair[0]!,2),saved=await submitReview(db,user,course,hard);expect(saved.status).toBe('learning');expect(await submitReview(db,user,course,hard)).toEqual(saved);
  expect(await db.sql`select 1 from review_states where user_id=${user}`).toEqual([]);
  expect((await submitReview(db,user,course,answer(pair[1]!,4))).status).toBe('scheduled');
  const states=await db.sql`select mode,card,version,due from review_states where user_id=${user}`;expect(states).toHaveLength(2);
  for(const state of states){expect(state.card.reps).toBe(1);expect(state.card.stability).toBe(nextCard(null,state.mode===pair[0]!.mode?2:4,new Date(state.card.last_review)).stability);}
  expect((await reviewQueue(db,user,course,'ja-ru')).items).toEqual([]);
  const early=answer({...pair[1]!,version:1},3);expect((await submitReview(db,user,course,early)).status).toBe('additional-practice');expect(await db.sql`select mode,card,version,due from review_states where user_id=${user}`).toEqual(states);
  const text=(await trainingQueue(db,user,course,{lessonId:context.lessonId})).items.find(i=>i.targetId===first.targetId&&i.mode==='ja-ru');
  if(text)expect(text.preparation?.passed).not.toContain('ja-ru');
  await db.sql`update review_states set due=now()-interval '1 hour' where user_id=${user}`;
  for(const mode of ['picture-word','word-meaning'] as const){const due=(await reviewQueue(db,user,course,mode)).items;expect(due).toHaveLength(1);expect(due[0]!.schedule?.kind).toBe('review');const input=answer(due[0]!,3),result=await submitReview(db,user,course,input);expect(result.version).toBe(2);expect(await submitReview(db,user,course,input)).toEqual(result);}
 });
 test('historical text scores do not enroll or complete visual learning; unsupported material is rejected',async()=>{
  const user=await learner(),word=course.words.find(w=>course.catalog!.wordCards!.entries[w.id])!,card=nextCard(null,4,new Date('2024-01-01'));
  await db.sql`insert into review_states(user_id,item_id,mode,version,card,due) values(${user},${word.id},'ja-ru',6,${card},${card.due})`;
  expect((await reviewQueue(db,user,course,'picture-word')).items).toEqual([]);
  const unsupported=course.words.find(w=>!course.catalog!.wordCards!.entries[w.id])!;
  await expect(submitReview(db,user,course,{attemptId:crypto.randomUUID(),reviewId:reviewId('picture-word',unsupported.id),version:0,mode:'picture-word',rating:3})).rejects.toMatchObject({code:'MATERIAL_UNAVAILABLE'});
  expect((await db.sql`select version from review_states where user_id=${user}`)[0].version).toBe(6);
  await expect(trainingQueue(db,user,course,{lessonId:course.lessons.find(l=>!l.id.startsWith('marugoto.starter-a1'))!.id,visualWords:true})).rejects.toMatchObject({code:'MATERIAL_UNAVAILABLE'});
 });
});
