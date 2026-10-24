import { afterAll, beforeAll, beforeEach, describe, expect, spyOn, test } from 'bun:test';
import { createApp } from '../src/server/app';
import { createLink, consumeLink } from '../src/server/auth';
import { legacyCourseFixture as loadCourse } from './helpers/legacy-course-fixture';
import { connectDatabase } from '../src/server/db';
import { defaultSettings } from '../src/server/material';
import { reviewId } from '../src/server/reviews';
import { nextFixtureIp } from './helpers/fixture-ip';
import type { Progress, ReviewItem, ReviewQueue, ReviewSubmission, WordList } from '../src/shared/types';

const databaseUrl=process.env.JAPANESE_INTEGRATION_DATABASE_URL;
const suite=databaseUrl?describe:describe.skip;
suite('lesson training and introduced-only repetition over authenticated HTTP',()=>{
 const origin='http://127.0.0.1:5173';const course=loadCourse();const lesson=course.lessons.find(item=>item.number===3)!;
 let database:ReturnType<typeof connectDatabase>;let app:ReturnType<typeof createApp>;let cookie='';let userId='';let fixtureIp=nextFixtureIp();
 const learners:{id:string;email:string}[]=[];const password='Lesson-training-isolated-fixture-only!';
 const request=(path:string,body?:unknown,method=body===undefined?'GET':'POST')=>app.request(origin+path,{method,headers:{origin,'x-forwarded-for':fixtureIp,...(cookie?{cookie}:{}),...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const queue=async(path='/api/reviews?mode=mixed'):Promise<ReviewQueue>=>{const response=await request(path);expect(response.status).toBe(200);return response.json();};
 const train=()=>queue('/api/training?lessonId='+lesson.id);
 const progress=async():Promise<Progress>=>(await request('/api/progress')).json();
 const answer=(item:ReviewItem):ReviewSubmission=>item.mode==='counter'?{attemptId:crypto.randomUUID(),reviewId:item.id,version:item.version,mode:'counter',rating:3,choice:item.counter.acceptedKeys[0],helped:false}:item.mode==='grammar'?{attemptId:crypto.randomUUID(),reviewId:item.id,version:item.version,mode:'grammar',tokenIds:item.exercise.acceptedOrders[0]!,revealed:false}:{attemptId:crypto.randomUUID(),reviewId:item.id,version:item.version,mode:item.mode,rating:3};
 beforeAll(()=>{const target=new URL(databaseUrl!);if(target.hostname!=='127.0.0.1'||target.pathname!=='/japanese_app_test')throw new Error('Use disposable localhost japanese_app_test.');database=connectDatabase(databaseUrl!);app=createApp({database,course,config:{DATABASE_URL:databaseUrl!,BETTER_AUTH_SECRET:'lesson-training-fixture-secret-with-more-than-32-characters',APP_URL:origin,PORT:3000,HOST:'127.0.0.1'}});});
 beforeEach(async()=>{cookie='';fixtureIp=nextFixtureIp();const email=`lesson-training-${crypto.randomUUID()}@example.test`;const link=await createLink(database,'invite',email,null);expect(await consumeLink(database,'invite',link.token,password,'Lesson training fixture')).toBe(true);const signedIn=await request('/api/auth/sign-in/email',{email,password});expect(signedIn.status).toBe(200);userId=(await signedIn.json()).user.id;learners.push({id:userId,email});cookie=signedIn.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');});
 afterAll(async()=>{if(!database)return;for(const learner of learners){await database.sql`delete from access_links where email=${learner.email}`;await database.sql`delete from users where id=${learner.id}`;}await database.sql.close();});
 test('manual opening and all legacy filters cannot introduce material; GET is read-only',async()=>{
  expect((await request('/api/settings',{...structuredClone(defaultSettings),lessonStatuses:Object.fromEntries(course.lessons.map(item=>[item.id,'completed'])),freeScopes:{words:'all',particles:'all',constructions:'all',forms:'all'},focusLessonIds:[course.lessons.at(-1)!.id],newWordsPerDay:0,newSkillsPerDay:0},'PUT')).status).toBe(200);
  const before=await progress();expect(before.introducedWordIds).toEqual([]);expect(before.introducedSkillIds).toEqual([]);expect(before.completedLessons).toBe(0);expect((await queue()).items).toEqual([]);
  const batch=await train();expect(batch.items.filter(item=>item.mode!=='grammar')).toHaveLength(10);expect(new Set(batch.items.filter(item=>item.mode!=='grammar').map(item=>item.targetId)).size).toBe(10);expect(batch.items.filter(item=>item.mode==='grammar')).toHaveLength(2);expect(new Set(batch.items.filter(item=>item.mode!=='grammar').map(item=>item.mode))).toEqual(new Set(['ja-ru','ru-ja','listening']));expect(await progress()).toEqual(before);expect((await queue()).items).toEqual([]);
  for(const path of ['/api/training','/api/training?lessonId='+lesson.id+'&listId=foreign','/api/training?lessonId=missing'])expect((await request(path)).status).toBeGreaterThanOrEqual(400);
 });
 test('one accepted Again enrolls all word directions with independent schedules and idempotent ACKs',async()=>{
  const item=(await train()).items.find(candidate=>candidate.mode!=='grammar')!;const input={...answer(item),rating:1};const result=await(await request('/api/reviews',input)).json();expect(result).toMatchObject({status:'scheduled',version:1});expect(await(await request('/api/reviews',input)).json()).toEqual(result);
  const due=await queue();expect(due.remainingNew).toBe(0);const siblings=due.items.filter(candidate=>candidate.targetId===item.targetId);expect(siblings).toHaveLength(2);expect(siblings.every(candidate=>!candidate.isNew&&candidate.version===0)).toBe(true);expect(siblings.every(candidate=>candidate.mode!==item.mode)).toBe(true);expect(due.items.every(candidate=>candidate.targetId===item.targetId)).toBe(true);
  const p=await progress();expect(p.introducedWordIds).toEqual([item.targetId]);expect(p.wordsIntroducedToday).toBe(1);expect(p.byMode[item.mode].reviewedToday).toBe(1);expect(p.byMode[siblings[0]!.mode].reviewedToday).toBe(0);
  expect((await train()).items.filter(candidate=>candidate.mode!=='grammar').some(candidate=>candidate.targetId===item.targetId)).toBe(false);
  const sibling=siblings[0]!;const results=await Promise.all([request('/api/reviews',answer(sibling)),request('/api/reviews',answer(sibling))]);expect(results.map(response=>response.status)).toEqual([200,200]);expect((await Promise.all(results.map(response=>response.json()))).map(value=>value.status).sort()).toEqual(['additional-practice','scheduled']);
 });
 test('weighted repetition never returns future, unseen or duplicate review IDs',async()=>{
  const words=course.words.filter(word=>word.audioUrl&&word.reviewStatus!=='draft').slice(0,3);
  for(const word of words)for(const mode of ['ja-ru','ru-ja','listening'] as const)expect((await request('/api/reviews',{attemptId:crypto.randomUUID(),reviewId:reviewId(mode,word.id),version:0,mode,rating:3})).status).toBe(200);
  const grammar=(await train()).items.find(item=>item.mode==='grammar')!;expect((await request('/api/reviews',answer(grammar))).status).toBe(200);
  await database.sql`update review_states set due=now()-interval '1 day' where user_id=${userId}`;
  const due=await queue();expect(due.items).toHaveLength(10);expect(new Set(due.items.map(item=>item.id)).size).toBe(due.items.length);expect(due.items.every(item=>!item.isNew&&new Date(item.due)<=new Date())).toBe(true);
  await database.sql`update review_states set due=now()+interval '30 days' where user_id=${userId}`;
  await database.sql`update review_states set due=now()-interval '1 minute' where user_id=${userId} and item_id=${words[0]!.id} and mode='ja-ru'`;
  for(let index=0;index<8;index++){const repeated=await queue();expect(repeated.remainingDue).toBe(1);expect(repeated.remainingNew).toBe(0);expect(repeated.items.map(item=>item.id)).toEqual([reviewId('ja-ru',words[0]!.id)]);}
 });
 test('batches continue without daily caps and fall back to old practice after new material ends',async()=>{
  await request('/api/settings',{...defaultSettings,newWordsPerDay:0,newSkillsPerDay:0},'PUT');let words=0;let batches=0;
  while(true){const batch=await train();const fresh=batch.items.filter(item=>item.mode!=='grammar'&&item.isNew);if(!fresh.length)break;expect(fresh.length).toBeLessThanOrEqual(10);expect(batch.items.filter(item=>item.mode==='grammar').length).toBeGreaterThan(0);for(const item of fresh){expect((await request('/api/reviews',answer(item))).status).toBe(200);words++;}batches++;expect(batches).toBeLessThan(15);}
  expect(words).toBeGreaterThan(10);expect(batches).toBeGreaterThan(1);const practice=await train();expect(practice.items.filter(item=>item.mode!=='grammar')).toHaveLength(10);expect(practice.items.filter(item=>item.mode!=='grammar').every(item=>!item.isNew)).toBe(true);
  const exercises=course.exercises.filter(exercise=>exercise.lessonId===lesson.id);for(const skillId of new Set(exercises.map(exercise=>exercise.skillId))){const exercise=exercises.find(item=>item.skillId===skillId)!;expect((await request('/api/reviews',{attemptId:crypto.randomUUID(),reviewId:reviewId('grammar',skillId,exercise.id),version:0,mode:'grammar',tokenIds:exercise.acceptedOrders[0]!,revealed:false})).status).toBe(200);}
  let seed=42;const random=spyOn(Math,'random').mockImplementation(()=>{seed=(Math.imul(seed,1664525)+1013904223)>>>0;return seed/4294967296;});
  try{const batches:ReviewQueue[]=[];for(let index=0;index<3;index++)batches.push(await train());expect(new Set(batches.flatMap(batch=>batch.items.filter(item=>item.mode!=='grammar').map(item=>item.targetId))).size).toBeGreaterThan(10);expect(new Set(batches.flatMap(batch=>batch.items.filter(item=>item.mode==='grammar').map(item=>item.targetId))).size).toBeGreaterThan(2);expect(batches.every(batch=>batch.items.filter(item=>item.mode==='grammar').length===2&&batch.items.every(item=>!item.isNew))).toBe(true);}finally{random.mockRestore();}

 });
 test('a completed construction repeats by skill without enrolling or waiting for all its token words',async()=>{
  const item=(await train()).items.find(candidate=>candidate.mode==='grammar')!;if(item.mode!=='grammar')throw new Error('Missing grammar');const input=answer(item);const initial=await progress();
  expect((await request('/api/reviews/evaluate',{reviewId:item.id,version:item.version,tokenIds:item.exercise.acceptedOrders[0]!.slice(0,1),revision:1})).status).toBe(200);expect(await progress()).toEqual(initial);
  const incomplete=await request('/api/reviews',{...input,tokenIds:item.exercise.acceptedOrders[0]!.slice(0,1)});expect(incomplete.status).toBe(409);expect(await progress()).toEqual(initial);
  const result=await(await request('/api/reviews',input)).json();expect(result).toMatchObject({status:'scheduled',correct:true,version:1});expect(await(await request('/api/reviews',input)).json()).toEqual(result);
  expect((await progress()).introducedWordIds).toEqual([]);expect((await progress()).introducedSkillIds).toEqual([item.targetId]);await database.sql`update review_states set due=now()-interval '1 minute' where user_id=${userId}`;
  const repeated=(await queue()).items.find(candidate=>candidate.targetId===item.targetId)!;expect(repeated.mode).toBe('grammar');expect(repeated.isNew).toBe(false);expect(repeated.version).toBe(1);expect((await train()).items.some(candidate=>candidate.mode==='grammar')).toBe(true);
 });
 test('accepted legacy rows remain introduced despite closed lessons; other learners stay empty',async()=>{
  const item=(await train()).items.find(candidate=>candidate.mode!=='grammar')!;expect((await request('/api/reviews',answer(item))).status).toBe(200);await database.sql`update review_states set due=now()-interval '30 days',introduced_at=now()-interval '90 days' where user_id=${userId}`;
  expect((await request('/api/settings',{...defaultSettings,focusLessonIds:[course.lessons.at(-1)!.id],newWordsPerDay:0},'PUT')).status).toBe(200);expect((await queue()).items.filter(candidate=>candidate.targetId===item.targetId)).toHaveLength(3);
  const ownCookie=cookie;cookie='';const freshEmail=`legacy-other-${crypto.randomUUID()}@example.test`;const link=await createLink(database,'invite',freshEmail,null);await consumeLink(database,'invite',link.token,password,'Other fixture');const signedIn=await request('/api/auth/sign-in/email',{email:freshEmail,password});const other=(await signedIn.json()).user;learners.push({id:other.id,email:freshEmail});cookie=signedIn.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');expect((await queue()).items).toEqual([]);expect((await progress()).introducedWordIds).toEqual([]);cookie=ownCookie;
 });
 test('private list training ignores legacy activation and rejects foreign list access',async()=>{
  const created=await request('/api/lists',{name:'Private training',text:'傘; かさ; зонтик'});const list:WordList=await created.json();const word=list.words[0]!;expect((await queue('/api/training?listId='+list.id)).items).toEqual([]);expect((await request(`/api/lists/${list.id}/words/${word.id}`,{pos:'noun'},'PATCH')).status).toBe(200);
  const textbook=await train();expect(textbook.items.some(item=>item.mode==='grammar'&&item.exercise.id.startsWith(word.id))).toBe(false);const original=course.exercises.find(item=>item.lessonId===lesson.id&&item.skillId==='marugoto.starter-a1.skill.wa_identity')!;expect(original).toBeDefined();expect((await request('/api/reviews',{attemptId:crypto.randomUUID(),reviewId:reviewId('grammar',original.skillId,original.id),version:0,mode:'grammar',tokenIds:original.acceptedOrders[0]!,revealed:false})).status).toBe(200);await database.sql`update review_states set due=now()-interval '1 minute' where user_id=${userId}`;expect((await queue()).items.some(item=>item.mode==='grammar'&&item.exercise.id.startsWith(word.id))).toBe(false);
  const batch=await queue('/api/training?listId='+list.id);expect(batch.items.some(item=>item.targetId===word.id)).toBe(true);expect(batch.items.some(item=>item.mode==='grammar')).toBe(true);expect((await request('/api/training?listId='+crypto.randomUUID())).status).toBe(404);expect((await request('/api/analyze',{text:word.surface,wordIds:[word.id],revision:1,listId:crypto.randomUUID()})).status).toBe(404);
 });
 test('an introduced skill cannot widen free analysis to unknown examples from another lesson',async()=>{
  const exercise=course.exercises.find(item=>item.id.endsWith('frequency.l11.2'))!;expect(exercise).toBeDefined();const source=course.exercises.find(item=>item.skillId===exercise.skillId)!;const submission={attemptId:crypto.randomUUID(),reviewId:reviewId('grammar',source.skillId,source.id),version:0,mode:'grammar',tokenIds:source.acceptedOrders[0]!,revealed:false};expect((await request('/api/reviews',submission)).status).toBe(200);await database.sql`update review_states set due=now()-interval '1 minute' where user_id=${userId}`;
  const forms=new Map(course.forms.map(item=>[item.id,item]));const text=exercise.acceptedOrders[0]!.map(id=>forms.get(exercise.tokens.find(item=>item.id===id)!.formId)!.surface).join('');const result=await(await request('/api/analyze',{text,wordIds:[],revision:1})).json();expect(result.status).toBe('ok');expect(result.materialViolations.length).toBeGreaterThan(0);
  await database.sql`update review_states set due=now()+interval '30 days' where user_id=${userId}`;const prepared=await(await request('/api/analyze',{text,wordIds:[],revision:2,exerciseId:exercise.id})).json();expect(prepared.materialViolations).toEqual([]);
 });
 test('analysis scopes current lesson plus introduced material and ignores old all-scopes switches',async()=>{
  const word=course.words.find(item=>item.lessonIds.includes(lesson.id))!;const body={text:word.surface,wordIds:[word.id],revision:1};const closed=await(await request('/api/analyze',body)).json();expect(closed.status).toBe('ok');expect(closed.materialViolations.length).toBeGreaterThan(0);const training=await(await request('/api/analyze',{...body,lessonId:lesson.id})).json();expect(training.materialViolations).toEqual([]);
  await request('/api/settings',{...defaultSettings,freeScopes:{words:'all',particles:'all',constructions:'all',forms:'all'}},'PUT');expect((await(await request('/api/analyze',body)).json()).materialViolations.length).toBeGreaterThan(0);
  expect((await request('/api/reviews',{attemptId:crypto.randomUUID(),reviewId:reviewId('ja-ru',word.id),version:0,mode:'ja-ru',rating:3})).status).toBe(200);expect((await(await request('/api/analyze',body)).json()).materialViolations).toEqual([]);
 });
});
