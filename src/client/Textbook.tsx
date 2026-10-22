import type { Snapshot } from './types';
import { Japanese } from './Japanese';
import { studyWord } from './learning';
import { counterDefinitions, counterWords, numbersFor, objectFor } from '../shared/counters';

export function Textbook({ data, onTrain, onCounters }: { data: Snapshot; onTrain: (lessonId: string) => void; onCounters: () => void }) {
  const { course, settings, progress } = data;
  const introducedWords = new Set(progress.introducedWordIds);
  const introducedSkills = new Set(progress.introducedSkillIds);
  return <>
    <header className="pagehead"><h1>Учебник</h1><p>Marugoto Starter A1 · 18 уроков · 9 тем</p><p className="muted">Выберите урок и начните тренировку: до 10 новых слов и 2 конструкций за порцию. После завершённой карточки материал автоматически появится в повторении.</p></header>
    <section className="counter-course sheet" aria-labelledby="counter-course-title">
      <div className="spread"><div><small lang="ja">ひとつ、ふたつ、みっつ…</small><h2 id="counter-course-title">Счётные суффиксы</h2><p>Картинки, чтения и аудио · по 20 карточек · от одного до миллионов.</p></div><button className="primary" onClick={onCounters}>Тренировать счёт</button></div>
      <div className="counter-levels">{counterDefinitions.map(counter => {
        const available = counterWords(course.words, introducedWords).some(word => objectFor(word)?.counters.includes(counter.id));
        const state = progress.counters?.find(state => state.counterId === counter.id); const numbers = numbersFor(counter, state?.level ?? 0);
        return <div key={counter.id} data-counter-id={counter.id} data-counter-level={state?.level ?? 0} data-available={available}><strong lang="ja">{counter.surface}</strong><span>{counter.title}<small>{available ? `1–${Math.max(...numbers).toLocaleString('ru-RU')}` : 'После знакомства со словом'}</small></span></div>;
      })}</div>
      <small>Новые суффиксы открываются вместе с пройденными словами учебника. При недостатке материала колода короче.</small>
    </section>
    <div className="lesson-grid">{course.lessons.map(lesson => {
      const words = course.words.filter(word => word.lessonIds.includes(lesson.id) && studyWord(word));
      const skills = course.skills.filter(skill => course.exercises.some(exercise => exercise.lessonId === lesson.id && exercise.skillId === skill.id));
      const learnedWords = words.filter(word => introducedWords.has(word.id)).length;
      const learnedSkills = skills.filter(skill => introducedSkills.has(skill.id)).length;
      const total = words.length + skills.length; const learned = learnedWords + learnedSkills;
      return <article className="lesson-card" key={lesson.id} data-lesson-id={lesson.id} data-learning-status={learned === 0 ? 'new' : learned === total ? 'introduced' : 'learning'}>
        <details className="lesson-material">
          <summary className="lesson-card-summary"><span className="lesson-topic-image" data-topic={lesson.topic} aria-hidden="true" /><span className="lesson-title"><small>Урок {lesson.number}</small><strong className="lesson-summary-title">{lesson.title}</strong><small className="lesson-status">{learned === 0 ? 'Начать изучение' : learned === total ? 'Материал знаком' : 'Изучение начато'}</small><small className="lesson-progress" data-lesson-id={lesson.id} data-introduced={learned} data-total={total}>Изучено {learned} из {total}</small></span><span className="lesson-disclosure" aria-hidden="true">⌄</span></summary>
          <div className="lesson-card-body">
            <p>{learnedWords} из {words.length} слов и фраз · {learnedSkills} из {skills.length} конструкций уже в повторении.</p><small className="muted">Общий материал разных уроков учитывается один раз. «Помню» и «Ещё раз» завершают первое знакомство; простое раскрытие карточки — нет.</small>
            {skills.length > 0 && <div><h3>Конструкции</h3>{skills.map(skill => <p key={skill.id}>{skill.title}</p>)}</div>}
            <div><h3>Слова и фразы</h3>{words.slice(0, 16).map(word => <p key={word.id}><Japanese value={word} mode={settings.orthography} /> — {word.meaningRu}</p>)}{words.length > 16 && <small>И ещё {words.length - 16}. Тренировка последовательно предложит неизученный остаток.</small>}</div>
            <p className="muted">Записи для аудирования: {words.filter(word => word.audioUrl).length} из {words.length}. Синтезированное произношение отдельных слов и фраз.</p>
          </div>
        </details>
        <button className="primary lesson-train" data-testid="train-lesson" data-lesson-id={lesson.id} aria-label={`Тренировать урок ${lesson.number}`} onClick={() => onTrain(lesson.id)}>Тренировать</button>
      </article>;
    })}</div>
  </>;
}
