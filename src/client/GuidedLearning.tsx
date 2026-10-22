import { useCallback, useEffect, useRef, useState } from 'react';
import type { LearnerSettings, ReviewResult, ReviewSubmission } from '../shared/types';
import type { LearningAdvance, LearningAdvanceResult, LearningExample, LearningState } from '../shared/learning';
import type { Snapshot, User } from './types';
import { api } from './api';
import { currentLearningState, learningConflict, learningHeaders, pendingLearning, submitLearning, type PendingLearning } from './guidedApi';
import { GestureCard } from './GestureCard';
import { Japanese } from './Japanese';
import { SentenceWorkspace } from './SentenceWorkspace';
import { LessonVideo } from './LessonVideo';
import { Cat } from './Cat';
import { companionState, type CardActivity, type SavedFeedback } from './companion';
import type { SceneSound } from './sceneSound';
import type { SceneId } from './scenes';

const message = (error: unknown) => error instanceof Error ? error.message : 'Не удалось сохранить шаг. Повторите попытку.';

function useStepSpeech(active: boolean, volume: number, sound: SceneSound, onActivity: (value: CardActivity) => void, stepId: string) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const live = useRef(active); live.current = active;
  const requested = useRef('');
  const [playing, setPlaying] = useState(false); const [played, setPlayed] = useState(''); const [error, setError] = useState('');
  const stop = useCallback(() => { audio.current?.pause(); sound.setSpeechPlaying(false); }, [sound.setSpeechPlaying]);
  useEffect(() => {
    const current = audio.current;
    if (!current) return;
    current.onplaying = () => { if (!live.current || document.hidden) { current.pause(); return; } setPlaying(true); setPlayed(requested.current); sound.setSpeechPlaying(true); };
    current.onpause = () => { setPlaying(false); sound.setSpeechPlaying(false); }; current.onended = current.onpause;
    current.onerror = () => { setPlaying(false); sound.setSpeechPlaying(false); setError('Запись не загрузилась. Проверьте соединение и прослушайте ещё раз.'); };
    const hidden = () => { if (document.hidden) stop(); };
    document.addEventListener('visibilitychange', hidden);
    return () => { document.removeEventListener('visibilitychange', hidden); current.onplaying = null; current.onpause = null; current.onended = null; current.onerror = null; current.pause(); sound.setSpeechPlaying(false); };
  }, [stop, sound.setSpeechPlaying]);
  useEffect(() => { if (!active) stop(); if (audio.current) audio.current.volume = volume; }, [active, volume, stop]);
  useEffect(() => { onActivity({ reviewId: stepId, activity: playing ? 'listening' : 'revealed', key: `${stepId}:${playing ? 'playing' : 'idle'}` }); }, [playing, stepId, onActivity]);
  async function play(src: string | undefined) {
    if (!live.current || document.hidden) return;
    stop(); setError('');
    if (!src) { setError('Запись пока недоступна. Попробуйте позже — шаг сохранён.'); return; }
    const current = audio.current; if (!current) return;
    if (requested.current !== src) { requested.current = src; current.src = src; } else current.currentTime = 0;
    current.volume = volume;
    try { await current.play(); } catch { if (audio.current === current && live.current) { setPlaying(false); sound.setSpeechPlaying(false); setError('Нажмите «Прослушать», чтобы включить японскую запись.'); } }
  }
  return { audio, play, stop, playing, played, error };
}

function Intro({ value, reading, explanation, example, breakdown, active, busy, sound, onActivity, stepId, data, onContinue }: { value: LearningExample; reading?: string; explanation: string; example?: LearningExample; breakdown?: { text: string; explanationRu: string }[]; active: boolean; busy: boolean; sound: SceneSound; onActivity: (value: CardActivity) => void; stepId: string; data: Snapshot; onContinue: () => void }) {
  const speech = useStepSpeech(active, data.settings.speechVolume, sound, onActivity, stepId);
  const pronunciation = reading ?? value.kana; const displayed = data.settings.orthography === 'kana' ? value.kana : value.surface;
  return <article className="guided-intro work-board stack" data-testid="learning-intro">
    <audio ref={speech.audio} preload="none" hidden />
    <small>{breakdown ? 'Как устроена фраза' : 'Знакомимся со словом или фразой'}</small>
    <div className="guided-headword"><h2><Japanese value={value} mode={data.settings.orthography} /></h2>
      {pronunciation !== displayed && <p className="guided-reading" lang="ja">{pronunciation}</p>}<h3>{value.meaningRu}</h3></div>
    <p className="guided-explanation">{explanation}</p>
    <button className="quiet" disabled={!active || busy || speech.playing} onClick={() => { void speech.play(value.audioUrl); }}>▶ Прослушать{breakdown ? ' фразу целиком' : ''}</button>
    {breakdown && <dl className="guided-breakdown">{breakdown.map((piece, index) => <div key={index}><dt className="jp" lang="ja">{piece.text}</dt><dd>{piece.explanationRu}</dd></div>)}</dl>}
    {example && <div className="guided-example"><small>Короткий пример</small><p><Japanese value={example} mode={data.settings.orthography} /></p><p>{example.meaningRu}</p><button className="quiet" disabled={!active || busy || speech.playing} onClick={() => { void speech.play(example.audioUrl); }}>▶ Послушать пример</button></div>}
    {speech.error && <p className="notice" role="status">{speech.error}</p>}
    <button className="primary" disabled={!active || busy} onClick={() => { speech.stop(); onContinue(); }}>Дальше</button>
  </article>;
}

function Recall({ value, mode, active, busy, sound, onActivity, stepId, data, grade }: { value: LearningExample; mode: 'ja-ru' | 'listening' | 'ru-ja'; active: boolean; busy: boolean; sound: SceneSound; onActivity: (value: CardActivity) => void; stepId: string; data: Snapshot; grade: (rating: 1 | 3) => void }) {
  const [revealed, setRevealed] = useState(false);
  const speech = useStepSpeech(active, data.settings.speechVolume, sound, onActivity, stepId);
  const attemptedAudio = useRef(false);
  useEffect(() => { if (active && mode === 'listening' && !attemptedAudio.current) { attemptedAudio.current = true; void speech.play(value.audioUrl); } }, [active, mode, value.audioUrl]);
  const played = speech.played === value.audioUrl;
  const label = mode === 'listening' ? 'Вспомните смысл услышанного' : mode === 'ja-ru' ? 'Вспомните русский смысл' : 'Вспомните по-японски';
  function reveal() { if (!active || busy) return; if (mode === 'listening' && !played) { void speech.play(value.audioUrl); return; } if (!revealed) sound.cue('reveal', stepId); setRevealed(true); }
  return <GestureCard active={active} enabled={revealed && !busy && (mode !== 'listening' || played)} mode={mode} reviewId={stepId} onAdvance={rating => { speech.stop(); grade(rating); }}>
    <audio ref={speech.audio} preload="none" hidden />
    <button className="study-card word-card" data-card-face data-testid="card-face" disabled={!active || busy} onClick={reveal}>
      <small>{label}</small><span className="prompt">{mode === 'listening' ? speech.playing ? 'Слушаем…' : played ? 'Нажмите, чтобы раскрыть смысл' : 'Нажмите, чтобы прослушать' : mode === 'ru-ja' ? value.meaningRu : <Japanese value={value} mode={data.settings.orthography} />}</span>
      {revealed ? <span className="answer">{mode !== 'ja-ru' && <Japanese value={value} mode={data.settings.orthography} />}{mode !== 'ru-ja' && <span>{value.meaningRu}</span>}</span> : mode !== 'listening' && <small>Нажмите на карточку, чтобы раскрыть ответ</small>}
    </button>
    {mode === 'listening' && <button className="quiet" disabled={!active || busy || speech.playing} onClick={() => { void speech.play(value.audioUrl); }}>↻ Прослушать ещё раз</button>}
    {speech.error && <p className="notice" role="status">{speech.error}</p>}
  </GestureCard>;
}

export function GuidedLearning({ lessonId, user, data, active, sound, scene, onExit, onCourse, onSaved, saveSettings, settingsBusy }: { lessonId: string; user: User; data: Snapshot; active: boolean; sound: SceneSound; scene: SceneId; onExit: () => void; onCourse: () => void; onSaved: (state: LearningState, reviewed: boolean) => void; saveSettings: (value: LearnerSettings) => Promise<void>; settingsBusy: boolean }) {
  const route = data.course.learning?.find(route => route.lessonId === lessonId);
  const lesson = data.course.lessons.find(lesson => lesson.id === lessonId);
  const [state, setState] = useState<LearningState | null>(null); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [hasPending, setHasPending] = useState(false); const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [activity, setActivity] = useState<CardActivity | null>(null); const [feedback, setFeedback] = useState<SavedFeedback | null>(null);
  const pending = useRef<PendingLearning | null>(null); const lock = useRef(false); const request = useRef(0); const mounted = useRef(true); const stateRef = useRef(state); stateRef.current = state;
  const owner = useRef(user.id); owner.current = user.id; const callbacks = useRef({ active, onSaved, sound }); callbacks.current = { active, onSaved, sound };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; }; }, [user.id, lessonId]);
  const isOwner = () => mounted.current && owner.current === user.id;
  const updateActivity = useCallback((value: CardActivity) => setActivity({ ...value, reviewId: stateRef.current?.step?.id ?? value.reviewId }), []);
  function accept(next: LearningState) { if (isOwner() && route && currentLearningState(next, lessonId, route.version, stateRef.current)) { stateRef.current = next; setState(next); } }
  const load = useCallback(async () => {
    if (!route || lock.current) return;
    const current = ++request.current; setLoading(true); setError(''); setConflict(false);
    let persisted = false;
    try {
      const attempts = pendingLearning(user.id).filter(item => item.lessonId === lessonId); persisted = attempts.length > 0; setHasPending(persisted);
      for (const item of attempts) {
        if (!mounted.current || owner.current !== user.id || current !== request.current) return;
        await submitLearning(user.id, item);
      }
      if (!mounted.current || owner.current !== user.id || current !== request.current) return;
      pending.current = null; setHasPending(false);
      const next = await api<LearningState>(`/api/learning/${encodeURIComponent(lessonId)}`, { headers: learningHeaders(user.id) });
      if (current === request.current && mounted.current && owner.current === user.id) accept(next);
    } catch (failure) { if (current === request.current && mounted.current && owner.current === user.id) { if (learningConflict(failure)) { pending.current = null; setHasPending(false); setConflict(true); setError('Этот ответ не применён: шаг уже изменился на другом устройстве. Загрузите актуальный шаг.'); } else { setError(message(failure)); setHasPending(persisted || !!pending.current); } } }
    finally { if (current === request.current && mounted.current && owner.current === user.id) setLoading(false); }
  }, [lessonId, route?.version, user.id]);
  const overviewVersion = data.learning?.find(lesson => lesson.lessonId === lessonId)?.version;
  const wasActive = useRef(false);
  useEffect(() => { const entering = active && !wasActive.current; wasActive.current = active; if (!active) return; const current = stateRef.current; if (entering || !current || current.routeVersion !== route?.version || (overviewVersion ?? 0) > current.version) void load(); const retry = () => { void load(); }; window.addEventListener('online', retry); window.addEventListener('focus', retry); return () => { request.current++; window.removeEventListener('online', retry); window.removeEventListener('focus', retry); }; }, [load, active, overviewVersion]);

  async function advance(action: LearningAdvance['action'], details: Partial<LearningAdvance> = {}, attemptId: string = crypto.randomUUID()): Promise<LearningAdvanceResult> {
    const current = stateRef.current;
    if (!current?.step || !isOwner() || !callbacks.current.active || lock.current) throw new Error('Шаг сейчас недоступен.');
    const item = pending.current ?? { lessonId, submission: { ...details, attemptId, routeVersion: current.routeVersion, stateVersion: current.version, stepId: current.step.id, action } };
    pending.current = item; lock.current = true; setHasPending(true); setBusy(true); setError(''); setConflict(false);
    try {
      const result = await submitLearning(user.id, item);
      if (isOwner()) {
        pending.current = null; setHasPending(false); accept(result.state); callbacks.current.onSaved(result.state, !!result.reviewResult);
        if (result.reviewResult) {
          const kind = item.submission.action === 'again' || result.reviewResult.correct === false || item.submission.revealed ? 'again' : 'good';
          setFeedback({ attemptId: result.attemptId, kind }); callbacks.current.sound.cue(kind, result.attemptId);
        }
        if (result.state.completed) callbacks.current.sound.cue('complete', `learning:${user.id}:${lessonId}:${result.state.routeVersion}`);
      }
      return result;
    } catch (failure) { if (isOwner()) { if (learningConflict(failure)) { pending.current = null; setHasPending(false); setConflict(true); setError('Этот ответ не применён: шаг уже изменился на другом устройстве. Загрузите актуальный шаг.'); } else setError(`${message(failure)} Шаг не изменён без подтверждения; ответ сохранён на устройстве.`); } throw failure; }
    finally { lock.current = false; if (isOwner()) setBusy(false); }
  }
  function go(action: LearningAdvance['action']) { void advance(action).catch(() => {}); }
  async function sendReview(_ownerId: string, submission: ReviewSubmission): Promise<ReviewResult> {
    const details = submission.mode === 'grammar' ? { tokenIds: submission.tokenIds, tokenForms: submission.tokenForms, revealed: submission.revealed, exploring: submission.exploring } : {};
    const result = await advance(submission.rating === 1 ? 'again' : 'remember', details, submission.attemptId);
    if (!result.reviewResult) throw new Error('Сервер не подтвердил учебный ответ.');
    return result.reviewResult;
  }
  const step = state?.step; const goal = route?.goals.find(goal => goal.id === step?.goalId); const part = goal?.parts.find(part => part.id === step?.partId);
  const wordLesson = step && 'wordId' in step ? part?.words.find(word => word.wordId === step.wordId) : undefined;
  const word = step && 'wordId' in step ? data.course.words.find(word => word.id === step.wordId) : undefined;
  const construction = part?.construction;
  const blocked = !active || busy || hasPending || loading || !!error;
  const percent = state && state.totalSteps > 0 ? Math.min(100, Math.floor(state.completedSteps / state.totalSteps * 100)) : 0;
  const companion = companionState({ reviewId: step?.id, activity, feedback, completed: state?.completedSteps ?? 0, total: state?.totalSteps ?? 0 });
  const video = step?.kind === 'video' ? lesson?.videos?.find(video => video.id === step.videoId) : undefined;
  let board;
  if (!route) board = <div className="work-board notice"><p>Учебный маршрут пока недоступен. Дополнительный словарь остаётся в учебнике.</p><button onClick={onCourse}>К учебнику</button></div>;
  else if (state?.completed) board = <div className="work-board stack" data-testid="learning-complete"><h2>Урок пройден</h2><p>Все обязательные форматы основного материала выполнены. Личные повторения продолжаются по своему расписанию.</p><button className="primary" onClick={onCourse}>К учебнику</button></div>;
  else if (step?.kind === 'word-intro' && word && wordLesson) board = <Intro key={`${step.id}:${state?.version}`} value={{ ...word, audioUrl: word.audioUrl ?? '' }} reading={word.kana} explanation={wordLesson.explanationRu} example={wordLesson.example} data={data} active={active} busy={blocked} sound={sound} onActivity={setActivity} stepId={step.id} onContinue={() => go('continue')} />;
  else if (step?.kind === 'word-practice' && word) board = <Recall key={`${step.id}:${state?.version}`} value={{ ...word, audioUrl: word.audioUrl ?? '' }} mode={step.mode} data={data} active={active} busy={blocked} sound={sound} onActivity={setActivity} stepId={step.id} grade={rating => go(rating === 3 ? 'remember' : 'again')} />;
  else if (step?.kind === 'construction-intro' && construction) board = <Intro key={`${step.id}:${state?.version}`} value={construction.example} explanation={construction.explanationRu} breakdown={construction.breakdown} data={data} active={active} busy={blocked} sound={sound} onActivity={setActivity} stepId={step.id} onContinue={() => go('continue')} />;
  else if (step?.kind === 'construction-practice' && construction) board = step.mode === 'grammar' && state?.reviewItem?.mode === 'grammar' ? <SentenceWorkspace key={`${step.id}:${state.version}`} item={state.reviewItem} data={data} source={{ kind: 'guided', lessonId }} userId={user.id} onNext={() => {}} onSaved={() => {}} saveSettings={saveSettings} settingsBusy={settingsBusy} active={active && !loading && !conflict} sound={sound} onActivity={updateActivity} sendReview={sendReview} requiredPractice /> : step.mode !== 'grammar' ? <Recall key={`${step.id}:${state?.version}`} value={construction.example} mode={step.mode} data={data} active={active} busy={blocked} sound={sound} onActivity={setActivity} stepId={step.id} grade={rating => go(rating === 3 ? 'remember' : 'again')} /> : null;
  else if (step?.kind === 'video') board = <div className="work-board stack guided-video" key={step.id}>{video ? <LessonVideo key={video.id} material={video} active={active} onPlayingChange={sound.setSpeechPlaying} /> : <p>Видео сейчас недоступно. Можно продолжить урок.</p>}<p className="muted">Видео необязательно. Продолжайте сразу, если не хотите смотреть.</p><button className="primary" disabled={blocked} onClick={() => { document.querySelector<HTMLVideoElement>('.guided-video video')?.pause(); go('skip'); }}>Продолжить урок</button></div>;
  else if (step?.kind === 'part-complete') board = <div className="work-board stack" data-testid="learning-part-complete"><h2>Часть пройдена</h2><p>{state && state.partIndex === state.totalParts - 1 ? 'Последняя часть пройдена. Сохраните завершение учебного маршрута.' : 'Все её слова и конструкции прошли обязательные форматы. Следующую часть можно начать сразу.'}</p><button className="primary" disabled={blocked} onClick={() => go('continue')}>{state && state.partIndex === state.totalParts - 1 ? 'Завершить урок' : 'Продолжить'}</button></div>;
  return <section className="study-session guided-learning stack" data-testid="guided-learning" data-lesson-id={lessonId} data-step-id={step?.id} data-step-kind={step?.kind} data-state-version={state?.version} data-active={active} data-scene-id={scene} onPointerDownCapture={() => setFeedback(null)} onKeyDownCapture={() => setFeedback(null)}>
    <header className="session-header">
      <div className="session-heading"><small>Урок {lesson?.number}</small><h1>{route?.titleRu ?? lesson?.title}</h1></div><button className="quiet" aria-label="Выйти из урока" onClick={onExit}>Выйти</button>
      <div className="session-progress"><div className="session-progress-info"><span className="session-goal">{goal?.titleRu ?? 'Учебный маршрут'}</span>{state && <span className="session-count session-part-count"><span>Часть {Math.min(state.partIndex + 1, state.totalParts)}/{state.totalParts}</span><span>{percent}%</span></span>}</div><progress aria-label="Прогресс учебного маршрута" value={state?.completedSteps ?? 0} max={Math.max(1, state?.totalSteps ?? 1)} aria-valuetext={state ? `${state.completedSteps} из ${state.totalSteps} шагов` : 'Загружаем маршрут'} /><div className="session-feedback" role="status">{feedback && <span className="answer-feedback-marker" data-feedback={feedback.kind}>{feedback.kind === 'good' ? '✓ Вспомнил' : '↻ Этот формат вернётся'}</span>}</div></div>
    </header>
    <div className="session-stage"><div className="session-board work-board"><div className="session-scroll" key={`${step?.id}:${state?.version}`} tabIndex={0} role="region" aria-label="Материал урока">
      {error && <div className="notice error session-notice" role="alert"><p>{error}</p><button disabled={!active || busy} onClick={() => { if (pending.current) go(pending.current.submission.action); else void load(); }}>{conflict ? 'Загрузить актуальный шаг' : hasPending ? 'Повторить сохранение' : 'Повторить загрузку'}</button></div>}
      {busy && <p className="session-notice" role="status">Сохраняем шаг…</p>}
      {goal?.introductionRu && (step?.kind === 'word-intro' || step?.kind === 'construction-intro' || step?.kind === 'video') && <p className="guided-goal-context">{goal.introductionRu}</p>}
      {board ?? <p role="status">{error ? 'Шаг появится после подтверждения.' : 'Готовим учебный маршрут…'}</p>}
    </div></div><div className="scene-companion" data-testid="scene-companion" data-activity={companion.activity}><Cat pose={companion.pose} activity={companion.activity} reactionKey={companion.key} /></div></div>
  </section>;
}
