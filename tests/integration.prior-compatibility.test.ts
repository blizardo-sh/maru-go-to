import {afterAll,beforeAll,describe,expect,test} from 'bun:test';
import {connectDatabase} from '../src/server/db';
import {disposableDatabase} from './helpers/disposable-database';
import {learningFixture} from './helpers/learning-fixture';
import {markPriorLearning,recognizePriorLearning} from '../src/server/prior-learning';
import {learningState} from '../src/server/learning';
import {learningParts,reconcileLearningRoute} from '../src/shared/learning';
import {recognizeRoute} from '../src/shared/prior-learning';
const url=process.env.JAPANESE_INTEGRATION_DATABASE_URL;
(url?describe:describe.skip)('production and new prior-learning share ownership safely',()=>{
 const db=connectDatabase(url!),course=learningFixture(),route=course.learning[0]!,word=route.goals[0]!.parts[0]!.words[0]!.wordId,users:string[]=[];
 beforeAll(()=>{if(!disposableDatabase(new URL(url!)))throw new Error('Disposable DB only');});
 afterAll(async()=>{for(const id of users)await db.sql`delete from users where id=${id}`;await db.sql.close();});
 const owner=async()=>{const id=crypto.randomUUID();users.push(id);await db.sql`insert into users(id,name,email) values(${id},'Compatibility',${id+'@example.test'})`;return id;};
 const fresh=()=>({requestId:crypto.randomUUID(),selection:{targets:[{kind:'word' as const,id:word}]}});
 const old=(action:'mark'|'unmark',requestId=crypto.randomUUID())=>({requestId,kind:'word' as const,itemId:word,action});
 const cards=(id:string)=>db.sql`select item_id,mode,version,card,due from review_states where user_id=${id} order by item_id,mode`;
 test('old receipts replay historical results and new commands cannot take ownership of existing marks',async()=>{
  const id=await owner(),legacy=old('mark'),result=await markPriorLearning(db,id,course,legacy),before=await cards(id),command=fresh();
  expect((await recognizePriorLearning(db,id,course,command)).targets).toBe(0);
  expect((await recognizePriorLearning(db,id,course,{requestId:crypto.randomUUID(),undo:command.requestId})).removed).toBe(0);expect(await cards(id)).toEqual(before);
  await markPriorLearning(db,id,course,old('unmark'));
  expect(await markPriorLearning(db,id,course,legacy)).toEqual(result);expect(await cards(id)).toHaveLength(0);
 });
 test('late undo cannot erase a replacement created through the legacy API',async()=>{
  const id=await owner(),command=fresh();await recognizePriorLearning(db,id,course,command);
  await markPriorLearning(db,id,course,old('unmark'));await markPriorLearning(db,id,course,old('mark'));const before=await cards(id);
  expect((await recognizePriorLearning(db,id,course,{requestId:crypto.randomUUID(),undo:command.requestId})).removed).toBe(0);expect(await cards(id)).toEqual(before);
 });
 test('legacy unmark reopens a whole lesson using its saved target set without removing other marks',async()=>{
  const id=await owner();await recognizePriorLearning(db,id,course,{requestId:crypto.randomUUID(),selection:{lessonId:route.lessonId,scope:'main'}});
  expect((await learningState(db,id,course,route.lessonId)).completed).toBe(true);
  const before=(await cards(id)).length;await markPriorLearning(db,id,course,old('unmark'));
  expect((await learningState(db,id,course,route.lessonId)).completed).toBe(false);
  expect((await cards(id)).length).toBeGreaterThan(0);expect((await cards(id)).length).toBeLessThan(before);
 });
 test('undo preserves every direction if any owned card has changed, even without a review receipt',async()=>{
  const id=await owner(),command=fresh();await recognizePriorLearning(db,id,course,command);
  await db.sql`update review_states set version=1 where user_id=${id} and item_id=${word} and mode='ja-ru'`;const before=await cards(id);
  const result=await recognizePriorLearning(db,id,course,{requestId:crypto.randomUUID(),undo:command.requestId});expect(result.retained).toBe(1);expect(result.removed).toBe(0);expect(await cards(id)).toEqual(before);
 });
 test('persisted legacy skips remain recognition, and undo never erases actual completed work',async()=>{
  const id=await owner();await markPriorLearning(db,id,course,old('mark'));
  const part=learningParts(route)[0]!,skipped=part.filter(s=>'wordId' in s&&s.wordId===word).map(s=>s.id),actual=part.find(s=>s.kind==='word-intro'&&s.wordId!==word)!;
  const state={partIndex:0,pendingStepIds:part.filter(s=>!skipped.includes(s.id)&&s.id!==actual.id).map(s=>s.id),completedStepIds:[...skipped,actual.id],skippedStepIds:skipped};
  await db.sql`insert into learning_states(user_id,lesson_id,route_version,version,state) values(${id},${route.lessonId},${route.version},4,${state})`;
  expect((await learningState(db,id,course,route.lessonId)).completedSteps).toBe(1);
  await markPriorLearning(db,id,course,old('unmark'));expect((await learningState(db,id,course,route.lessonId)).step?.id).toBe(skipped[0]);
  expect(recognizeRoute(course,route,state,new Set(),false).completedStepIds).toEqual([actual.id]);
  const projected=reconcileLearningRoute(route,route,state);expect(projected.completedStepIds).not.toContain(skipped[0]!);expect(projected.completedStepIds).toContain(actual.id);
 });
});
