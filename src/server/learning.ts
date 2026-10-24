import { studyPreparations, studySpec, introduceStudy } from './study';
import { stagedLearning } from '../shared/training';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { advanceLearningState, currentLearningStep, initialLearningState, learningParts, reconcileOptionalVideos, reconcileLearningRoute, type GuidedLesson, type LearningAdvance, type LearningAdvanceResult, type LearningRouteState, type LearningState, type LearningStep } from '../shared/learning';
import type { Course, ReviewItem, ReviewSubmission } from '../shared/types';
import type { Database } from './db';
import { learningReviewItem, ReviewError, submitReviewLocked } from './reviews';
import { getPublication, legacyPublication } from './publications';
import { counterTarget, makeCounterCard } from '../shared/counters';
import { counterAudio } from './counter-audio';
import { reviewId } from './reviews';
import { learningWordChoices } from '../shared/learningChoices';

function routeFor(course: Course, lessonId: string): GuidedLesson {
  const route = course.learning?.find(lesson => lesson.lessonId === lessonId);
  if (!route) throw new ReviewError('NOT_FOUND', 'Учебный маршрут урока не найден.', 404);
  return route;
}
function storedState(route: GuidedLesson, row?: { route_version: string; state: LearningRouteState }): LearningRouteState {
  if (row && row.route_version !== route.version) throw new ReviewError('ROUTE_CHANGED', 'Учебный маршрут обновился. Обратитесь к преподавателю для переноса прогресса.', 409);
  return row ? reconcileOptionalVideos(route, row.state) : initialLearningState(route);
}
async function stateFor(sql: Database['sql'], userId: string, course: Course, route: GuidedLesson, state: LearningRouteState, version: number, hydrate: boolean): Promise<LearningState> {
  const step = currentLearningStep(route, state);
  const parts = learningParts(route);
  const result: LearningState = { ...(course.publicationId ? { publicationId: course.publicationId } : {}), lessonId: route.lessonId, routeVersion: route.version, version, partIndex: state.partIndex, totalParts: parts.length, completedSteps: state.completedStepIds.length, totalSteps: parts.flat().length, completed: state.partIndex >= parts.length, step };
  if (hydrate && step?.kind === 'word-practice') {
    result.reviewItem = await learningReviewItem(sql, userId, course, step.mode, step.wordId);
    result.wordChoices = learningWordChoices(course, route, step);
  }
  if (hydrate && step?.kind === 'construction-practice') {
    const exercise = course.exercises.find(item => item.id === step.exerciseId)!;
    result.reviewItem = await learningReviewItem(sql, userId, course, 'grammar', exercise.skillId, exercise.id);
  }
  if (hydrate && step?.kind === 'counter-practice') result.reviewItem = await counterReview(sql,userId,course,step,version);
  if (result.reviewItem && course.publicationId) result.reviewItem.publicationId=course.publicationId;
  return result;
}
async function previousContext(database:Database,course:Course,route:GuidedLesson,row?:any) {
  if(!row || !course.publicationId || row.publication_id===course.publicationId) return {course,route,state:storedState(route,row)};
  const previous=row.publication_id?await getPublication(database,row.publication_id):await legacyPublication(database);
  const oldRoute=routeFor(previous,route.lessonId), oldState=storedState(oldRoute,row);
  return {course:previous,route:oldRoute,state:oldState};
}
async function counterReview(sql:Database['sql'],userId:string,course:Course,step:Extract<LearningStep,{kind:'counter-practice'}>,learningVersion:number):Promise<Extract<ReviewItem,{mode:'counter'}>> {
  const targetId=counterTarget(step.counterId,step.format??'reading-choice',step.quantity);
  const [saved]=await sql`select version,due from review_states where user_id=${userId} and item_id=${targetId} and mode='counter'`;
  const hash=createHash('sha256').update(`${userId}:${course.publicationId??course.version}:${step.id}:${learningVersion}`).digest('hex');
  const seed=`${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
  const counter=makeCounterCard(targetId,step.wordId,course.words,seed,false,course.catalog);
  if(stagedLearning(course)&&counter)counter.introduction=true;
  if(!counter)throw new ReviewError('MATERIAL_UNAVAILABLE','Счётное задание недоступно.',403);
  counter.audioUrl=counterAudio(counter.definition,counter.quantity,course.catalog,course.media);
  const item:Extract<ReviewItem,{mode:'counter'}> = {id:reviewId('counter',targetId,`${step.wordId}|${seed}`),targetId,mode:'counter',version:saved?.version??0,due:new Date(saved?.due??Date.now()).toISOString(),isNew:!saved,counter,...(course.publicationId?{publicationId:course.publicationId}:{})};
  return (await studyPreparations(sql,userId,course,[item]))[0] as typeof item;
}
export async function learningOverview(database: Database, userId: string, course: Course): Promise<{ lessons: LearningState[] }> {
  return {lessons:await Promise.all((course.learning??[]).map(route=>learningState(database,userId,course,route.lessonId,false)))};
}
export async function learningState(database: Database, userId: string, course: Course, lessonId: string, hydrate=true): Promise<LearningState> {
  const route=routeFor(course,lessonId);
  const [row]=await database.sql`select route_version,publication_id,version,state from learning_states where user_id=${userId} and lesson_id=${lessonId}`;
  const previous=await previousContext(database,course,route,row);
  // An issued unfinished question stays pinned until its answer is committed.
  if(previous.course.publicationId!==course.publicationId&&currentLearningStep(previous.route,previous.state))return stateFor(database.sql,userId,previous.course,previous.route,previous.state,row?.version??0,hydrate);
  const state=previous.course.publicationId!==course.publicationId?reconcileLearningRoute(previous.route,route,previous.state):previous.state;
  return stateFor(database.sql,userId,course,route,state,row?.version??0,hydrate);
}
function validateAction(step: LearningStep, input: LearningAdvance): void {
  const practice = step.kind === 'word-practice' || step.kind === 'construction-practice' || step.kind === 'counter-practice';
  const allowed = step.kind === 'counter-practice' ? step.format === 'recall' ? ['remember','again'] : ['choose'] : step.kind === 'word-practice' ? ['remember', 'again', 'choose'] : practice ? ['remember', 'again'] : step.kind === 'word-intro' ? ['continue', 'start-practice'] : step.kind === 'video' ? ['continue', 'skip'] : ['continue'];
  if (!allowed.includes(input.action)) throw new ReviewError('INVALID_ACTION', 'Действие не соответствует текущему шагу.');
  if (step.kind !== 'counter-practice' && (input.action === 'choose' ? !input.choiceWordId : input.choiceWordId !== undefined)) throw new ReviewError('INVALID_ACTION', 'Выбор ответа не относится к текущему шагу.');
  if(step.kind==='counter-practice'?(step.format!=='recall'&&!input.counterChoice)||input.choiceWordId!==undefined:input.counterChoice!==undefined||input.helped!==undefined)throw new ReviewError('INVALID_ACTION','Выбор не относится к счётному заданию.');
  const assembly = step.kind === 'construction-practice' && step.mode === 'grammar';
  if (!assembly && (input.tokenIds !== undefined || input.tokenForms !== undefined || input.revealed !== undefined || input.exploring !== undefined)) throw new ReviewError('INVALID_ACTION', 'Ответ конструктора не относится к текущему шагу.');
  if (assembly && !input.tokenIds) throw new ReviewError('INVALID_ACTION', 'Нужно собрать фразу.');
}
export async function advanceLearning(database: Database, userId: string, course: Course, lessonId: string, input: LearningAdvance, nextCourse:Course=course): Promise<LearningAdvanceResult> {
  const route = routeFor(course, lessonId);
  const [before]=await database.sql`select route_version,publication_id,version,state from learning_states where user_id=${userId} and lesson_id=${lessonId}`;
  const context=await previousContext(database,course,route,before);
  return database.sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(hashtext(${userId}))`;
    await tx`select pg_advisory_xact_lock(hashtext(${'learning-attempt:' + input.attemptId}))`;
    const [prior] = await tx`select user_id,lesson_id,payload,result from learning_attempts where attempt_id=${input.attemptId}`;
    if (prior) {
      if (prior.user_id !== userId || prior.lesson_id !== lessonId || !isDeepStrictEqual(prior.payload, input)) throw new ReviewError('ATTEMPT_CONFLICT', 'Идентификатор попытки уже использован.', 409);
      return prior.result as LearningAdvanceResult;
    }
    const [row] = await tx`select route_version,publication_id,version,state from learning_states where user_id=${userId} and lesson_id=${lessonId} for update`;
    if (input.routeVersion !== route.version || input.stateVersion !== (row?.version ?? 0)) throw new ReviewError('LEARNING_CONFLICT', 'Учебный шаг изменился на другом устройстве. Обновите маршрут.', 409);
    const state = row&&context.course.publicationId!==course.publicationId?reconcileLearningRoute(context.route,route,context.state):storedState(route,row);
    const step = currentLearningStep(route, state);
    if (!step || step.id !== input.stepId) throw new ReviewError('LEARNING_CONFLICT', 'Этот учебный шаг уже изменился.', 409);
    validateAction(step, input);
    if (step.kind === 'word-practice' && state.wordQuiz && input.action !== 'choose') throw new ReviewError('INVALID_ACTION', 'Выберите один из четырёх ответов.');
    let action = input.action;
    if (step.kind === 'word-practice' && action === 'choose') {
      if (!learningWordChoices(course, route, step).includes(input.choiceWordId!)) throw new ReviewError('INVALID_CHOICE', 'Вариант не относится к этому вопросу.');
      action = input.choiceWordId === step.wordId ? 'remember' : 'again';
    }
    if(stagedLearning(course)&&(step.kind==='word-intro'||step.kind==='construction-intro')){
      const parts=learningParts(route)[state.partIndex]!;
      const introductions=input.action==='start-practice'?parts.filter(value=>value.kind==='word-intro'&&state.pendingStepIds.includes(value.id)):[step];
      for(const introduction of introductions){
        const item=introduction.kind==='word-intro'?await learningReviewItem(tx,userId,course,'ja-ru',introduction.wordId):introduction.kind==='construction-intro'?await learningReviewItem(tx,userId,course,'grammar',course.exercises.find(value=>value.id===introduction.exerciseId)!.skillId,introduction.exerciseId):undefined;
        if(item)await introduceStudy(tx,userId,studySpec(course,item),'learning');
      }
    }
    let reviewResult: LearningAdvanceResult['reviewResult'];
    if (step.kind === 'word-practice' || step.kind === 'construction-practice' || step.kind === 'counter-practice') {
      const item = step.kind === 'counter-practice' ? await counterReview(tx,userId,course,step,input.stateVersion) : step.kind === 'word-practice'
        ? await learningReviewItem(tx, userId, course, step.mode, step.wordId)
        : await learningReviewItem(tx, userId, course, 'grammar', course.exercises.find(exercise => exercise.id === step.exerciseId)!.skillId, step.exerciseId);
      if(stagedLearning(course)&&(step.kind==='word-practice'||step.kind==='construction-practice')){const introId=`${step.partId}:intro:${step.kind==='word-practice'?step.wordId:step.exerciseId}`;if(state.completedStepIds.includes(introId))await introduceStudy(tx,userId,studySpec(course,item),'learning');}
      if(step.kind==='counter-practice'&&step.format!=='recall'&&item.mode==='counter'){if(!item.counter.options.some(option=>option.key===input.counterChoice))throw new ReviewError('INVALID_CHOICE','Вариант не относится к этому вопросу.');action=item.counter.acceptedKeys.includes(input.counterChoice!)&&!input.helped?'remember':'again';}
      const submission: ReviewSubmission = item.mode === 'counter' ? {attemptId:input.attemptId,reviewId:item.id,version:item.version,mode:'counter',rating:action==='remember'?3:1,choice:input.counterChoice,helped:input.helped??false,...(course.publicationId?{publicationId:course.publicationId}:{})} : item.mode !== 'grammar'
        ? { attemptId: input.attemptId, reviewId: item.id, version: item.version, mode: item.mode, rating: action === 'again' ? 1 : 3 }
        : { attemptId: input.attemptId, reviewId: item.id, version: item.version, mode: 'grammar', tokenIds: step.kind === 'construction-practice' && step.mode === 'grammar' ? input.tokenIds! : item.exercise.acceptedOrders[0]!, ...(input.tokenForms ? { tokenForms: input.tokenForms } : {}), revealed: input.revealed ?? false, ...(input.exploring !== undefined ? { exploring: input.exploring } : {}), rating: action === 'again' ? 1 : 3 };
      if(step.kind==='construction-practice')submission.practiceFormat=step.mode;
      reviewResult = await submitReviewLocked(tx, userId, course, submission);
      if (step.kind === 'word-practice' && input.action === 'choose') reviewResult = { ...reviewResult, correct: action === 'remember' };
      if ((item.mode === 'grammar' || item.mode === 'counter') && (reviewResult.correct === false || submission.mode === 'grammar' && submission.revealed)) action = 'again';
    }
    let next = advanceLearningState(route, state, action);
    const nextRoute=routeFor(nextCourse,lessonId);
    if(nextCourse.publicationId!==course.publicationId)next=reconcileLearningRoute(route,nextRoute,next);
    if (step.kind === 'word-practice' && input.action === 'choose') next.wordQuiz = true;
    const version = (row?.version ?? 0) + 1;
    await tx`insert into learning_states(user_id,lesson_id,publication_id,route_version,version,state) values(${userId},${lessonId},${nextCourse.publicationId??null},${nextRoute.version},${version},${next}) on conflict(user_id,lesson_id) do update set publication_id=excluded.publication_id,route_version=excluded.route_version,version=excluded.version,state=excluded.state,updated_at=now()`;
    const result: LearningAdvanceResult = { attemptId: input.attemptId, state: await stateFor(tx, userId, nextCourse, nextRoute, next, version, true), ...(reviewResult ? { reviewResult } : {}) };
    await tx`insert into learning_attempts(attempt_id,user_id,lesson_id,payload,result) values(${input.attemptId},${userId},${lessonId},${input},${result})`;
    return result;
  });
}
