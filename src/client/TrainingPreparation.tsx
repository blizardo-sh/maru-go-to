import { useState } from 'react';
import type { ReviewItem, ReviewQueue } from '../shared/types';
import type { Snapshot } from './types';
import { Japanese } from './Japanese';
import { JapaneseText } from './JapaneseText';
import { ExampleLine } from './ExampleLine';
import { WordIllustration } from './WordIllustration';
import { catalogFor } from '../shared/catalog';
import { trainingEntry } from '../shared/training';
import { useStepSpeech } from './GuidedLearning';
import type { CardActivity } from './companion';
import type { SceneSound } from './sceneSound';
import type { TrainingEntry } from '../shared/training';

export function TrainingVisual({ value }: { value?: TrainingEntry['visual'] }) {
  if (!value) return null;
  if (value.kind === 'calendar') return <div className="training-calendar" aria-label={`${value.value} ${value.label}`}><small>{value.label}</small><strong>{value.value}</strong></div>;
  const hour = (value.hour % 12 + value.minute / 60) * 30, minute = value.minute * 6;
  return <div className="training-clock"><svg viewBox="0 0 200 200" role="img" aria-label={`Часы: ${value.hour}:${String(value.minute).padStart(2, '0')} ${value.period === 'am' ? 'до полудня' : 'после полудня'}`}><circle cx="100" cy="100" r="94" fill="var(--paper, #fff5de)" stroke="currentColor" strokeWidth="3" />{Array.from({length:12}, (_,i) => { const angle=(i+1)*Math.PI/6; return <text key={i} x={100+77*Math.sin(angle)} y={106-77*Math.cos(angle)} textAnchor="middle" fontSize="16">{i+1}</text>; })}<line x1="100" y1="100" x2="100" y2="54" stroke="currentColor" strokeWidth="7" strokeLinecap="round" transform={`rotate(${hour} 100 100)`}/><line x1="100" y1="100" x2="100" y2="32" stroke="currentColor" strokeWidth="4" strokeLinecap="round" transform={`rotate(${minute} 100 100)`}/><circle cx="100" cy="100" r="5" fill="currentColor"/></svg><small>{value.period === 'am' ? 'До полудня · AM' : 'После полудня · PM'}</small></div>;
}

export function TrainingPreparation({ items, reference, stage, data, active, sound, onActivity, onContinue }: { items: ReviewItem[]; reference: ReviewQueue['reference']; stage: 'reference' | 'learning'; data: Snapshot; active: boolean; sound: SceneSound; onActivity: (value: CardActivity) => void; onContinue: () => Promise<void> }) {
  const [busy,setBusy]=useState(false),[error,setError]=useState('');
  const speech=useStepSpeech(active,data.settings.speechVolume,sound,onActivity,'preparation:'+stage);
  const entries=[...new Map(items.filter(item=>item.preparation).map(item=>[item.preparation!.key,item.preparation!])).values()];
  async function proceed() { if(!active||busy||document.hidden)return; setBusy(true);setError('');speech.stop();try{await onContinue();}catch(error){setError(error instanceof Error?error.message:'Не удалось сохранить этап. Повторите попытку.');}finally{setBusy(false);} }
  return <article className="training-preparation stack" data-testid="training-preparation" data-stage={stage}><audio hidden ref={speech.audio} preload="none"/><header><small>{stage==='reference'?'1 · Справка':'2 · Знакомство'}</small><h2>{stage==='reference'?reference?.title??'Как устроена тренировка':'Материал этой части'}</h2><p>{stage==='reference'?'Разберите правило, затем познакомьтесь с небольшой группой. В практику можно вернуться после выхода.':'Послушайте записи и прочитайте примеры. Далее — перемешанная практика доступных форматов.'}</p></header>
    {stage==='reference'?<div className="training-reference"><p className="preserve-lines"><JapaneseText text={reference?.text??'Сначала изучаем материал, затем отрабатываем его. В повторение он попадает после успешного учебного цикла.'} course={data.course} mode={data.settings.orthography}/></p>{entries.filter(entry=>entry.kind!=='word').map(entry=><section key={entry.key}><h3>{entry.title}</h3><p><JapaneseText text={entry.explanationRu} course={data.course} mode={data.settings.orthography}/></p></section>)}</div>:<div className="word-group-grid">{entries.map(entry=>{const visual=entry.word?trainingEntry(data.course,entry.word.id)?.visual:undefined;return <article className="word-introduction" key={entry.key} data-study-key={entry.key}>{visual?<TrainingVisual value={visual}/>:entry.word?<WordIllustration catalog={catalogFor(data.course)} wordId={entry.word.id}/>:null}<div className="word-introduction-heading"><h3>{entry.word?<Japanese value={entry.word} forms={data.course.forms} mode={data.settings.orthography}/>:entry.title}</h3>{entry.word?.audioUrl&&<button className="quiet audio-icon" disabled={!active||busy||speech.playing} aria-label={`Прослушать ${entry.word.surface}`} onClick={()=>{void speech.play(entry.word!.audioUrl);}}>▶</button>}</div>{entry.word&&<p className="word-meaning">{entry.word.meaningRu}</p>}<p className="word-note"><JapaneseText text={entry.explanationRu} course={data.course} mode={data.settings.orthography}/></p>{entry.word&&!entry.word.audioUrl&&<small className="muted">Для этой записи пока доступна только текстовая практика.</small>}{[...(entry.example?[entry.example]:[]),...(entry.examples??[])].map((example,index)=><ExampleLine key={index} example={example} mode={data.settings.orthography} play={example.audioUrl?()=>{void speech.play(example.audioUrl);}:undefined} disabled={!active||busy||speech.playing}/>)}{!entry.example&&!entry.examples?.length&&<small className="muted">{visual?.kind==='clock'?'Произнесите время целиком, сверяясь с правилом часов и минут.':'Отдельный пример для этой записи пока не подготовлен.'}</small>}</article>;})}</div>}
    {(error||speech.error)&&<p className="notice error" role="alert">{error||speech.error}</p>}<footer className="album-footer"><button className="primary" disabled={!active||busy} onClick={()=>{void proceed();}}>{busy?'Сохраняем этап…':stage==='reference'?'Перейти к знакомству':'Начать практику'}</button></footer></article>;
}
