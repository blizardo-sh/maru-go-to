import {afterAll,beforeAll,beforeEach,describe,expect,test} from 'bun:test';
import {createApp} from '../src/server/app';
import {createLink,consumeLink} from '../src/server/auth';
import {loadCourse} from '../src/server/course';
import {connectDatabase} from '../src/server/db';
import {nextCard,reviewId} from '../src/server/reviews';
import {learningParts,type LearningState} from '../src/shared/learning';
import {defaultSettings} from '../src/server/material';
import {nextFixtureIp} from './helpers/fixture-ip';
import type {ReviewItem,ReviewQueue,ReviewSubmission,ReviewResult} from '../src/shared/types';

const url=process.env.JAPANESE_INTEGRATION_DATABASE_URL;
(url?describe:describe.skip)('reference, learning and successful practice before repeat enrollment',()=>{
 const origin='http://localhost:5299',course=loadCourse(),users:{id:string;email:string;cookie:string;ip:string}[]=[];
 let db:ReturnType<typeof connectDatabase>,app:ReturnType<typeof createApp>,user:typeof users[number];
 const request=(path:string,body?:unknown,method=body===undefined?'GET':'POST',owner=user.id)=>app.request(origin+path,{method,headers:{origin,cookie:user.cookie,'x-forwarded-for':user.ip,'X-Learning-Learner-Id':owner,...(body===undefined?{}:{'content-type':'application/json'})},...(body===undefined?{}:{body:JSON.stringify(body)})});
 const queue=async(query='topicId=questions&sectionId=questions'):Promise<ReviewQueue>=>{const r=await request('/api/training?'+query);expect(r.status).toBe(200);return r.json();};
 const rows=()=>db.sql`select item_id,mode,version,card from review_states where user_id=${user.id} order by item_id,mode`;
 const introduce=async(items:ReviewItem[],stage='learning')=>{const r=await request('/api/training/introduce',{reviewIds:items.map(item=>item.id),stage});expect(r.status).toBe(200);};
 const input=(item:ReviewItem,extra:Record<string,unknown>={}):ReviewSubmission=>({...{attemptId:crypto.randomUUID(),reviewId:item.id,version:item.version},...(item.mode==='grammar'?{mode:'grammar',practiceFormat:item.construction?.mode??'grammar',tokenIds:item.exercise.acceptedOrders[0]!,revealed:false,rating:3}:item.mode==='counter'?{mode:'counter',rating:3,helped:false,...(item.counter.kind==='recall'?{}:{choice:item.counter.acceptedKeys[0]})}:{mode:item.mode,rating:3,...(item.choices?.length?{choiceWordId:item.targetId}:{})}),...extra} as ReviewSubmission);
 const submit=async(item:ReviewItem,extra:Record<string,unknown>={}):Promise<ReviewResult>=>{const r=await request('/api/reviews',input(item,extra));expect(r.status).toBe(200);return r.json();};
 beforeAll(()=>{const target=new URL(url!);if(target.hostname!=='127.0.0.1'||target.pathname!=='/japanese_app_test')throw new Error('Disposable local test DB required');db=connectDatabase(url!);app=createApp({database:db,course,config:{DATABASE_URL:url!,BETTER_AUTH_SECRET:'thematic-fixture-secret-more-than-32-characters',APP_URL:origin,HOST:'127.0.0.1',PORT:3099}});});
 beforeEach(async()=>{const email=`thematic-${crypto.randomUUID()}@example.test`,ip=nextFixtureIp(),password='Thematic-fixture-only!';const link=await createLink(db,'invite',email,null);expect(await consumeLink(db,'invite',link.token,password,'Thematic test')).toBe(true);const r=await app.request(origin+'/api/auth/sign-in/email',{method:'POST',headers:{origin,'content-type':'application/json','x-forwarded-for':ip},body:JSON.stringify({email,password})});expect(r.status).toBe(200);user={id:(await r.json()).user.id,email,ip,cookie:r.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ')};users.push(user);});
 afterAll(async()=>{if(!db)return;for(const u of users){await db.sql`delete from access_links where email=${u.email}`;await db.sql`delete from users where id=${u.id}`;}await db.sql.close();});
 test('reference does not enroll; errors and hinted answers return; only a complete four-format element enters once',async()=>{
  const batch=await queue();expect(batch.items).toHaveLength(20);expect(batch.reference?.title).toContain('Вопрос');expect(await rows()).toEqual([]);
  const target=batch.items[0]!.targetId,items=batch.items.filter(item=>item.targetId===target);expect(items).toHaveLength(4);
  const blocked=await request('/api/reviews',input(items[0]!));expect(blocked.status).toBe(409);await introduce(items,'reference');expect((await queue()).items.find(item=>item.targetId===target)?.preparation).toMatchObject({referenceSeen:true,introduced:false});expect(await rows()).toEqual([]);
  await introduce(items);expect((await queue()).items.find(item=>item.targetId===target)?.preparation?.introduced).toBe(true);
  for(const item of items.slice(0,3))expect((await submit(item)).status).toBe('learning');expect(await rows()).toEqual([]);
  const applied=items.find(item=>'application'in item&&item.application)!;const wrong='choices'in applied?applied.choices!.find(id=>id!==target)!:'';
  expect((await submit(applied,{choiceWordId:wrong}))).toMatchObject({status:'learning',correct:false});expect((await submit(applied,{helped:true}))).toMatchObject({status:'learning',correct:false});expect(await rows()).toEqual([]);
  const last=input(applied),r=await request('/api/reviews',last);expect(r.status).toBe(200);const result=await r.json();expect(result).toMatchObject({status:'scheduled',correct:true,version:1});expect(await(await request('/api/reviews',last)).json()).toEqual(result);
  const enrolled=await rows();expect(enrolled).toHaveLength(3);expect(new Set(enrolled.map((row:any)=>row.item_id))).toEqual(new Set([target]));expect((await queue()).items.some(item=>item.targetId===target)).toBe(false);
  await db.sql`update review_states set due=now()-interval '1 day' where user_id=${user.id}`;
  await request('/api/settings',{...defaultSettings,repeatTypes:['words']},'PUT');expect((await(await request('/api/reviews?mode=mixed')).json()).items).toEqual([]);
  await request('/api/settings',{...defaultSettings,repeatTypes:['questions','time']},'PUT');const repeat=await(await request('/api/reviews?mode=mixed')).json();expect(repeat.items).toHaveLength(3);expect(new Set(repeat.items.map((item:ReviewItem)=>item.id)).size).toBe(3);expect((await(await request('/api/progress')).json()).byType.questions.due).toBe(3);
 });
 test('clock groups are small, fully voiced and keep minute/meridiem visual metadata; dates share the original IDs',async()=>{
  const clock=await queue('topicId=time&sectionId=clock');expect(clock.items).toHaveLength(20);expect(new Set(clock.items.map(item=>item.targetId)).size).toBe(5);expect(clock.reference?.text).toContain('12時');for(const item of clock.items){expect('visual'in item&&item.visual?.kind).toBe('clock');expect(item.preparation?.required).toEqual(['ja-ru','ru-ja','listening','application']);}
  const dates=await queue('topicId=time&sectionId=dates');expect(dates.items[0]!.targetId.startsWith('marugoto.')).toBe(true);
  expect((await request('/api/training?topicId=questions&sectionId=clock')).status).toBe(404);expect((await request('/api/training?topicId=time&listId=foreign')).status).toBe(400);
  expect((await request('/api/training/introduce',{reviewIds:[Buffer.from(JSON.stringify(['bogus','target',''])).toString('base64url')],stage:'learning'})).status).toBe(400);
  expect((await request('/api/training/introduce',{reviewIds:[clock.items[0]!.id],stage:'learning'},'POST','another-learner')).status).toBe(409);expect(await rows()).toEqual([]);
 });
 test('personal text-only words require both directions and edited pronunciations cannot reuse old audio',async()=>{
  const created=await request('/api/lists',{name:'Custom',text:'ねこのともだち;ねこのともだち;друг кошки'});expect(created.status).toBe(200);const list=await created.json(),word=list.words[0];
  expect((await request(`/api/lists/${list.id}/words/${word.id}`,{pos:'noun'},'PATCH')).status).toBe(200);
  const batch=await queue('listId='+list.id),items=batch.items.filter(item=>item.mode!=='grammar');expect(items.map(item=>item.mode).sort()).toEqual(['ja-ru','ru-ja']);expect(items[0]!.preparation?.required).toEqual(['ja-ru','ru-ja']);await introduce(items);expect((await submit(items[0]!)).status).toBe('learning');expect(await rows()).toEqual([]);expect((await submit(items[1]!)).status).toBe('scheduled');expect(await rows()).toHaveLength(2);
  const canonical=course.words.find(word=>word.kana==='かぞく')!;const clone=await(await request('/api/lists',{name:'Clone',text:`${canonical.surface};${canonical.kana};${canonical.meaningRu}`})).json();expect(clone.words[0].audioUrl).toBeDefined();const edited=await(await request(`/api/lists/${clone.id}/words/${clone.words[0].id}`,{surface:'ともだち',kana:'ともだち'},'PATCH')).json();expect(edited.audioUrl).toBeUndefined();expect(edited.audioText).toBeUndefined();
 });
 test('counters learn each semantic element through its own cycle and retain accepted historical schedules',async()=>{
  const book=course.words.find(word=>word.kana==='ほん'&&!/суффикс/.test(word.meaningRu))!;expect(book).toBeDefined();const card=nextCard(null,3,new Date('2024-01-01'));await db.sql`insert into review_states(user_id,item_id,mode,version,card,due) values(${user.id},${book.id},'ja-ru',1,${card},${card.due})`;
  const batch=await queue('counters=true');expect(batch.items.length).toBeGreaterThan(0);const first=batch.items[0]!,key=first.preparation!.key,group=batch.items.filter(item=>item.preparation!.key===key);await introduce(group);expect(group).toHaveLength(first.preparation!.required.length);
  for(const item of group.slice(0,-1))expect((await submit(item)).status).toBe('learning');expect((await rows()).filter((row:any)=>row.mode==='counter')).toEqual([]);expect((await submit(group.at(-1)!)).status).toBe('scheduled');expect((await rows()).filter((row:any)=>row.mode==='counter')).toHaveLength(group.length);expect((await rows()).find((row:any)=>row.item_id===book.id)?.version).toBe(1);
 });
 test('new constructions finish understanding, listening and assembly before a schedule exists',async()=>{
  const batch=await queue('lessonId='+course.lessons.find(lesson=>lesson.number===3)!.id),items=batch.items.filter(item=>item.mode==='grammar');expect(items).toHaveLength(3);expect(items[0]!.preparation?.required).toEqual(['ja-ru','listening','grammar']);await introduce(items);
  for(const item of items.slice(0,2))expect((await submit(item)).status).toBe('learning');expect(await rows()).toEqual([]);expect((await submit(items[2]!)).status).toBe('scheduled');expect(await rows()).toHaveLength(1);
 });
 test('guided counting teaches each quantity, preserves every format and returns a hinted recall instead of completing it',async()=>{
  const route=course.learning!.find(route=>route.lessonId.endsWith('.04'))!,parts=learningParts(route),index=parts.findIndex(steps=>steps.some(step=>step.kind==='counter-practice')),steps=parts[index]!,first=steps.find(step=>step.kind==='counter-practice')!;
  if(first.kind!=='counter-practice')throw new Error('Missing count step');
  const card=nextCard(null,3,new Date('2024-01-01'));await db.sql`insert into review_states(user_id,item_id,mode,version,card,due) values(${user.id},${first.wordId},'ja-ru',1,${card},${card.due})`;
  await db.sql`insert into learning_states(user_id,lesson_id,route_version,version,state) values(${user.id},${route.lessonId},${route.version},0,${{partIndex:index,pendingStepIds:steps.map(step=>step.id),completedStepIds:parts.slice(0,index).flat().map(step=>step.id)}})`;
  const path='/api/learning/'+route.lessonId;let current:LearningState=await(await request(path)).json(),hinted=false,turn=0;
  while(current.step?.kind==='counter-practice'&&turn++<12){
   const item=current.reviewItem!;if(item.mode!=='counter')throw new Error('Expected counter');
   if(!item.preparation?.introduced)await introduce([item]);
   const recall=current.step.format==='recall';const helped:boolean=recall&&!hinted;hinted ||= helped;
   const body={attemptId:crypto.randomUUID(),routeVersion:current.routeVersion,stateVersion:current.version,stepId:current.step.id,action:recall?'remember':'choose',...(recall?{}:{counterChoice:item.counter.acceptedKeys[0]}),helped};
   const r=await request(path+'/advance',body);expect(r.status).toBe(200);const saved=await r.json();if(helped){expect(saved.reviewResult.correct).toBe(false);const [state]=await db.sql`select state from learning_states where user_id=${user.id} and lesson_id=${route.lessonId}`;expect(state.state.completedStepIds).not.toContain(body.stepId);}
   current=saved.state;
  }
  expect(hinted).toBe(true);expect(current.step?.kind).not.toBe('counter-practice');expect((await rows()).filter((row:any)=>row.mode==='counter')).toHaveLength(steps.filter(step=>step.kind==='counter-practice').length);
 });
 test('v2 unchecked categories stay unchecked, while old word selections migrate once',async()=>{
  const old={...defaultSettings,repeatTypes:['words']};delete old.repeatTypesVersion;await db.sql`insert into preferences(user_id,settings) values(${user.id},${old})`;expect((await(await request('/api/settings')).json()).repeatTypes).toEqual(['words','questions','time']);expect((await request('/api/settings',{...defaultSettings,repeatTypes:['words']},'PUT')).status).toBe(200);expect((await(await request('/api/settings')).json()).repeatTypes).toEqual(['words']);
 });
});
