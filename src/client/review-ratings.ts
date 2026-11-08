import type { Rating, ReviewSchedule } from '../shared/types';

export function intervalLabel(seconds: number): string {
  if (seconds <= 0) return 'сейчас';
  if (seconds < 3600) return `${Math.max(1, Math.round(seconds / 60))} мин`;
  if (seconds < 86400) return `${Math.round(seconds / 3600)} ч`;
  const days = seconds / 86400;
  if (days < 30) return `${Math.round(days)} дн.`;
  return `${Number((days / (days < 365 ? 30 : 365)).toFixed(1)).toLocaleString('ru-RU')} ${days < 365 ? 'мес.' : 'г.'}`;
}

export function ratingOptions(schedule?: ReviewSchedule) {
  return ([['again', 'Снова'], ['hard', 'Трудно'], ['remember', 'Хорошо'], ['easy', 'Легко']] as const).map(([id, label], index) => {
    const rating = (index + 1) as Rating;
    const interval = schedule?.kind === 'review' ? intervalLabel(schedule.intervals[rating]) : schedule?.kind === 'practice' ? 'Практика' : 'Учёба';
    return { id: `grade-${id}`, rating, label, interval, text: `${label}\n${interval}` };
  });
}

export const scheduleDescription = (schedule?: ReviewSchedule) => schedule?.kind === 'review'
  ? 'Когда повторить после этой оценки'
  : schedule?.kind === 'practice' ? 'Дополнительная практика: назначенный срок сохраняется'
  : 'В расписание — после успешной отработки всех учебных форматов';

export function reviewWakeDelay(nextDue: string, now = Date.now()): number {
  return Math.min(2_147_483_647, Math.max(0, Date.parse(nextDue) - now) + 50);
}
