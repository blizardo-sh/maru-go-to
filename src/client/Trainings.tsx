import { useState } from 'react';
import { trainingSections } from '../shared/training';
import { catalogFor } from '../shared/catalog';
import { counterWords, numbersFor, objectFor, counterAnswer } from '../shared/counters';
import type { Snapshot } from './types';
import type { SceneSound } from './sceneSound';
import { Japanese } from './Japanese';
import { CounterPicture } from './CounterPicture';
import { KanaTrainer } from './KanaTrainer';
import { KanaReference } from './Reference';

export function Trainings({ data, sound, onCounters, onTopic, onConstruction }: { data: Snapshot; sound: SceneSound; onCounters: () => void; onTopic: (topicId: 'questions' | 'time', sectionId: string) => void; onConstruction: (skillId: string) => void }) {
  const { course, progress } = data, catalog = catalogFor(course);
  const { definitions: counterDefinitions, objects: counterObjects } = catalog.counters;
  const introducedWords = new Set(progress.introducedWordIds);
  const availableCounters = counterDefinitions.filter(counter => counterWords(course.words, introducedWords, catalog).some(word => objectFor(word, catalog)?.counters.includes(counter.id))).length;
  const skills = course.skills.filter(skill => progress.introducedSkillIds.includes(skill.id));
  const [kana, setKana] = useState<'hiragana' | 'katakana'>(), [selectedSkill, setSelectedSkill] = useState('');
  const skillId = skills.find(skill => skill.id === selectedSkill)?.id ?? skills[0]?.id ?? '';
  function selectKana(script?: 'hiragana' | 'katakana') { setKana(script); window.scrollTo({ top: 0, behavior: 'instant' }); }
  return <section className="trainings-page" data-testid="trainings-page">
    <header className="pagehead"><h1>Тренировки</h1><p className="muted">Выберите тему или навык. Сначала справка и знакомство, затем практика. Прогресс общий с уроками и повторением.</p></header>
    {kana ? <><details className="sheet"><summary>Справка: {kana === 'hiragana' ? 'хирагана' : 'катакана'}</summary><KanaReference script={kana} catalog={catalog} /></details><KanaTrainer key={kana} script={kana} catalog={catalog} sound={sound} volume={data.settings.speechVolume} onClose={() => selectKana()} /></> : <>
    <section className="counter-course sheet" aria-labelledby="counter-course-title">
      <div className="counter-course-entry">{counterObjects[0] && <CounterPicture catalog={catalog} object={counterObjects[0]} quantity={3} label="Счётные предметы" showQuantity />}<div><h2 id="counter-course-title">Счётные суффиксы</h2><p>Картинки, чтения и аудио · колода до 20 карточек.</p></div><button className="primary" onClick={onCounters}>Тренировать счёт</button></div>
      <details className="counter-course-details"><summary>Типы счёта · доступно {availableCounters} из {counterDefinitions.length}</summary><div className="counter-levels">{counterDefinitions.map(counter => {
        const available = counterWords(course.words, introducedWords, catalog).some(word => objectFor(word, catalog)?.counters.includes(counter.id));
        const state = progress.counters?.find(state => state.counterId === counter.id); const numbers = numbersFor(counter, state?.level ?? 0);
        return <div key={counter.id} data-counter-id={counter.id} data-counter-level={state?.level ?? 0} data-available={available}><strong><Japanese value={counterAnswer(counter, null, catalog)} mode={data.settings.orthography} /></strong><span>{counter.title}<small>{available ? `1–${Math.max(...numbers).toLocaleString('ru-RU')}` : 'После знакомства со словом'}</small></span></div>;
      })}</div>
      <small>Новые суффиксы открываются вместе с пройденными словами учебника. При недостатке материала колода короче.</small></details>
    </section>
    {trainingSections(course).length > 0 && <section className="sheet thematic-course" aria-labelledby="thematic-title"><h2 id="thematic-title">Тематические тренировки</h2><p>Справка → знакомство с группой → практика. Доступны сразу, прогресс общий с уроками.</p><div className="thematic-sections">{trainingSections(course).map(section => <article key={section.id}><small>{section.topic === 'questions' ? 'Вопросы' : 'Время и календарь'}</small><h3>{section.title}</h3><p>{section.variable ? 'Небольшие подборки циферблатов и записей. Сначала правила чтения часов и минут.' : `${section.wordIds.length} выражений · части до 5`}</p><button className="primary" onClick={() => onTopic(section.topic, section.id)}>Изучать</button></article>)}</div></section>}
    <section className="sheet" aria-labelledby="kana-training-title"><h2 id="kana-training-title">Азбуки</h2><p>Выбор рядов, знакомство со знаками, чтение и узнавание на слух. Знаки не добавляются в интервальное повторение.</p><div className="row"><button className="primary" data-testid="train-kana" data-script="hiragana" onClick={() => selectKana('hiragana')}>Тренировать хирагану</button><button className="primary" data-testid="train-kana" data-script="katakana" onClick={() => selectKana('katakana')}>Тренировать катакану</button></div></section>
    <section className="sheet stack training-constructions" aria-labelledby="construction-training-title"><h2 id="construction-training-title">Конструкции</h2><p>Понимание текста, аудирование и сборка фразы. Тренируем изученные конструкции, результаты учитываются в общих повторениях.</p>{skills.length ? <div><label htmlFor="training-construction">Выберите конструкцию</label><select id="training-construction" value={skillId} onChange={event => setSelectedSkill(event.target.value)}>{skills.map(skill => <option key={skill.id} value={skill.id}>{skill.title}</option>)}</select></div> : <p className="muted">Сначала изучите конструкцию в уроке — затем она появится здесь для отдельной тренировки.</p>}<div><button className="primary" data-testid="train-construction" disabled={!skillId} onClick={() => onConstruction(skillId)}>Тренировать конструкцию</button></div></section>
    </>}
  </section>;
}
