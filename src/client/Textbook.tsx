import { stagedLearning } from '../shared/training';
import type { Snapshot } from './types';
import { studyWord } from './learning';
import { Japanese } from './Japanese';
import { JapaneseText } from './JapaneseText';
import { LessonVideoLibrary } from './LessonVideo';

export function Textbook({ data, onLearn, onTrain }: { data: Snapshot; onLearn: (lessonId: string) => void; onTrain: (lessonId: string) => void }) {
  const { course, settings, progress } = data;
  const introducedWords = new Set(progress.introducedWordIds);
  const introducedSkills = new Set(progress.introducedSkillIds);
  return <>
    <header className="pagehead"><h1>Учебник</h1><p>Marugoto Starter A1 · 18 уроков · 9 тем</p><p className="muted">Сначала знакомимся с основным материалом, затем практикуем его в обе стороны и на слух. Можно выйти в любой момент: точный шаг сохранится для вас.</p></header>
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
      return <article className="lesson-card" key={lesson.id} data-lesson-id={lesson.id} data-learning-status={learning?.completed ? 'introduced' : started ? 'learning' : 'new'}>
        <header className="lesson-card-summary"><span className="lesson-topic-image" data-topic={lesson.topic} aria-hidden="true" /><div className="lesson-title"><small>Урок {lesson.number}</small><h2 className="lesson-summary-title">{lesson.title}</h2><small className="lesson-status">{learning?.completed ? 'Урок пройден' : started ? 'Изучение начато' : 'Новый урок'}</small>{parts.length > 0 && <div className="lesson-progress" data-lesson-id={lesson.id} data-completed-steps={learning?.completedSteps ?? 0} data-total-steps={learning?.totalSteps ?? 0}><div className="lesson-part-bar" role="progressbar" aria-label={`Прогресс урока ${lesson.number}`} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent} aria-valuetext={`Части завершены: ${completedParts} из ${parts.length}. Общий прогресс: ${percent}%`} style={{ gridTemplateColumns: `repeat(${parts.length}, minmax(0,1fr))` }}>{parts.map((part, index) => <span className="lesson-part" key={part.partId} data-part-id={part.partId} data-completed={fills[index] === 1} data-current={started && !learning?.completed && index === learning?.partIndex} aria-hidden="true"><span style={{ width: `${fills[index]! * 100}%` }} /></span>)}</div><small>Части: {completedParts} из {parts.length}</small></div>}</div></header>
        <button className="primary lesson-train" data-testid="learn-lesson" data-lesson-id={lesson.id} disabled={!route} aria-label={`${learning?.completed ? 'Итог' : started ? 'Продолжить' : 'Начать'} урок ${lesson.number}`} onClick={() => onLearn(lesson.id)}>{learning?.completed ? 'Итог урока' : started ? 'Продолжить урок' : 'Начать урок'}</button>
        <details className="lesson-material" onToggle={event => { if (!event.currentTarget.open) event.currentTarget.querySelectorAll('video').forEach(media => media.pause()); }}>
          <summary>Материал урока</summary>
          <div className="lesson-card-body">
            {route ? <section><h3>Чему научимся</h3><ol className="lesson-goals">{route.goals.map(goal => <li key={goal.id}>{goal.titleRu}</li>)}</ol><small className="muted">Части до 5 слов или фраз и одной конструкции. Трудный формат вернётся до «Помню». Прохождение маршрута и интервальные повторения учитываются отдельно.</small></section> : <p className="notice">Учебный маршрут готовится. Дополнительный словарь доступен ниже.</p>}
            <details className="lesson-details"><summary>Дополнительный словарь и конструкции</summary><div className="stack">
              <p>Полный материал указателя: {words.length} слов и фраз. В повторении уже {learnedWords} слов и {learnedSkills} конструкций.</p><small className="muted">Эта практика не нужна для завершения основного маршрута. {stagedLearning(course) ? 'Материал попадает в повторения после успешной отработки всех доступных форматов.' : 'Первая оценка добавляет материал в повторения.'}</small>
              <button className="quiet" data-testid="train-lesson" data-lesson-id={lesson.id} aria-label={`Практиковать дополнительный словарь урока ${lesson.number}`} onClick={() => onTrain(lesson.id)}>Практиковать словарь</button>
              {skills.length > 0 && <div><h3>Конструкции</h3>{skills.map(skill => <p key={skill.id}><JapaneseText text={skill.title} course={course} mode={settings.orthography} /></p>)}</div>}
              <div><h3>Слова и фразы</h3>{words.slice(0, 16).map(word => <p key={word.id}><Japanese value={word} forms={course.forms} mode={settings.orthography} /> — {word.meaningRu}</p>)}{words.length > 16 && <small>И ещё {words.length - 16}. Практика предлагает неизученный остаток полного словаря.</small>}</div>
            </div></details>
            {lesson.videos && <LessonVideoLibrary materials={lesson.videos} course={data.course} orthography={data.settings.orthography} />}
          </div>
        </details>
      </article>;
    })}</div>
  </>;
}
