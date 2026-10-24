import { useCallback, useEffect, useRef, useState, type FormEvent } from 'react';
import type { LearnerSettings, RepeatType } from '../shared/types';
import { api, ApiRequestError, json, pendingReviews, submitReview } from './api';
import { Session } from './Session';
import { Auth } from './Auth';
import { RegistrationLinks } from './RegistrationLinks';
import { GuidedLearning } from './GuidedLearning';
import { invalidLearningChoice, learningConflict, learningHeaders, pendingLearning, submitLearning } from './guidedApi';
import { Cat } from './Cat';
import { Settings } from './Settings';
import { Textbook } from './Textbook';
import { Reference } from './Reference';
import { useSceneSound } from './sceneSound';
import { SceneIntro, SceneStage, useReducedMotion, type EntryPhase } from './SceneStage';
import { chooseScene, type SceneId } from './scenes';
import { selectSceneDecor } from './sceneDecor';
import type { Snapshot, StudySource, User } from './types';
import { sourceKey } from './learning';

type Page = 'review' | 'course' | 'words' | 'settings' | 'admin';
const navigation: [Page, string][] = [['course', 'Учебник'], ['review', 'Повторение'], ['words', 'Справочник']];
const errorText = (error: unknown) => error instanceof Error ? error.message : 'Не удалось выполнить запрос. Повторите попытку.';
const pauseLessonMedia = () => document.querySelectorAll<HTMLMediaElement>('.lesson-video video, .guided-learning audio').forEach(media => media.pause());

function Notice({ children, error = false }: { children: React.ReactNode; error?: boolean }) { return <div className={`notice${error ? ' error' : ''}`} role={error ? 'alert' : 'status'}>{children}</div>; }
function PageHead({ title, children }: { title: string; children?: React.ReactNode }) { return <header className="pagehead"><h1>{title}</h1>{children}</header>; }


export function App() {
  const [user, setUser] = useState<User | null | undefined>(undefined); const [data, setData] = useState<Snapshot | null>(null);
  const [page, setPage] = useState<Page>('course'); const [study, setStudy] = useState(false); const [sessionSource, setSessionSource] = useState<StudySource | null>(null); const [selectedScene, setSelectedScene] = useState<SceneId>('room');
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false); const [outboxCount, setOutboxCount] = useState(0);
  const userRef = useRef<User | null>(null);
  const [decor, setDecor] = useState(() => selectSceneDecor('room'));
  const [entryId, setEntryId] = useState(0); const [entryPhase, setEntryPhase] = useState<EntryPhase>('ready');
  const reducedMotion = useReducedMotion(); const motionEnabled = (data?.settings.animations ?? true) && !reducedMotion;
  const sound = useSceneSound({ learnerId: user?.id ?? null, settings: data?.settings, scene: selectedScene, active: study });
  const finishEntry = useCallback(() => setEntryPhase('ready'), []);
  const sceneReady = useCallback((scene: SceneId, failed: boolean) => { if (scene === selectedScene) setEntryPhase(current => current === 'loading' ? (failed || !motionEnabled ? 'ready' : 'entering') : current); }, [selectedScene, motionEnabled]);
  useEffect(() => { if (!motionEnabled) finishEntry(); }, [motionEnabled, finishEntry]);
  const refresh = useCallback(async () => {
    const current = userRef.current; if (!current) return;
    try {
      const snapshot = await api<Snapshot>('/api/bootstrap', { headers: learningHeaders(current.id) });
      if (userRef.current?.id === current.id) { setData(snapshot); setError(''); }
    } catch (failure) { if (userRef.current?.id === current.id) setError(errorText(failure)); }
  }, []);
  const loadUser = useCallback(async (home = false, expectedEmail?: string) => {
    try {
      const current = await api<User>('/api/me');
      if (expectedEmail && current.email.trim().toLowerCase() !== expectedEmail.trim().toLowerCase()) return false;
      if (userRef.current?.id !== current.id) { setData(null); setStudy(false); setSessionSource(null); setPage('course'); setEntryPhase('ready'); setSaving(false); setOutboxCount(0); setError(''); }
      if (home) history.replaceState(null, '', '/');
      userRef.current = current; setUser(current); return true;
    }
    catch (failure) { if (failure instanceof ApiRequestError && failure.status === 401) { userRef.current = null; setUser(null); } else setError(errorText(failure)); return false; }
  }, []);
  useEffect(() => { void loadUser(); }, [loadUser]);
  useEffect(() => { if (user) void refresh(); }, [user, refresh]);
  const retryPending = useCallback(async () => {
    if (!userRef.current) return;
    const id = userRef.current.id;
    try {
      const pending = pendingReviews(id); const learning = pendingLearning(id); setOutboxCount(pending.length + learning.length);
      if (pending.length + learning.length === 0) return;
      for (const result of pending) {
        if (userRef.current?.id !== id) return;
        await submitReview(id, result);
        if (userRef.current?.id !== id) return;
      }
      for (const item of learning) {
        if (userRef.current?.id !== id) return;
        try { await submitLearning(id, item); } catch (failure) { if (!invalidLearningChoice(failure)) throw failure; }
        if (userRef.current?.id !== id) return;
      }
      setOutboxCount(pendingReviews(id).length + pendingLearning(id).length); await refresh();
    } catch (failure) { if (userRef.current?.id === id) { if (learningConflict(failure)) { setOutboxCount(pendingReviews(id).length + pendingLearning(id).length); await refresh(); if (userRef.current?.id === id) setError('Устаревший ответ не применён: учебный шаг изменился на другом устройстве. Загружено актуальное положение.'); } else setError(errorText(failure)); } }
  }, [refresh]);
  useEffect(() => { if (!user) return; void retryPending(); const sync = () => { void retryPending(); }; window.addEventListener('online', sync); window.addEventListener('focus', sync); return () => { window.removeEventListener('online', sync); window.removeEventListener('focus', sync); }; }, [user, retryPending]);
  async function saveSettings(next: LearnerSettings) {
    const id = userRef.current?.id; if (!id) return;
    setSaving(true); setError('');
    try {
      const saved = await api<LearnerSettings>('/api/settings', { ...json('PUT', next), headers: learningHeaders(id) });
      if (userRef.current?.id !== id) return;
      setData(current => current ? { ...current, settings: saved } : current); await refresh();
    } catch (failure) { if (userRef.current?.id === id) setError(errorText(failure)); }
    finally { if (userRef.current?.id === id) setSaving(false); }
  }
  async function logout() { try { await api('/api/auth/sign-out', json('POST', {})); userRef.current = null; setUser(null); setData(null); setStudy(false); setSessionSource(null); setPage('course'); setEntryPhase('ready'); setSaving(false); setOutboxCount(0); setError(''); } catch (failure) { setError(errorText(failure)); } }
  function sessionSaved(id: string) {
    if (userRef.current?.id !== id) return;
    try { setOutboxCount(pendingReviews(id).length + pendingLearning(id).length); } catch (failure) { setError(errorText(failure)); return; }
  }
  if (user === undefined) return <main className="auth">{error ? <Notice error><p>{error}</p><button onClick={() => { setError(''); void loadUser(); }}>Повторить загрузку</button></Notice> : <p role="status">Проверяем вход…</p>}</main>;
  if (!user || location.pathname === '/invite' || location.pathname === '/recover') return <Auth onLogin={email => loadUser(true, email)} />;
  function startOrResume(source: StudySource) {
    pauseLessonMedia();
    if (!sessionSource || sourceKey(sessionSource) !== sourceKey(source)) {
      const chosen = chooseScene(); sound.unlock(chosen); setSelectedScene(chosen); setDecor(selectSceneDecor(chosen)); setEntryId(current => current + 1); setEntryPhase(motionEnabled ? 'loading' : 'ready'); setSessionSource(source);
    } else sound.unlock(selectedScene);
    setPage(source.kind === 'review' ? 'review' : source.kind === 'lesson' || source.kind === 'guided' || source.kind === 'counters' || source.kind === 'topic' ? 'course' : 'words'); setStudy(true);
  }
  function closeSession(toCourse = false) { setStudy(false); setSessionSource(null); finishEntry(); if (toCourse) setPage('course'); void refresh(); }
  function navigate(value: Page) {
    pauseLessonMedia();
    const resumeReview = value === 'review' && sessionSource?.kind === 'review';
    if (resumeReview) sound.unlock(selectedScene); else finishEntry();
    setPage(value); setStudy(resumeReview); if (!resumeReview) void refresh();
  }
  return <div className="shell game-shell" data-scene={selectedScene} data-motion={motionEnabled} data-entry-phase={entryPhase} data-entry-id={entryId} data-decor-period={decor.period} data-sound-state={sound.state}><SceneStage scene={selectedScene} decor={decor} entryId={entryId} phase={entryPhase} active={study} layoutKey={`${page}:${study}:${!!data}`} onReady={sceneReady} /><a className="skip" href="#main">К упражнению</a><header className="game-hud"><div className="wordmark"><span className="brand-stamp" lang="ja" aria-hidden="true">ま</span><span lang="ja">まるごと</span></div><nav className="nav" aria-label="Разделы">{navigation.map(([value, label]) => <button key={value} aria-current={page === value ? 'page' : undefined} onClick={() => navigate(value)}>{page === value && <span className="nav-leaf" aria-hidden="true">❧</span>}{label}</button>)}<button className="scene-sound-toggle" aria-label="Звуки сцены" aria-pressed={data?.settings.sceneSoundEnabled ?? true} disabled={!data || saving} title={({ paused: 'Музыка и окружение звучат во время занятия', muted: 'Звуки сцены выключены', loading: 'Загружаем звуки сцены…', playing: 'Звуки сцены воспроизводятся', blocked: 'Браузер заблокировал звук. Выключите и снова включите ♪.', unavailable: 'Звук сцены сейчас недоступен' })[sound.state]} onClick={() => { if (!data) return; if (!data.settings.sceneSoundEnabled) sound.unlock(study ? selectedScene : undefined); void saveSettings({ ...data.settings, sceneSoundEnabled: !data.settings.sceneSoundEnabled }); }}><span aria-hidden="true">{data?.settings.sceneSoundEnabled ? '♪' : '♫'}</span><span className="sound-off-mark" aria-hidden="true">{!data?.settings.sceneSoundEnabled && '╱'}</span></button><details className="hud-menu"><summary aria-label="Настройки и аккаунт">⚙</summary><div className="hud-menu-panel"><small>{user.name}</small><button aria-current={page === 'settings' ? 'page' : undefined} onClick={event => { navigate('settings'); event.currentTarget.closest('details')?.removeAttribute('open'); }}>Настройки</button>{user.isAdmin && <button aria-current={page === 'admin' ? 'page' : undefined} onClick={event => { navigate('admin'); event.currentTarget.closest('details')?.removeAttribute('open'); }}>Доступ учеников</button>}<button onClick={() => { void logout(); }}>Выйти</button></div></details></nav></header>{(sound.state === 'blocked' || sound.state === 'unavailable') && <p className="scene-sound-notice" role="status">{sound.state === 'blocked' ? 'Звук сцены заблокирован браузером. Выключите и снова включите ♪.' : 'Звуки сцены пока недоступны. Занятие можно продолжить.'}</p>}<main id="main"><div className="page">{(error || outboxCount > 0) && <div className="page-notices">{error && <Notice error><p>{error}</p><button onClick={() => { void refresh(); }}>Повторить загрузку</button></Notice>}{outboxCount > 0 && <Notice><p>На этом устройстве ждут сохранения ответы: {outboxCount}. Не очищайте данные браузера.</p><button onClick={() => { void retryPending(); }}>Повторить сохранение</button></Notice>}</div>}{!data ? <div className="work-board sheet" aria-busy="true">Загружаем учебник и прогресс…</div> : <>{study && entryPhase !== 'ready' && <SceneIntro scene={selectedScene} entryId={entryId} phase={entryPhase} onReady={finishEntry} />}{sessionSource && <div className="session-preserve" hidden={!study || entryPhase !== 'ready'} inert={!study || entryPhase !== 'ready'}>{sessionSource.kind === 'guided' ? <GuidedLearning key={sourceKey(sessionSource)} lessonId={sessionSource.lessonId} active={study && entryPhase === 'ready'} sound={sound} scene={selectedScene} user={user} data={data} saveSettings={saveSettings} settingsBusy={saving} onExit={() => closeSession()} onCourse={() => closeSession(true)} onSaved={() => sessionSaved(user.id)} /> : <Session key={sourceKey(sessionSource)} source={sessionSource} active={study && entryPhase === 'ready'} sound={sound} scene={selectedScene} user={user} data={data} saveSettings={saveSettings} settingsBusy={saving} onExit={() => closeSession()} onCourse={() => closeSession(true)} onSaved={() => sessionSaved(user.id)} />}</div>}{!study && (page === 'review' ? <Repeat data={data} onStudy={() => startOrResume({ kind: 'review' })} saveSettings={saveSettings} settingsBusy={saving} onCourse={() => navigate('course')} /> : <section className={`section-board work-board${page === 'course' ? ' textbook-board' : ''}`}>{page === 'course' ? <Textbook data={data} onTopic={(topicId, sectionId) => startOrResume({ kind: 'topic', topicId, sectionId })} onCounters={() => startOrResume({ kind: 'counters' })} onLearn={lessonId => startOrResume({ kind: 'guided', lessonId })} onTrain={lessonId => startOrResume({ kind: 'lesson', lessonId })} /> : page === 'words' ? <Reference data={data} refresh={refresh} sound={sound} onConstruction={skillId => startOrResume({ kind: 'construction', skillId, mode: 'ja-ru' })} onTrain={listId => startOrResume({ kind: 'list', listId })} /> : page === 'settings' ? <Settings data={data} busy={saving} save={saveSettings} user={user} logout={logout} /> : <Admin />}</section>)}</>}</div></main></div>;
}

function Repeat({ data, onStudy, onCourse, saveSettings, settingsBusy }: { data: Snapshot; onStudy: () => void; onCourse: () => void; saveSettings: (value: LearnerSettings) => Promise<void>; settingsBusy: boolean }) {
  const { progress, settings } = data;
  const [selected, setSelected] = useState<RepeatType[]>(settings.repeatTypes);
  const acknowledged = selected.length === settings.repeatTypes.length && selected.every(type => settings.repeatTypes.includes(type));
  const count = (type: RepeatType) => progress.byType?.[type].due ?? (type === 'words' ? progress.byMode['ja-ru'].due + progress.byMode['ru-ja'].due + progress.byMode.listening.due : type === 'counters' ? progress.byMode.counter.due : type === 'constructions' ? progress.byMode.grammar.due : 0);
  const reviewed = Object.values(progress.byMode).reduce((sum, mode) => sum + mode.reviewedToday, 0);
  const due = acknowledged && progress.repeatDue !== undefined ? progress.repeatDue : selected.reduce((sum, type) => sum + count(type), 0);
  function select(type: RepeatType, checked: boolean) { const next = checked ? [...selected, type] : selected.filter(value => value !== type); setSelected(next); void saveSettings({ ...settings, repeatTypes: next, repeatTypesVersion: 2 }); }
  return <section className="today work-board"><div className="today-heading"><div><small>Marugoto Starter A1 · личное расписание</small><h1>Повторение</h1><p className="muted">Уже изученный материал, которому пришло время повториться.</p></div><Cat welcome pose={reviewed ? 'success' : 'wave'} /></div><fieldset className="repeat-types" data-testid="repeat-types"><legend>Что повторяем</legend>{([['words', 'Слова'], ['counters', 'Счётные суффиксы'], ['constructions', 'Конструкции'], ['questions', 'Вопросы'], ['time', 'Время и календарь']] as const).map(([type, label]) => <label key={type}><input type="checkbox" checked={selected.includes(type)} disabled={settingsBusy} onChange={event => select(type, event.target.checked)} />{label}<small>{count(type)}</small></label>)}</fieldset>{!acknowledged && !settingsBusy && <Notice><p>Выбор пока не сохранён. Повторение начнётся после подтверждения настроек.</p><button onClick={() => { void saveSettings({ ...settings, repeatTypes: selected, repeatTypesVersion: 2 }); }}>Повторить сохранение выбора</button></Notice>}<div className="today-stats"><div><strong>{due}</strong><span>по выбранным типам</span></div><div><strong>{reviewed}</strong><span>выполнено сегодня</span></div></div>{due > 0 ? <div><button className="primary start-session" disabled={settingsBusy || !acknowledged || !selected.length} onClick={onStudy}><span className="start-leaf" aria-hidden="true">❧</span>Начать повторение<span aria-hidden="true">↗</span></button></div> : <Notice><p>{!selected.length ? 'Выберите хотя бы один тип материала.' : 'На сейчас выбранный материал повторён. Можно выбрать другие типы или изучить новое в учебнике.'}</p><button className="primary" onClick={onCourse}>К учебнику</button></Notice>}<p className="today-hint">Нажмите на карточку, чтобы раскрыть смысл.<br />Вправо — помню, влево — ещё раз.</p><p className="today-sound-hint">{settings.sceneSoundEnabled ? 'Музыка и окружение звучат во время занятия.' : 'Звуки сцены выключены. Их можно включить кнопкой ♪.'}</p></section>;
}


function Admin() {
  const [kind, setKind] = useState<'invite' | 'recovery'>('invite'); const [email, setEmail] = useState(''); const [link, setLink] = useState(''); const [expires, setExpires] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [copied, setCopied] = useState(false);
  async function create(event: FormEvent) { event.preventDefault(); setBusy(true); setError(''); setLink(''); setCopied(false); try { const result = await api<{ url: string; expiresAt: string }>('/api/admin/links', json('POST', { kind, email })); setLink(new URL(result.url, location.origin).href); setExpires(result.expiresAt); } catch (failure) { setError(errorText(failure)); } finally { setBusy(false); } }
  return <><PageHead title="Доступ учеников"><p className="muted">Выдавайте общие регистрационные или личные одноразовые ссылки.</p></PageHead><RegistrationLinks /><section className="stack head-actions"><h2>Персональное приглашение или восстановление</h2><form className="sheet stack" onSubmit={create}><label><span>Действие</span><select value={kind} onChange={event => setKind(event.target.value as 'invite' | 'recovery')}><option value="invite">Приглашение</option><option value="recovery">Восстановление пароля</option></select></label><label><span>Email ученика</span><input type="email" required value={email} onChange={event => setEmail(event.target.value)} /></label><div><button className="primary" disabled={busy}>{busy ? 'Создаём…' : 'Создать ссылку'}</button></div>{error && <Notice error>{error}</Notice>}{link && <div className="stack"><label><span>Одноразовая ссылка</span><input readOnly value={link} onFocus={event => event.target.select()} /></label><small>Действует до {new Date(expires).toLocaleString('ru-RU')}.</small><div><button type="button" onClick={() => { void navigator.clipboard.writeText(link).then(() => setCopied(true)).catch(() => setError('Не удалось скопировать. Выделите ссылку и скопируйте вручную.')); }}>{copied ? '✓ Скопировано' : 'Скопировать'}</button></div></div>}</form></section></>;
}
