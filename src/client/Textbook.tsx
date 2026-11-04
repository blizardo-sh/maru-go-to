import { stagedLearning } from '../shared/training';
import { useState } from 'react';
import { api, ApiRequestError, json } from './api';
import { learningHeaders } from './guidedApi';
import { mainLessonMaterial, type PriorLearningRequest, type PriorLearningResult, type PriorLearningTarget } from '../shared/priorLearning';
import type { Snapshot } from './types';
import { studyWord } from './learning';
import { Japanese } from './Japanese';
import { JapaneseText } from './JapaneseText';
import { LessonVideoLibrary } from './LessonVideo';

export function Textbook({ data, userId, refresh, onLearn, onTrain }: { data: Snapshot; userId: string; refresh: () => Promise<void>; onLearn: (lessonId: string) => void; onTrain: (lessonId: string) => void }) {
  const { course, settings, progress } = data;
  const [saving, setSaving] = useState(false), [pending, setPending] = useState<PriorLearningRequest | null>(null);
  const [message, setMessage] = useState(''), [error, setError] = useState('');
  const introducedWords = new Set(progress.introducedWordIds);
  const introducedSkills = new Set(progress.introducedSkillIds);
  const known = (target: PriorLearningTarget) => (target.kind === 'word' ? introducedWords : introducedSkills).has(target.itemId);
  async function save(input: PriorLearningRequest) {
    if (saving) return;
    setSaving(true); setPending(input); setMessage(''); setError('');
    try {
      const result = await api<PriorLearningResult>('/api/prior-learning', { ...json('POST', input), headers: learningHeaders(userId, course.publicationId) });
      setPending(null);
      setMessage(result.removedCards ? `Отметка отменена. Убрано карточек: ${result.removedCards}.` : result.addedCards ? `Добавлено карточек: ${result.addedCards}. Они доступны сегодня в следующей порции повторения с учётом выбранных типов.` : 'Материал уже изучен. Прежнее расписание сохранено.');
      await refresh();
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : 'Не удалось сохранить отметку.');
      if (failure instanceof ApiRequestError && failure.status >= 400 && failure.status < 500) { setPending(null); await refresh(); }
    } finally { setSaving(false); }
  }
  function markButton(target: PriorLearningTarget, label: string) {
    const mark = progress.priorLearning?.find(value => value.kind === target.kind && value.itemId === target.itemId);
    const text = mark?.canUndo ? 'Отменить отметку' : known(target) ? 'Изучено' : 'Уже проходил';
    return <button className="quiet" data-testid="prior-material" data-kind={target.kind} data-item-id={target.itemId} disabled={saving || !!pending || known(target) && !mark?.canUndo} aria-label={`${text}: ${label}`} onClick={() => void save({ ...target, action: mark?.canUndo ? 'unmark' : 'mark', requestId: crypto.randomUUID() })}>{text}</button>;
  }
  return <>
    <header className="pagehead"><h1>Учебник</h1><p>Marugoto Starter A1 · 18 уроков · 9 тем</p><p className="muted">Сначала знакомимся с основным материалом, затем практикуем его в обе стороны и на слух. Можно выйти в любой момент: точный шаг сохранится для вас.</p></header>
    {message && <p className="notice" role="status">{message}</p>}
    {error && <div className="notice error" role="alert">{error}{pending && <button disabled={saving} onClick={() => void save(pending)}>Повторить сохранение</button>}</div>}
    <div className="lesson-grid" onPlayCapture={event => { event.currentTarget.querySelectorAll('video').forEach(media => { if (media !== event.target) media.pause(); }); }}>{course.lessons.map(lesson => {
      const route = course.learning?.find(route => route.lessonId === lesson.id);
      const learning = data.learning?.find(state => state.lessonId === lesson.id);
      const partCount = learning?.totalParts ?? route?.goals.reduce((count, goal) => count + goal.parts.length, 0) ?? 0;
      // Legacy responses cannot safely infer partial progress without per-part step counts.
      const parts = learning?.partProgress ?? Array.from({ length: partCount }, (_, index) => ({ partId: `${lesson.id}:${index}`, completedSteps: learning?.completed || index < (learning?.partIndex ?? 0) ? 1 : 0, totalSteps: 1 }));
      const fills = parts.map(part => part.totalSteps > 0 ? Math.min(1, Math.max(0, part.completedSteps / part.totalSteps)) : 0);
      const completedParts = fills.filter(fill => fill === 1).length;
      const percent = fills.length ? Math.round(fills.reduce((sum, fill) => sum + fill, 0) / fills.length * 100) : 0;
      const started = (learning?.completedSteps ?? 0) > 0;
      const words = course.words.filter(word => !word.trainingOnly && word.lessonIds.includes(lesson.id) && studyWord(word));
      const skills = course.skills.filter(skill => course.exercises.some(exercise => exercise.lessonId === lesson.id && exercise.skillId === skill.id));
      const learnedWords = words.filter(word => introducedWords.has(word.id)).length;
      const learnedSkills = skills.filter(skill => introducedSkills.has(skill.id)).length;
      const main = mainLessonMaterial(course, lesson.id);
      return <article className="lesson-card" key={lesson.id} data-lesson-id={lesson.id} data-learning-status={learning?.completed ? 'introduced' : started ? 'learning' : 'new'}>
        <header className="lesson-card-summary"><span className="lesson-topic-image" data-topic={lesson.topic} aria-hidden="true" /><div className="lesson-title"><small>Урок {lesson.number}</small><h2 className="lesson-summary-title">{lesson.title}</h2><small className="lesson-status">{learning?.completed ? 'Урок пройден' : started ? 'Изучение начато' : 'Новый урок'}</small>{parts.length > 0 && <div className="lesson-progress" data-lesson-id={lesson.id} data-completed-steps={learning?.completedSteps ?? 0} data-total-steps={learning?.totalSteps ?? 0}><div className="lesson-part-bar" role="progressbar" aria-label={`Прогресс урока ${lesson.number}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`Части завершены: ${completedParts} из ${parts.length}. Общий прогресс: ${percent}%`} style={{ gridTemplateColumns: `repeat(${parts.length}, minmax(0,1fr))` }}>{parts.map((part, index) => <span className="lesson-part" key={part.partId} data-part-id={part.partId} data-completed={fills[index] === 1} data-current={started && !learning?.completed && index === learning?.partIndex} aria-hidden="true"><span style={{ width: `${fills[index]! * 100}%` }} /></span>)}</div><small>Части: {completedParts} из {parts.length}</small></div>}</div></header>
        <button className="primary lesson-train" data-testid="learn-lesson" data-lesson-id={lesson.id} disabled={!route} aria-label={`${learning?.completed ? 'Итог' : started ? 'Продолжить' : 'Начать'} урок ${lesson.number}`} onClick={() => onLearn(lesson.id)}>{learning?.completed ? 'Итог урока' : started ? 'Продолжить урок' : 'Начать урок'}</button>
        <button className="quiet" data-testid="prior-lesson" data-lesson-id={lesson.id} disabled={saving || !!pending || !main.length || learning?.completed && !main.some(target => !known(target))} onClick={() => void save({ kind: 'lesson', itemId: lesson.id, action: 'mark', requestId: crypto.randomUUID() })}>Уже проходил основной материал</button>
        <details className="lesson-material" onToggle={event => { if (!event.currentTarget.open) event.currentTarget.querySelectorAll('video').forEach(media => media.pause()); }}>
          <summary>Материал урока</summary>
          <div className="lesson-card-body">
            {route ? <section><h3>Чему научимся</h3><ol className="lesson-goals">{route.goals.map(goal => <li key={goal.id}>{goal.titleRu}</li>)}</ol><small className="muted">Части до 5 слов или фраз и одной конструкции. Трудный формат вернётся до «Помню». Прохождение маршрута и интервальные повторения учитываются отдельно.</small></section> : <p className="notice">Учебный маршрут готовится. Дополнительный словарь доступен ниже.</p>}
            <details className="lesson-details"><summary>Все слова и конструкции</summary><div className="stack">
              <p>Полный материал указателя: {words.length} слов и фраз. В повторении уже {learnedWords} слов и {learnedSkills} конструкций.</p><small className="muted">Эта практика не нужна для завершения основного маршрута. {stagedLearning(course) ? 'Материал попадает в повторения после успешной отработки всех доступных форматов.' : 'Первая оценка добавляет материал в повторения.'}</small>
              <button className="quiet" data-testid="train-lesson" data-lesson-id={lesson.id} aria-label={`Практиковать дополнительный словарь урока ${lesson.number}`} onClick={() => onTrain(lesson.id)}>Практиковать словарь</button>
              <p className="muted">Знакомый материал можно отметить «Уже проходил». Отметку можно отменить до первого повторения.</p>
              {skills.length > 0 && <div><h3>Конструкции</h3>{skills.filter(skill => skill.reviewStatus !== 'draft').map(skill => <p key={skill.id}><JapaneseText text={skill.title} course={course} mode={settings.orthography} /> {markButton({ kind: 'grammar', itemId: skill.id }, skill.title)}</p>)}</div>}
              <div><h3>Слова и фразы</h3>{words.map(word => <p key={word.id}><Japanese value={word} forms={course.forms} mode={settings.orthography} /> — {word.meaningRu} <small className="muted">{main.some(target => target.kind === 'word' && target.itemId === word.id) ? 'Основной' : 'Дополнительный'} материал</small> {markButton({ kind: 'word', itemId: word.id }, word.meaningRu)}</p>)}</div>
            </div></details>
            {lesson.videos && <LessonVideoLibrary materials={lesson.videos} course={data.course} orthography={data.settings.orthography} />}
          </div>
        </details>
      </article>;
    })}</div>
  </>;
}
