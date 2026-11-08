import type { Rating, ReviewSchedule } from '../shared/types';
import { ratingOptions, scheduleDescription } from './review-ratings';
import './review-ratings.css';

export function ReviewRatings({ schedule, disabled, againOnly = false, grade }: { schedule?: ReviewSchedule; disabled: boolean; againOnly?: boolean; grade: (rating: Rating) => unknown }) {
  return <div className="review-ratings">
    <small>{againOnly ? 'Ответ с ошибкой или подсказкой — «Снова»' : scheduleDescription(schedule)}</small>
    <div role="group" aria-label="Оценка вспоминания">{ratingOptions(schedule).map(option => <button key={option.id} data-rating={option.rating} disabled={disabled || againOnly && option.rating !== 1} onClick={() => grade(option.rating)}><span>{option.label}</span><small>{option.interval}</small></button>)}</div>
  </div>;
}
