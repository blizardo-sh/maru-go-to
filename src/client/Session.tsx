import { useCallback, useEffect, useRef, useState } from 'react';
import type { LearnerSettings, ReviewItem, ReviewQueue, ReviewResult } from '../shared/types';
import type { Snapshot, StudySource, User } from './types';
import { sourceKey, trainingContext } from './learning';
import { api } from './api';
import { useReviewSave } from './useReviewSave';
import { GestureCard } from './GestureCard';
import { DisplayControl, Japanese } from './Japanese';
import { SentenceWorkspace } from './SentenceWorkspace';
import { WordIllustration } from './WordIllustration';
import { Cat } from './Cat';
import { companionState, type CardActivity, type SavedFeedback } from './companion';
import type { SceneId } from './scenes';
import type { SceneSound } from './sceneSound';
import { advanceDeck } from './study';
import { FlipCard } from './FlipCard';
import { CounterCard } from './CounterCard';
import { useCardSpeech } from './useCardSpeech';
import { objectFor } from '../shared/counters';

const messages = (error: unknown) => error instanceof Error ? error.message : 'Не удалось сохранить ответ. Повторите попытку.';
export function Session({ user, data, source, onExit, onCourse, onSaved, saveSettings, settingsBusy, active = true, scene = 'room', sound }: { user: User; data: Snapshot; source: StudySource; onExit: () => void; onCourse: () => void; onSaved: () => void; saveSettings: (value: LearnerSettings) => Promise<void>; settingsBusy: boolean; active?: boolean; scene?: SceneId; sound: SceneSound }) {
  const [queue, setQueue] = useState<ReviewQueue | null>(null); const [error, setError] = useState('');
  const [completed, setCompleted] = useState(0); const [feedback, setFeedback] = useState<SavedFeedback | null>(null);
  const [pending, setPending] = useState<ReviewItem[]>([]); const [turn, setTurn] = useState(0);
  const seenCounterIntros = useRef(new Set<string>());
  const [soundSessionId] = useState(() => crypto.randomUUID());
  const [portion, setPortion] = useState(0); const [loadingQueue, setLoadingQueue] = useState(true); const request = useRef(0);
  const contextKey = sourceKey(source); const training = source.kind !== 'review';
  const sourceTitle = source.kind === 'lesson' ? `Дополнительный словарь · урок ${data.course.lessons.find(lesson => lesson.id === source.lessonId)?.number ?? ''}` : source.kind === 'list' ? data.lists.find(list => list.id === source.listId)?.name ?? 'Личный список' : source.kind === 'counters' ? 'Счётные суффиксы' : 'Повторение';
  const [activity, setActivity] = useState<CardActivity | null>(null); const [companionFeedback, setCompanionFeedback] = useState<SavedFeedback | null>(null);
  const load = useCallback(async () => {
    const current = ++request.current; setError(''); setLoadingQueue(true);
    const query = new URLSearchParams(Object.entries(trainingContext(source)).map(([key, value]) => [key, String(value)]));
    try {
      const nextQueue = await api<ReviewQueue>(source.kind === 'review' ? '/api/reviews?mode=mixed' : `/api/training?${query}`);
      if (request.current !== current) return;
      const visibleQueue = source.kind === 'lesson' ? { ...nextQueue, items: nextQueue.items.filter(item => item.mode !== 'grammar') } : nextQueue;
      setQueue(visibleQueue); setPending(visibleQueue.items); setCompleted(0); setTurn(0); setFeedback(null); setActivity(null); setCompanionFeedback(null); setPortion(value => value + 1);
    } catch (failure) { if (request.current === current) setError(messages(failure)); }
    finally { if (request.current === current) setLoadingQueue(false); }
  }, [contextKey]);
  useEffect(() => { void load(); return () => { request.current++; }; }, [load]);
  const total = queue?.items.length ?? 0; const item = pending[0];
  const remainingCards = pending.filter(item => item.mode !== 'grammar').length;
  const initialCards = queue?.items.filter(item => item.mode !== 'grammar').length ?? 0;
  useEffect(() => { if (total > 0 && completed >= total) sound.cue('complete', `${soundSessionId}:${portion}`); }, [total, completed, soundSessionId, portion, sound.cue]);
  const percent = total > 0 ? Math.round(completed / total * 100) : 0;
  const companion = companionState({ reviewId: item?.id, activity, feedback: companionFeedback, completed, total });
  function next(acknowledged?: SavedFeedback, result?: ReviewResult, reaction = acknowledged) {
    const repeat = item?.mode !== 'grammar' && acknowledged?.kind === 'again';
    setPending(items => advanceDeck(items, repeat, result)); setTurn(value => value + 1);
    if (!repeat) setCompleted(value => Math.min(value + 1, total));
    setFeedback(acknowledged ?? null); setCompanionFeedback(reaction ?? null);
  }
  function clearPreviousFeedback() { if (active) { setFeedback(null); setCompanionFeedback(null); } }
  const board = item ? item.mode === 'grammar'
    ? <SentenceWorkspace source={source} key={`${portion}:${turn}:${item.id}:${item.version}`} item={item} data={data} userId={user.id} onNext={reaction => next(undefined, undefined, reaction)} onSaved={onSaved} saveSettings={saveSettings} settingsBusy={settingsBusy} active={active} onActivity={setActivity} sound={sound} />
    : item.mode === 'counter' ? <CounterCard key={`${portion}:${turn}`} item={item} data={data} userId={user.id} onNext={next} onSaved={onSaved} saveSettings={saveSettings} settingsBusy={settingsBusy} active={active} onActivity={setActivity} sound={sound} cueScope={`${soundSessionId}:${portion}:${turn}`} introductionSeen={seenCounterIntros.current.has(item.counter.definition.id)} onIntroductionRead={() => { seenCounterIntros.current.add(item.counter.definition.id); }} />
    : <WordCard key={`${portion}:${turn}:${item.id}:${item.version}`} item={item} data={data} userId={user.id} onNext={next} onSaved={onSaved} saveSettings={saveSettings} settingsBusy={settingsBusy} active={active} onActivity={setActivity} sound={sound} cueScope={`${soundSessionId}:${portion}:${turn}`} />
    : queue ? <div className="sheet empty" data-testid="portion-complete"><h2>{completed ? training ? 'Порция пройдена' : 'Повторение завершено' : training ? 'Пока нет готовых заданий' : 'На сейчас всё повторено'}</h2><p>{completed ? training ? 'Подтверждённые карточки сохранены. Продолжите следующую порцию: неизученный остаток, а затем практика знакомого материала.' : 'Подтверждённые ответы сохранены. Новые слова и конструкции можно изучать в учебнике.' : source.kind === 'counters' ? `Сначала пройдите подходящие слова учебника: ${data.course.words.filter(word => word.reviewStatus !== 'draft' && objectFor(word)).slice(0, 5).map(word => `${word.kana} (урок ${data.course.lessons.find(lesson => word.lessonIds.includes(lesson.id))?.number ?? ''})`).join(', ')}. Затем здесь появится практика счёта.` : training ? 'Для личных слов проверьте чтение и перевод. Задания появятся после подтверждения записей.' : 'Здесь появляются только уже изученные слова и конструкции, когда подходит срок повторения.'}</p>{completed > 0 && <small>Пройденные шаги порции включают исследовательские и незавершённые варианты. Они не подключают исходное задание к повторению.</small>}<div className="row">{training && <button className="primary" disabled={loadingQueue} onClick={() => { void load(); }}>{loadingQueue ? 'Готовим порцию…' : 'Продолжить'}</button>}<button className={training ? undefined : 'primary'} onClick={onCourse}>К учебнику</button></div></div> : null;
  return <section data-testid="study-session" data-scene-id={scene} data-session-kind={source.kind} data-source-id={source.kind === 'lesson' ? source.lessonId : source.kind === 'list' ? source.listId : source.kind} data-portion={portion} data-active={active} className="study-session stack" onPointerDownCapture={clearPreviousFeedback} onKeyDownCapture={clearPreviousFeedback}>
    <header className="session-header"><div className="session-heading"><h1>{sourceTitle}</h1></div><button className="quiet" onClick={onExit}>Завершить</button>
    <div className="session-progress" aria-busy={loadingQueue}><div className="session-progress-info"><span className="session-goal">{training ? item?.isNew ? 'Первое знакомство' : 'Тренировка материала' : 'По расписанию'}</span><span className="session-count">{queue && total > 0 ? `${completed} / ${total} · ${percent}%` : queue ? 'Нет заданий' : 'Загрузка…'}</span></div><progress aria-label="Прогресс занятия" value={completed} max={Math.max(1, total)} aria-valuetext={`Пройдено ${completed} из ${total} заданий (${percent}%)`} /><div className="session-feedback" data-testid="session-feedback" data-feedback={feedback?.kind ?? 'neutral'} role="status" aria-live="polite" aria-atomic="true">{feedback && <span key={feedback.attemptId} className="answer-feedback-marker" data-feedback={feedback.kind}><span className="feedback-context">Последний ответ: </span><span aria-hidden="true">{feedback.kind === 'good' ? '✓ ' : '↻ '}</span>{feedback.kind === 'good' ? 'Вспомнил' : 'Повторим'}</span>}</div></div></header>
    <div className="session-stage"><div className="session-board work-board"><div className="session-scroll" key={`${portion}:${turn}`} tabIndex={0} role="region" aria-label="Материал практики">{error && <div className="notice error session-notice" role="alert"><p>{error}</p><button onClick={() => { void load(); }}>Повторить загрузку</button></div>}{!queue && !error ? <p role="status">Готовим занятие…</p> : item && item.mode !== 'grammar' ? <div className="card-deck" data-testid="card-deck" data-remaining={remainingCards}><div className="deck-summary"><span>Колода</span><strong role="status">Осталось {remainingCards} из {initialCards}</strong></div><div className="deck-stack">{Array.from({ length: Math.min(3, remainingCards - 1) }, (_, index) => <div className="deck-layer" aria-hidden="true" key={index} style={{ transform: `translateY(${(index + 1) * Math.min(remainingCards - 1, 20) / 3}px) rotate(${index % 2 ? 1 : -1}deg)` }} />)}{board}</div></div> : board}</div></div><div className="scene-companion" data-testid="scene-companion" data-activity={companion.activity} data-event-key={companion.key}><Cat playful pose={companion.pose} activity={companion.activity} reactionKey={companion.key} /></div></div>
  </section>;
}

function WordCard({ item, data, userId, onNext, onSaved, saveSettings, settingsBusy, active, onActivity, sound, cueScope }: { item: Extract<ReviewItem, { mode: 'ja-ru' | 'ru-ja' | 'listening' }>; data: Snapshot; userId: string; onNext: (feedback?: SavedFeedback, result?: ReviewResult) => void; onSaved: () => void; saveSettings: (value: LearnerSettings) => Promise<void>; settingsBusy: boolean; active: boolean; onActivity: (value: CardActivity) => void; sound: SceneSound; cueScope: string }) {
  const [revealed, setRevealed] = useState(false);
  const speech = useCardSpeech(item.word.audioUrl, item.mode === 'listening', active, data.settings.speechVolume, sound);
  const saving = useReviewSave(userId, onSaved, (submission, result) => { const kind = submission.rating === 3 ? 'good' : 'again'; sound.cue(kind, result.attemptId); onNext({ attemptId: result.attemptId, kind }, result); });
  const unavailable = item.mode === 'listening' && (!item.word.audioUrl || !speech.played || !!speech.error);
  const enabled = active && !saving.busy && !saving.pending;
  const phase: CardActivity['activity'] = !active || speech.error || saving.error ? 'neutral' : saving.busy || saving.pending ? 'checking' : speech.playing ? 'listening' : revealed ? 'revealed' : 'idle';
  useEffect(() => { onActivity({ reviewId: item.id, activity: phase, key: `${item.id}:${item.version}:${phase}` }); }, [phase, item.id, item.version, onActivity]);
  function tap() { if (!enabled) return; if (unavailable) { void speech.play(); return; } if (!revealed) { sound.cue('reveal', `${cueScope}:${item.id}:${item.version}`); document.querySelector<HTMLElement>('[data-testid="review-gesture"]')?.focus({ preventScroll: true }); } setRevealed(true); }
  function grade(rating: 1 | 3) { if (!enabled || !revealed || unavailable) return; return saving.save({ attemptId: crypto.randomUUID(), reviewId: item.id, version: item.version, mode: item.mode, rating }); }
  const label = item.mode === 'ja-ru' ? 'Вспомните перевод' : item.mode === 'ru-ja' ? 'Вспомните слово по-японски' : 'Вспомните смысл услышанного';
  return <GestureCard active={active} enabled={revealed && enabled && !unavailable} onAdvance={grade} mode={item.mode} reviewId={item.id} actions={<DisplayControl mode={data.settings.orthography} onChange={orthography => { void saveSettings({ ...data.settings, orthography }); }} disabled={settingsBusy || !enabled} />}>
    <FlipCard revealed={revealed} front={<button className="study-card word-card" data-card-face={!revealed || undefined} data-testid={!revealed ? 'card-face' : undefined} onClick={tap} disabled={!enabled}>
      <small>{label}</small>{item.mode === 'listening' ? <span className="prompt">{speech.playing ? 'Слушаем…' : speech.played ? 'Нажмите, чтобы раскрыть смысл' : 'Нажмите, чтобы прослушать'}</span> : <span className="prompt">{item.mode === 'ru-ja' ? item.word.meaningRu : <Japanese value={item.word} mode={data.settings.orthography} />}</span>}<small>Нажмите на карточку, чтобы раскрыть ответ</small>
    </button>} back={<button className="study-card word-card" data-card-face data-testid="card-face" onClick={tap} disabled={!enabled}><small>Ответ</small><span className="prompt"><Japanese value={item.word} mode={data.settings.orthography} /></span><span className="answer" aria-live="polite"><WordIllustration wordId={item.word.id} />{item.word.meaningRu}</span></button>} />
    {(revealed || item.mode === 'listening') && item.word.audioUrl && <div className="spread"><small>Синтезированная японская речь</small><button className="quiet" aria-label="Прослушать ещё раз" onClick={() => { void speech.play(); }} disabled={!active || speech.playing || saving.busy}>↻</button></div>}
    {revealed && <div className="row card-ratings"><button disabled={!enabled || unavailable} onClick={() => grade(1)}>Ещё раз ↶</button><button className="primary" disabled={!enabled || unavailable} onClick={() => grade(3)}>Помню ✓</button></div>}
    {speech.error && <p className="error" role="alert">{speech.error}</p>}
    {saving.busy && <p role="status">Сохраняем ответ…</p>}
    {saving.error && <div className="notice error" role="alert"><p>{saving.error}</p><button disabled={!active} onClick={saving.retry}>Повторить сохранение</button></div>}
  </GestureCard>;
}
