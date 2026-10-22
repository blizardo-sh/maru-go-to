import { useEffect, useRef, useState } from 'react';
import type { LearnerSettings, ReviewItem, ReviewResult } from '../shared/types';
import type { Snapshot } from './types';
import { GestureCard } from './GestureCard';
import { FlipCard } from './FlipCard';
import { CounterPicture } from './CounterPicture';
import { DisplayControl, Japanese } from './Japanese';
import { useCardSpeech } from './useCardSpeech';
import { useReviewSave } from './useReviewSave';
import type { CardActivity, SavedFeedback } from './companion';
import type { SceneSound } from './sceneSound';
import { readingVariants } from '../shared/counters';

export function CounterCard({ item, data, userId, onNext, onSaved, saveSettings, settingsBusy, active, onActivity, sound, cueScope, introductionSeen, onIntroductionRead }: {
  item: Extract<ReviewItem, { mode: 'counter' }>; data: Snapshot; userId: string; onNext: (feedback?: SavedFeedback, result?: ReviewResult) => void;
  onSaved: () => void; saveSettings: (value: LearnerSettings) => Promise<void>; settingsBusy: boolean; active: boolean; onActivity: (value: CardActivity) => void; sound: SceneSound; cueScope: string;
  introductionSeen: boolean; onIntroductionRead: () => void;
}) {
  const card = item.counter, age = card.definition.id === 'sai';
  const introduction = useRef<HTMLDivElement>(null);
  const [intro, setIntro] = useState(card.introduction && !introductionSeen && !data.progress.counters?.some(progress => progress.counterId === card.definition.id));
  const [helped, setHelped] = useState(false), [revealed, setRevealed] = useState(false), [choice, setChoice] = useState<string>();
  const speech = useCardSpeech(card.audioUrl, card.kind === 'listening-image' && !intro || revealed, active, data.settings.speechVolume, sound);
  const correct = choice === undefined ? undefined : card.acceptedKeys.includes(choice);
  const saving = useReviewSave(userId, onSaved, (submission, result) => {
    const kind = submission.rating === 1 || helped || result.correct === false ? 'again' : 'good';
    sound.cue(kind, result.attemptId); onNext({ attemptId: result.attemptId, kind }, result);
  });
  const unavailable = card.kind === 'listening-image' && (!card.audioUrl || !speech.played || !!speech.error);
  const enabled = active && !intro && !saving.busy && !saving.pending && !unavailable;
  const phase = saving.error || speech.error || !active ? 'neutral' : saving.busy ? 'checking' : speech.playing ? 'listening' : revealed ? 'revealed' : 'idle';
  useEffect(() => { const node = introduction.current; if (!active) node?.querySelectorAll('audio').forEach(audio => audio.pause()); return () => { node?.querySelectorAll('audio').forEach(audio => audio.pause()); sound.setSpeechPlaying(false); }; }, [active, intro, sound.setSpeechPlaying]);
  useEffect(() => { onActivity({ reviewId: item.id, activity: phase, key: `${item.id}:${phase}` }); }, [item.id, phase, onActivity]);
  function reveal(value?: string) {
    if (!enabled || revealed) return;
    setChoice(value); setRevealed(true); sound.cue('reveal', `${cueScope}:${item.id}`);
    document.querySelector<HTMLElement>('[data-testid="review-gesture"]')?.focus({ preventScroll: true });
  }
  function grade(rating: 1 | 3) {
    if (!enabled || !revealed) return;
    void saving.save({ attemptId: crypto.randomUUID(), reviewId: item.id, version: item.version, mode: 'counter', rating: correct === false || helped ? 1 : rating, choice, helped });
  }
  const title = { 'image-counter': 'Какое счётное слово подходит?', 'counter-image': 'Что считают этим суффиксом?', 'reading-choice': 'Выберите чтение количества', 'listening-image': 'Послушайте и выберите количество', recall: 'Вспомните количество по-японски' }[card.kind];
  const picture = <CounterPicture object={card.object} quantity={card.quantity ?? (age ? 7 : 1)} label={card.word.meaningRu} age={age} />;
  return <GestureCard mode="counter" reviewId={item.id} enabled={enabled && revealed} active={active} onAdvance={grade} actions={<DisplayControl mode={data.settings.orthography} disabled={settingsBusy || !enabled} onChange={orthography => { void saveSettings({ ...data.settings, orthography }); }} />}>
    {intro ? <div ref={introduction} className="counter-introduction stack" data-testid="counter-introduction"><small>Знакомимся со счётным словом</small><h2><Japanese value={{ surface: card.definition.surface, kana: card.definition.kana, segments: [{ surface: card.definition.surface, reading: card.definition.kana }] }} mode={data.settings.orthography} /> · {card.definition.title}</h2><p>{card.definition.explanation}</p><CounterPicture object={card.object} quantity={age ? 7 : 1} label={card.word.meaningRu} age={age} /><div className="counter-examples">{card.examples.map(example => <div key={example.surface}><Japanese value={example} mode={data.settings.orthography} />{example.audioUrl && <audio aria-label={`Прослушать пример ${example.surface}`} controls preload="none" src={example.audioUrl} ref={element => { if (element) element.volume = data.settings.speechVolume; }} onPlaying={event => { if (!active) { event.currentTarget.pause(); return; } event.currentTarget.parentElement?.parentElement?.querySelectorAll('audio').forEach(audio => { if (audio !== event.currentTarget) audio.pause(); }); sound.setSpeechPlaying(true); }} onPause={() => sound.setSpeechPlaying(false)} onEnded={() => sound.setSpeechPlaying(false)} />}</div>)}</div><button className="primary" disabled={!active} onClick={() => { onIntroductionRead(); setIntro(false); }}>К карточке</button></div> : <>
      <div className="spread"><small>{title}</small><button className="quiet" disabled={!active || saving.busy || saving.pending} onClick={() => { setHelped(true); setIntro(true); }}>Напомнить правило</button></div>
      <FlipCard revealed={revealed} front={<div className="study-card counter-card" data-testid="counter-front">
        {card.kind === 'counter-image' ? <div className="prompt"><Japanese value={card.answer} mode={data.settings.orthography} /></div> : card.kind === 'listening-image' ? <button className="counter-listen" onClick={() => { void speech.play(); }} disabled={!active || speech.playing}>{speech.playing ? 'Слушаем…' : '▶ Прослушать ещё раз'}</button> : <>{picture}<small><Japanese value={card.word} mode={data.settings.orthography} /> · {card.word.meaningRu}</small></>}
        {card.kind === 'recall' ? <button className="primary" data-card-face disabled={!enabled} onClick={() => reveal()}>Показать ответ</button> : <div className="counter-options">{card.options.map(option => <button key={option.key} data-choice={option.key} disabled={!enabled} onClick={() => reveal(option.key)}>{option.object && option.word ? <><CounterPicture object={option.object} quantity={option.quantity ?? 1} label={option.word.meaningRu} age={option.age} /><small>{option.label}</small></> : <span lang="ja">{option.label}</span>}</button>)}</div>}
      </div>} back={<div className="study-card counter-card" data-testid="counter-answer"><small role="status">{correct === false ? 'Ещё раз — посмотрим на ответ' : 'Ответ'}</small>{picture}<span className="prompt"><Japanese value={card.answer} mode={data.settings.orthography} /></span><p>{card.definition.explanation}</p><small>{card.kind === 'image-counter' && correct && choice !== card.definition.id && <>Ваш вариант {card.options.find(option => option.key === choice)?.label} тоже подходит. </>}{card.quantity !== null && readingVariants(card.definition.id, card.quantity).length > 1 && <>Также допустимо: <span lang="ja">{readingVariants(card.definition.id, card.quantity).slice(1).join(" · ")}</span>. </>}</small></div>} />
      {revealed && <div className="row counter-ratings"><button disabled={!enabled} onClick={() => grade(1)}>Ещё раз ↶</button><button className="primary" disabled={!enabled || correct === false || helped} onClick={() => grade(3)}>Помню ✓</button></div>}
      {card.audioUrl && (revealed || card.kind === 'listening-image') && <button className="quiet" disabled={!active || speech.playing || saving.busy} onClick={() => { void speech.play(); }}>▶ Прослушать ответ{card.kind === 'listening-image' && !revealed ? ' ещё раз' : ''}</button>}
    </>}
    {speech.error && <p className="error" role="alert">{speech.error}</p>}
    {saving.busy && <p role="status">Сохраняем ответ…</p>}
    {saving.error && <div className="notice error" role="alert"><p>{saving.error}</p><button disabled={!active} onClick={saving.retry}>Повторить сохранение</button></div>}
  </GestureCard>;
}
