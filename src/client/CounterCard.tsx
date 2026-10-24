import { useEffect, useRef, useState } from 'react';
import type { LearnerSettings, ReviewItem, ReviewResult } from '../shared/types';
import type { Snapshot } from './types';
import { GestureCard } from './GestureCard';
import { FlipCard } from './FlipCard';
import { CounterPicture } from './CounterPicture';
import { JapaneseText } from './JapaneseText';
import { DisplayControl, Japanese } from './Japanese';
import { useCardSpeech } from './useCardSpeech';
import { useReviewSave } from './useReviewSave';
import type { CardActivity, SavedFeedback } from './companion';
import type { SceneSound } from './sceneSound';
import { counterAnswer, counterDefinitions, readingVariants } from '../shared/counters';

export function CounterCard({ item, data, userId, onNext, onSaved, onFeedback, saveSettings, settingsBusy, active, onActivity, sound, cueScope, introductionSeen, onIntroductionRead }: {
  item: Extract<ReviewItem, { mode: 'counter' }>; data: Snapshot; userId: string; onNext: (feedback?: SavedFeedback, result?: ReviewResult) => void;
  onSaved: () => void; onFeedback: (feedback: SavedFeedback) => void; saveSettings: (value: LearnerSettings) => Promise<void>; settingsBusy: boolean; active: boolean; onActivity: (value: CardActivity) => void; sound: SceneSound; cueScope: string;
  introductionSeen: boolean; onIntroductionRead: () => void;
}) {
  const card = item.counter, age = card.definition.id === 'sai';
  const [intro, setIntro] = useState(card.introduction && !introductionSeen && !data.progress.counters?.some(progress => progress.counterId === card.definition.id));
  const [helped, setHelped] = useState(false), [revealed, setRevealed] = useState(false), [choice, setChoice] = useState<string>();
  const objective = card.kind !== 'recall';
  const [confirmed, setConfirmed] = useState<{ ownerId: string; feedback: SavedFeedback; result: ReviewResult }>();
  const callbacks = useRef({ active, userId, onNext, onFeedback, sound }); callbacks.current = { active, userId, onNext, onFeedback, sound };
  const reacted = useRef(false), advanced = useRef(false);
  const rule = useRef<HTMLDialogElement>(null);
  const [ruleOpen, setRuleOpen] = useState(false);
  function openRule() { setHelped(true); setRuleOpen(true); rule.current?.showModal(); }
  const speech = useCardSpeech(card.audioUrl, card.kind === 'listening-image' && !intro || revealed, active, data.settings.speechVolume, sound);
  const correct = choice === undefined ? undefined : card.acceptedKeys.includes(choice);
  const saving = useReviewSave(userId, onSaved, (submission, result) => {
    const kind = submission.rating === 1 || helped || result.correct === false ? 'again' : 'good';
    const feedback: SavedFeedback = { attemptId: result.attemptId, kind };
    if (objective) { setRevealed(true); setConfirmed({ ownerId: userId, feedback, result }); }
    else { if (active && !document.hidden) sound.cue(kind, result.attemptId); onNext(feedback, result); }
  });
  useEffect(() => {
    if (!confirmed) return;
    let timer: number | undefined;
    function resume() {
      window.clearTimeout(timer);
      if (document.hidden || !callbacks.current.active || callbacks.current.userId !== confirmed!.ownerId || advanced.current) return;
      if (!reacted.current) { reacted.current = true; callbacks.current.onFeedback(confirmed!.feedback); callbacks.current.sound.cue(confirmed!.feedback.kind, confirmed!.feedback.attemptId); }
      timer = window.setTimeout(() => {
        if (document.hidden || !callbacks.current.active || callbacks.current.userId !== confirmed!.ownerId || advanced.current) return;
        advanced.current = true; callbacks.current.onNext(confirmed!.feedback, confirmed!.result);
      }, confirmed!.feedback.kind === 'good' ? 800 : 1600);
    }
    resume(); document.addEventListener('visibilitychange', resume);
    return () => { window.clearTimeout(timer); document.removeEventListener('visibilitychange', resume); };
  }, [confirmed, active, userId]);
  const unavailable = card.kind === 'listening-image' && (!card.audioUrl || !speech.played || !!speech.error);
  const enabled = active && !intro && !saving.busy && !saving.pending && !confirmed && !unavailable;
  const phase = saving.error || speech.error || !active ? 'neutral' : saving.busy ? 'checking' : speech.playing ? 'listening' : revealed ? 'revealed' : 'idle';
  useEffect(() => { if (!active) rule.current?.close(); }, [active]);
  useEffect(() => { onActivity({ reviewId: item.id, activity: phase, key: `${item.id}:${phase}` }); }, [item.id, phase, onActivity]);
  function reveal(value?: string) {
    if (!enabled || document.hidden || revealed) return;
    setChoice(value);
    if (!objective) { setRevealed(true); sound.cue('reveal', `${cueScope}:${item.id}`); }
    if (objective && value !== undefined) void saving.save({ attemptId: crypto.randomUUID(), reviewId: item.id, version: item.version, mode: 'counter', rating: card.acceptedKeys.includes(value) && !helped ? 3 : 1, choice: value, helped });
    document.querySelector<HTMLElement>('[data-testid="review-gesture"]')?.focus({ preventScroll: true });
  }
  function grade(rating: 1 | 3) {
    if (!enabled || document.hidden || objective || !revealed) return;
    return saving.save({ attemptId: crypto.randomUUID(), reviewId: item.id, version: item.version, mode: 'counter', rating: correct === false || helped ? 1 : rating, choice, helped });
  }
  const title = { 'image-counter': 'Какое счётное слово подходит?', 'counter-image': 'Что считают этим суффиксом?', 'reading-choice': 'Выберите чтение количества', 'listening-image': 'Послушайте и выберите количество', recall: 'Вспомните количество по-японски' }[card.kind];
  const picture = <CounterPicture object={card.object} quantity={card.quantity ?? (age ? 7 : 1)} label={card.word.meaningRu} age={age} showQuantity={card.quantity !== null} />;
  const ruleContent = <><h2><Japanese value={counterAnswer(card.definition, null)} mode={data.settings.orthography} /> · {card.definition.title}</h2><p><JapaneseText text={card.definition.explanation} course={data.course} mode={data.settings.orthography} spellings={[counterAnswer(card.definition, null)]} /></p><div className="counter-examples">{card.examples.map(example => <CounterExample key={example.surface} example={example} data={data} active={active && (intro || ruleOpen)} sound={sound} />)}</div></>;
  return <GestureCard mode="counter" phase={objective || intro ? 'choice' : revealed ? 'answer' : 'question'} reviewId={item.id} enabled={enabled && revealed && !objective} active={active} onAdvance={grade} actions={<DisplayControl mode={data.settings.orthography} disabled={settingsBusy || !enabled} onChange={orthography => { void saveSettings({ ...data.settings, orthography }); }} />}>
    {intro ? <div className="counter-introduction illustrated-card" data-testid="counter-introduction"><div className="card-art">{picture}</div><div className="card-information"><small>Знакомимся со счётным словом</small>{ruleContent}<button className="primary" disabled={!active} onClick={() => { onIntroductionRead(); setIntro(false); }}>К карточке</button></div></div> : <>
      <FlipCard revealed={revealed} front={<div className={`counter-card${card.kind === 'recall' ? ' recall-face' : ''}`} data-testid="counter-front" data-card-face={card.kind === 'recall' || undefined} role={card.kind === 'recall' ? 'button' : undefined} tabIndex={card.kind === 'recall' ? 0 : undefined} onClick={event => { if (card.kind === 'recall' && !((event.target as Element).closest('button, a, summary'))) reveal(); }} onKeyDown={event => { if (card.kind === 'recall' && event.currentTarget === event.target && ['Enter', ' '].includes(event.key)) { event.preventDefault(); reveal(); } }}>
        <div className="illustrated-card"><div className="card-art">{card.kind === 'counter-image' ? <span className="prompt"><Japanese value={card.answer} mode={data.settings.orthography} /></span> : card.kind === 'listening-image' ? <button className="counter-listen inline-audio" aria-label="Прослушать количество" onClick={() => { void speech.play(); }} disabled={!active || speech.playing}>▶ {speech.playing ? 'Слушаем…' : 'Прослушать ещё раз'}</button> : picture}</div><div className="card-information"><small>Счётные суффиксы</small><h2>{title}</h2>{card.kind !== 'listening-image' && card.kind !== 'counter-image' && <p><Japanese value={card.word} forms={data.course.forms} mode={data.settings.orthography} /> · {card.word.meaningRu}</p>}
        {card.kind !== 'recall' && <div className="counter-options">{card.options.map(option => { const definition = counterDefinitions.find(value => value.id === option.key); return <button key={option.key} data-choice={option.key} aria-pressed={choice === option.key} disabled={!enabled || revealed} onClick={() => reveal(option.key)}>{option.object && option.word ? <><CounterPicture object={option.object} quantity={option.quantity ?? 1} label={option.word.meaningRu} age={option.age} showQuantity={card.kind === 'listening-image'} /><small>{option.label}</small></> : definition ? <Japanese value={counterAnswer(definition, null)} mode={data.settings.orthography} /> : <span lang="ja" className="jp">{option.label}</span>}</button>; })}</div>}
        <button className="text-link" disabled={!active || saving.busy || saving.pending} onClick={openRule}>Полное правило ↗</button></div></div>
      </div>} back={<div className="illustrated-card counter-answer" data-testid="counter-answer"><div className="card-art">{picture}</div><div className="card-information"><small role="status">{correct === false ? 'Ещё раз — посмотрим на ответ' : 'Ответ'}</small><h2>{card.definition.title}</h2><div className="inline-pronunciation"><span className={`prompt${card.answer.kana.length > 10 ? ' counter-long-answer' : ''}`}><Japanese value={card.answer} mode={data.settings.orthography} /></span>{card.audioUrl && <button className="quiet audio-icon" aria-label="Прослушать ответ" disabled={!active || speech.playing || saving.busy} onClick={() => { void speech.play(); }}>▶</button>}</div><p><JapaneseText text={card.definition.explanation} course={data.course} mode={data.settings.orthography} spellings={[counterAnswer(card.definition, null)]} /></p><button className="text-link" disabled={!active} onClick={openRule}>Полное правило ↗</button><small>{card.kind === 'image-counter' && correct && choice !== card.definition.id && <>Ваш вариант тоже подходит. </>}{card.quantity !== null && readingVariants(card.definition.id, card.quantity).length > 1 && <>Также допустимо: <span lang="ja">{readingVariants(card.definition.id, card.quantity).slice(1).join(' · ')}</span>.</>}</small></div></div>} />
    </>}
    <dialog ref={rule} className="token-dialog rule-dialog" aria-label="Полное правило счётного слова" onClose={() => setRuleOpen(false)}><div className="spread"><h2>Полное правило</h2><button className="quiet" aria-label="Закрыть правило" onClick={() => rule.current?.close()}>×</button></div>{ruleContent}</dialog>
    {speech.error && <p className="error" role="alert">{speech.error}</p>}
    {saving.busy && <p role="status">Сохраняем ответ…</p>}
    {confirmed && <p role="status" data-testid="counter-confirmed" data-feedback={confirmed.feedback.kind}>{confirmed.feedback.kind === 'good' ? 'Верно! Следующий вопрос…' : 'Это задание вернётся после других карточек.'}</p>}
    {saving.error && <div className="notice error" role="alert"><p>{saving.error}</p><button disabled={!active} onClick={saving.retry}>Повторить сохранение</button></div>}
  </GestureCard>;
}

function CounterExample({ example, data, active, sound }: { example: ReturnType<typeof counterAnswer> & { audioUrl?: string }; data: Snapshot; active: boolean; sound: SceneSound }) {
  const speech = useCardSpeech(example.audioUrl, false, active, data.settings.speechVolume, sound);
  return <div className="inline-pronunciation"><Japanese value={example} mode={data.settings.orthography} />{example.audioUrl && <button className="quiet audio-icon" aria-label={`Прослушать ${example.kana}`} disabled={!active || speech.playing} onClick={() => { void speech.play(); }}>▶</button>}{speech.error && <p role="status">{speech.error}</p>}</div>;
}
