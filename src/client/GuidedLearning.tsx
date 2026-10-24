import { catalogFor } from '../shared/catalog';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { LearnerSettings, ReviewResult, ReviewSubmission } from '../shared/types';
import type { LearningAdvance, LearningAdvanceResult, LearningExample, LearningState, LearningPart } from '../shared/learning';
import type { Snapshot, User } from './types';
import { api, json, publicationHeaders } from './api';
import { currentLearningState, invalidLearningChoice, learningConflict, learningHeaders, pendingLearning, submitLearning, type PendingLearning } from './guidedApi';
import { ExampleLine } from './ExampleLine';
import { WordIllustration } from './WordIllustration';
import { GestureCard } from './GestureCard';
import { FlipCard } from './FlipCard';
import { JapaneseText } from './JapaneseText';
import { Japanese, verifiedKanji } from './Japanese';
import { CounterCard } from './CounterCard';
import { SentenceWorkspace } from './SentenceWorkspace';
import { LessonVideo } from './LessonVideo';
import { Cat } from './Cat';
import { companionState, type CardActivity, type SavedFeedback } from './companion';
import type { SceneSound } from './sceneSound';
import type { SceneId } from './scenes';

const message = (error: unknown) => error instanceof Error ? error.message : 'Не удалось сохранить шаг. Повторите попытку.';

export function useStepSpeech(active: boolean, volume: number, sound: SceneSound, onActivity: (value: CardActivity) => void, stepId: string) {
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
  useEffect(() => { onActivity({ reviewId: stepId, activity: playing ? 'listening' : 'idle', key: `${stepId}:${playing ? 'playing' : 'idle'}` }); }, [playing, stepId, onActivity]);
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

function Intro({ value, explanation, example, breakdown, active, busy, sound, onActivity, stepId, data, onContinue }: { value: LearningExample; explanation: string; example?: LearningExample; breakdown?: { text: string; explanationRu: string }[]; active: boolean; busy: boolean; sound: SceneSound; onActivity: (value: CardActivity) => void; stepId: string; data: Snapshot; onContinue: () => void }) {
  const speech = useStepSpeech(active, data.settings.speechVolume, sound, onActivity, stepId);
  return <article className="guided-intro work-board stack" data-testid="learning-intro">
    <audio ref={speech.audio} preload="none" hidden />
    <div className="illustrated-card"><div className="card-art"><div className="inline-pronunciation guided-headword"><h2><Japanese value={value} forms={data.course.forms} mode={data.settings.orthography} /></h2><button className="quiet audio-icon" aria-label="Прослушать фразу" disabled={!active || busy || speech.playing} onClick={() => { void speech.play(value.audioUrl); }}>▶</button></div></div><div className="card-information"><small>{breakdown ? 'Как устроена фраза' : 'Знакомимся со словом или фразой'}</small><h2>{value.meaningRu}</h2><p className="guided-explanation"><JapaneseText text={explanation} course={data.course} mode={data.settings.orthography} /></p>
    {breakdown && <details className="guided-rule"><summary>Полное правило и разбор</summary><dl className="guided-breakdown">{breakdown.map((piece, index) => <div key={index}><dt><JapaneseText text={piece.text} course={data.course} mode={data.settings.orthography} /></dt><dd><JapaneseText text={piece.explanationRu} course={data.course} mode={data.settings.orthography} /></dd></div>)}</dl></details>}
    {example && <ExampleLine example={example} mode={data.settings.orthography} play={() => { void speech.play(example.audioUrl); }} disabled={!active || busy || speech.playing} />}
    <button className="primary" disabled={!active || busy} onClick={() => { speech.stop(); onContinue(); }}>Дальше</button></div></div>
    {speech.error && <p className="notice" role="status">{speech.error}</p>}
  </article>;
}

function GroupIntro({ part, data, active, busy, sound, onActivity, stepId, onStart }: { part: LearningPart; data: Snapshot; active: boolean; busy: boolean; sound: SceneSound; onActivity: (value: CardActivity) => void; stepId: string; onStart: () => void }) {
  const speech = useStepSpeech(active, data.settings.speechVolume, sound, onActivity, stepId);
  return <article className="word-group" data-testid="learning-word-group"><audio ref={speech.audio} preload="none" hidden /><header className="album-section-heading"><h2>Слова этой части</h2><p className="muted">Послушайте слова. Нажмите на японский пример, чтобы увидеть перевод.</p></header><div className="word-group-grid">{part.words.map(introduction => {
    const word = data.course.words.find(word => word.id === introduction.wordId);
    if (!word) return null;
    const kanji = verifiedKanji(word, data.course.forms);
    return <article className="word-introduction" key={word.id} data-word-id={word.id}><WordIllustration catalog={catalogFor(data.course)} wordId={word.id} /><div className="word-introduction-heading"><h3 className="jp" lang="ja">{word.kana}</h3><button className="quiet word-pronunciation" aria-label={`Прослушать ${word.surface}`} disabled={!active || busy || speech.playing} onClick={() => { void speech.play(word.audioUrl); }}>▶</button></div><p className="word-meaning">{word.meaningRu}</p>{kanji && kanji !== word.kana && data.settings.orthography !== 'kana' && <p className="word-kanji"><Japanese value={word} forms={data.course.forms} mode={data.settings.orthography} /></p>}<p className="word-note">{introduction.explanationRu}</p><ExampleLine example={introduction.example} mode={data.settings.orthography} disabled={!active || busy || speech.playing} play={() => { void speech.play(introduction.example.audioUrl); }} /></article>;
  })}</div>{speech.error && <p className="notice" role="status">{speech.error}</p>}<footer className="album-footer"><button className="primary" data-testid="start-learning-practice" disabled={!active || busy} onClick={() => { speech.stop(); onStart(); }}>Начать практику <span aria-hidden="true">→</span></button></footer></article>;
}

type NextStep = { state: LearningState; snapshot: Snapshot };
type QuizSnapshot = { state: LearningState; choice: string; attemptId: string; confirmed?: boolean; correct: boolean; next?: NextStep };
export function WordQuiz({ value, mode, choices, wordId, data, active, busy, sound, onActivity, stepId, selection, choose, application, visual }: { application?: import('../shared/training').TrainingEntry['application']; visual?: import('react').ReactNode; value: LearningExample; mode: 'ja-ru' | 'listening' | 'ru-ja'; choices: string[]; wordId: string; data: Snapshot; active: boolean; busy: boolean; sound: SceneSound; onActivity: (value: CardActivity) => void; stepId: string; selection: { choice: string; confirmed?: boolean; correct: boolean } | null; choose: (id: string) => void }) {
  const speech = useStepSpeech(active && !selection?.confirmed, data.settings.speechVolume, sound, onActivity, stepId);
  const attemptedAudio = useRef(false);
  useEffect(() => { if (active && mode === 'listening' && !attemptedAudio.current) { attemptedAudio.current = true; void speech.play(value.audioUrl); } }, [active, mode, value.audioUrl]);
  const confirmed = selection?.confirmed;
  const label = application ? 'Выберите ответ по ситуации' : mode === 'ja-ru' ? 'Выберите русский перевод' : mode === 'ru-ja' ? 'Выберите японское слово' : 'Что прозвучало?';
  return <article className="word-quiz" data-testid="learning-word-quiz" data-target-id={wordId} data-application={!!application} data-mode={mode} data-feedback={confirmed ? selection.correct ? 'good' : 'again' : 'neutral'}>
    <audio ref={speech.audio} preload="none" hidden /><div className="quiz-prompt"><small>{label}</small>{application && visual}{mode === 'listening' ? <button className="quiz-listen" aria-label="Прослушать слово" disabled={!active || !!selection || speech.playing} onClick={() => { void speech.play(value.audioUrl); }}><span aria-hidden="true">♪</span>{speech.playing ? 'Слушаем…' : 'Прослушать'}</button> : <h2 className="quiz-word">{mode === 'ru-ja' ? application?.promptRu ?? value.meaningRu : <Japanese value={value} forms={data.course.forms} mode={data.settings.orthography} />}</h2>}<p className="muted">{selection && !confirmed ? 'Сохраняем выбранный ответ…' : 'Один правильный ответ'}</p></div>
    <div className="quiz-choices" role="group" aria-label="Варианты ответа">{choices.map((id, index) => { const candidate = data.course.words.find(word => word.id === id); if (!candidate) return null; const result = confirmed && id === wordId ? 'correct' : confirmed && id === selection?.choice ? 'incorrect' : undefined; return <button key={id} data-choice-word-id={id} data-result={result} aria-pressed={selection?.choice === id} disabled={!active || busy || !!selection || mode === 'listening' && (speech.played !== value.audioUrl || !!speech.error)} onClick={() => { speech.stop(); choose(id); }}><span className="choice-number" aria-hidden="true">{index + 1}</span><span>{mode === 'ru-ja' ? <Japanese value={application?.labels?.[id] ?? candidate} forms={data.course.forms} mode={data.settings.orthography} /> : candidate.meaningRu}</span>{result && <span aria-hidden="true">{result === 'correct' ? '✓' : '↻'}</span>}</button>; })}</div>
    <div className="quiz-feedback" role="status" aria-live="polite">{confirmed ? <>{!application && visual}<WordIllustration catalog={catalogFor(data.course)} wordId={wordId} /><div><strong>{selection.correct ? 'Верно!' : 'Запомним и попробуем ещё'}</strong><p><Japanese value={value} forms={data.course.forms} mode={data.settings.orthography} /> — {value.meaningRu}</p></div></> : <p className="muted">{selection ? 'Сохраняем выбранный ответ…' : application ? 'Сопоставьте условие и японский ответ.' : 'Вспомните значение и выберите вариант.'}</p>}</div>{speech.error && <p className="notice" role="status">{speech.error}</p>}
  </article>;
}

export function Recall({ value, mode, active, busy, sound, onActivity, stepId, data, grade }: { value: LearningExample; mode: 'ja-ru' | 'listening' | 'ru-ja'; active: boolean; busy: boolean; sound: SceneSound; onActivity: (value: CardActivity) => void; stepId: string; data: Snapshot; grade: (rating: 1 | 3) => Promise<unknown> }) {
  const [revealed, setRevealed] = useState(false);
  const speech = useStepSpeech(active, data.settings.speechVolume, sound, onActivity, stepId);
  const attemptedAudio = useRef(false);
  useEffect(() => { if (active && mode === 'listening' && !attemptedAudio.current) { attemptedAudio.current = true; void speech.play(value.audioUrl); } }, [active, mode, value.audioUrl]);
  const played = speech.played === value.audioUrl;
  useEffect(() => { onActivity({ reviewId: stepId, activity: speech.playing ? 'listening' : revealed ? 'revealed' : 'idle', key: `${stepId}:${speech.playing ? 'listening' : revealed ? 'revealed' : 'idle'}` }); }, [speech.playing, revealed, stepId, onActivity]);
  const label = mode === 'listening' ? 'Вспомните смысл услышанного' : mode === 'ja-ru' ? 'Вспомните русский смысл' : 'Вспомните по-японски';
  function reveal() { if (!active || document.hidden || busy) return; if (mode === 'listening' && (!played || speech.error)) { void speech.play(value.audioUrl); return; } if (!revealed) sound.cue('reveal', stepId); setRevealed(true); }
  return <GestureCard active={active} phase={revealed ? 'answer' : 'question'} enabled={revealed && !busy && !speech.error && (mode !== 'listening' || played)} mode={mode} reviewId={stepId} onAdvance={rating => { speech.stop(); return grade(rating); }}>
    <audio ref={speech.audio} preload="none" hidden />
    <FlipCard revealed={revealed} front={<button className="study-card word-card" data-card-face data-testid={!revealed ? "card-face" : undefined} disabled={!active || busy} onClick={reveal}>
      <small>{label}</small><span className="prompt">{mode === 'listening' ? speech.playing ? 'Слушаем…' : played ? 'Что прозвучало?' : 'Прослушайте фразу' : mode === 'ru-ja' ? value.meaningRu : <Japanese value={value} forms={data.course.forms} mode={data.settings.orthography} />}</span>
    </button>} back={<div className="study-card word-card" data-testid={revealed ? "card-face" : undefined}><small>Сверьте свой ответ</small><span className="prompt"><Japanese value={value} forms={data.course.forms} mode={data.settings.orthography} /></span><span className="answer">{value.meaningRu}</span></div>} />
    {mode === 'listening' && <button className="quiet inline-audio" disabled={!active || busy || speech.playing} onClick={() => { void speech.play(value.audioUrl); }}>↻ Прослушать ещё раз</button>}
    {speech.error && <p className="notice" role="status">{speech.error}</p>}
  </GestureCard>;
}

export function GuidedLearning({ lessonId, user, data: incomingData, active, sound, scene, onExit, onCourse, onSaved, saveSettings, settingsBusy }: { lessonId: string; user: User; data: Snapshot; active: boolean; sound: SceneSound; scene: SceneId; onExit: () => void; onCourse: () => void; onSaved: (state: LearningState, reviewed: boolean) => void; saveSettings: (value: LearnerSettings) => Promise<void>; settingsBusy: boolean }) {
  const [material, setMaterial] = useState(incomingData); const materialRef = useRef(material); materialRef.current = material;
  const data = { ...incomingData, course: material.course };
  const route = data.course.learning?.find(route => route.lessonId === lessonId);
  const lesson = data.course.lessons.find(lesson => lesson.id === lessonId);
  const [state, setState] = useState<LearningState | null>(null); const [loading, setLoading] = useState(true); const [busy, setBusy] = useState(false); const [hasPending, setHasPending] = useState(false); const [error, setError] = useState('');
  const [conflict, setConflict] = useState(false);
  const [quiz, setQuiz] = useState<QuizSnapshot | null>(null); const quizRef = useRef(quiz); quizRef.current = quiz; const transition = useRef<number | undefined>(undefined);
  const reacted = useRef(new Set<string>()); const counterNext = useRef<NextStep | null>(null);
  const [activity, setActivity] = useState<CardActivity | null>(null); const [feedback, setFeedback] = useState<SavedFeedback | null>(null);
  const pending = useRef<PendingLearning | null>(null); const lock = useRef(false); const request = useRef(0); const mounted = useRef(true); const stateRef = useRef(state); stateRef.current = state;
  const owner = useRef(user.id); owner.current = user.id; const callbacks = useRef({ active, onSaved, sound }); callbacks.current = { active, onSaved, sound };
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; request.current++; }; }, [user.id, lessonId]);
  useEffect(() => {
    function resume() {
      window.clearTimeout(transition.current);
      const current = quizRef.current;
      if (!active || document.hidden || !current?.confirmed) return;
      if (!reacted.current.has(current.attemptId)) { reacted.current.add(current.attemptId); const kind = current.correct ? 'good' : 'again'; setFeedback({ attemptId: current.attemptId, kind }); callbacks.current.sound.cue(kind, current.attemptId); }
      transition.current = window.setTimeout(() => { if (mounted.current && owner.current === user.id && callbacks.current.active && !document.hidden && quizRef.current?.attemptId === current.attemptId) { quizRef.current = null; setQuiz(null); if (current.next) finish(current.next); } }, current.correct ? 800 : 1600);
    }
    resume(); document.addEventListener('visibilitychange', resume);
    return () => { window.clearTimeout(transition.current); document.removeEventListener('visibilitychange', resume); };
  }, [active, user.id, lessonId, quiz?.confirmed, quiz?.attemptId]);
  const isOwner = () => mounted.current && owner.current === user.id;
  const updateActivity = useCallback((value: CardActivity) => setActivity({ ...value, reviewId: stateRef.current?.step?.id ?? value.reviewId }), []);
  function accept(next: LearningState, snapshot = materialRef.current) {
    const targetRoute = snapshot.course.learning?.find(route => route.lessonId === lessonId);
    const previous = stateRef.current?.publicationId === next.publicationId ? stateRef.current : null;
    if (isOwner() && snapshot.course.publicationId === next.publicationId && targetRoute && currentLearningState(next, lessonId, targetRoute.version, previous)) { materialRef.current = snapshot; setMaterial(snapshot); stateRef.current = next; setState(next); }
  }
  function finish(next: NextStep) {
    accept(next.state, next.snapshot);
    if (next.state.completed) callbacks.current.sound.cue('complete', `learning:${user.id}:${lessonId}:${next.state.routeVersion}`);
  }
  const load = useCallback(async (force = false) => {
    if (lock.current || quizRef.current || counterNext.current || !force && stateRef.current?.publicationId && stateRef.current.step && !pending.current) return;
    const current = ++request.current; setLoading(true); setError(''); setConflict(false);
    let persisted = false;
    try {
      const attempts = pendingLearning(user.id).filter(item => item.lessonId === lessonId); persisted = attempts.length > 0; setHasPending(persisted);
      for (const item of attempts) {
        if (!mounted.current || owner.current !== user.id || current !== request.current) return;
        try { await submitLearning(user.id, item); } catch (failure) { if (!invalidLearningChoice(failure)) throw failure; }
      }
      if (!mounted.current || owner.current !== user.id || current !== request.current) return;
      pending.current = null; setHasPending(false);
      const next = await api<LearningState>(`/api/learning/${encodeURIComponent(lessonId)}`, { headers: learningHeaders(user.id) });
      const snapshot = next.publicationId ? await api<Snapshot>('/api/bootstrap', { headers: learningHeaders(user.id, next.publicationId) }) : materialRef.current;
      if (current === request.current && mounted.current && owner.current === user.id) { accept(next, snapshot); setQuiz(null); }
    } catch (failure) { if (current === request.current && mounted.current && owner.current === user.id) { if (learningConflict(failure)) { setQuiz(null); pending.current = null; setHasPending(false); setConflict(true); setError('Этот ответ не применён: шаг уже изменился на другом устройстве. Загрузите актуальный шаг.'); } else { setError(message(failure)); setHasPending(persisted || !!pending.current); } } }
    finally { if (current === request.current && mounted.current && owner.current === user.id) setLoading(false); }
  }, [lessonId, user.id]);
  const overviewVersion = data.learning?.find(lesson => lesson.lessonId === lessonId)?.version;
  const wasActive = useRef(false);
  useEffect(() => { const entering = active && !wasActive.current; wasActive.current = active; if (!active) return; const current = stateRef.current; if (entering || !current || current.routeVersion !== route?.version || (overviewVersion ?? 0) > current.version) void load(); const retry = () => { void load(); }; window.addEventListener('online', retry); window.addEventListener('focus', retry); return () => { request.current++; window.removeEventListener('online', retry); window.removeEventListener('focus', retry); }; }, [load, active, overviewVersion]);

  async function advance(action: LearningAdvance['action'], details: Partial<LearningAdvance> = {}, attemptId: string = crypto.randomUUID()): Promise<LearningAdvanceResult> {
    const current = stateRef.current;
    if (!current?.step || !isOwner() || !callbacks.current.active || document.hidden || lock.current) throw new Error('Шаг сейчас недоступен.');
    const item = pending.current ?? { lessonId, submission: { ...details, ...(current.publicationId ? { publicationId: current.publicationId } : {}), attemptId, routeVersion: current.routeVersion, stateVersion: current.version, stepId: current.step.id, action } };
    pending.current = item; lock.current = true; setHasPending(true); setBusy(true); setError(''); setConflict(false);
    let refreshChoices = false;
    try {
      const result = await submitLearning(user.id, item);
      const snapshot = result.state.publicationId && result.state.publicationId !== materialRef.current.course.publicationId ? await api<Snapshot>('/api/bootstrap', { headers: learningHeaders(user.id, result.state.publicationId) }) : materialRef.current;
      const nextRoute = snapshot.course.learning?.find(route => route.lessonId === lessonId);
      if (!nextRoute || snapshot.course.publicationId !== result.state.publicationId || !currentLearningState(result.state, lessonId, nextRoute.version, result.state.publicationId === current.publicationId ? current : null)) throw new Error('Не удалось загрузить материал подтверждённого шага. Повторите сохранение.');
      if (isOwner()) {
        const next = { state: result.state, snapshot };
        pending.current = null; setHasPending(false); callbacks.current.onSaved(result.state, !!result.reviewResult);
        if (current.step.kind === 'word-practice' && item.submission.action === 'choose' && result.reviewResult) {
          const snapshot = quizRef.current ?? { state: current, choice: item.submission.choiceWordId!, attemptId: item.submission.attemptId, correct: result.reviewResult.correct === true };
          const confirmed = { ...snapshot, confirmed: true, correct: result.reviewResult.correct === true, next }; quizRef.current = confirmed; setQuiz(confirmed);
        } else if (current.step.kind === 'counter-practice' && result.reviewResult) counterNext.current = next;
        else finish(next);
        if (result.reviewResult && current.step.kind !== 'counter-practice' && callbacks.current.active && !document.hidden && !reacted.current.has(result.attemptId)) {
          reacted.current.add(result.attemptId);
          const kind = item.submission.action === 'again' || result.reviewResult.correct === false || item.submission.revealed ? 'again' : 'good';
          setFeedback({ attemptId: result.attemptId, kind }); callbacks.current.sound.cue(kind, result.attemptId);
        }
      }
      return result;
    } catch (failure) { if (isOwner()) { if (invalidLearningChoice(failure)) { quizRef.current = null; setQuiz(null); pending.current = null; setHasPending(false); refreshChoices = true; } else if (learningConflict(failure)) { quizRef.current = null; setQuiz(null); pending.current = null; setHasPending(false); setConflict(true); setError('Этот ответ не применён: шаг уже изменился на другом устройстве. Загрузите актуальный шаг.'); } else setError(`${message(failure)} Шаг не изменён без подтверждения; ответ сохранён на устройстве.`); } throw failure; }
    finally { lock.current = false; if (isOwner()) { setBusy(false); if (refreshChoices) void load(true); } }
  }
  function go(action: LearningAdvance['action']) { void advance(action).catch(() => {}); }
  async function sendReview(_ownerId: string, submission: ReviewSubmission): Promise<ReviewResult> {
    const details = submission.mode === 'grammar' ? { tokenIds: submission.tokenIds, tokenForms: submission.tokenForms, revealed: submission.revealed, exploring: submission.exploring } : submission.mode === 'counter' ? { counterChoice: submission.choice, helped: submission.helped } : {};
    const result = await advance(submission.mode === 'counter' && stateRef.current?.step?.kind === 'counter-practice' && stateRef.current.step.format !== 'recall' ? 'choose' : submission.rating === 1 ? 'again' : 'remember', details, submission.attemptId);
    if (!result.reviewResult) throw new Error('Сервер не подтвердил учебный ответ.');
    return result.reviewResult;
  }
  function choose(choiceWordId: string) {
    const current = stateRef.current; if (current?.step?.kind !== 'word-practice' || lock.current || quizRef.current || !active || document.hidden) return;
    const attemptId = crypto.randomUUID(), correct = choiceWordId === current.step.wordId;
    const snapshot = { state: current, choice: choiceWordId, attemptId, correct };
    quizRef.current = snapshot; setQuiz(snapshot);
    void advance('choose', { choiceWordId }, attemptId).catch(() => {});
  }
  const viewState = quiz?.state ?? state;
  const step = viewState?.step; const goal = route?.goals.find(goal => goal.id === step?.goalId); const part = goal?.parts.find(part => part.id === step?.partId);
  const word = step && 'wordId' in step ? data.course.words.find(word => word.id === step.wordId) : undefined;
  const construction = part?.construction;
  const blocked = !active || busy || hasPending || loading || !!error;
  const percent = state && state.totalSteps > 0 ? Math.min(100, Math.floor(state.completedSteps / state.totalSteps * 100)) : 0;
  const companion = companionState({ reviewId: step?.id, activity, feedback, completed: state?.completedSteps ?? 0, total: state?.totalSteps ?? 0 });
  const video = step?.kind === 'video' ? lesson?.videos?.find(video => video.id === step.videoId) : undefined;
  let board;
  if (!route) board = <div className="work-board notice"><p>Учебный маршрут пока недоступен. Дополнительный словарь остаётся в учебнике.</p><button onClick={onCourse}>К учебнику</button></div>;
  else if (viewState?.completed) board = <div className="work-board stack" data-testid="learning-complete"><h2>Урок пройден</h2><p>Все обязательные форматы основного материала выполнены. Личные повторения продолжаются по своему расписанию.</p><button className="primary" onClick={onCourse}>К учебнику</button></div>;
  else if (step?.kind === 'word-intro' && part) board = <GroupIntro key={part.id} part={part} data={data} active={active} busy={blocked} sound={sound} onActivity={setActivity} stepId={step.id} onStart={() => go('start-practice')} />;
  else if (step?.kind === 'word-practice' && word && viewState?.wordChoices?.length === 4) board = <WordQuiz key={`${step.id}:${viewState.version}`} value={{ ...word, audioUrl: word.audioUrl ?? '' }} wordId={word.id} choices={viewState.wordChoices} mode={step.mode} data={data} active={active} busy={blocked} sound={sound} onActivity={setActivity} stepId={step.id} selection={quiz} choose={choose} />;
  else if (step?.kind === 'word-practice' && word) board = <Recall key={`${step.id}:${state?.version}`} value={{ ...word, audioUrl: word.audioUrl ?? '' }} mode={step.mode} data={data} active={active} busy={blocked} sound={sound} onActivity={setActivity} stepId={step.id} grade={rating => advance(rating === 3 ? 'remember' : 'again')} />;
  else if (step?.kind === 'construction-intro' && construction) board = <Intro key={`${step.id}:${state?.version}`} value={construction.example} explanation={construction.explanationRu} breakdown={construction.breakdown} data={data} active={active} busy={blocked} sound={sound} onActivity={setActivity} stepId={step.id} onContinue={() => go('continue')} />;
  else if (step?.kind === 'construction-practice' && construction) board = step.mode === 'grammar' && state?.reviewItem?.mode === 'grammar' ? <SentenceWorkspace key={`${step.id}:${state.version}`} item={state.reviewItem} data={data} source={{ kind: 'guided', lessonId }} userId={user.id} onNext={() => {}} onSaved={() => {}} saveSettings={saveSettings} settingsBusy={settingsBusy} active={active && !loading && !conflict} sound={sound} onActivity={updateActivity} sendReview={sendReview} requiredPractice /> : step.mode !== 'grammar' ? <Recall key={`${step.id}:${state?.version}`} value={construction.example} mode={step.mode} data={data} active={active} busy={blocked} sound={sound} onActivity={setActivity} stepId={step.id} grade={rating => advance(rating === 3 ? 'remember' : 'again')} /> : null;
  else if (step?.kind === 'counter-practice' && viewState?.reviewItem?.mode === 'counter') board = <CounterCard key={`${step.id}:${viewState.version}`} item={viewState.reviewItem} data={data} userId={user.id} active={active && !loading && !conflict} sound={sound} onActivity={updateActivity} onSaved={() => {}} onFeedback={setFeedback} onNext={() => { const next = counterNext.current; if (next) { counterNext.current = null; finish(next); } }} saveSettings={saveSettings} settingsBusy={settingsBusy} cueScope={step.id} introductionSeen={!viewState.reviewItem.preparation || viewState.reviewItem.preparation.introduced} onIntroductionRead={async () => { await api('/api/training/introduce', { ...json('POST', { reviewIds: [viewState.reviewItem!.id], stage: 'learning', publicationId: data.course.publicationId }), headers: { 'Content-Type': 'application/json', 'X-Learning-Learner-Id': user.id, ...publicationHeaders(data.course.publicationId) } }); }} sendReview={sendReview} />;
  else if (step?.kind === 'video') board = <div className="work-board stack guided-video" key={step.id}>{video ? <LessonVideo key={video.id} material={video} course={data.course} orthography={data.settings.orthography} active={active} onPlayingChange={sound.setSpeechPlaying} /> : <p>Видео сейчас недоступно. Можно продолжить урок.</p>}<p className="muted">Видео необязательно. Продолжайте сразу, если не хотите смотреть.</p><button className="primary" disabled={blocked} onClick={() => { document.querySelector<HTMLVideoElement>('.guided-video video')?.pause(); go('skip'); }}>Продолжить урок</button></div>;
  else if (step?.kind === 'part-complete') board = <div className="work-board stack" data-testid="learning-part-complete"><h2>Часть пройдена</h2><p>{state && state.partIndex === state.totalParts - 1 ? 'Последняя часть пройдена. Сохраните завершение учебного маршрута.' : 'Все её слова и конструкции прошли обязательные форматы. Следующую часть можно начать сразу.'}</p><button className="primary" disabled={blocked} onClick={() => go('continue')}>{state && state.partIndex === state.totalParts - 1 ? 'Завершить урок' : 'Продолжить'}</button></div>;
  return <section className="study-session guided-learning stack" data-testid="guided-learning" data-lesson-id={lessonId} data-step-id={step?.id} data-step-kind={step?.kind} data-state-version={state?.version} data-quiz-pending={!!quiz && !quiz.confirmed} data-active={active} data-scene-id={scene} onPointerDownCapture={() => setFeedback(null)} onKeyDownCapture={() => setFeedback(null)}>
    <header className="session-header">
      <div className="session-heading"><small>Урок {lesson?.number}</small><h1>{route?.titleRu ?? lesson?.title}</h1></div><button className="quiet" aria-label="Выйти из урока" onClick={onExit}>Выйти</button>
      <div className="session-progress"><div className="session-progress-info"><span className="session-goal">{goal?.titleRu ?? 'Учебный маршрут'}</span>{state && <span className="session-count session-part-count"><span>Часть {Math.min(state.partIndex + 1, state.totalParts)}/{state.totalParts}</span><span>{percent}%</span></span>}</div><progress aria-label="Прогресс учебного маршрута" value={state?.completedSteps ?? 0} max={Math.max(1, state?.totalSteps ?? 1)} aria-valuetext={state ? `${state.completedSteps} из ${state.totalSteps} шагов` : 'Загружаем маршрут'} /><div className="session-feedback" role="status">{feedback && <span className="answer-feedback-marker" data-feedback={feedback.kind}>{feedback.kind === 'good' ? '✓ Вспомнил' : '↻ Этот формат вернётся'}</span>}</div></div>
    </header>
    <div className="session-stage"><div className="session-board work-board"><div className="session-scroll" key={`${step?.id}:${viewState?.version}`} tabIndex={0} role="region" aria-label="Материал урока">
      {error && <div className="notice error session-notice" role="alert"><p>{error}</p><button disabled={!active || busy} onClick={() => { if (pending.current) go(pending.current.submission.action); else void load(true); }}>{conflict ? 'Загрузить актуальный шаг' : hasPending ? 'Повторить сохранение' : 'Повторить загрузку'}</button></div>}
      {busy && !quiz && <p className="session-notice" role="status">Сохраняем шаг…</p>}
      {goal?.introductionRu && (step?.kind === 'construction-intro' || step?.kind === 'video') && <p className="guided-goal-context">{goal.introductionRu}</p>}
      {board ?? <p role="status">{error ? 'Шаг появится после подтверждения.' : 'Готовим учебный маршрут…'}</p>}
    </div></div><div className="scene-companion" data-testid="scene-companion" data-activity={companion.activity}><Cat playful pose={companion.pose} activity={companion.activity} reactionKey={companion.key} /></div></div>
  </section>;
}
