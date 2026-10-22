import { isDeepStrictEqual } from 'node:util';
import { advanceLearningState, currentLearningStep, initialLearningState, learningParts, reconcileOptionalVideos, type GuidedLesson, type LearningAdvance, type LearningAdvanceResult, type LearningRouteState, type LearningState, type LearningStep } from '../shared/learning';
import type { Course, ReviewSubmission } from '../shared/types';
import type { Database } from './db';
import { learningReviewItem, ReviewError, submitReviewLocked } from './reviews';
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
  const result: LearningState = { lessonId: route.lessonId, routeVersion: route.version, version, partIndex: state.partIndex, totalParts: parts.length, completedSteps: state.completedStepIds.length, totalSteps: parts.flat().length, completed: state.partIndex >= parts.length, step };
  if (hydrate && step?.kind === 'word-practice') {
    result.reviewItem = await learningReviewItem(sql, userId, course, step.mode, step.wordId);
    result.wordChoices = learningWordChoices(course, route, step);
  }
  if (hydrate && step?.kind === 'construction-practice') {
    const exercise = course.exercises.find(item => item.id === step.exerciseId)!;
    result.reviewItem = await learningReviewItem(sql, userId, course, 'grammar', exercise.skillId, exercise.id);
  }
  return result;
}
export async function learningOverview(database: Database, userId: string, course: Course): Promise<{ lessons: LearningState[] }> {
  const rows = await database.sql`select lesson_id,route_version,version,state from learning_states where user_id=${userId}`;
  const lessons = await Promise.all((course.learning ?? []).map(route => {
    const row = rows.find((entry: any) => entry.lesson_id === route.lessonId);
    return stateFor(database.sql, userId, course, route, storedState(route, row), row?.version ?? 0, false);
  }));
  return { lessons };
}
export async function learningState(database: Database, userId: string, course: Course, lessonId: string): Promise<LearningState> {
  const route = routeFor(course, lessonId);
  const [row] = await database.sql`select route_version,version,state from learning_states where user_id=${userId} and lesson_id=${lessonId}`;
  return stateFor(database.sql, userId, course, route, storedState(route, row), row?.version ?? 0, true);
}
function validateAction(step: LearningStep, input: LearningAdvance): void {
  const practice = step.kind === 'word-practice' || step.kind === 'construction-practice';
  const allowed = step.kind === 'word-practice' ? ['remember', 'again', 'choose'] : practice ? ['remember', 'again'] : step.kind === 'word-intro' ? ['continue', 'start-practice'] : step.kind === 'video' ? ['continue', 'skip'] : ['continue'];
  if (!allowed.includes(input.action)) throw new ReviewError('INVALID_ACTION', 'Действие не соответствует текущему шагу.');
  if (input.action === 'choose' ? !input.choiceWordId : input.choiceWordId !== undefined) throw new ReviewError('INVALID_ACTION', 'Выбор ответа не относится к текущему шагу.');
  const assembly = step.kind === 'construction-practice' && step.mode === 'grammar';
  if (!assembly && (input.tokenIds !== undefined || input.tokenForms !== undefined || input.revealed !== undefined || input.exploring !== undefined)) throw new ReviewError('INVALID_ACTION', 'Ответ конструктора не относится к текущему шагу.');
  if (assembly && !input.tokenIds) throw new ReviewError('INVALID_ACTION', 'Нужно собрать фразу.');
}
export async function advanceLearning(database: Database, userId: string, course: Course, lessonId: string, input: LearningAdvance): Promise<LearningAdvanceResult> {
  const route = routeFor(course, lessonId);
  return database.sql.begin(async tx => {
    await tx`select pg_advisory_xact_lock(hashtext(${userId}))`;
    await tx`select pg_advisory_xact_lock(hashtext(${'learning-attempt:' + input.attemptId}))`;
    const [prior] = await tx`select user_id,lesson_id,payload,result from learning_attempts where attempt_id=${input.attemptId}`;
    if (prior) {
      if (prior.user_id !== userId || prior.lesson_id !== lessonId || !isDeepStrictEqual(prior.payload, input)) throw new ReviewError('ATTEMPT_CONFLICT', 'Идентификатор попытки уже использован.', 409);
      return prior.result as LearningAdvanceResult;
    }
    const [row] = await tx`select route_version,version,state from learning_states where user_id=${userId} and lesson_id=${lessonId} for update`;
    if (input.routeVersion !== route.version || input.stateVersion !== (row?.version ?? 0)) throw new ReviewError('LEARNING_CONFLICT', 'Учебный шаг изменился на другом устройстве. Обновите маршрут.', 409);
    const state = storedState(route, row);
    const step = currentLearningStep(route, state);
    if (!step || step.id !== input.stepId) throw new ReviewError('LEARNING_CONFLICT', 'Этот учебный шаг уже изменился.', 409);
    validateAction(step, input);
    if (step.kind === 'word-practice' && state.wordQuiz && input.action !== 'choose') throw new ReviewError('INVALID_ACTION', 'Выберите один из четырёх ответов.');
    let action = input.action;
    if (step.kind === 'word-practice' && action === 'choose') {
      if (!learningWordChoices(course, route, step).includes(input.choiceWordId!)) throw new ReviewError('INVALID_CHOICE', 'Вариант не относится к этому вопросу.');
      action = input.choiceWordId === step.wordId ? 'remember' : 'again';
    }
    let reviewResult: LearningAdvanceResult['reviewResult'];
    if (step.kind === 'word-practice' || step.kind === 'construction-practice') {
      const item = step.kind === 'word-practice'
        ? await learningReviewItem(tx, userId, course, step.mode, step.wordId)
        : await learningReviewItem(tx, userId, course, 'grammar', course.exercises.find(exercise => exercise.id === step.exerciseId)!.skillId, step.exerciseId);
      const submission: ReviewSubmission = item.mode !== 'grammar'
        ? { attemptId: input.attemptId, reviewId: item.id, version: item.version, mode: item.mode, rating: action === 'again' ? 1 : 3 }
        : { attemptId: input.attemptId, reviewId: item.id, version: item.version, mode: 'grammar', tokenIds: step.kind === 'construction-practice' && step.mode === 'grammar' ? input.tokenIds! : item.exercise.acceptedOrders[0]!, ...(input.tokenForms ? { tokenForms: input.tokenForms } : {}), revealed: input.revealed ?? false, ...(input.exploring !== undefined ? { exploring: input.exploring } : {}), rating: action === 'again' ? 1 : 3 };
      reviewResult = await submitReviewLocked(tx, userId, course, submission);
      if (step.kind === 'word-practice' && input.action === 'choose') reviewResult = { ...reviewResult, correct: action === 'remember' };
      if (item.mode === 'grammar' && (reviewResult.correct === false || submission.mode === 'grammar' && submission.revealed)) action = 'again';
    }
    const next = advanceLearningState(route, state, action);
    if (step.kind === 'word-practice' && input.action === 'choose') next.wordQuiz = true;
    const version = (row?.version ?? 0) + 1;
    await tx`insert into learning_states(user_id,lesson_id,route_version,version,state) values(${userId},${lessonId},${route.version},${version},${next}) on conflict(user_id,lesson_id) do update set route_version=excluded.route_version,version=excluded.version,state=excluded.state,updated_at=now()`;
    const result: LearningAdvanceResult = { attemptId: input.attemptId, state: await stateFor(tx, userId, course, route, next, version, true), ...(reviewResult ? { reviewResult } : {}) };
    await tx`insert into learning_attempts(attempt_id,user_id,lesson_id,payload,result) values(${input.attemptId},${userId},${lessonId},${input},${result})`;
    return result;
  });
}
