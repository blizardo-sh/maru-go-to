import { afterAll, beforeAll, describe, expect, test } from 'bun:test';
import { connectDatabase } from '../src/server/db';
import { loadCourse } from '../src/server/course';
import { nextCard, reviewQueue, submitReview, trainingQueue, introduceTraining } from '../src/server/reviews';
import { advanceLearning, learningState } from '../src/server/learning';
import { disposableDatabase } from './helpers/disposable-database';
import type { Rating, ReviewItem, ReviewSubmission } from '../src/shared/types';

const url = process.env.JAPANESE_INTEGRATION_DATABASE_URL;
(url ? describe : describe.skip)('FSRS scheduling preserves history and agrees with initial learning', () => {
  const course = loadCourse(), users: string[] = [];
  let db: ReturnType<typeof connectDatabase>;
  beforeAll(() => { if (!disposableDatabase(new URL(url!))) throw new Error('Disposable local DB required'); db=connectDatabase(url!); });
  afterAll(async () => { if (!db) return; for (const id of users) await db.sql`delete from users where id=${id}`; await db.sql.close(); });
  async function learner() { const id=crypto.randomUUID();users.push(id);await db.sql`insert into users(id,name,email) values(${id},'FSRS test',${id+'@example.test'})`;return id; }
  function answer(item: ReviewItem,rating: Rating): ReviewSubmission {
    const base={attemptId:crypto.randomUUID(),reviewId:item.id,version:item.version};
    return item.mode==='grammar'?{...base,mode:'grammar',tokenIds:item.exercise.acceptedOrders[0]!,revealed:false,rating,practiceFormat:item.construction?.mode??'grammar'}:item.mode==='counter'?{...base,mode:'counter',rating,helped:false,...(item.counter.kind!=='recall'?{choice:item.counter.acceptedKeys[0]}:{})}:{...base,mode:item.mode,rating,...(item.choices?.length?{choiceWordId:item.targetId}:{})};
  }
  test('read-only previews preserve a mature card; Hard, retry, early and stale answers do not reset or double-grade it', async () => {
    const id=await learner(),word=(await trainingQueue(db,id,course,{topicId:'questions',sectionId:'questions'})).items[0]!;
    let card=nextCard(null,3,new Date('2024-01-01T00:00:00Z'));
    for(let i=0;i<4;i++)card=nextCard(card,3,card.due);
    await db.sql`insert into review_states(user_id,item_id,mode,version,card,due) values(${id},${word.targetId},'ja-ru',7,${card},${card.due})`;
    const before=await db.sql`select card,version,due from review_states where user_id=${id}`;
    const queue=await reviewQueue(db,id,course,'ja-ru'),item=queue.items[0]!;
    expect(item.schedule?.kind).toBe('review');
    expect(await db.sql`select card,version,due from review_states where user_id=${id}`).toEqual(before);
    const input=answer(item,2),first=await submitReview(db,id,course,input);
    expect(first).toMatchObject({status:'scheduled',rating:2,correct:true,version:8});
    expect(await submitReview(db,id,course,input)).toEqual(first);
    const [stored]=await db.sql`select card,version,due from review_states where user_id=${id}`;
    expect(stored.card.reps).toBe(card.reps+1);expect(stored.card.lapses).toBe(card.lapses);expect(stored.card.stability).toBeGreaterThanOrEqual(card.stability);
    const future=await reviewQueue(db,id,course,'ja-ru');expect(future.items).toEqual([]);expect(future.nextDue).toBe(first.nextDue);
    expect((await submitReview(db,id,course,{...input,attemptId:crypto.randomUUID(),rating:4})).status).toBe('additional-practice');
    expect((await submitReview(db,id,course,{...input,attemptId:crypto.randomUUID(),version:8,rating:1})).status).toBe('additional-practice');
    expect((await db.sql`select card,version,due from review_states where user_id=${id}`)[0]).toEqual(stored);
  });
  test('new words enroll only after every format succeeds, keeping Hard and Easy for each direction', async () => {
    const id=await learner(),batch=await trainingQueue(db,id,course,{topicId:'questions',sectionId:'questions'});
    const target=batch.items[0]!.targetId,items=batch.items.filter(item=>item.targetId===target);
    expect(items.every(item=>item.schedule?.kind==='learning')).toBe(true);
    await introduceTraining(db,id,course,items.map(item=>item.id),'learning');
    const grades=new Map<string,Rating>();
    for(const [index,item] of items.entries()) {
      const rating:Rating=index===0?2:4;grades.set(item.mode,rating);
      const result=await submitReview(db,id,course,answer(item,rating));
      expect(result).toMatchObject({correct:true,rating,status:index===items.length-1?'scheduled':'learning'});
      if(index<items.length-1)expect(await db.sql`select 1 from review_states where user_id=${id}`).toEqual([]);
    }
    const states=await db.sql`select mode,card from review_states where user_id=${id}`;
    expect(states).toHaveLength(3);
    for(const row of states) {
      const expected=nextCard(null,grades.get(row.mode)!,new Date(row.card.last_review));
      expect(row.card.stability).toBe(expected.stability);expect(row.card.due).toBe(expected.due.toISOString());
    }
    const restored=await reviewQueue(db,id,course,'mixed');expect(restored.items).toEqual([]);expect(restored.nextDue).toBeDefined();
  });
  test('guided Hard completes a format, while a helped Easy remains a failed learning attempt', async () => {
    const id=await learner(),route=course.learning![0]!;
    let state=await learningState(db,id,course,route.lessonId);
    for(let i=0;state.step?.kind==='word-intro'&&i<20;i++)state=(await advanceLearning(db,id,course,route.lessonId,{attemptId:crypto.randomUUID(),routeVersion:state.routeVersion,stateVersion:state.version,stepId:state.step.id,action:'continue'})).state;
    expect(state.step?.kind).toBe('word-practice');
    const step=state.step!,input={attemptId:crypto.randomUUID(),routeVersion:state.routeVersion,stateVersion:state.version,stepId:step.id,action:'remember' as const,rating:2 as const,recall:{helped:false}};
    const saved=await advanceLearning(db,id,course,route.lessonId,input);
    expect(saved.reviewResult).toMatchObject({rating:2,correct:true,status:'learning'});
    expect(saved.state.completedSteps).toBe(state.completedSteps+1);
    expect(await advanceLearning(db,id,course,route.lessonId,input)).toEqual(saved);
    state=saved.state;expect(state.step?.kind).toBe('word-practice');
    const helped=await advanceLearning(db,id,course,route.lessonId,{...input,attemptId:crypto.randomUUID(),stateVersion:state.version,stepId:state.step!.id,rating:4,recall:{helped:true}});
    expect(helped.reviewResult).toMatchObject({rating:1,correct:false,status:'learning'});
    expect(helped.state.completedSteps).toBe(state.completedSteps);
    expect(await db.sql`select 1 from review_states where user_id=${id}`).toEqual([]);
  });
  test('a new construction keeps its learning cycle and enrolls with the chosen Easy interval', async () => {
    const id=await learner(),route=course.learning!.find(route=>route.lessonId.endsWith('.03'))!;
    const items=(await trainingQueue(db,id,course,{lessonId:route.lessonId})).items.filter(item=>item.mode==='grammar');
    const target=items[0]!.targetId,cycle=items.filter(item=>item.targetId===target);
    expect(cycle.map(item=>item.construction?.mode)).toEqual(['ja-ru','listening','grammar']);
    expect(cycle.every(item=>item.schedule?.kind==='learning')).toBe(true);
    await introduceTraining(db,id,course,cycle.map(item=>item.id),'learning');
    for(const item of cycle.slice(0,-1))expect((await submitReview(db,id,course,answer(item,2))).status).toBe('learning');
    expect(await db.sql`select 1 from review_states where user_id=${id}`).toEqual([]);
    expect(await submitReview(db,id,course,answer(cycle.at(-1)!,4))).toMatchObject({status:'scheduled',rating:4});
    const [saved]=await db.sql`select card from review_states where user_id=${id}`;
    expect(saved.card.due).toBe(nextCard(null,4,new Date(saved.card.last_review)).due.toISOString());
    expect((await reviewQueue(db,id,course,'grammar')).items).toEqual([]);
  });
});
