import { useState } from 'react';
import { trainingSections } from '../shared/training';
import { catalogFor } from '../shared/catalog';
import { counterWords, numbersFor, objectFor, counterAnswer } from '../shared/counters';
import type { Snapshot } from './types';
import type { SceneSound } from './sceneSound';
import { Japanese } from './Japanese';
import { KanaTrainer } from './KanaTrainer';
import { KanaReference } from './Reference';

export function Trainings({ data, sound, onCounters, onTopic, onConstruction }: { data: Snapshot; sound: SceneSound; onCounters: () => void; onTopic: (topicId: 'questions' | 'time', sectionId: string) => void; onConstruction: (skillId: string) => void }) {
  const { course, progress } = data, catalog = catalogFor(course);
  const { definitions: counterDefinitions } = catalog.counters;
  const introducedWords = new Set(progress.introducedWordIds);
  const availableCounters = counterDefinitions.filter(counter => counterWords(course.words, introducedWords, catalog).some(word => objectFor(word, catalog)?.counters.includes(counter.id))).length;
  const skills = course.skills.filter(skill => progress.introducedSkillIds.includes(skill.id));
  const [kana, setKana] = useState<'hiragana' | 'katakana'>(), [selectedSkill, setSelectedSkill] = useState('');
  const skillId = skills.find(skill => skill.id === selectedSkill)?.id ?? skills[0]?.id ?? '';
  function selectKana(script?: 'hiragana' | 'katakana') { setKana(script); window.scrollTo({ top: 0, behavior: 'instant' }); }
  return <section className="trainings-page" data-testid="trainings-page">
    <header className="pagehead"><h1>Тренировки</h1><p className="muted">Сначала знакомимся с материалом небольшими группами, затем закрепляем его в упражнениях.</p></header>
    {kana ? <><details className="sheet"><summary>Справка: {kana === 'hiragana' ? 'хирагана' : 'катакана'}</summary><KanaReference script={kana} catalog={catalog} /></details><KanaTrainer key={kana} script={kana} catalog={catalog} sound={sound} volume={data.settings.speechVolume} onClose={() => selectKana()} /></> : <>
    <section className="thematic-course" aria-labelledby="thematic-title">
      <h2 id="thematic-title">Тематические тренировки</h2>
      <div className="thematic-sections">
        <article aria-labelledby="counter-course-title" data-testid="counter-training-card"><h3 id="counter-course-title">Счётные суффиксы</h3><button onClick={onCounters}>Тренировать счёт</button></article>
        {trainingSections(course).map(section => <article key={section.id}><h3>{section.title}</h3><button onClick={() => onTopic(section.topic, section.id)}>Изучать</button></article>)}
      </div>
      <details className="counter-course-details"><summary>Справка по счёту · доступно {availableCounters} из {counterDefinitions.length} типов</summary><div className="counter-levels">{counterDefinitions.map(counter => {
        const available = counterWords(course.words, introducedWords, catalog).some(word => objectFor(word, catalog)?.counters.includes(counter.id));
        const state = progress.counters?.find(state => state.counterId === counter.id); const numbers = numbersFor(counter, state?.level ?? 0);
        return <div key={counter.id} data-counter-id={counter.id} data-counter-level={state?.level ?? 0} data-available={available}><strong><Japanese value={counterAnswer(counter, null, catalog)} mode={data.settings.orthography} /></strong><span>{counter.title}<small>{available ? `1–${Math.max(...numbers).toLocaleString('ru-RU')}` : 'После знакомства со словом'}</small></span></div>;
      })}</div><p>Новые суффиксы открываются вместе с пройденными словами учебника. В тренировке до 20 заданий; при недостатке материала — меньше.</p></details>
    </section>
    <section className="sheet" aria-labelledby="kana-training-title"><h2 id="kana-training-title">Азбуки</h2><p>Выбор рядов, знакомство со знаками, чтение и узнавание на слух. Знаки не добавляются в интервальное повторение.</p><div className="row"><button data-testid="train-kana" data-script="hiragana" onClick={() => selectKana('hiragana')}>Тренировать хирагану</button><button data-testid="train-kana" data-script="katakana" onClick={() => selectKana('katakana')}>Тренировать катакану</button></div></section>
    <section className="sheet stack training-constructions" aria-labelledby="construction-training-title"><h2 id="construction-training-title">Конструкции</h2><p>Понимание текста, аудирование и сборка фразы. Тренируем изученные конструкции, результаты учитываются в общих повторениях.</p>{skills.length ? <div><label htmlFor="training-construction">Выберите конструкцию</label><select id="training-construction" value={skillId} onChange={event => setSelectedSkill(event.target.value)}>{skills.map(skill => <option key={skill.id} value={skill.id}>{skill.title}</option>)}</select></div> : <p className="muted">Сначала изучите конструкцию в уроке — затем она появится здесь для отдельной тренировки.</p>}<div><button data-testid="train-construction" disabled={!skillId} onClick={() => onConstruction(skillId)}>Тренировать конструкцию</button></div></section>
    </>}
  </section>;
}
