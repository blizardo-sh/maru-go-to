import { TrainingPreparation } from './TrainingPreparation';
import { TrainingQuiz } from './TrainingQuiz';
import { catalogFor } from '../shared/catalog';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { ConstructionMode, LearnerSettings, ReviewItem, ReviewQueue, ReviewResult } from '../shared/types';
import type { Snapshot, StudySource, User } from './types';
import { sourceKey, trainingContext, inTrainingSection } from './learning';
import { api, json, publicationHeaders, ApiRequestError } from './api';
import { useReviewSave } from './useReviewSave';
import { GestureCard } from './GestureCard';
import { JapaneseText } from './JapaneseText';
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
import { Recall } from './GuidedLearning';
import { objectFor } from '../shared/counters';

const messages = (error: unknown) => error instanceof Error ? error.message : 'Не удалось сохранить ответ. Повторите попытку.';
export function Session({ user, data: incomingData, source, onExit, onReturn, onSaved, saveSettings, settingsBusy, active = true, scene = 'room', sound }: { user: User; data: Snapshot; source: StudySource; onExit: () => void; onReturn: () => void; onSaved: () => void; saveSettings: (value: LearnerSettings) => Promise<void>; settingsBusy: boolean; active?: boolean; scene?: SceneId; sound: SceneSound }) {
  const [preparationStage, setPreparationStage] = useState<'reference'|'learning'|'practice'>('practice');
  const [material, setMaterial] = useState(incomingData);
  const data = { ...incomingData, course: material.course };
  const [constructionMode, setConstructionMode] = useState<ConstructionMode>(source.kind === 'construction' ? source.mode : 'ja-ru');
  const [audioUnavailable, setAudioUnavailable] = useState(false);
  const [queue, setQueue] = useState<ReviewQueue | null>(null); const [error, setError] = useState('');
  const [completed, setCompleted] = useState(0); const [feedback, setFeedback] = useState<SavedFeedback | null>(null);
  const [pending, setPending] = useState<ReviewItem[]>([]); const [turn, setTurn] = useState(0);
  const seenCounterIntros = useRef(new Set<string>());
  const [soundSessionId] = useState(() => crypto.randomUUID());
  const [portion, setPortion] = useState(0); const [loadingQueue, setLoadingQueue] = useState(true); const request = useRef(0);
  const contextKey = sourceKey(source); const training = source.kind !== 'review';
  const sourceTitle = source.kind === 'topic' ? data.course.catalog?.thematic?.sections.find(section => section.id === source.sectionId)?.title ?? (source.topicId === 'questions' ? 'Вопросы' : 'Время и календарь') : source.kind === 'construction' ? data.course.skills.find(skill => skill.id === source.skillId)?.title ?? 'Конструкция' : source.kind === 'lesson' ? `Дополнительный словарь · урок ${data.course.lessons.find(lesson => lesson.id === source.lessonId)?.number ?? ''}` : source.kind === 'list' ? data.lists.find(list => list.id === source.listId)?.name ?? 'Личный список' : source.kind === 'counters' ? 'Счётные суффиксы' : 'Повторение';
  const [activity, setActivity] = useState<CardActivity | null>(null); const [companionFeedback, setCompanionFeedback] = useState<SavedFeedback | null>(null);
  const load = useCallback(async () => {
    const current = ++request.current; setError(''); setAudioUnavailable(false); setLoadingQueue(true);
    const query = new URLSearchParams(Object.entries(trainingContext(source.kind === 'construction' ? { ...source, mode: constructionMode } : source)).map(([key, value]) => [key, String(value)]));
    try {
      const snapshot = incomingData.course.publicationId ? await api<Snapshot>('/api/bootstrap', { headers: { 'X-Learning-Learner-Id': user.id } }) : incomingData;
      const nextQueue = await api<ReviewQueue>(source.kind === 'review' ? '/api/reviews?mode=mixed' : `/api/training?${query}`, { headers: { 'X-Learning-Learner-Id': user.id, ...publicationHeaders(snapshot.course.publicationId) } });
      if (request.current !== current) return;
      const visibleQueue = source.kind === 'lesson' ? { ...nextQueue, items: nextQueue.items.filter(item => item.mode !== 'grammar') } : nextQueue;
      setPreparationStage(training && visibleQueue.items.some(item => item.preparation && !item.preparation.referenceSeen) ? 'reference' : training && visibleQueue.items.some(item => item.preparation && !item.preparation.introduced) ? 'learning' : 'practice');
      setMaterial(snapshot); setQueue(visibleQueue); setPending(visibleQueue.items); setCompleted(0); setTurn(0); setFeedback(null); setActivity(null); setCompanionFeedback(null); setPortion(value => value + 1);
    } catch (failure) { if (request.current === current) { setError(messages(failure)); setAudioUnavailable(failure instanceof ApiRequestError && failure.code === 'AUDIO_UNAVAILABLE'); } }
    finally { if (request.current === current) setLoadingQueue(false); }
  }, [contextKey, constructionMode]);
  useEffect(() => { void load(); return () => { request.current++; }; }, [load]);
  const total = queue?.items.length ?? 0; const item = pending[0];
  const remainingCards = pending.filter(item => item.mode !== 'grammar').length;
  const initialCards = queue?.items.filter(item => item.mode !== 'grammar').length ?? 0;
  useEffect(() => { if (total > 0 && completed >= total) sound.cue('complete', `${soundSessionId}:${portion}`); }, [total, completed, soundSessionId, portion, sound.cue]);
  const percent = total > 0 ? Math.round(completed / total * 100) : 0;
  const companion = companionState({ reviewId: item?.id, activity, feedback: companionFeedback, completed, total });
  function next(acknowledged?: SavedFeedback, result?: ReviewResult, reaction = acknowledged) {
    const repeat = acknowledged?.kind === 'again' && (item?.mode !== 'grammar' || source.kind === 'construction' || !!item.preparation);
    if (source.kind === 'construction' && pending.length === 1 && !repeat && constructionMode !== 'grammar') { setQueue(null); setPending([]); setConstructionMode(constructionMode === 'ja-ru' ? 'listening' : 'grammar'); }
    else setPending(items => { const remaining = repeat && item?.mode === 'grammar' ? [...items.slice(1), items[0]!] : advanceDeck(items, repeat, result); return result ? remaining.map(value => value.targetId === item?.targetId && value.mode === item.mode ? { ...value, version: result.version, due: result.nextDue, isNew: false } : value) : remaining; }); setTurn(value => value + 1);
    if (!repeat) setCompleted(value => Math.min(value + 1, total));
    setFeedback(acknowledged ?? null); setCompanionFeedback(reaction ?? null);
  }
  function clearPreviousFeedback() { if (active) { setFeedback(null); setCompanionFeedback(null); } }
  async function completePreparation() {
    if (!queue || !active || document.hidden) return;
    const reviewIds = queue.items.filter(value => value.preparation && (preparationStage === 'reference' ? !value.preparation.referenceSeen : !value.preparation.introduced)).map(value => value.id);
    if (reviewIds.length) await api('/api/training/introduce', { ...json('POST', { reviewIds, stage: preparationStage, ...(material.course.publicationId ? { publicationId: material.course.publicationId } : {}) }), headers: { 'Content-Type': 'application/json', 'X-Learning-Learner-Id': user.id, ...publicationHeaders(material.course.publicationId) } });
    const learning = preparationStage === 'learning';
    const update = (value: ReviewItem): ReviewItem => value.preparation ? { ...value, preparation: { ...value.preparation, referenceSeen: true, introduced: learning || value.preparation.introduced } } : value;
    setQueue(value => value ? { ...value, items: value.items.map(update) } : value); setPending(items => items.map(update));
    setPreparationStage(learning || !queue.items.some(value => value.preparation && !value.preparation.introduced) ? 'practice' : 'learning');
  }
  const board = queue && preparationStage !== 'practice' ? <TrainingPreparation key={`${portion}:${preparationStage}`} items={queue.items.filter(value => value.preparation && (preparationStage === 'reference' ? !value.preparation.referenceSeen : !value.preparation.introduced))} reference={queue.reference} stage={preparationStage} data={data} active={active} sound={sound} onActivity={setActivity} onContinue={completePreparation} /> : item ? item.mode === 'grammar'
    ? item.construction && item.construction.mode !== 'grammar' ? <ConstructionCard key={`${portion}:${turn}`} item={item} data={data} userId={user.id} active={active} sound={sound} onActivity={setActivity} onSaved={onSaved} onNext={next} /> : <SentenceWorkspace source={source} key={`${portion}:${turn}:${item.id}:${item.version}`} item={item} data={data} userId={user.id} onNext={(reaction, result) => next(source.kind === 'construction' || item.preparation ? reaction : undefined, result, reaction)} onSaved={onSaved} saveSettings={saveSettings} settingsBusy={settingsBusy} active={active} onActivity={setActivity} sound={sound} requiredPractice={source.kind === 'construction' || !!item.preparation} />
    : item.mode === 'counter' ? <CounterCard key={`${portion}:${turn}`} item={item} data={data} userId={user.id} onNext={next} onSaved={onSaved} onFeedback={value => { setFeedback(value); setCompanionFeedback(value); }} saveSettings={saveSettings} settingsBusy={settingsBusy} active={active} onActivity={setActivity} sound={sound} cueScope={`${soundSessionId}:${portion}:${turn}`} introductionSeen={!!item.preparation?.introduced || seenCounterIntros.current.has(item.counter.definition.id)} onIntroductionRead={() => { seenCounterIntros.current.add(item.counter.definition.id); }} />
    : item.choices?.length === 4 ? <TrainingQuiz key={`${portion}:${turn}`} item={item} data={data} userId={user.id} active={active} sound={sound} onActivity={setActivity} onSaved={onSaved} onFeedback={value => { setFeedback(value); setCompanionFeedback(value); }} onNext={next} /> : <WordCard key={`${portion}:${turn}:${item.id}:${item.version}`} item={item} data={data} userId={user.id} onNext={next} onSaved={onSaved} saveSettings={saveSettings} settingsBusy={settingsBusy} active={active} onActivity={setActivity} sound={sound} cueScope={`${soundSessionId}:${portion}:${turn}`} />
    : queue ? <div className="sheet empty" data-testid="portion-complete"><h2>{completed ? training ? 'Порция пройдена' : 'Повторение завершено' : training ? 'Пока нет готовых заданий' : 'На сейчас всё повторено'}</h2><p>{completed ? training ? 'Подтверждённые карточки сохранены. Продолжите следующую порцию: неизученный остаток, а затем практика знакомого материала.' : 'Подтверждённые ответы сохранены. Новые слова и конструкции можно изучать в учебнике.' : source.kind === 'counters' ? `Сначала пройдите подходящие слова учебника: ${data.course.words.filter(word => word.reviewStatus !== 'draft' && objectFor(word, catalogFor(data.course))).slice(0, 5).map(word => `${word.kana} (урок ${data.course.lessons.find(lesson => word.lessonIds.includes(lesson.id))?.number ?? ''})`).join(', ')}. Затем здесь появится практика счёта.` : training ? 'Для личных слов проверьте чтение и перевод. Задания появятся после подтверждения записей.' : 'Здесь появляются только уже изученные слова и конструкции, когда подходит срок повторения.'}</p>{completed > 0 && <small>Пройденные шаги порции сохранены. Новые элементы подключаются к повторению после полного успешного учебного цикла.</small>}<div className="row">{training && <button className="primary" disabled={loadingQueue} onClick={() => { void load(); }}>{loadingQueue ? 'Готовим порцию…' : 'Продолжить'}</button>}<button className={training ? undefined : 'primary'} onClick={onReturn}>{inTrainingSection(source) ? 'К тренировкам' : 'К учебнику'}</button></div></div> : null;
  return <section data-testid="study-session" data-scene-id={scene} data-session-kind={source.kind} data-source-id={source.kind === 'lesson' ? source.lessonId : source.kind === 'list' ? source.listId : source.kind} data-portion={portion} data-active={active} className="study-session stack" onPointerDownCapture={clearPreviousFeedback} onKeyDownCapture={clearPreviousFeedback}>
    <header className="session-header"><div className="session-heading"><h1><JapaneseText text={sourceTitle} course={data.course} mode={data.settings.orthography} /></h1></div><button className="quiet" onClick={onExit}>Завершить</button>
    <div className="session-progress" aria-busy={loadingQueue}><div className="session-progress-info"><span className="session-goal">{training ? item?.isNew ? 'Первое знакомство' : 'Тренировка материала' : 'По расписанию'}</span><span className="session-count">{queue && total > 0 ? `${completed} / ${total} · ${percent}%` : queue ? 'Нет заданий' : 'Загрузка…'}</span></div><progress aria-label="Прогресс занятия" value={completed} max={Math.max(1, total)} aria-valuetext={`Пройдено ${completed} из ${total} заданий (${percent}%)`} /><div className="session-feedback" data-testid="session-feedback" data-feedback={feedback?.kind ?? 'neutral'} role="status" aria-live="polite" aria-atomic="true">{feedback && <span key={feedback.attemptId} className="answer-feedback-marker" data-feedback={feedback.kind}><span className="feedback-context">Последний ответ: </span><span aria-hidden="true">{feedback.kind === 'good' ? '✓ ' : '↻ '}</span>{feedback.kind === 'good' ? 'Вспомнил' : 'Повторим'}</span>}</div></div></header>
    <div className="session-stage"><div className="session-board work-board"><div className="session-scroll" key={`${portion}:${turn}`} tabIndex={0} role="region" aria-label="Материал практики">{error && <div className="notice error session-notice" role="alert"><p>{error}</p>{audioUnavailable && source.kind === 'construction' ? <button onClick={() => { setQueue(null); setPending([]); setConstructionMode('grammar'); }}>Перейти к сборке без оценки аудирования</button> : <button onClick={() => { void load(); }}>Повторить загрузку</button>}</div>}{!queue && !error ? <p role="status">Готовим занятие…</p> : preparationStage === 'practice' && item && item.mode !== 'grammar' ? <div className="card-deck" data-testid="card-deck" data-remaining={remainingCards}><div className="deck-summary"><span>Колода</span><strong role="status">Осталось {remainingCards} из {initialCards}</strong></div><div className="deck-stack">{Array.from({ length: Math.min(3, remainingCards - 1) }, (_, index) => <div className="deck-layer" aria-hidden="true" key={index} style={{ transform: `translateY(${(index + 1) * Math.min(remainingCards - 1, 20) / 3}px) rotate(${index % 2 ? 1 : -1}deg)` }} />)}{board}</div></div> : board}</div></div><div className="scene-companion" data-testid="scene-companion" data-activity={companion.activity} data-event-key={companion.key}><Cat playful pose={companion.pose} activity={companion.activity} reactionKey={companion.key} /></div></div>
  </section>;
}

function WordCard({ item, data, userId, onNext, onSaved, saveSettings, settingsBusy, active, onActivity, sound, cueScope }: { item: Extract<ReviewItem, { mode: 'ja-ru' | 'ru-ja' | 'listening' }>; data: Snapshot; userId: string; onNext: (feedback?: SavedFeedback, result?: ReviewResult) => void; onSaved: () => void; saveSettings: (value: LearnerSettings) => Promise<void>; settingsBusy: boolean; active: boolean; onActivity: (value: CardActivity) => void; sound: SceneSound; cueScope: string }) {
  const [revealed, setRevealed] = useState(false);
  const speech = useCardSpeech(item.word.audioUrl, item.mode === 'listening', active, data.settings.speechVolume, sound);
  const saving = useReviewSave(userId, onSaved, (submission, result) => { const kind = result.correct === false || submission.rating === 1 ? 'again' : 'good'; sound.cue(kind, result.attemptId); onNext({ attemptId: result.attemptId, kind }, result); });
  const unavailable = item.mode === 'listening' && (!item.word.audioUrl || !speech.played || !!speech.error);
  const enabled = active && !saving.busy && !saving.pending;
  const phase: CardActivity['activity'] = !active || speech.error || saving.error ? 'neutral' : saving.busy || saving.pending ? 'checking' : speech.playing ? 'listening' : revealed ? 'revealed' : 'idle';
  useEffect(() => { onActivity({ reviewId: item.id, activity: phase, key: `${item.id}:${item.version}:${phase}` }); }, [phase, item.id, item.version, onActivity]);
  function tap() { if (!enabled || document.hidden) return; if (unavailable) { void speech.play(); return; } if (!revealed) { sound.cue('reveal', `${cueScope}:${item.id}:${item.version}`); document.querySelector<HTMLElement>('[data-testid="review-gesture"]')?.focus({ preventScroll: true }); } setRevealed(true); }
  function grade(rating: 1 | 3) { if (!enabled || document.hidden || !revealed || unavailable) return; return saving.save({ attemptId: crypto.randomUUID(), reviewId: item.id, version: item.version, ...(item.publicationId ? { publicationId: item.publicationId } : {}), mode: item.mode, rating }); }
  const label = item.mode === 'ja-ru' ? 'Вспомните перевод' : item.mode === 'ru-ja' ? 'Вспомните слово по-японски' : 'Вспомните смысл услышанного';
  return <GestureCard active={active} phase={revealed ? 'answer' : 'question'} enabled={revealed && enabled && !unavailable} onAdvance={grade} mode={item.mode} reviewId={item.id} actions={<DisplayControl mode={data.settings.orthography} onChange={orthography => { void saveSettings({ ...data.settings, orthography }); }} disabled={settingsBusy || !enabled} />}>
    <FlipCard revealed={revealed} front={<div className="stack"><button className="study-card word-card" data-card-face={!revealed || undefined} data-testid={!revealed ? 'card-face' : undefined} onClick={tap} disabled={!enabled}>
      <small>{label}</small><span className="prompt">{item.mode === 'listening' ? speech.playing ? 'Слушаем…' : speech.played ? 'Что прозвучало?' : 'Нажмите, чтобы прослушать' : item.mode === 'ru-ja' ? item.word.meaningRu : <Japanese value={item.word} forms={data.course.forms} mode={data.settings.orthography} />}</span>
    </button>{item.mode === 'listening' && item.word.audioUrl && <button className="quiet inline-audio" aria-label="Прослушать ещё раз" onClick={() => { void speech.play(); }} disabled={!active || speech.playing || saving.busy}>▶ Прослушать ещё раз</button>}</div>} back={<div className="illustrated-card" data-testid={revealed ? "card-face" : undefined}><div className="card-art"><WordIllustration catalog={catalogFor(data.course)} wordId={item.word.id} /></div><div className="card-information answer"><small>Сверьте свой ответ</small><h2>{item.word.meaningRu}</h2><div className="inline-pronunciation"><span className="prompt"><Japanese value={item.word} forms={data.course.forms} mode={data.settings.orthography} /></span>{item.word.audioUrl && <button className="quiet audio-icon" aria-label="Прослушать слово" onClick={() => { void speech.play(); }} disabled={!active || speech.playing || saving.busy}>▶</button>}</div></div></div>} />
    {speech.error && <p className="error" role="alert">{speech.error}</p>}
    {saving.busy && <p role="status">Сохраняем ответ…</p>}
    {saving.error && <div className="notice error" role="alert"><p>{saving.error}</p><button disabled={!active} onClick={saving.retry}>Повторить сохранение</button></div>}
  </GestureCard>;
}

function ConstructionCard({ item, data, userId, active, sound, onActivity, onSaved, onNext }: { item: Extract<ReviewItem, { mode: 'grammar' }>; data: Snapshot; userId: string; active: boolean; sound: SceneSound; onActivity: (activity: CardActivity) => void; onSaved: () => void; onNext: (feedback?: SavedFeedback, result?: ReviewResult) => void }) {
  const construction = item.construction!;
  const [helped, setHelped] = useState(false);
  const saving = useReviewSave(userId, onSaved, (submission, result) => { const kind = result.correct === false || submission.rating === 1 ? 'again' : 'good'; sound.cue(kind, result.attemptId); onNext({ attemptId: result.attemptId, kind }, result); });
  const order = item.exercise.acceptedOrders[0] ?? [];
  return <div className="stack construction-drill" data-testid="construction-drill" data-format={construction.mode}>
    <Recall value={construction.example} mode={construction.mode === 'listening' ? 'listening' : 'ja-ru'} active={active} busy={saving.busy || saving.pending} sound={sound} onActivity={onActivity} stepId={item.id} data={data} grade={rating => saving.save({ attemptId: crypto.randomUUID(), reviewId: item.id, version: item.version, ...(item.publicationId ? { publicationId: item.publicationId } : {}), mode: 'grammar', practiceFormat: construction.mode, tokenIds: order, tokenForms: Object.fromEntries(order.map(id => [id, item.exercise.tokens.find(token => token.id === id)!.formId])), revealed: rating === 1 || helped, exploring: false, rating: helped ? 1 : rating })} />
    <details className="guided-rule" onToggle={event => { if (event.currentTarget.open) setHelped(true); }}><summary>Полное правило</summary><p><JapaneseText text={construction.explanationRu} course={data.course} mode={data.settings.orthography} /></p>{construction.breakdown.map((piece, index) => <p key={index}><JapaneseText text={piece.text} course={data.course} mode={data.settings.orthography} /> — <JapaneseText text={piece.explanationRu} course={data.course} mode={data.settings.orthography} /></p>)}</details>
    {saving.error && <div className="notice error" role="alert"><p>{saving.error}</p><button disabled={!active} onClick={saving.retry}>Повторить сохранение</button></div>}
  </div>;
}
