import { createEmptyCard } from 'ts-fsrs';
import { isDeepStrictEqual } from 'node:util';
import type { Database } from './db';
import type { Course } from '../shared/types';
import { wordTarget } from '../shared/meanings';
import { priorTargets, recognizeRoute, type PriorCommand, type PriorResult } from '../shared/prior-learning';
import { wordPracticeFormats } from '../shared/training';
import { ReviewError } from './reviews';
export { markPriorLearning } from './prior-learning-legacy';
import type { GuidedLesson, LearningRouteState } from '../shared/learning';

export async function recognizedState(sql: Database['sql'], userId: string, course: Course, route: GuidedLesson, state: LearningRouteState) {
  const rows = await sql`select kind,item_id from prior_learning where user_id=${userId}`;
  const [lesson] = await sql`select lesson_id from prior_learning_lessons where user_id=${userId} and lesson_id=${route.lessonId}`;
  if (!rows.length && !lesson && !state.recognizedStepIds?.length && !state.skippedStepIds?.length) return state;
  const targets=new Set<string>(rows.map((row:any)=>row.kind+':'+row.item_id));
  if(rows.length){const schedules=await sql`select item_id,mode from review_states where user_id=${userId} and mode<>'counter'`;for(const row of schedules)targets.add((row.mode==='grammar'?'grammar:':'word:')+row.item_id);}
  return recognizeRoute(course,route,state,targets,!!lesson);
}
export async function recognizePriorLearning(database: Database, userId: string, course: Course, input: PriorCommand): Promise<PriorResult> {
  return database.sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(hashtext(${userId}))`;
    await tx`select pg_advisory_xact_lock(hashtext(${'prior:'+input.requestId}))`;
    const [receipt] = await tx`select user_id,payload,result from prior_learning_commands where request_id=${input.requestId}`;
    if (receipt) {
      if (receipt.user_id!==userId || !isDeepStrictEqual(receipt.payload,input)) throw new ReviewError('ATTEMPT_CONFLICT','Этот запрос уже использован.',409);
      return receipt.result;
    }
    const result: PriorResult = { requestId:input.requestId,added:0,removed:0,retained:0,targets:0 };
    await tx`insert into prior_learning_commands(request_id,user_id,payload,result) values(${input.requestId},${userId},${input},${result})`;
    if (input.undo) {
      const [original] = await tx`select request_id from prior_learning_commands where request_id=${input.undo} and user_id=${userId}`;
      if (!original) throw new ReviewError('NOT_FOUND','Отметка не найдена.',404);
      const rows = await tx`select kind,item_id,created_modes,created_at,reviewed from prior_learning where user_id=${userId} and request_id=${input.undo}`;
      for (const row of rows) {
        result.targets++;
        const [answered] = await tx`select attempt_id from review_attempts where user_id=${userId} and item_id=${row.item_id} and (mode='grammar')=${row.kind==='grammar'} and created_at>=${row.created_at} limit 1`;
        const [changed] = await tx`select item_id from review_states where user_id=${userId} and item_id=${row.item_id} and mode in (select jsonb_array_elements_text(${row.created_modes}::jsonb)) and version<>0 limit 1`;
        if (row.reviewed || answered || changed) { result.retained++; continue; }
        for (const mode of row.created_modes) {
          const removed = await tx`delete from review_states where user_id=${userId} and item_id=${row.item_id} and mode=${mode} and version=0 returning item_id`;
          result.removed+=removed.length;
        }
        await tx`delete from prior_learning where user_id=${userId} and kind=${row.kind} and item_id=${row.item_id}`;
      }
      await tx`delete from prior_learning_lessons where user_id=${userId} and request_id=${input.undo}`;
    } else {
      if (!input.selection) throw new ReviewError('INVALID_ACTION','Выберите материал.');
      let targets;
      try { targets=priorTargets(course,input.selection); } catch { throw new ReviewError('NOT_FOUND','Материал не найден.',404); }
      for (const target of targets) {
        const word=target.kind==='word'?wordTarget(course,target.id):undefined;
        const skill=target.kind==='grammar'?course.skills.find(skill=>skill.id===target.id):undefined;
        if (!(word && word.reviewStatus!=='draft' || skill && skill.reviewStatus!=='draft' && course.exercises.some(exercise=>exercise.skillId===skill.id))) throw new ReviewError('NOT_FOUND','Материал не готов к изучению.',404);
        const modes=word?wordPracticeFormats(word,false):['grammar'];
        const [existing] = await tx`select item_id from prior_learning where user_id=${userId} and kind=${target.kind} and item_id=${target.id}`;
        if(existing)continue;
        const created:string[]=[];
        for(const mode of modes){
          const card=createEmptyCard(new Date());
          const added=await tx`insert into review_states(user_id,item_id,mode,version,card,due) values(${userId},${target.id},${mode},0,${card},${card.due}) on conflict do nothing returning item_id`;
          if(added.length)created.push(mode);
        }
        result.added+=created.length;result.targets++;
        await tx`insert into prior_learning(user_id,kind,item_id,request_id,created_modes) values(${userId},${target.kind},${target.id},${input.requestId},${created})`;
      }
      if('lessonId' in input.selection && input.selection.scope==='main')await tx`insert into prior_learning_lessons(user_id,lesson_id,request_id,targets) values(${userId},${input.selection.lessonId},${input.requestId},${targets}) on conflict do nothing`;
    }
    await tx`update prior_learning_commands set result=${result} where request_id=${input.requestId}`;
    return result;
  });
}
