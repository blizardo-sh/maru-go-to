import { isVisualWordMode } from '../shared/word-cards';
import { checkTaskAnswer } from '../shared/learning-tasks';
import { recognizedState } from './prior-learning';
import { matchesPreparedAnswer } from '../shared/answers';
import { studyPreparations, studySpec, introduceStudy } from './study';
import { stagedLearning } from '../shared/training';
import { createHash } from 'node:crypto';
import { isDeepStrictEqual } from 'node:util';
import { advanceLearningState, currentLearningStep, initialLearningState, learningParts, learningPartProgress, reconcileOptionalVideos, reconcileLearningRoute, type GuidedLesson, type LearningAdvance, type LearningAdvanceResult, type LearningRouteState, type LearningState, type LearningStep } from '../shared/learning';
import type { Course, ReviewItem, ReviewSubmission } from '../shared/types';
import type { Database } from './db';
import { learningReviewItem, reviewSchedule, ReviewError, submitReviewLocked } from './reviews';
import { getPublication, legacyPublication } from './publications';
import { counterTarget, makeCounterCard } from '../shared/counters';
import { counterAudio } from './counter-audio';
import { reviewId } from './reviews';
import { learningWordChoices, recallWordChoices } from '../shared/learningChoices';

function routeFor(course: Course, lessonId: string): GuidedLesson {
  const route = course.learning?.find(lesson => lesson.lessonId === lessonId);
  if (!route) throw new ReviewError('NOT_FOUND', 'Учебный маршрут урока не найден.', 404);
  return route;
}
function storedState(route: GuidedLesson, row?: { route_version: string; state: LearningRouteState }): LearningRouteState {
  if (row && row.route_version === route.version.replace('-visual-v1', '') && route.version.includes('-visual-v1')) {
    const previous = structuredClone(route); previous.version = row.route_version;
    for (const goal of previous.goals) for (const part of goal.parts) for (const word of part.words) delete word.visualCards;
    return reconcileLearningRoute(previous, route, row.state);
  }
  if (row && row.route_version !== route.version) throw new ReviewError('ROUTE_CHANGED', 'Учебный маршрут обновился. Обратитесь к преподавателю для переноса прогресса.', 409);
  return row ? reconcileOptionalVideos(route, row.state) : { ...initialLearningState(route), recallPolicy: 'recall-v1' };
}
async function stateFor(sql: Database['sql'], userId: string, course: Course, route: GuidedLesson, state: LearningRouteState, version: number, hydrate: boolean): Promise<LearningState> {
  state = await recognizedState(sql,userId,course,route,state);
  const step = currentLearningStep(route, state);
  const parts = learningParts(route);
  const result: LearningState = { ...(state.taskEvidence?{taskEvidence:state.taskEvidence}:{}), ...(state.recallPolicy ? { recallPolicy: state.recallPolicy } : {}), ...(course.publicationId ? { publicationId: course.publicationId } : {}), lessonId: route.lessonId, routeVersion: route.version, version, partIndex: state.partIndex, totalParts: parts.length, partProgress: learningPartProgress(parts, {completedStepIds:[...state.completedStepIds,...(state.recognizedStepIds??[])]}), recognizedSteps:state.recognizedStepIds?.length??0, completionBasis:state.recognizedWhole ? 'recognized' : Object.values(state.taskEvidence??{}).some(value=>value.basis==='self-assessed') ? 'self-assessed' : 'performed', completedSteps: state.completedStepIds.length, totalSteps: parts.flat().length, completed: state.partIndex >= parts.length, step };
  if (hydrate && step?.kind === 'word-practice') {
    result.reviewItem = await learningReviewItem(sql, userId, course, step.mode, step.wordId);
    if (!isVisualWordMode(step.mode)) result.wordChoices = state.recallPolicy ? recallWordChoices(course, route, step, state) : learningWordChoices(course, route, step);
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
  const [saved]=await sql`select version,due,card from review_states where user_id=${userId} and item_id=${targetId} and mode='counter'`;
  const hash=createHash('sha256').update(`${userId}:${course.publicationId??course.version}:${step.id}:${learningVersion}`).digest('hex');
  const seed=`${hash.slice(0,8)}-${hash.slice(8,12)}-${hash.slice(12,16)}-${hash.slice(16,20)}-${hash.slice(20,32)}`;
  const counter=makeCounterCard(targetId,step.wordId,course.words,seed,false,course.catalog);
  if(stagedLearning(course)&&counter)counter.introduction=true;
  if(!counter)throw new ReviewError('MATERIAL_UNAVAILABLE','Счётное задание недоступно.',403);
  counter.audioUrl=counterAudio(counter.definition,counter.quantity,course.catalog,course.media);
  counter.examples.forEach((example,index)=>{example.audioUrl=counterAudio(counter.definition,[1,3,8][index]!,course.catalog,course.media);});
  const item:Extract<ReviewItem,{mode:'counter'}> = {id:reviewId('counter',targetId,`${step.wordId}|${seed}`),targetId,mode:'counter',version:saved?.version??0,due:new Date(saved?.due??Date.now()).toISOString(),isNew:!saved,schedule:reviewSchedule(saved?{...saved.card,due:saved.due}:null),counter,...(course.publicationId?{publicationId:course.publicationId}:{})};
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
  if (step.kind !== 'learning-task' && (input.taskAnswer !== undefined || input.selfAssessment !== undefined || input.attempted !== undefined)) throw new ReviewError('INVALID_ACTION','Ответ относится к другому заданию.');
  if(input.rating!==undefined&&(!practice||!['remember','again'].includes(input.action)||(input.rating===1)!==(input.action==='again')))throw new ReviewError('INVALID_ACTION','Оценка не соответствует учебному ответу.');
  const allowed = step.kind === 'learning-task' ? [step.phase === 'question' ? 'answer' : step.phase === 'feedback' ? 'continue' : step.phase === 'attempt' ? 'attempt' : 'assess'] : step.kind === 'counter-practice' ? step.format === 'recall' ? ['remember','again'] : ['choose'] : step.kind === 'word-practice' ? isVisualWordMode(step.mode) ? ['remember', 'again'] : ['remember', 'again', 'choose'] : practice ? ['remember', 'again'] : step.kind === 'word-intro' ? ['continue', 'start-practice'] : step.kind === 'video' ? ['continue', 'skip'] : ['continue'];
  if (!allowed.includes(input.action)) throw new ReviewError('INVALID_ACTION', 'Действие не соответствует текущему шагу.');
  if (step.kind !== 'counter-practice' && (input.action === 'choose' ? !input.choiceWordId : input.choiceWordId !== undefined)) throw new ReviewError('INVALID_ACTION', 'Выбор ответа не относится к текущему шагу.');
  if(step.kind==='counter-practice'?(step.format!=='recall'&&!input.counterChoice)||input.choiceWordId!==undefined:input.counterChoice!==undefined||input.helped!==undefined)throw new ReviewError('INVALID_ACTION','Выбор не относится к счётному заданию.');
  const assembly = step.kind === 'construction-practice' && step.mode === 'grammar';
  if (!assembly && (input.tokenIds !== undefined || input.tokenForms !== undefined || input.revealed !== undefined || input.exploring !== undefined)) throw new ReviewError('INVALID_ACTION', 'Ответ конструктора не относится к текущему шагу.');
  if (assembly && !input.tokenIds) throw new ReviewError('INVALID_ACTION', 'Нужно собрать фразу.');
}
export async function advanceLearning(database: Database, userId: string, course: Course, lessonId: string, input: LearningAdvance, nextCourse:Course=course): Promise<LearningAdvanceResult> {
  const route = routeFor(course, lessonId);
  // A rollback may remove this book; acknowledge its pinned answer without discarding its route.
  if(!nextCourse.learning?.some(candidate=>candidate.lessonId===lessonId))nextCourse=course;
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
    let state = row&&context.course.publicationId!==course.publicationId?reconcileLearningRoute(context.route,route,context.state):storedState(route,row);
    // Accept an already issued raw question as well as the newly projected remainder.
    if (currentLearningStep(route,state)?.id !== input.stepId) state = await recognizedState(tx,userId,course,route,state);
    const step = currentLearningStep(route, state);
    if (!step || step.id !== input.stepId) throw new ReviewError('LEARNING_CONFLICT', 'Этот учебный шаг уже изменился.', 409);
    validateAction(step, input);
    const recall = !!state.recallPolicy && (step.kind === 'word-practice' || step.kind === 'construction-practice');
    if (recall !== !!input.recall) throw new ReviewError('INVALID_ACTION', 'Правила ответа не совпадают с выданной частью.');
    if (recall && !['remember', 'again'].includes(input.action)) throw new ReviewError('INVALID_ACTION', 'После раскрытия нужна самооценка.');
    if (step.kind === 'word-practice' && !isVisualWordMode(step.mode) && state.wordQuiz && !recall && input.action !== 'choose') throw new ReviewError('INVALID_ACTION', 'Выберите один из четырёх ответов.');
    let action = input.action;
    if (step.kind === 'learning-task') {
      const task=route.goals.flatMap(goal=>goal.parts.flatMap(part=>part.tasks??[])).find(task=>task.id===step.taskId)!;
      const evidence=state.taskEvidence?.[task.id];
      state={...state,taskEvidence:{...state.taskEvidence}};
      if(step.phase==='question' && task.kind!=='production') {
        if(!input.taskAnswer || input.selfAssessment || input.attempted!==undefined || !task.options.some(option=>option.id===input.taskAnswer)) throw new ReviewError('INVALID_ACTION','Выберите ответ по содержанию.');
        const correct=checkTaskAnswer(task,input.taskAnswer);
        state.taskEvidence![task.id]={taskId:task.id,basis:'objective',answer:input.taskAnswer,correct};
        action=correct?'remember':'again';
      } else if(step.phase==='attempt' && task.kind==='production') {
        if(input.attempted!==true || input.selfAssessment || task.response==='written'&&!input.taskAnswer?.trim()) throw new ReviewError('INVALID_ACTION','Сначала подготовьте свой ответ.');
        state.taskEvidence![task.id]={taskId:task.id,basis:'self-assessed',attempted:true,...(input.taskAnswer?{answer:input.taskAnswer}:{})};action='remember';
      } else if(step.phase==='assessment' && task.kind==='production') {
        if(!evidence?.attempted || !input.selfAssessment || input.taskAnswer!==undefined || input.attempted!==undefined)throw new ReviewError('INVALID_ACTION','Сверьте попытку с критериями и выберите самооценку.');
        state.taskEvidence![task.id]={...evidence,rating:input.selfAssessment};action=input.selfAssessment==='retry'?'again':'remember';
      } else if(step.phase==='feedback') {
        if(!evidence?.correct || input.taskAnswer || input.selfAssessment || input.attempted!==undefined)throw new ReviewError('INVALID_ACTION','Сначала ответьте на вопрос.');
      } else throw new ReviewError('INVALID_ACTION','Неверный этап задания.');
    }
    if (input.recall) {
      const first = input.recall.firstChoiceWordId;
      const tokens = input.recall.firstTokenIds;
      if (step.kind === 'word-practice') {
        if (isVisualWordMode(step.mode) && first || tokens || first && !recallWordChoices(course, route, step, state).includes(first)) throw new ReviewError('INVALID_CHOICE', 'Первая попытка не относится к вопросу.');
        if (first && !input.recall.helped) throw new ReviewError('INVALID_ACTION', 'Выбор вариантов является подсказкой.');
        if (input.recall.helped || first && first !== step.wordId) action = 'again';
      } else if (step.kind === 'construction-practice') {
        if (first || tokens && step.mode !== 'grammar') throw new ReviewError('INVALID_ACTION', 'Первая попытка не относится к конструкции.');
        const exercise = course.exercises.find(value => value.id === step.exerciseId)!;
        if (input.recall.helped || tokens && !matchesPreparedAnswer(exercise, course.forms, tokens, input.recall.firstTokenForms)) action = 'again';
      }
    }
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
      const rating=action==='again'?1:(input.rating??3);
      const submission: ReviewSubmission = item.mode === 'counter' ? {attemptId:input.attemptId,reviewId:item.id,version:item.version,mode:'counter',rating,choice:input.counterChoice,helped:input.helped??false,...(course.publicationId?{publicationId:course.publicationId}:{})} : item.mode !== 'grammar'
        ? { attemptId: input.attemptId, reviewId: item.id, version: item.version, mode: item.mode, rating }
        : { attemptId: input.attemptId, reviewId: item.id, version: item.version, mode: 'grammar', tokenIds: step.kind === 'construction-practice' && step.mode === 'grammar' ? input.tokenIds! : item.exercise.acceptedOrders[0]!, ...(input.tokenForms ? { tokenForms: input.tokenForms } : {}), revealed: input.revealed ?? false, ...(input.exploring !== undefined ? { exploring: input.exploring } : {}), rating };
      if(step.kind==='construction-practice')submission.practiceFormat=step.mode;
      reviewResult = await submitReviewLocked(tx, userId, course, submission);
      if (step.kind === 'word-practice' && input.action === 'choose') reviewResult = { ...reviewResult, correct: action === 'remember' };
      if ((item.mode === 'grammar' || item.mode === 'counter') && (reviewResult.correct === false || submission.mode === 'grammar' && submission.revealed)) action = 'again';
    }
    if (step.kind === 'counter-practice' && input.helped) action = 'again';
    if (step.kind === 'counter-practice' && reviewResult) reviewResult = { ...reviewResult, correct: action === 'remember' && reviewResult.correct !== false };
    if (recall && reviewResult) reviewResult = { ...reviewResult, correct: action === 'remember' && reviewResult.correct !== false };
    let next = step.kind === 'learning-task' && action === 'again' ? state : advanceLearningState(route, state, action);
    if(step.kind==='learning-task' && step.phase==='assessment' && input.selfAssessment==='retry'){
      const attempt=learningParts(route)[state.partIndex]!.find(value=>value.kind==='learning-task' && value.taskId===step.taskId && value.phase==='attempt')!;
      next={...state,completedStepIds:state.completedStepIds.filter(id=>id!==attempt.id),pendingStepIds:[attempt.id,...state.pendingStepIds.filter(id=>id!==attempt.id)]};
    }
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
