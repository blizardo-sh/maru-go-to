import { useCallback, useEffect, useRef, useState } from 'react';
import type { LearnerSettings, ReviewItem, ReviewQueue } from '../shared/types';
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

const messages = (error: unknown) => error instanceof Error ? error.message : 'Не удалось сохранить ответ. Повторите попытку.';
export function Session({ user, data, source, onExit, onCourse, onSaved, saveSettings, settingsBusy, active = true, scene = 'room', sound }: { user: User; data: Snapshot; source: StudySource; onExit: () => void; onCourse: () => void; onSaved: () => void; saveSettings: (value: LearnerSettings) => Promise<void>; settingsBusy: boolean; active?: boolean; scene?: SceneId; sound: SceneSound }) {
  const [queue, setQueue] = useState<ReviewQueue | null>(null); const [error, setError] = useState('');
  const [completed, setCompleted] = useState(0); const [feedback, setFeedback] = useState<SavedFeedback | null>(null);
  const [soundSessionId] = useState(() => crypto.randomUUID());
  const [portion, setPortion] = useState(0); const [loadingQueue, setLoadingQueue] = useState(true); const request = useRef(0);
  const contextKey = sourceKey(source); const training = source.kind !== 'review';
  const sourceTitle = source.kind === 'lesson' ? `Дополнительный словарь · урок ${data.course.lessons.find(lesson => lesson.id === source.lessonId)?.number ?? ''}` : source.kind === 'list' ? data.lists.find(list => list.id === source.listId)?.name ?? 'Личный список' : 'Повторение';
  const [activity, setActivity] = useState<CardActivity | null>(null); const [companionFeedback, setCompanionFeedback] = useState<SavedFeedback | null>(null);
  const load = useCallback(async () => {
    const current = ++request.current; setError(''); setLoadingQueue(true);
    const query = new URLSearchParams(Object.entries(trainingContext(source)));
    try {
      const nextQueue = await api<ReviewQueue>(source.kind === 'review' ? '/api/reviews?mode=mixed' : `/api/training?${query}`);
      if (request.current !== current) return;
      setQueue(source.kind === 'lesson' ? { ...nextQueue, items: nextQueue.items.filter(item => item.mode !== 'grammar') } : nextQueue); setCompleted(0); setFeedback(null); setActivity(null); setCompanionFeedback(null); setPortion(value => value + 1);
    } catch (failure) { if (request.current === current) setError(messages(failure)); }
    finally { if (request.current === current) setLoadingQueue(false); }
  }, [contextKey]);
  useEffect(() => { void load(); return () => { request.current++; }; }, [load]);
  const total = queue?.items.length ?? 0; const item = queue?.items[completed];
  useEffect(() => { if (total > 0 && completed >= total) sound.cue('complete', `${soundSessionId}:${portion}`); }, [total, completed, soundSessionId, portion, sound.cue]);
  const percent = total > 0 ? Math.round(completed / total * 100) : 0;
  const companion = companionState({ reviewId: item?.id, activity, feedback: companionFeedback, completed, total });
  function next(acknowledged?: SavedFeedback, reaction = acknowledged) { setCompleted(value => Math.min(value + 1, total)); setFeedback(acknowledged ?? null); setCompanionFeedback(reaction ?? null); }
  function clearPreviousFeedback() { if (active) { setFeedback(null); setCompanionFeedback(null); } }
  const board = item ? item.mode === 'grammar'
    ? <SentenceWorkspace source={source} key={`${portion}:${item.id}:${item.version}`} item={item} data={data} userId={user.id} onNext={reaction => next(undefined, reaction)} onSaved={onSaved} saveSettings={saveSettings} settingsBusy={settingsBusy} active={active} onActivity={setActivity} sound={sound} />
    : <WordCard key={`${portion}:${item.id}:${item.version}`} item={item} data={data} userId={user.id} onNext={next} onSaved={onSaved} saveSettings={saveSettings} settingsBusy={settingsBusy} active={active} onActivity={setActivity} sound={sound} cueScope={`${soundSessionId}:${portion}`} />
    : queue ? <div className="sheet empty" data-testid="portion-complete"><h2>{completed ? training ? 'Порция пройдена' : 'Повторение завершено' : training ? 'Пока нет готовых заданий' : 'На сейчас всё повторено'}</h2><p>{completed ? training ? 'Подтверждённые карточки сохранены. Продолжите следующую порцию: неизученный остаток, а затем практика знакомого материала.' : 'Подтверждённые ответы сохранены. Новые слова и конструкции можно изучать в учебнике.' : training ? 'Для личных слов проверьте чтение и перевод. Задания появятся после подтверждения записей.' : 'Здесь появляются только уже изученные слова и конструкции, когда подходит срок повторения.'}</p>{completed > 0 && <small>Пройденные шаги порции включают исследовательские и незавершённые варианты. Они не подключают исходное задание к повторению.</small>}<div className="row">{training && <button className="primary" disabled={loadingQueue} onClick={() => { void load(); }}>{loadingQueue ? 'Готовим порцию…' : 'Продолжить'}</button>}<button className={training ? undefined : 'primary'} onClick={onCourse}>К учебнику</button></div></div> : null;
  return <section data-testid="study-session" data-scene-id={scene} data-session-kind={source.kind} data-source-id={source.kind === 'lesson' ? source.lessonId : source.kind === 'list' ? source.listId : 'review'} data-portion={portion} data-active={active} className="study-session stack" onPointerDownCapture={clearPreviousFeedback} onKeyDownCapture={clearPreviousFeedback}>
    <header className="session-header"><div className="session-heading"><h1>{sourceTitle}</h1></div><button className="quiet" onClick={onExit}>Завершить</button>
    <div className="session-progress" aria-busy={loadingQueue}><div className="session-progress-info"><span className="session-goal">{training ? item?.isNew ? 'Первое знакомство' : 'Тренировка материала' : 'По расписанию'}</span><span className="session-count">{queue && total > 0 ? `${completed} / ${total} · ${percent}%` : queue ? 'Нет заданий' : 'Загрузка…'}</span></div><progress aria-label="Прогресс занятия" value={completed} max={Math.max(1, total)} aria-valuetext={`Пройдено ${completed} из ${total} заданий (${percent}%)`} /><div className="session-feedback" data-testid="session-feedback" data-feedback={feedback?.kind ?? 'neutral'} role="status" aria-live="polite" aria-atomic="true">{feedback && <span key={feedback.attemptId} className="answer-feedback-marker" data-feedback={feedback.kind}><span className="feedback-context">Последний ответ: </span><span aria-hidden="true">{feedback.kind === 'good' ? '✓ ' : '↻ '}</span>{feedback.kind === 'good' ? 'Вспомнил' : 'Повторим'}</span>}</div></div></header>
    <div className="session-stage"><div className="session-board work-board"><div className="session-scroll" key={`${portion}:${completed}`} tabIndex={0} role="region" aria-label="Материал практики">{error && <div className="notice error session-notice" role="alert"><p>{error}</p><button onClick={() => { void load(); }}>Повторить загрузку</button></div>}{!queue && !error ? <p role="status">Готовим занятие…</p> : board}</div></div><div className="scene-companion" data-testid="scene-companion" data-activity={companion.activity} data-event-key={companion.key}><Cat playful pose={companion.pose} activity={companion.activity} reactionKey={companion.key} /></div></div>
  </section>;
}

function WordCard({ item, data, userId, onNext, onSaved, saveSettings, settingsBusy, active, onActivity, sound, cueScope }: { item: Exclude<ReviewItem, { mode: 'grammar' }>; data: Snapshot; userId: string; onNext: (feedback?: SavedFeedback) => void; onSaved: () => void; saveSettings: (value: LearnerSettings) => Promise<void>; settingsBusy: boolean; active: boolean; onActivity: (value: CardActivity) => void; sound: SceneSound; cueScope: string }) {
  const [revealed, setRevealed] = useState(false); const [played, setPlayed] = useState(false); const [playing, setPlaying] = useState(false); const [audioError, setAudioError] = useState('');
  const audio = useRef<HTMLAudioElement | null>(null); const activeRef = useRef(active); activeRef.current = active;
  const saving = useReviewSave(userId, onSaved, (submission, result) => { const kind = submission.rating === 3 ? 'good' : 'again'; sound.cue(kind, result.attemptId); onNext({ attemptId: result.attemptId, kind }); });
  const play = useCallback(async () => {
    const current = audio.current; if (!current || !activeRef.current) return;
    setAudioError('');
    try { current.currentTime = 0; await current.play(); }
    catch (failure) { setPlaying(false); sound.setSpeechPlaying(false); if (activeRef.current && !(failure instanceof DOMException && ['NotAllowedError', 'AbortError'].includes(failure.name))) setAudioError('Запись не загрузилась. Проверьте соединение и нажмите на карточку ещё раз.'); }
  }, []);
  useEffect(() => {
    if (item.mode !== 'listening') return;
    if (!item.word.audioUrl) { setAudioError('Для этой карточки нет аудиозаписи. Расписание не изменится.'); return; }
    const current = new Audio(item.word.audioUrl); audio.current = current;
    current.onplaying = () => { if (activeRef.current) { setPlaying(true); setPlayed(true); sound.setSpeechPlaying(true); } else current.pause(); };
    current.onpause = () => { setPlaying(false); sound.setSpeechPlaying(false); }; current.onended = current.onpause;
    current.onerror = () => { setPlaying(false); sound.setSpeechPlaying(false); setAudioError('Запись не загрузилась. Проверьте соединение и нажмите на карточку ещё раз.'); };
    const pauseHidden = () => { if (document.hidden) current.pause(); }; document.addEventListener('visibilitychange', pauseHidden);
    return () => { document.removeEventListener('visibilitychange', pauseHidden); sound.setSpeechPlaying(false); current.onplaying = null; current.onpause = null; current.onended = null; current.onerror = null; current.pause(); audio.current = null; };
  }, [item, sound.setSpeechPlaying]);
  useEffect(() => { if (!active) { audio.current?.pause(); setPlaying(false); } else if (item.mode === 'listening' && !played) void play(); }, [active, item.mode, played, play]);
  useEffect(() => { if (audio.current) audio.current.volume = data.settings.speechVolume; }, [data.settings.speechVolume, item]);
  const phase: CardActivity['activity'] = !active || audioError || saving.error ? 'neutral' : saving.busy || saving.pending ? 'checking' : playing ? 'listening' : revealed ? 'revealed' : 'idle';
  useEffect(() => { onActivity({ reviewId: item.id, activity: phase, key: `${item.id}:${item.version}:${phase}` }); }, [phase, item.id, item.version, onActivity]);
  function tap() { if (!active || saving.busy || saving.pending) return; if (item.mode === 'listening' && !played) { void play(); return; } if (!revealed) sound.cue('reveal', `${cueScope}:${item.id}:${item.version}`); setRevealed(true); }
  function grade(rating: 1 | 3) { if (!active || !revealed) return; return saving.save({ attemptId: crypto.randomUUID(), reviewId: item.id, version: item.version, mode: item.mode, rating }); }
  const label = item.mode === 'ja-ru' ? 'Вспомните перевод' : item.mode === 'ru-ja' ? 'Вспомните слово по-японски' : 'Вспомните смысл услышанного';
  return <GestureCard active={active} enabled={revealed && !saving.busy && !saving.pending} onAdvance={grade} mode={item.mode} reviewId={item.id} actions={<DisplayControl mode={data.settings.orthography} onChange={orthography => { void saveSettings({ ...data.settings, orthography }); }} disabled={settingsBusy || saving.busy || saving.pending || !active} />}>
    <button className="study-card word-card" data-card-face data-testid="card-face" onClick={tap} disabled={!active || saving.busy || saving.pending}>
      <small>{label}</small>
      {item.mode === 'listening' ? <span className="prompt">{playing ? 'Слушаем…' : revealed ? 'Сравните ответ' : played ? 'Что прозвучало?' : 'Прослушайте слово'}</span> : <span className="prompt">{item.mode === 'ru-ja' ? item.word.meaningRu : <Japanese value={item.word} mode={data.settings.orthography} />}</span>}
      {revealed ? <span className="answer" aria-live="polite"><WordIllustration wordId={item.word.id} />{item.mode !== 'ja-ru' && <Japanese value={item.word} mode={data.settings.orthography} />}{item.mode !== 'ru-ja' && <span>{item.word.meaningRu}</span>}</span> : item.mode !== 'listening' && <small>Нажмите на карточку, чтобы раскрыть ответ</small>}
    </button>
    {item.mode === 'listening' && <div className="spread"><small>Японская озвучка</small>{played && <button className="quiet" aria-label="Прослушать ещё раз" onClick={() => { void play(); }} disabled={!active || playing || saving.busy}>↻</button>}</div>}
    {audioError && <p className="error" role="alert">{audioError}</p>}
    {saving.busy && <p role="status">Сохраняем ответ…</p>}
    {saving.error && <div className="notice error" role="alert"><p>{saving.error}</p><button disabled={!active} onClick={saving.retry}>Повторить сохранение</button></div>}
  </GestureCard>;
}
