import { expect, test } from 'bun:test';
import { createEmptyCard, State } from 'ts-fsrs';
import { nextCard, reviewSchedule, gradeGrammar } from '../src/server/reviews';
import { intervalLabel, ratingOptions, reviewWakeDelay } from '../src/client/review-ratings';
import { submissionSchema, learningAdvanceSchema } from '../src/server/validation';
import { course } from '../src/shared/course';

test('all four previews match applied FSRS intervals through learning, review and forgetting without changing history', () => {
  let now = new Date('2026-11-06T23:59:00+03:00'), card = createEmptyCard(now);
  const fresh = reviewSchedule(card, now);
  expect(fresh).toEqual({kind:'review',intervals:{1:60,2:360,3:600,4:691200}});
  for (const grade of [3,3,2,4,1,3] as const) {
    const before = JSON.stringify(card), preview = reviewSchedule(card, now);
    expect(preview.kind).toBe('review');
    if (preview.kind !== 'review') throw new Error('Missing preview');
    for (const rating of [1,2,3,4] as const) expect(nextCard(card,rating,now).due.getTime()-now.getTime()).toBe(preview.intervals[rating]*1000);
    expect(JSON.stringify(card)).toBe(before);
    const previousReps = card.reps;
    card = nextCard(card,grade,now);
    expect(card.reps).toBe(previousReps+1);
    if (grade === 1) expect(card.state).toBe(State.Relearning);
    expect(reviewSchedule(card,now)).toEqual({kind:'practice'});
    now = card.due;
  }
});

test('Hard and Easy are successful grammar grades, while a hint or wrong answer forces Again', () => {
  const exercise = course.exercises[0]!;
  const input = {attemptId:crypto.randomUUID(),reviewId:'test',version:0,mode:'grammar' as const,tokenIds:exercise.acceptedOrders[0]!,revealed:false};
  for (const rating of [2,4] as const) {
    expect(gradeGrammar(course,{...input,rating},exercise.id)).toMatchObject({correct:true,rating});
    expect(gradeGrammar(course,{...input,rating,revealed:true},exercise.id).rating).toBe(1);
    expect(gradeGrammar(course,{...input,rating,tokenIds:[]},exercise.id).rating).toBe(1);
    expect(submissionSchema.safeParse({...input,rating}).success).toBe(true);
    expect(submissionSchema.safeParse({attemptId:input.attemptId,reviewId:'counter',version:0,mode:'counter',rating,helped:false}).success).toBe(true);
    expect(learningAdvanceSchema.safeParse({attemptId:input.attemptId,routeVersion:'v',stateVersion:0,stepId:'practice',action:'remember',rating}).success).toBe(true);
  }
});

test('interval labels distinguish learning and extra practice; long waits cannot overflow timers', () => {
  expect(ratingOptions({kind:'review',intervals:{1:60,2:360,3:600,4:691200}}).map(value=>value.interval)).toEqual(['1 мин','6 мин','10 мин','8 дн.']);
  expect(ratingOptions({kind:'learning'}).every(value=>value.interval==='Учёба')).toBe(true);
  expect(ratingOptions({kind:'practice'}).every(value=>value.interval==='Практика')).toBe(true);
  expect(intervalLabel(36*86400)).toBe('1,2 мес.');
  expect(reviewWakeDelay('2100-01-01T00:00:00Z',0)).toBe(2_147_483_647);
  expect(reviewWakeDelay('2026-11-06T12:00:00Z',Date.parse('2026-11-06T12:00:00Z'))).toBe(50);
});
