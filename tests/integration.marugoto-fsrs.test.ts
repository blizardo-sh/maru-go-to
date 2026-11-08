import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { readFileSync, readdirSync } from 'node:fs';
import { connectDatabase } from '../src/server/db';
import { createApp } from '../src/server/app';
import { createLink, consumeLink } from '../src/server/auth';
import { loadCourse } from '../src/server/course';
import { activatePublication, currentPublication, getPublication, packContent, publishContent } from '../src/server/publications';
import { recognizePriorLearning } from '../src/server/prior-learning';
import { introduceTraining, nextCard, reviewQueue, submitReview, trainingQueue } from '../src/server/reviews';
import { learnerCourse } from '../src/server/client-course';
import { disposableDatabase } from './helpers/disposable-database';
import { nextFixtureIp } from './helpers/fixture-ip';
import type { Course, Rating, ReviewItem, ReviewQueue, ReviewResult, ReviewSubmission } from '../src/shared/types';

const url=process.env.JAPANESE_INTEGRATION_DATABASE_URL;
(url?describe:describe.skip)('Marugoto v3 and four-grade FSRS together',()=>{
 let db:ReturnType<typeof connectDatabase>,course:Course,app:ReturnType<typeof createApp>,oldId='',newId='',previous:string|undefined;
 const users:string[]=[],emails:string[]=[],root=new URL('../public',import.meta.url).pathname,origin='http://127.0.0.1:5173';
 beforeAll(async()=>{
  if(!disposableDatabase(new URL(url!)))throw new Error('Disposable local DB required');db=connectDatabase(url!);
  previous=(await db.sql`select publication_id from content_active where singleton=1`)[0]?.publication_id;
  const archives=new URL('../materials/publications/',import.meta.url),old=JSON.parse(readFileSync(new URL(readdirSync(archives).find(name=>name.endsWith('.json'))!,archives),'utf8'));
  old.course.title+=' combined '+crypto.randomUUID();oldId=(await publishContent(db,old,{mediaRoot:root,activate:false})).id;
  const next=packContent(loadCourse());expect(next.formatVersion).toBe(3);next.course.title+=' combined '+crypto.randomUUID();newId=(await publishContent(db,next,{mediaRoot:root,activate:false})).id;course=await getPublication(db,newId);
  app=createApp({database:db,course,config:{DATABASE_URL:url!,APP_URL:origin,BETTER_AUTH_SECRET:'marugoto-fsrs-test-only-secret-more-than-32-characters',PORT:3000,HOST:'127.0.0.1'},publications:id=>id?getPublication(db,id):currentPublication(db)});
 });
 afterAll(async()=>{
  if(!db)return;
  if(previous)await activatePublication(db,previous,root);else await db.sql`delete from content_active where publication_id in (${oldId},${newId})`;
  for(const id of users)await db.sql`delete from users where id=${id}`;
  for(const email of emails)await db.sql`delete from access_links where email=${email}`;
  for(const id of [oldId,newId])if(id)await db.sql`delete from content_publications where id=${id}`;
  await db.sql.close();
 });
 async function learner(){
  const email=crypto.randomUUID()+'@example.test',password=crypto.randomUUID()+crypto.randomUUID(),ip=nextFixtureIp();emails.push(email);
  const link=await createLink(db,'invite',email,null);expect(await consumeLink(db,'invite',link.token,password,'Combined fixture')).toBe(true);
  const signed=await app.request(origin+'/api/auth/sign-in/email',{method:'POST',headers:{origin,'content-type':'application/json','x-forwarded-for':ip},body:JSON.stringify({email,password})});expect(signed.status).toBe(200);
  const id=(await signed.json()).user.id as string;users.push(id);const cookie=signed.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  const request=(path:string,body?:unknown)=>app.request(origin+path,{method:body?'POST':'GET',headers:{cookie,origin,'x-forwarded-for':ip,'X-Learning-Learner-Id':id,'X-Content-Publication':newId,'X-Course-Representation':'learner-v1',...(body?{'content-type':'application/json'}:{})},...(body?{body:JSON.stringify(body)}:{})});
  return {id,request};
 }
 const answer=(item:ReviewItem,rating:Rating):ReviewSubmission=>item.mode==='grammar'?{attemptId:crypto.randomUUID(),publicationId:newId,reviewId:item.id,version:item.version,mode:'grammar',tokenIds:item.exercise.acceptedOrders[0]!,revealed:false,rating,practiceFormat:item.construction?.mode??'grammar'}:item.mode==='counter'?{attemptId:crypto.randomUUID(),publicationId:newId,reviewId:item.id,version:item.version,mode:'counter',rating,helped:false,choice:item.counter.acceptedKeys[0]}:{attemptId:crypto.randomUUID(),publicationId:newId,reviewId:item.id,version:item.version,mode:item.mode,rating,...(item.choices?{choiceWordId:item.targetId}:{})};

 test('all four grades stay pinned through rollback; an additional meaning never changes its base lexeme',async()=>{
  const meaning=course.meanings![0]!;
  for(const rating of [1,2,3,4] as const){
   const actor=await learner();await activatePublication(db,newId,root);
   const recognition={requestId:crypto.randomUUID(),selection:{targets:[{kind:'word' as const,id:meaning.id},{kind:'word' as const,id:meaning.wordId}]}};
   await recognizePriorLearning(db,actor.id,course,recognition);
   const beforeBase=await db.sql`select * from review_states where user_id=${actor.id} and item_id=${meaning.wordId} order by mode`;
   const response=await actor.request('/api/course');expect(response.status).toBe(200);expect(await response.json()).toEqual(learnerCourse(course));
   const queue:ReviewQueue=await (await actor.request('/api/reviews?mode=ja-ru')).json();const item=queue.items.find(item=>item.targetId===meaning.id)!;
   expect(item.schedule?.kind).toBe('review');if(item.mode==='grammar'||item.mode==='counter'||item.schedule?.kind!=='review')throw new Error('Missing meaning review');
   expect(item.word.lexemeId).toBe(meaning.wordId);expect(item.word.meaningContext).toEqual(meaning.context);
   const pending=answer(item,rating);await activatePublication(db,oldId,root);
   expect((await currentPublication(db)).meanings?.some(value=>value.id===meaning.id)??false).toBe(false);
   const ackResponse=await actor.request('/api/reviews',pending);expect(ackResponse.status).toBe(200);const ack:ReviewResult=await ackResponse.json();
   expect(ack).toMatchObject({publicationId:newId,rating,status:'scheduled',version:1});
   expect(await (await actor.request('/api/reviews',pending)).json()).toEqual(ack);
   const [stored]=await db.sql`select card from review_states where user_id=${actor.id} and item_id=${meaning.id} and mode='ja-ru'`;
   expect(stored.card.due).toBe(nextCard(null,rating,new Date(stored.card.last_review)).due.toISOString());
   expect(await db.sql`select * from review_states where user_id=${actor.id} and item_id=${meaning.wordId} order by mode`).toEqual(beforeBase);
   const after:ReviewQueue=await (await actor.request('/api/reviews?mode=ja-ru')).json();expect(after.items.some(value=>value.targetId===meaning.id)).toBe(false);expect(after.nextDue).toBe(ack.nextDue);
   expect((await db.sql`select 1 from review_attempts where user_id=${actor.id}`)).toHaveLength(1);
   const state=await db.sql`select * from review_states where user_id=${actor.id} order by item_id,mode`;await activatePublication(db,newId,root);expect(await db.sql`select * from review_states where user_id=${actor.id} order by item_id,mode`).toEqual(state);
  }
 },30000);

 test('new words and constructions in each added book complete learning before their Hard/Easy schedules begin',async()=>{
  for(const book of course.books!.filter(book=>book.id!=='marugoto.starter-a1')){
   const actor=await learner(),lesson=course.lessons.find(lesson=>lesson.bookId===book.id)!;
   const queue=await trainingQueue(db,actor.id,course,{lessonId:lesson.id});
   const word=queue.items.find(item=>item.mode==='ja-ru'&&item.targetId.startsWith('marugoto.')&&item.word.lessonIds.includes(lesson.id))!;
   const grammar=queue.items.find(item=>item.mode==='grammar')!;expect(word).toBeDefined();expect(grammar).toBeDefined();
   for(const target of [word,grammar]){
    const cycle=queue.items.filter(item=>item.targetId===target.targetId);expect(cycle.length).toBeGreaterThanOrEqual(2);expect(cycle.every(item=>item.schedule?.kind==='learning')).toBe(true);
    await introduceTraining(db,actor.id,course,cycle.map(item=>item.id),'learning');
    for(const [index,item] of cycle.entries()){
     const result=await submitReview(db,actor.id,course,answer(item,index===0?2:4));
     expect(result.status).toBe(index===cycle.length-1?'scheduled':'learning');
     if(index<cycle.length-1)expect(await db.sql`select 1 from review_states where user_id=${actor.id} and item_id=${target.targetId}`).toEqual([]);
    }
    const states=await db.sql`select mode,card from review_states where user_id=${actor.id} and item_id=${target.targetId}`;expect(states.length).toBe(target.mode==='grammar'?1:3);
    for(const row of states){const grade=target.mode==='grammar'?4:row.mode===cycle[0]!.mode?2:4;expect(row.card.due).toBe(nextCard(null,grade,new Date(row.card.last_review)).due.toISOString());}
   }
   expect((await reviewQueue(db,actor.id,course,'mixed')).items).toEqual([]);
  }
 },30000);
});
