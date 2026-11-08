import { isDeepStrictEqual } from 'node:util';
import { createEmptyCard } from 'ts-fsrs';
import type { Course } from '../shared/types';
import { mainLessonMaterial, type PriorLearningRequest, type PriorLearningResult, type PriorLearningTarget } from '../shared/priorLearning';
import type { Database } from './db';
import { validSegments } from './material';
import { ReviewError } from './reviews';

function modesFor(course: Course, target: PriorLearningTarget): string[] {
  if (target.kind === 'word') {
    const word = course.words.find(word => word.id === target.itemId && !word.trainingOnly && word.lessonIds.some(id => course.lessons.some(lesson => lesson.id === id)) && word.reviewStatus !== 'draft' && validSegments(word));
    if (word) return ['ja-ru', 'ru-ja', ...(word.audioUrl ? ['listening'] : [])];
  } else {
    const skill = course.skills.find(skill => skill.id === target.itemId && skill.reviewStatus !== 'draft');
    if (skill && course.exercises.some(exercise => exercise.skillId === skill.id && exercise.reviewStatus !== 'draft' && course.lessons.some(lesson => lesson.id === exercise.lessonId) && exercise.tokens.every(token => course.forms.some(form => form.id === token.formId && form.reviewStatus !== 'draft')))) return ['grammar'];
  }
  throw new ReviewError('MATERIAL_UNAVAILABLE', 'Этот материал учебника пока недоступен для повторения.', 403);
}

export async function markPriorLearning(database: Database, userId: string, course: Course, input: PriorLearningRequest): Promise<PriorLearningResult> {
  return database.sql.begin(async tx => {
    // Share the learner lock with answers so an undo cannot erase a concurrent review.
    await tx`select pg_advisory_xact_lock(hashtext(${userId}))`;
    await tx`select pg_advisory_xact_lock(hashtext(${'prior-learning:' + input.requestId}))`;
    const [previous] = await tx`select user_id,payload,result from prior_learning_actions where request_id=${input.requestId}`;
    if (previous) {
      if (previous.user_id !== userId || !isDeepStrictEqual(previous.payload, input)) throw new ReviewError('ATTEMPT_CONFLICT', 'Идентификатор действия уже использован.', 409);
      return previous.result as PriorLearningResult;
    }
    const targets = input.kind === 'lesson' ? mainLessonMaterial(course, input.itemId) : [{ kind: input.kind, itemId: input.itemId }];
    if (!targets.length || input.kind === 'lesson' && input.action !== 'mark') throw new ReviewError('MATERIAL_UNAVAILABLE', 'Основной материал урока недоступен.', 403);
    const result: PriorLearningResult = { addedCards: 0, removedCards: 0 };
    for (const target of targets) {
      const modes = modesFor(course, target);
      const [mark] = await tx`select created_modes,reviewed from prior_learning where user_id=${userId} and kind=${target.kind} and item_id=${target.itemId}`;
      if (input.action === 'unmark') {
        if (!mark) continue;
        if (mark.reviewed) throw new ReviewError('ALREADY_REVIEWED', 'Материал уже повторяли. Результаты и расписание сохранены.', 409);
        for (const mode of mark.created_modes as string[]) {
          const removed = await tx`delete from review_states where user_id=${userId} and item_id=${target.itemId} and mode=${mode} and version=0 returning item_id`;
          if (!removed.length) throw new ReviewError('ALREADY_REVIEWED', 'Карточка изменилась. Обновите учебник; результаты сохранены.', 409);
          result.removedCards += removed.length;
        }
        await tx`delete from prior_learning where user_id=${userId} and kind=${target.kind} and item_id=${target.itemId}`;
        // An explicit unmark cancels whole-lesson recognition, while keeping other target marks.
        await tx`delete from prior_learning_lessons where user_id=${userId} and targets @> ${[{kind:target.kind,id:target.itemId}]}::jsonb`;
      } else {
        if (mark) continue;
        const existing = await tx`select mode from review_states where user_id=${userId} and item_id=${target.itemId} and (mode='grammar')=${target.kind === 'grammar'} and mode<>'counter'`;
        if (existing.length) {
          await tx`insert into prior_learning(user_id,kind,item_id,created_modes,reviewed) values(${userId},${target.kind},${target.itemId},${[]},true)`;
          continue;
        }
        const now = new Date(), card = createEmptyCard(now);
        for (const mode of modes) await tx`insert into review_states(user_id,item_id,mode,version,card,due) values(${userId},${target.itemId},${mode},0,${card},${now})`;
        await tx`insert into prior_learning(user_id,kind,item_id,created_modes) values(${userId},${target.kind},${target.itemId},${modes})`;
        result.addedCards += modes.length;
      }
    }
    await tx`insert into prior_learning_actions(request_id,user_id,payload,result) values(${input.requestId},${userId},${input},${result})`;
    return result;
  });
}
