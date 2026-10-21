import type { Snapshot } from './types';
import { Japanese } from './Japanese';
import { studyWord } from './learning';
import { LessonVideo } from './LessonVideo';

export function Textbook({ data, onLearn, onTrain }: { data: Snapshot; onLearn: (lessonId: string) => void; onTrain: (lessonId: string) => void }) {
  const { course, settings, progress } = data;
  const introducedWords = new Set(progress.introducedWordIds);
  const introducedSkills = new Set(progress.introducedSkillIds);
  return <>
    <header className="pagehead"><h1>Учебник</h1><p>Marugoto Starter A1 · 18 уроков · 9 тем</p><p className="muted">Сначала знакомимся с основным материалом, затем практикуем его в обе стороны и на слух. Можно выйти в любой момент: точный шаг сохранится для вас.</p></header>
    <div className="lesson-grid" onPlayCapture={event => { event.currentTarget.querySelectorAll('video').forEach(media => { if (media !== event.target) media.pause(); }); }}>{course.lessons.map(lesson => {
      const route = course.learning?.find(route => route.lessonId === lesson.id);
      const learning = data.learning?.find(state => state.lessonId === lesson.id);
      const percent = learning && learning.totalSteps > 0 ? Math.min(100, Math.floor(learning.completedSteps / learning.totalSteps * 100)) : 0;
      const started = (learning?.completedSteps ?? 0) > 0;
      const words = course.words.filter(word => word.lessonIds.includes(lesson.id) && studyWord(word));
      const skills = course.skills.filter(skill => course.exercises.some(exercise => exercise.lessonId === lesson.id && exercise.skillId === skill.id));
      const learnedWords = words.filter(word => introducedWords.has(word.id)).length;
      const learnedSkills = skills.filter(skill => introducedSkills.has(skill.id)).length;
      return <article className="lesson-card" key={lesson.id} data-lesson-id={lesson.id} data-learning-status={learning?.completed ? 'introduced' : started ? 'learning' : 'new'}>
        <details className="lesson-material" onToggle={event => { if (!event.currentTarget.open) event.currentTarget.querySelector('video')?.pause(); }}>
          <summary className="lesson-card-summary"><span className="lesson-topic-image" data-topic={lesson.topic} aria-hidden="true" /><span className="lesson-title"><small>Урок {lesson.number}</small><strong className="lesson-summary-title">{lesson.title}</strong><small className="lesson-status">{learning?.completed ? 'Урок пройден' : started ? 'Изучение начато' : 'Новый урок'}</small><small className="lesson-progress" data-lesson-id={lesson.id} data-completed-steps={learning?.completedSteps ?? 0} data-total-steps={learning?.totalSteps ?? 0}>Учебный маршрут: {percent}%</small></span><span className="lesson-disclosure" aria-hidden="true">⌄</span></summary>
          <div className="lesson-card-body">
            {route ? <section><h3>Чему научимся</h3><ol className="lesson-goals">{route.goals.map(goal => <li key={goal.id}>{goal.titleRu}</li>)}</ol><small className="muted">Части до 5 слов или фраз и одной конструкции. Трудный формат вернётся до «Помню». Прохождение маршрута и интервальные повторения учитываются отдельно.</small></section> : <p className="notice">Учебный маршрут готовится. Дополнительный словарь доступен ниже.</p>}
            <details className="lesson-details"><summary>Дополнительный словарь и конструкции</summary><div className="stack">
              <p>Полный материал указателя: {words.length} слов и фраз. В повторении уже {learnedWords} слов и {learnedSkills} конструкций.</p><small className="muted">Эта практика не нужна для завершения основного маршрута. Первая оценка, включая «Ещё раз», добавляет материал в личные повторения.</small>
              <button className="quiet" data-testid="train-lesson" data-lesson-id={lesson.id} aria-label={`Практиковать дополнительный словарь урока ${lesson.number}`} onClick={() => onTrain(lesson.id)}>Практиковать словарь</button>
              {skills.length > 0 && <div><h3>Конструкции</h3>{skills.map(skill => <p key={skill.id}>{skill.title}</p>)}</div>}
              <div><h3>Слова и фразы</h3>{words.slice(0, 16).map(word => <p key={word.id}><Japanese value={word} mode={settings.orthography} /> — {word.meaningRu}</p>)}{words.length > 16 && <small>И ещё {words.length - 16}. Практика предлагает неизученный остаток полного словаря.</small>}</div>
            </div></details>
            {lesson.video && <details className="lesson-details"><summary>Видеодиалог Marugoto Plus</summary><LessonVideo material={lesson.video} /></details>}
          </div>
        </details>
        <button className="primary lesson-train" data-testid="learn-lesson" data-lesson-id={lesson.id} disabled={!route} aria-label={`${learning?.completed ? 'Итог' : started ? 'Продолжить' : 'Начать'} урок ${lesson.number}`} onClick={() => onLearn(lesson.id)}>{learning?.completed ? 'Итог урока' : started ? 'Продолжить урок' : 'Начать урок'}</button>
      </article>;
    })}</div>
  </>;
}
