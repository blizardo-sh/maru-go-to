import { ratingOptions, intervalLabel } from '@app/client/review-ratings';
import { meaningDisplay } from '@app/shared/meanings';
import { TaskView, renderTask } from './album-task';
import 'pixi.js/unsafe-eval';
import 'pixi.js/accessibility';
import { Application, Assets, Container, Graphics, Rectangle, Text, Texture } from 'pixi.js';
import { api, json, pendingReviews } from '@app/client/api';
import { learningHeaders, pendingLearning } from '@app/client/guidedApi';
import { prepareCardAudio, warmCardAudio } from '../cardAudio';
import { SceneSoundController } from '../sceneSound';
import { defaultSoundSettings } from '@app/shared/sound';
import type { Rating, ReviewItem, LearnerSettings } from '@app/shared/types';
import type { LearningAdvance } from '@app/shared/learning';
import { matchesPreparedAnswer } from '@app/shared/answers';
import { EditorBridge, type Rect, type JapaneseValue } from './canvas';
import { ConnectedFlow, liveCatalog } from './connected-flow';
import { ReviewFlow } from './review-flow';
import { StudySurface, type StudyAction, type StudyChoice } from './study-surface';
import { albumPages, paintScene, prototypeLayout, type SceneTextures } from './prototype-layouts';
import { AlbumLeaf, liftAlbumPage } from './album-leaf';
import { renderReviewOverview } from './album-review';
import { renderAlbumMenu } from './album-menu';
import { renderBookShelf } from './album-books';
import { booksFor, bookForLesson, lessonBookId, lessonAvailability, starterBookId } from '@app/shared/books';
import { readBookNavigation, saveBookNavigation, type BookNavigation } from '../book-navigation';
import { contentPages, sectionCards, woodenTab } from './album-navigation';
import { M6Companion } from './m6-companion';
import { M6Events } from './m6-events';
import { LivingScene, sceneNames } from './m6-scenes';
import { chooseScene, sceneIds, type SceneId } from '@app/client/scenes';
import neutralUrl from '../../../assets/canvas/m6-repertoire-v1/neutral.webp';
import { renderAlbumRecall } from './album-recall';
import { renderAlbumIntro } from './album-intro';
import { videoCaption } from '@app/client/videoCaptions';
import { renderReading } from './album-reading';
import { AccessFlow, AdminAccess, renderAdminAccess, type AccessMode } from './album-access';
import { renderFullSettings, storeSettings, pendingSettings } from './album-settings';
import { KanaFlow } from './kana-flow';
import { renderKana } from './album-kana';
import { catalogFor } from '@app/shared/catalog';
import { AlbumReference, renderReference } from './album-reference';
import { personalCommands } from './personal-commands';
import { AlbumLibrary, renderBook } from './album-book';
import type { TrainingContext, LessonVideo } from '@app/shared/types';
import { AlbumWorkspace, renderWorkspace } from './album-workspace';
import { CounterPictures } from './counter-pictures';
import { renderCounterCard, newCounterDraft } from './album-counter';
import { readRecallDraft, writeRecallDraft, recallDraftKey } from '@app/client/guidedApi';
import { misplacedTokens } from './builder-mistakes';
import roomUrl from '../../../assets/canvas/runtime/room-stand.webp';
import standUrl from '../../../assets/canvas/runtime/stand.webp';
import paperUrl from '../../../assets/canvas/runtime/plain-paper.webp';
import catUrl from '../../../assets/canvas/runtime/cat.webp';
import logoUrl from '../../../assets/canvas/runtime/logo.webp';
import './paper.css';
import './connected-album.css';

const host = document.querySelector<HTMLElement>('#stage')!, recovery = document.querySelector<HTMLElement>('#recovery')!;
let app = new Application();
const world = new Container(), ui = new Container();
const flow = new ConnectedFlow(schedule), review = new ReviewFlow<ReviewItem>(schedule);
const access = new AccessFlow(schedule), admin = new AdminAccess(schedule), settingsView = { offset: 0, volume: null as keyof typeof import('./album-settings').volumeLabels | null, level: 0 };
const kana = new KanaFlow(schedule), kanaView = { offset: 0 };
const library = new AlbumLibrary(schedule), reference = new AlbumReference(library, schedule);
const referenceFields = new Map<string, EditorBridge>(), referenceCallbacks = new Map<string, (value: string) => void>();
let libraryInput: ((value: string) => void) | null = null, trainingContext: TrainingContext | undefined, grammarContext: TrainingContext | undefined;
const grammar = new ReviewFlow<Extract<ReviewItem, { mode: 'grammar' }>>(schedule);
const counterArt = new CounterPictures(schedule);
const counters = new ReviewFlow<Extract<ReviewItem, { mode: 'counter' }>>(schedule);
let counterDraft = newCounterDraft();
let workspace: AlbumWorkspace | null = null, workspaceInput: ((value: string) => void) | null = null;
let soundState = 'paused';
const newSound = () => new SceneSoundController(value => { if (value !== soundState) { soundState = value; schedule(); } }, '/m6/audio/manifest.json');
let sound = newSound();
const audio = new Audio(), video = document.createElement('video');
const m6Events = new M6Events();
const requestedScene = new URLSearchParams(location.search).get('scene');
let chosenScene: SceneId = sceneIds.includes(requestedScene as SceneId) ? requestedScene as SceneId : chooseScene();
let environment: LivingScene, decorFrame = 0, decorTicks = 0, decorPrevious = 0;
const decorDeltas: number[] = [], renderSubmit: number[] = [];
const percentile95 = (values: number[]) => { const sorted = [...values].sort((a, b) => a - b); return sorted[Math.floor((sorted.length - 1) * .95)] ?? 0; };
video.className = 'native-video'; video.playsInline = true; video.preload = 'none'; video.hidden = true; host.append(video);
const email = new EditorBridge('email', schedule), password = new EditorBridge(true, schedule), editor = new EditorBridge(false, schedule);
editor.element.addEventListener('input', () => { flow.revise(); workspaceInput?.(editor.element.value); libraryInput?.(editor.element.value); });
email.element.setAttribute('aria-label', 'Электронная почта'); password.element.setAttribute('aria-label', 'Пароль'); password.element.autocomplete = 'current-password'; email.element.name = 'email'; password.element.name = 'password'; email.element.autocapitalize = 'none'; email.element.setAttribute('autocorrect', 'off');
const accessName = new EditorBridge(false, schedule); accessName.element.lang = 'ru'; accessName.element.setAttribute('autocomplete', 'nickname'); accessName.element.setAttribute('aria-label', 'Имя в приложении'); accessName.element.maxLength = 100; accessName.element.addEventListener('input', () => { access.name = accessName.element.value; }); email.element.addEventListener('input', () => { if (access.mode) access.email = email.element.value; });
const placedFields = new Set<EditorBridge>();
let keyboardOffset = 0, keyboardFrame = 0;
function keepEditorsVisible() {
  const viewport = window.visualViewport, active = document.activeElement;
  let offset = 0;
  if (ready && !suspended && viewport && Math.abs(viewport.scale - 1) < .01 && viewport.height < innerHeight - 1 && active instanceof HTMLElement && active.matches('.native-editor:not([hidden])') && host.contains(active)) {
    const focused = active.getBoundingClientRect(), fields = [...placedFields].map(field => field.element.getBoundingClientRect());
    let top = Math.min(focused.top, ...fields.map(rect => rect.top)), bottom = Math.max(focused.bottom, ...fields.map(rect => rect.bottom));
    if (bottom - top > viewport.height - 32) { top = focused.top; bottom = focused.bottom; }
    // Undo our previous translation before accounting for Safari's own viewport pan.
    top -= keyboardOffset; bottom -= keyboardOffset;
    offset = Math.round(Math.max(viewport.offsetTop + 16 - top, Math.min(0, viewport.offsetTop + viewport.height - 16 - bottom)));
  }
  const moved = keyboardOffset !== offset;
  keyboardOffset = offset;
  host.style.translate = offset ? `0 ${offset}px` : '';
  if (moved && ready && !contextLost && !suspended) app.render();
}
function queueKeyboardPosition() {
  if (!keyboardFrame) keyboardFrame = requestAnimationFrame(() => { keyboardFrame = 0; keepEditorsVisible(); });
}
host.addEventListener('focusin', queueKeyboardPosition); host.addEventListener('focusout', queueKeyboardPosition);
window.visualViewport?.addEventListener('resize', queueKeyboardPosition); window.visualViewport?.addEventListener('scroll', queueKeyboardPosition);
const transcript = document.createElement('p'); transcript.className = 'semantic-copy'; transcript.setAttribute('aria-live', 'polite'); host.append(transcript);
let desktopMenu: 'practice' | 'album' = 'practice';
let reviewStarted = false;
let menuOpen = false, renderCount = 0, displayedOwner: string | null = null;
let suspended = false;
let ready = false, frame = 0, page: 'practice' | 'lessons' | 'lesson' | 'review' | 'counters' | 'grammar' | 'book' | 'reference' | 'kana' | 'library-video' | 'admin' | 'settings' = 'lessons';
let view: ReturnType<typeof prototypeLayout>, scene: ReturnType<typeof paintScene>, surface: StudySurface, textures: SceneTextures;
let leaf: AlbumLeaf, companion: M6Companion;
let key = '', heard = false, mediaError = '', revealed = false, selected: string | null = null, wrong: string[] = [], order: number[] = [], bad: string[] = [], correct: boolean | null = null, manual = false;
let speechActive = false, mediaOwner: 'speech' | 'video' | null = null;
let mediaEpoch = 0, notice = '', settings: LearnerSettings | null = null, settingsBusy = false, contextLost = false;
let autoPlayedKey = '';
let lastAttempt = '', lastGuided: { attemptId: string; kind: 'good' | 'again' } | null = null;
const noticeReading = { scroll: 0 }; let renderedNotice = '';
let preview: { width: number; height: number } | null = null;
const box = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const heldPointers = new Set<number>();
const lessonPages = { page: 0 };
let bookNavigation: BookNavigation = { bookId: starterBookId, places: {} };
let shelfOpen = false, requestedFocus: string | null = null, bookReturnFocus: string | null = null;
const shelfPages = { offset: 0 };
function savePlace() {
  if (!flow.user) return;
  bookNavigation.places[bookNavigation.bookId] = { ...bookNavigation.places[bookNavigation.bookId], page: lessonPages.page };
  saveBookNavigation(flow.user.id, bookNavigation);
}
function rememberLesson(id: string) {
  const lesson = flow.course?.lessons.find(value => value.id === id);
  if (!lesson) return;
  savePlace(); bookNavigation.bookId = lessonBookId(lesson);
  lessonPages.page = bookNavigation.places[bookNavigation.bookId]?.page ?? 0;
  bookNavigation.places[bookNavigation.bookId] = { page: lessonPages.page, lessonId: id };
  savePlace();
}
const busy = () => flow.busy || review.busy || grammar.busy || counters.busy || library.busy || reference.busy || kana.busy || access.busy || admin.busy || settingsBusy;
const reviewWord = () => { const item = review.item; return item && 'word' in item ? item : undefined; };
const reviewCounter = () => review.item?.mode === 'counter' ? review.item : undefined;
const activeCounter = () => page === 'review' ? reviewCounter() : counters.item;
const listening = () => page === 'counters' || page === 'review' && reviewStarted ? activeCounter()?.counter.kind === 'listening-image' || page === 'review' && reviewWord()?.mode === 'listening' : page === 'lesson' && (flow.step && 'mode' in flow.step && flow.step.mode === 'listening' || flow.counter?.kind === 'listening-image');
const counterRecall = () => ((page === 'counters' || page === 'review' && reviewStarted) && activeCounter()?.counter.kind === 'recall' && activeCounter()?.preparation?.introduced !== false && !!(page === 'review' ? review.course : counters.course) && counterArt.ready(catalogFor((page === 'review' ? review.course : counters.course)!)) || page === 'lesson' && flow.counter?.kind === 'recall' && !!flow.course && counterArt.ready(catalogFor(flow.course))) && !counterDraft.rule && !(page === 'lesson' && flow.counterNeedsIntro);
const isRecall = () => counterRecall() || page === 'review' && reviewStarted && !!reviewWord() && !reviewWord()?.choices?.length || page === 'lesson' && (flow.recall && flow.step?.kind !== 'construction-practice' || flow.step?.kind === 'construction-practice' && flow.step.mode !== 'grammar');
const isRevealed = () => counterRecall() ? counterDraft.revealed : page === 'lesson' && flow.recall ? flow.draft.revealed : revealed;
const allowed = (rating: Rating) => ready && !contextLost && !suspended && !menuOpen && !busy() && !flow.error && !(page === 'review' && (review.saveError || review.pending)) && !(page === 'counters' && (counters.saveError || counters.pending)) && isRevealed() && (!listening() || heard && !mediaError);
function feedbackForPage() { return page === 'review' ? review.last : page === 'counters' ? counters.last : page === 'grammar' ? grammar.last : page === 'kana' ? kana.last : page === 'lesson' ? flow.feedback : null; }
function presentationPlan() {
  const done = page === 'lesson' ? flow.state?.completed : page === 'review' ? review.total > 0 && review.completed >= review.total && !review.item : page === 'grammar' ? grammar.total > 0 && grammar.completed >= grammar.total && !grammar.item : page === 'counters' ? counters.total > 0 && counters.completed >= counters.total && !counters.item : page === 'kana' ? kana.total > 0 && kana.completed >= kana.total && !kana.item : false;
  const scope = `${page}:${page === 'lesson' ? flow.state?.lessonId : page === 'kana' ? kana.sessionId : ''}`;
  const active = page === 'lesson' ? !!flow.state && flow.active : page === 'review' ? review.total > 0 && !!review.item : page === 'grammar' ? grammar.total > 0 && !!grammar.item : page === 'counters' ? counters.total > 0 && !!counters.item : page === 'kana' ? kana.active && !!kana.item : false;
  const confirmed = !busy() && !flow.error && !(page === 'review' ? review.saveError : page === 'counters' ? counters.saveError : page === 'grammar' ? grammar.saveError : kana.error && page === 'kana');
  return { scope, active: !!active && confirmed, done: !!done && confirmed };
}
function schedule() {
  if ((!ready || contextLost || suspended || document.hidden) && flow.user?.id === m6Events.owner) {
    const feedback = feedbackForPage(); if (feedback && feedback.attemptId !== lastAttempt) { m6Events.saved(feedback); lastAttempt = feedback.attemptId; }
    const plan = presentationPlan(), completion = m6Events.observePlan(plan.scope, plan.active, plan.done); if (completion) m6Events.complete(completion);
  }
  if (!ready || contextLost || suspended || heldPointers.size || leaf?.busy) return;
  if (!frame) frame = requestAnimationFrame(() => { frame = 0; if (!leaf?.busy) draw(); });
}
function mediaPriority(active: boolean) { sound.setSpeechPlaying(active); companion?.setSpeech(active); }
function stopMedia() { ++mediaEpoch; mediaOwner = null; speechActive = false; mediaError = ''; audio.pause(); video.pause(); mediaPriority(false); }
function changedCard() {
  const next = page === 'grammar' ? `grammar:${grammar.turn}:${grammar.item?.id}` : page === 'kana' ? `kana:${kana.sessionId}:${kana.turn}` : page === 'counters' ? `counters:${counters.turn}:${counters.item?.id}` : page === 'review' ? `review:${review.turn}:${review.item?.id}` : page === 'lesson' ? `lesson:${flow.snapshot().version}:${flow.step?.id}` : key;
  if (next === key) return;
  key = next; workspace = null; workspaceInput = null; counterDraft = newCounterDraft(); if (page === 'lesson' && flow.counter && flow.user && flow.state) { const stored = readRecallDraft(recallDraftKey(flow.user.id, flow.state)); counterDraft.helped = stored.helped; counterDraft.revealed = stored.revealed; } stopMedia(); heard = false; mediaError = ''; revealed = false; selected = null; wrong = []; bad = []; order = []; correct = null; manual = false; editor.element.value = ''; notice = '';
  if (page === 'lesson' && flow.recall && flow.draft.tokenIds) order = flow.draft.tokenIds.map(id => flow.construction!.tokens.findIndex(token => token.id === id)).filter(i => i >= 0);
}
async function play(url?: string | null, automatic = false) {
  if (!url) { mediaError = 'Запись недоступна. Попробуйте позже.'; schedule(); return; }
  const epoch = ++mediaEpoch; video.pause(); audio.pause(); mediaOwner = 'speech'; speechActive = true; mediaError = ''; prepareCardAudio(audio, url); audio.currentTime = 0; audio.volume = settings?.speechVolume ?? 1; mediaPriority(true); schedule();
  try { await audio.play(); if (epoch === mediaEpoch && mediaOwner === 'speech' && !document.hidden) heard = true; }
  catch (error) { if (epoch === mediaEpoch && mediaOwner === 'speech') { mediaOwner = null; speechActive = false; mediaPriority(false); mediaError = automatic && error instanceof DOMException && error.name === 'NotAllowedError' ? '' : 'Не удалось включить запись. Нажмите «Прослушать» ещё раз.'; } }
  schedule();
}
function prepareCurrentAudio() {
  if (menuOpen || page === 'review' && !reviewStarted || document.hidden || busy() || mediaOwner || flow.error) return;
  const word = page === 'review' ? reviewWord()?.word : page === 'lesson' ? flow.word : null;
  const url = word && 'audioUrl' in word ? word.audioUrl : page === 'lesson' ? flow.construction?.example.audioUrl : undefined;
  if (!url) return;
  prepareCardAudio(audio, url);
  const next = page === 'lesson' ? flow.part?.words.slice((flow.session?.introIndex ?? 0) + 1, (flow.session?.introIndex ?? 0) + 3).map(intro => liveCatalog.words.find(value => value.id === intro.wordId)?.audioUrl) ?? [] : review.queue.slice(1, 3).map(item => 'word' in item ? item.word.audioUrl : undefined);
  warmCardAudio([page === 'lesson' ? flow.introduction?.example.audioUrl : undefined, ...next]);
  if (listening() && autoPlayedKey !== key) { autoPlayedKey = key; void play(url, true); }
}
for (const name of ['ended', 'pause']) audio.addEventListener(name, () => { if (mediaOwner === 'speech' && (audio.paused || audio.ended)) { mediaOwner = null; speechActive = false; mediaPriority(false); } });
audio.addEventListener('error', () => { if (speechActive && mediaOwner === 'speech' && audio.error) { heard = false; mediaError = 'Запись не загрузилась. Повторите прослушивание.'; mediaOwner = null; speechActive = false; mediaPriority(false); schedule(); } });
async function playVideo() {
  const epoch = ++mediaEpoch; audio.pause(); speechActive = false; mediaOwner = 'video'; mediaPriority(true);
  try { await video.play(); } catch { if (epoch === mediaEpoch && mediaOwner === 'video') { mediaOwner = null; mediaPriority(false); mediaError = 'Видео недоступно. Повторите или откройте источник.'; } } schedule();
}
video.addEventListener('play', () => { if (!document.hidden && !video.hidden) { audio.pause(); mediaOwner = 'video'; mediaPriority(true); } });
for (const name of ['pause', 'ended']) video.addEventListener(name, () => { if (mediaOwner === 'video' && (video.paused || video.ended)) { mediaOwner = null; mediaPriority(false); } });
function savedFeedback(value: { attemptId: string; kind: 'good' | 'again' }) { if (companion.saved(value) && !document.hidden && !contextLost && !suspended) sound.cue(value.kind, value.attemptId); }
function reveal() {
  if (!ready || contextLost || suspended || busy() || document.hidden || listening() && (!heard || mediaError)) return;
  if (counterRecall()) { counterDraft.revealed = true; persistCounterDraft(); } else if (page === 'lesson' && flow.recall) flow.reveal(); else revealed = true;
  sound.cue('reveal', key); companion.update(`${key}:reveal`, 'revealed'); schedule();
}
async function advance(action: LearningAdvance['action'], details: Partial<LearningAdvance> = {}) {
  const ticket = flow.ticket(), before = key;
  const result = await flow.advance(ticket, action, details);
  if (result && page === 'lesson' && before === key) {
    lastGuided = flow.feedback;
    // The draw consumes validated feedback after binding the current card scope.
  }
  schedule();
}
function acceptGrade(rating: Rating) {
  if (!allowed(rating) || document.hidden) return false;
  const owner = flow.user!.id;
  if (page === 'counters' || page === 'review' && reviewCounter()) { const item = activeCounter()!; void (page === 'review' ? review : counters).save({attemptId:crypto.randomUUID(),reviewId:item.id,version:item.version,publicationId:item.publicationId,mode:'counter',rating,helped:counterDraft.helped}); try { return pendingReviews(owner).some(value=>value.reviewId===item.id&&value.version===item.version); } catch { return false; } }
  if (page === 'review') {
    const item = review.item!; void review.grade(owner, rating);
    try { return pendingReviews(owner).some(value => value.reviewId === item.id && value.version === item.version); } catch { return false; }
  }
  const state = flow.state!; void advance(rating === 1 ? 'again' : 'remember', {rating,...(flow.counter ? {helped:counterDraft.helped} : {})});
  try { return pendingLearning(owner).some(value => value.lessonId === state.lessonId && value.submission.stateVersion === state.version && value.submission.stepId === state.step!.id); } catch { return false; }
}
function gradeActions(): StudyAction[] {
  const item = page === 'lesson' ? flow.state?.reviewItem : review.item;
  return ratingOptions(item?.schedule).map(option => ({...option, fontSize: 14, accessibleLabel: `${option.label}, ${option.interval}`, enabled: allowed(option.rating) && (option.rating === 1 || page !== 'lesson' || !flow.draft.helped), run: () => { acceptGrade(option.rating); }}));
}
function safe(action: StudyAction): StudyAction { const ticket = flow.ticket(), turn = review.turn, counterTurn = counters.turn, grammarTurn = grammar.turn, kanaTurn = kana.turn, currentPage = page; return { ...action, enabled: action.enabled !== false && !busy(), run: () => { if (ready && !contextLost && !suspended && !busy() && !document.hidden && page === currentPage && counters.turn === counterTurn && grammar.turn === grammarTurn && kana.turn === kanaTurn && ticket.stepId === flow.ticket().stepId && ticket.revision === flow.ticket().revision && turn === review.turn) { sound.unlock(flow.user ? chosenScene : undefined); action.run(); } } }; }
function footer(actions: StudyAction[]) { surface.footer(actions.map(safe)); }
function message(title: string, detail: string, actions: StudyAction[]) {
  const pages = contentPages(surface), a = pages[0]!, titleHeight = surface.measure(title, a.width - 24, 24), height = surface.measure(detail, a.width - 24, 18);
  const y = a.y + 24;
  surface.text(title, box(a.x + 12, y, a.width - 24, titleHeight), 24);
  surface.text(detail, box(a.x + 12, y + titleHeight + 22, a.width - 24, height), 18);
  if (pages.length > 1 && actions.length) {
    const right = pages[1]!;
    actions.forEach((action, index) => surface.action(safe(action), box(right.x, right.y + 24 + index * 66, right.width, 56), false, 18));
  } else footer(actions);
}
function nativeField(bridge: EditorBridge, rect: Rect, placeholder: string) {
  placedFields.add(bridge); if (bridge === editor) bridge.element.setAttribute('aria-label', placeholder); bridge.draw(surface.root, rect, placeholder);
  const r = host.getBoundingClientRect(), scale = r.width / app.screen.width;
  bridge.place({ ...rect, x: (rect.x + view.layout.paper.x) * scale, y: (rect.y + view.layout.paper.y) * scale, width: rect.width * scale, height: rect.height * scale });
}
async function signIn() {
  await flow.signIn(email.element.value, password.element.value);
  password.element.value = '';
  if (flow.user) { await loadSettings(); draw(); companion.react('entry'); } schedule();
}
async function loadSettings() {
  const owner = flow.user?.id; if (!owner) return;
  try { let next = await api<LearnerSettings>('/api/settings', { headers: learningHeaders(owner) }); const pending = pendingSettings(owner); if (pending) next = await storeSettings(owner, pending.value, next); if (flow.user?.id === owner) settings = next; }
  catch { if (flow.user?.id === owner) notice = 'Настройки временно недоступны.'; } schedule();
}
async function openLesson(id: string) { notice = ''; rememberLesson(id);
  stopMedia(); review.hide(); await flow.open(id); if (!flow.error) { page = 'lesson'; flow.start(); draw(); companion.react('entry'); history.replaceState(null, '', `?lesson=${encodeURIComponent(id)}`); } schedule();
}
function home() { if(page==='book')requestedFocus=bookReturnFocus; notice = ''; shelfOpen = false; menuOpen = false; stopMedia(); flow.active = false; review.hide(); grammar.hide(); counters.hide(); kana.hide(); page = 'lessons'; history.replaceState(null, '', location.pathname); schedule(); }
async function logout() { stopMedia(); sound.configure(settings ?? defaultSoundSettings, chosenScene, false, false); companion.quiet(); review.clear(); grammar.clear(); counters.clear(); page = 'lessons'; settings = null; await flow.logout(); schedule(); }
function openGrammar(context?: TrainingContext) { notice = ''; stopMedia(); review.hide(); counters.hide(); flow.active = false; menuOpen = false; page = 'grammar'; if (JSON.stringify(context) !== JSON.stringify(grammarContext)) grammar.clear(); grammarContext = context; grammar.active = true; if (!grammar.item && !grammar.pending) void grammar.open(flow.user!.id, 'grammar', context); schedule(); }
function openCounters() { notice = ''; stopMedia(); review.hide(); grammar.hide(); flow.active = false; menuOpen = false; page = 'counters'; counters.active = true; if (!counters.item && !counters.pending) void counters.open(flow.user!.id, 'counter', {counters:true}); schedule(); }
function openAdmin() { notice = ''; stopMedia(); review.hide(); grammar.hide(); counters.hide(); flow.active = false; menuOpen = false; page = 'admin'; if (flow.user?.isAdmin) void admin.load(flow.user.id); schedule(); }
function openKana() { notice = ''; stopMedia(); review.hide(); grammar.hide(); counters.hide(); flow.active = false; menuOpen = false; page = 'kana'; void kana.boot(flow.user!.id, catalogFor(flow.course!)); schedule(); }
function referenceField(id: string, rect: Rect, value: string, placeholder: string, changed: (value: string) => void, readOnly = false) {
  let field = referenceFields.get(id); if (!field) { field = new EditorBridge(false, schedule); field.element.addEventListener('input', () => referenceCallbacks.get(id)?.(field!.element.value)); referenceFields.set(id, field); }
  referenceCallbacks.set(id, changed); field.element.setAttribute('aria-label', placeholder); field.element.readOnly = reference.busy || admin.busy || readOnly; if (!field.composing && field.element.value !== value) field.element.value = value;
  if (id === 'text') field.element.maxLength = 30000;
  nativeField(field, rect, placeholder);
}
function openReference(lists = false) { notice = ''; stopMedia(); review.hide(); grammar.hide(); counters.hide(); flow.active = false; menuOpen = false; page = 'reference'; try { reference.bind(flow.user!.id); if (lists) reference.section = 'lists'; if (personalCommands(flow.user!.id).length) void reference.save(); else void library.load(flow.user!.id); } catch (error) { reference.error = error instanceof Error ? error.message : 'Черновик недоступен.'; } schedule(); }
function openBook(lessonId?: string) { bookReturnFocus=surface?.controls.find(control=>control.id==='lesson:'+lessonId)?.accessibleLabel??null; notice = ''; if (lessonId) { savePlace(); const lesson = flow.course?.lessons.find(value => value.id === lessonId); if (lesson) bookNavigation.bookId = lessonBookId(lesson); history.replaceState(null, '', `?lesson=${encodeURIComponent(lessonId)}`); if (library.owner !== flow.user!.id) { library.clear(); library.owner = flow.user!.id; } library.lessonId = lessonId; library.tab = 'overview'; library.detail = ''; library.search = ''; library.offset = 0; } stopMedia(); review.hide(); grammar.hide(); counters.hide(); flow.active = false; menuOpen = false; page = 'book'; void library.load(flow.user!.id); schedule(); }
function libraryField(rect: Rect, value: string, changed: (value: string) => void) { libraryInput = changed; if (!editor.composing && editor.element.value !== value) editor.element.value = value; nativeField(editor, rect, 'Поиск'); }
function beginTraining(context: TrainingContext) { notice = ''; stopMedia(); flow.active = false; review.clear(); trainingContext = context; reviewStarted = true; page = 'review'; schedule(); }
function openLibraryVideo(material: LessonVideo) { stopMedia(); library.video = material; mediaError = ''; page = 'library-video'; schedule(); }
function renderLibraryVideo() { renderVideoPlayer(library.video ?? undefined, false); }
let captionTrack: TextTrack | undefined;
function renderVideoPlayer(material: LessonVideo | undefined, guided: boolean) {
  const a = surface.body;
  if (!material) { message('Видео недоступно', 'Вернитесь к материалам и попробуйте ещё раз.', [{ id: 'video-back', text: 'Назад', run: guided ? () => void advance('skip') : openBook }]); return; }
  if (video.getAttribute('src') !== material.mediaUrl) {
    video.src = material.mediaUrl; video.preload = 'metadata'; video.load();
    captionTrack ??= video.addTextTrack('captions', '日本語', 'ja');
    for (const cue of Array.from(captionTrack.cues ?? [])) captionTrack.removeCue(cue);
    for (const cue of material.captions) if (cue.text && cue.endSeconds !== null) {
      const text = videoCaption(material, cue.startSeconds);
      captionTrack.addCue(new VTTCue(cue.startSeconds, cue.endSeconds, (text.learner ? 'Ваша реплика: ' : '') + cue.text));
    }
    captionTrack.mode = 'hidden';
  }
  const frame = view.prompt ?? a, titleSize = a.height < 240 ? 14 : 17;
  const titleHeight = surface.measure(material.title, frame.width - 16, titleSize);
  surface.text(material.title, { x: frame.x + 8, y: frame.y, width: frame.width - 16, height: titleHeight }, titleSize);
  const h = Math.max(44, Math.min(frame.width * 9 / 16, frame.height - titleHeight - (view.prompt ? 14 : 172)));
  const r = host.getBoundingClientRect(), scale = r.width / app.screen.width;
  video.volume = settings?.speechVolume ?? 1; video.setAttribute('aria-label', material.title); video.hidden = false;
  Object.assign(video.style, { left: `${(frame.x + view.layout.paper.x) * scale}px`, top: `${(frame.y + titleHeight + 8 + view.layout.paper.y) * scale}px`, width: `${frame.width * scale}px`, height: `${h * scale}px` });
  const controlsY = view.prompt ? a.y : frame.y + titleHeight + h + 18;
  surface.row([
    { id: 'video-rewind', text: '−10 с', fontSize: 15, run: () => { video.currentTime = Math.max(0, video.currentTime - 10); schedule(); } },
    { id: guided ? 'video-play' : 'library-video-play', text: video.paused ? '▶' : 'Пауза', accessibleLabel: video.paused ? 'Воспроизвести видео' : 'Приостановить видео', fontSize: 16, run: () => { if (video.paused) { if (mediaError) { video.load(); mediaError = ''; } void playVideo(); } else video.pause(); schedule(); } },
    { id: 'video-forward', text: '+10 с', fontSize: 15, run: () => { if (Number.isFinite(video.duration)) video.currentTime = Math.min(video.duration, video.currentTime + 10); schedule(); } },
  ].map(safe), { x: a.x, y: controlsY, width: a.width, height: 44 });
  const cue = video.ended ? {text:null,learner:false} : videoCaption(material, video.currentTime);
  const label = a.height < 240 ? cue.learner ? 'Ваша реплика' : 'Субтитры' : cue.learner ? 'Ваша реплика · произнесите вслух' : material.variant === 'challenge' ? 'Диалог · отвечайте в свою очередь' : 'Диалог · японские субтитры';
  const labelHeight = surface.measure(label, a.width - 16, 14);
  surface.text(label, { x: a.x + 8, y: controlsY + 52, width: a.width - 16, height: labelHeight }, 14, false, true).style.fill = cue.learner ? '#304d30' : '#715638';
  const text = cue.text ?? (material.variant === 'challenge' ? 'Во время вашей реплики здесь появится образец ответа.' : 'Текст появится вместе с репликой.');
  const top = controlsY + 58 + labelHeight, available = a.y + a.height - top - 4;
  let size = cue.text ? 22 : 15;
  while (size > 14 && surface.measure(text, a.width - 24, size, !!cue.text) > available) size--;
  const textHeight = surface.measure(text, a.width - 24, size, !!cue.text);
  surface.text(text, { x: a.x + 12, y: top, width: a.width - 24, height: Math.max(0, available) }, size, !!cue.text, true);
  footer([
    { id: guided ? 'video-skip' : 'library-video-back', text: guided ? 'Дальше →' : 'Каталог', accessibleLabel: guided ? 'Продолжить урок' : 'Вернуться к каталогу видео', fontSize: 14, run: () => { stopMedia(); if (guided) void advance('skip'); else {page = 'book'; schedule();} } },
    { id: 'library-video-source', text: 'Сайт', accessibleLabel: 'Открыть источник видео', fontSize: 14, run: () => { if (new URL(material.sourceUrl).protocol === 'https:') window.open(material.sourceUrl, '_blank', 'noopener,noreferrer'); } },
    { id: 'library-video-fullscreen', text: 'На экран', fontSize: 14, run: () => { const ios = video as HTMLVideoElement & {webkitEnterFullscreen?:()=>void}; if (ios.webkitEnterFullscreen) ios.webkitEnterFullscreen(); else void video.requestFullscreen?.().catch(() => {mediaError='Полный экран недоступен.';schedule();}); } },
  ]);
}
const syncCaptionMode = () => { if(captionTrack) captionTrack.mode = document.fullscreenElement === video ? 'showing' : 'hidden'; };
document.addEventListener('fullscreenchange', syncCaptionMode);
video.addEventListener('webkitbeginfullscreen', () => {if(captionTrack)captionTrack.mode='showing';});
video.addEventListener('webkitendfullscreen', () => {if(captionTrack)captionTrack.mode='hidden';});
for (const event of ['timeupdate', 'seeked', 'loadedmetadata', 'ended']) video.addEventListener(event, () => { if (!document.hidden && !video.hidden) schedule(); });
video.addEventListener('error', () => { if (mediaOwner === 'video' && video.error && !video.hidden && (page === 'library-video' || page === 'lesson' && flow.step?.kind === 'video')) { mediaOwner = null; mediaPriority(false); mediaError = 'Видео не загрузилось. Повторите или вернитесь к каталогу.'; schedule(); } });
function topNavigation() {
  const a = surface.layout.content, compactLandscape = view.low && view.width < 700, y = view.low ? -5 : !view.wide && view.height < 650 ? -12 : -72;
  const actions: StudyAction[] = [
    { id: 'home', text: 'Разделы', run: () => { menuOpen = !menuOpen; schedule(); } },
    { id: 'reviews', text: 'Повторение', run: openReviewMenu },
      { id: 'settings', text: 'Настройки', run: () => { notice = ''; menuOpen = false; stopMedia(); page = 'settings'; schedule(); } },
    { id: 'logout', text: 'Выход', run: () => void logout() },
  ];
  const x = !view.wide && !view.low ? Math.max(a.x, 108 - view.layout.paper.x) : a.x;
  const width = a.width - (x - a.x), gap = 6;
  if (view.wide) {
    const left = view.prompt!, start = left.x + 142, available = a.x + a.width - start;
    const entries: StudyAction[] = [
      { id: 'album-lessons', text: 'Уроки', selected: ['lessons', 'lesson', 'book', 'library-video'].includes(page) && !menuOpen, run: home },
      { id: 'reviews', text: 'Повторение', selected: page === 'review' && !menuOpen, run: openReviewMenu },
      { id: 'practice-menu', text: 'Тренажёры ▾', selected: menuOpen ? desktopMenu === 'practice' : ['practice', 'counters', 'kana', 'grammar'].includes(page), run: openPracticeMenu },
      { id: 'reference', text: 'Справочник', selected: page === 'reference' && !menuOpen, run: () => openReference() },
    ];
    const cell = (available - 100 - 6 * 6) / entries.length;
    entries.forEach((entry, i) => woodenTab(surface, textures.rail, safe(entry), box(start + i * (cell + 6), y, cell, 46), 14));
    woodenTab(surface, textures.rail, safe({ id: 'album-options', text: '⚙', accessibleLabel: 'Настройки и доступ', selected: menuOpen ? desktopMenu === 'album' : page === 'settings' || page === 'admin', run: () => { stopMedia(); menuOpen = !menuOpen || desktopMenu !== 'album'; desktopMenu = 'album'; schedule(); } }), box(a.x + a.width - 94, y, 44, 46), 18);
    woodenTab(surface, textures.rail, { id: 'logout', text: '↪', accessibleLabel: 'Выйти из аккаунта', run: () => void logout() }, box(a.x + a.width - 44, y, 44, 46), 18);
    if (menuOpen) renderPracticeMenu();
    return;
  }
  if (!view.wide && !view.low || compactLandscape) {
    woodenTab(surface, textures.rail, safe({ id: 'nav-menu', text: page === 'lesson' ? `${flow.progress().percent}% · Меню` : page === 'review' && review.item ? `Осталось ${review.queue.length}` : 'Разделы', accessibleLabel: 'Открыть разделы', run: () => { stopMedia(); menuOpen = !menuOpen; schedule(); } }), box(x, y, width - 54, 44), 16);
    woodenTab(surface, textures.rail, { id: 'logout', text: '↪', accessibleLabel: 'Выйти из аккаунта', run: () => void logout() }, box(x + width - 44, y, 44, 44), 18);
  } else {
    const cell = (width - gap * 3) / 4;
    actions.forEach((action, i) => woodenTab(surface, textures.rail, action.id === 'logout' ? action : safe(action.id === 'settings' ? { ...action, text: '⚙', accessibleLabel: 'Настройки' } : action), box(x + i * (cell + gap), y, cell, 44), 14));
  }
  if (menuOpen) {
    sectionCards(surface, 'Разделы', 'Учиться, повторять, тренироваться', [
      { id: 'home', text: 'Уроки', description: 'Занятия, словарь и видео', run: home },
      { id: 'reviews', text: 'Повторение', description: 'Изученное по расписанию', run: openReviewMenu },
      { id: 'practice-menu', text: 'Тренажёры', description: 'Азбуки и счёт', run: openPracticeMenu },
      { id: 'reference', text: 'Справочник', description: 'Изученное и личные списки', run: () => openReference() },
      ...(flow.user?.emailVerified===false?[{id:'confirm-email',text:'Подтвердить почту',description:'Для восстановления пароля',run:()=>openAccess('account')}]:[]),
      { id: 'settings', text: 'Настройки', run: () => { menuOpen = false; page = 'settings'; schedule(); } },
      ...(flow.user?.isAdmin ? [{ id: 'admin-access', text: 'Доступ учеников', run: openAdmin }] : []),
    ], safe);
    footer([{ id: 'menu-close', text: 'Закрыть меню', run: () => { menuOpen = false; schedule(); } }]);
  }
}
function openAccess(mode:AccessMode) { menuOpen=false;stopMedia();flow.error=''; password.element.value=''; email.element.readOnly=false; password.element.readOnly=false; access.open(mode,flow.user?.email??email.element.value,flow.user?.id); schedule(); }
async function finishAccess() { email.element.value=access.email; password.element.value=''; password.element.autocomplete='current-password'; access.login(); await flow.boot(); if(flow.user)await loadSettings(); schedule(); }
function renderLogin() {
  const a = surface.body, width = Math.min(a.width - 24, 420), x = a.x + (a.width - width) / 2, y = a.y + Math.max(0, (a.height - 228) / 2);
  surface.text('まるごと · Вход', box(x, y, width, 48), 24, false, true);
  nativeField(email, box(x, y + 60, width, 50), 'Электронная почта'); nativeField(password, box(x, y + 124, width, 50), 'Пароль');
  footer([{ id: 'sign-in', text: flow.busy ? 'Входим…' : 'Войти', run: () => void signIn() },{id:'register',text:'Регистрация',run:()=>openAccess('register')},{id:'forgot-password',text:'Забыли пароль?',run:()=>openAccess('forgot')}]);
}

function openPracticeMenu() { notice = ''; stopMedia(); review.hide(); grammar.hide(); counters.hide(); kana.hide(); flow.active = false; menuOpen = false; page = 'practice'; schedule(); }
function renderPracticeMenu() {
  sectionCards(surface, 'Приложение', 'Настройки и управление доступом', [
    ...(flow.user?.emailVerified===false?[{id:'confirm-email',text:'Подтвердить почту',description:'Для восстановления пароля',run:()=>openAccess('account')}]:[]),
      { id: 'settings', text: 'Настройки', run: () => { menuOpen = false; page = 'settings'; schedule(); } },
    ...(flow.user?.isAdmin ? [{ id: 'admin-access', text: 'Доступ учеников', run: openAdmin }] : []),
  ], safe);
}
function renderTrainers() {
  sectionCards(surface, 'Тренажёры', 'Выберите навык для самостоятельного занятия', [
    { id: 'kana', text: 'Хирагана и катакана', description: 'Знаки, чтение и повтор ошибок', run: openKana },
    { id: 'counters', text: 'Счётные суффиксы', description: 'Учимся считать знакомые предметы', run: openCounters },
  ], safe);
}
function openReviewMenu() {
  notice = ''; menuOpen = false; stopMedia(); flow.active = false; grammar.hide(); counters.hide(); kana.hide(); page = 'review';
  if (trainingContext) { review.clear(); trainingContext = undefined; }
  review.active = true;
  if (!review.item && !review.pending) { reviewStarted = false; void review.open(flow.user!.id, 'mixed'); }
  else void review.refreshDue();
  schedule();
}
function renderLessons() {
  const course = flow.course; if (!course) return;
  const books = booksFor(course), book = books.find(value => value.id === bookNavigation.bookId) ?? books[0]!;
  if (shelfOpen) { renderBookShelf(surface, books, book.id, shelfPages, {
    safe, changed: schedule, close: () => { shelfOpen = false; requestedFocus = `${book.shortTitle} · Выбрать учебник`; schedule(); },
    choose: id => { savePlace(); bookNavigation.bookId = id; lessonPages.page = bookNavigation.places[id]?.page ?? 0; shelfOpen = false; savePlace(); requestedFocus = `${books.find(value => value.id === id)!.shortTitle} · Выбрать учебник`; schedule(); },
  }); return; }
  const lessons = course.lessons.filter(lesson => lessonBookId(lesson) === book.id).map(lesson => ({ ...lesson, availability: lessonAvailability(course, lesson), ...flow.progress(lesson.id), parts: flow.lessonStages(lesson.id) }));
  const saved = lessons.find(lesson => lesson.id === bookNavigation.places[book.id]?.lessonId && lesson.availability==='full' && !lesson.finished);
  renderAlbumMenu(surface, view, lessonPages, {
    lessons, book, continueLesson: saved ?? lessons.find(lesson => lesson.started && !lesson.finished),
    chooseBook: () => { savePlace(); shelfOpen = true; schedule(); },
    safe, changed: () => { savePlace(); schedule(); }, learn: id => openBook(id), confirmEmail: flow.user?.emailVerified===false ? ()=>openAccess('account') : undefined,
  });
}
function renderIntro() {
  const part = flow.part!, word = flow.word!, isWord = flow.step?.kind === 'word-intro';
  const explanation = isWord ? flow.introduction!.explanationRu : flow.construction!.explanationRu, example = isWord ? flow.introduction!.example : flow.construction!.example;
  renderAlbumIntro(surface, word, explanation, example, {
    prompt: view.prompt, page: introTab, changed: page => { introTab = page; schedule(); },
    wordAudio: safe({ id: 'intro-audio', text: '▶ Слово', accessibleLabel: isWord ? 'Прослушать слово' : 'Прослушать конструкцию', run: () => void play('audioUrl' in word ? word.audioUrl : example.audioUrl) }),
    exampleAudio: safe({ id: 'example-audio', text: '▶ Пример', accessibleLabel: 'Прослушать пример', run: () => void play(example.audioUrl) }),
  });
  footer(isWord ? [
    { id: 'intro-back', text: '←', enabled: flow.session!.introIndex > 0, run: () => { flow.introduce(flow.ticket(), -1); schedule(); } },
    { id: 'intro-next', text: flow.session!.introIndex < part.words.length - 1 ? 'Дальше →' : 'К практике →', run: () => { if (flow.session!.introIndex < part.words.length - 1) { flow.introduce(flow.ticket(), 1); schedule(); } else void advance('start-practice'); } },
  ] : [{ id: 'intro-next', text: 'К практике →', run: () => void advance('continue') }]);
}
let introTab = 0;
const taskView = new TaskView();
function renderWordRecall() {
  const item = page === 'review' ? reviewWord()! : null, word = item?.word ?? flow.word!, mode = item?.mode ?? (flow.step as { mode: 'ja-ru' | 'ru-ja' | 'listening' }).mode;
  const shown = isRevealed(), draft = flow.recall && page === 'lesson' ? flow.draft : null;
  const choices = draft?.helped && !shown && flow.step?.kind === 'word-practice' ? flow.choices.map(value => ({ id: value.id, text: mode === 'ru-ja' ? value.surface : value.meaningRu, japanese: mode === 'ru-ja', wrong: wrong.includes(value.id), enabled: !busy() && (!listening() || heard && !mediaError), run: () => {} })) : undefined;
  const actions: StudyAction[] = shown ? gradeActions() : [
    { id: 'show-answer', text: 'Раскрыть', enabled: !listening() || heard && !mediaError, run: reveal },
    ...(flow.recall && page === 'lesson' && flow.step?.kind === 'word-practice' && !draft?.helped && flow.choices.length > 1 ? [{ id: 'hint', text: 'Подсказка', enabled: !listening() || heard && !mediaError, run: () => flow.hint() }] : []),
  ];
  renderAlbumRecall(surface, view, word, mode, shown, mode === 'ru-ja' && !shown ? null : { id: 'audio', text: view.prompt ? '▶ Прослушать' : '▶', accessibleLabel: 'Прослушать задание', run: () => void play('audioUrl' in word ? word.audioUrl : flow.construction?.example.audioUrl), bare: !view.prompt }, actions.map(safe), choices, id => { const result = flow.chooseRecall(id); selected = id; if (result === false && !wrong.includes(id)) wrong.push(id); schedule(); }, shown && draft?.helped ? 'Карточка вернётся на повтор' : undefined);
}
function renderOldWord() {
  const step = flow.step!; if (step.kind !== 'word-practice') return;
  const mode = step.mode, choices: StudyChoice[] = flow.choices.map(word => ({ id: word.id, text: mode === 'ru-ja' ? word.surface : word.meaningRu, japanese: mode === 'ru-ja', wrong: wrong.includes(word.id), selected: selected === word.id && correct === true, enabled: !busy() && (!listening() || heard && !mediaError), run: () => {} }));
  const plan = surface.quiz(correct === false ? 'Попробуйте другой вариант' : 'Выберите ответ', mode === 'listening' ? '♪' : mode === 'ru-ja' ? meaningDisplay(flow.word!).meaningRu : meaningDisplay(flow.word!).surface, choices, undefined, { question: view.prompt, alignQuestion: true, paper: false, titleSize: 16, ruby: mode === 'ja-ru' ? meaningDisplay(flow.word!) : undefined });
  surface.choices(choices, plan.choices, id => { void (async () => { const before = key, result = await flow.choose(id); if (before !== key || result === undefined) return; selected = id; correct = result; if (!result && !wrong.includes(id)) wrong.push(id); schedule(); })(); }, plan.columns, plan.size);
  if (listening()) surface.action(safe({ id: 'audio', text: '▶', run: () => void play('audioUrl' in flow.word! ? flow.word!.audioUrl : undefined) }), box(plan.question.x + plan.question.width - 48, plan.question.y + plan.question.height - 46, 44, 44));
  footer([{ id: 'old-next', text: 'Дальше →', enabled: correct === true, run: () => void advance('remember') }]);
}
function renderBuilder() {
  const context = page === 'grammar' ? grammarContext : undefined;
  const guided = page === 'lesson', session = page === 'review' ? review : grammar, item = guided ? flow.state?.reviewItem : session.item, course = guided ? flow.course : session.course;
  if (!item || item.mode !== 'grammar' || !course) { message('Практика конструкций', context?.listId ? 'Сначала подтвердите чтение и изучите слова списка в доступных форматах.' : 'Сейчас нет доступных заданий. Продолжите изучение конструкций в уроках.', [{id:'grammar-home',text:'К урокам',run:home}]); return; }
  if (!guided && item.preparation && !item.preparation.introduced) { message('Знакомство с конструкцией', item.skill.title + '\n' + item.skill.explanationRu, [{id:'grammar-intro',text:'К практике',run:()=>void session.introduce()}]); return; }
  const owner = flow.user!.id;
  const draftKey = guided ? recallDraftKey(owner, flow.state!) + ':workspace' : `japanese-workspace:${owner}:${item.publicationId ?? ''}:${item.id}:${item.version}`;
  if (!workspace || workspace.key !== draftKey) {
    const originalIds = new Set(item.exercise.tokens.map(token => course.forms.find(form => form.id === token.formId)!.wordId));
    workspace = new AlbumWorkspace(draftKey, course, item.exercise, course.words.filter(word => word.lessonIds.includes(item.exercise.lessonId) || originalIds.has(word.id) || flow.introducedWordIds.has(word.id) || !!context?.listId && !!library.data?.lists.find(list=>list.id===context!.listId)?.words.some(value=>value.id===word.id)), () => { flow.revise(); schedule(); });
    if (guided && !localStorage.getItem(draftKey) && flow.draft.tokenIds) workspace.tokens = flow.draft.tokenIds.map(id => workspace!.original.find(token => token.id === id)!).filter(Boolean);
  }
  const model = workspace, currentPage = page, current = () => workspace === model && flow.user?.id === owner && page === currentPage && (guided || session.item === item);
  order = model.tokens.map(token => item.exercise.tokens.findIndex(value => value.id === token.id));
  renderWorkspace(surface, model, { schedule: item.schedule, prompt: view.prompt, safe, changed: schedule, busy: busy(), composing: editor.composing, revealed: guided ? flow.draft.revealed : !!model.verdict,
    drawField: (rect, value, placeholder, changed) => { workspaceInput = changed; if (!editor.composing && editor.element.value !== value) editor.element.value = value; nativeField(editor, rect, placeholder); },
    check: () => void model.evaluate(owner, item, current, (result, tokenIds, tokenForms) => {
      if (guided && flow.recall && ['correct', 'incorrect'].includes(result.outcome)) writeRecallDraft(recallDraftKey(owner, flow.state!), { firstTokenIds: tokenIds, firstTokenForms: tokenForms, tokenIds, revealed: result.outcome === 'correct' });
      model.result = result.outcome === 'correct' ? 'Фраза собрана верно' : result.outcome === 'incorrect' ? 'Проверьте порядок и формы' : '';
      schedule();
    }),
    analyze: () => { void model.analyze(owner, item, guided ? { lessonId: item.exercise.lessonId } : context?.listId ? { listId: context.listId } : context?.lessonId ? { lessonId: context.lessonId } : {}, current).then(() => { if (current() && model.result) { notice = model.result; schedule(); } }); },
    grade: rating => { const tokenIds = model.tokens.map(token => token.id), tokenForms = model.forms; if (guided) void advance(rating === 1 ? 'again' : 'remember', { tokenIds, tokenForms, rating }); else void session.save({ attemptId: crypto.randomUUID(), reviewId: item.id, version: item.version, publicationId: item.publicationId, mode: 'grammar', tokenIds, tokenForms, exploring: model.exploring, revealed: false, rating }); },
  });
}
function persistCounterDraft() { if (page === 'lesson' && flow.user && flow.state) { try { writeRecallDraft(recallDraftKey(flow.user.id, flow.state), { helped: counterDraft.helped, revealed: counterDraft.revealed }); } catch { notice = 'Не удалось сохранить черновик на устройстве.'; } } schedule(); }
function renderCounter() {
  if (page === 'counters' && counters.loading && !counters.item) { message('Загружаем счётные задания', 'Подождите немного.', []); return; }
  const guided = page === 'lesson', session = page === 'review' ? review : counters, item = activeCounter(), card = guided ? flow.counter : item?.counter;
  if (!card) { message('Счётные суффиксы', counters.total ? 'Занятие завершено. Результаты сохранены.' : 'Сначала познакомьтесь со словами уроков. Здесь появятся задания со знакомыми предметами.', [{ id: 'counter-home', text: 'К урокам', run: home }]); return; }
  const course = guided ? flow.course! : session.course!, catalog = catalogFor(course); counterArt.use(catalog);
  if (counterArt.loading) { message('Загружаем иллюстрации', 'Подождите немного.', []); return; }
  if (counterArt.error) { message('Иллюстрации недоступны', counterArt.error, [{id:'counter-art-retry',text:'Повторить',run:()=>void counterArt.retry(catalog)},{id:'counter-art-home',text:'К урокам',run:home}]); return; }
  const before = key;
  const changed = persistCounterDraft;
  renderCounterCard(surface, card, course, counterDraft, {
    schedule: (guided ? flow.state?.reviewItem : item)?.schedule, prompt: view.prompt, pictures: counterArt.textures, intro: guided ? flow.counterNeedsIntro : item?.preparation ? !item.preparation.introduced : card.introduction,
    busy: busy(), heard, mediaError, changed, safe,
    play: url => void play(url), introduce: () => void (guided ? flow.introduceCounter() : session.introduce()),
    choose: (id, helped) => { if (document.hidden || busy()) return; void (async () => {
      if (guided) { const result = await flow.chooseCounter(id, helped); if (before !== key || result === undefined) return; counterDraft.correct = result; if (!result) counterDraft.wrong.push(id); }
      else { const item = activeCounter()!; await session.save({ attemptId: crypto.randomUUID(), reviewId: item.id, version: item.version, publicationId: item.publicationId, mode: 'counter', rating: card.acceptedKeys.includes(id) && !helped ? 3 : 1, choice: id, helped }); }
      schedule();
    })(); },
    grade: rating => { acceptGrade(rating); },
    ...(guided ? { next: () => void advance(counterDraft.wrong.length || counterDraft.helped ? 'again' : 'remember') } : {}),
  });
}
function renderVideo() { renderVideoPlayer(flow.video, true); }
function renderLesson() {
  const step = flow.step;
  if (!step) { message('Урок пройден', flow.state?.completionBasis==='recognized'?'Ранее проходил. Отметка сохранена отдельно от выполненных ответов.':flow.state?.completionBasis==='self-assessed'?'Задания выполнены. Собственный ответ отмечен по самооценке. Повторения продолжаются по расписанию.':'Все обязательные шаги выполнены. Повторения продолжаются по расписанию.', [{ id: 'lesson-done', text: 'К урокам', run: home }]); return; }
  if (step.kind.endsWith('intro')) renderIntro();
  else if (step.kind === 'word-practice') flow.recall ? renderWordRecall() : renderOldWord();
  else if (step.kind === 'construction-practice') step.mode === 'grammar' ? renderBuilder() : renderWordRecall();
  else if (step.kind === 'counter-practice') renderCounter();
  else if (step.kind === 'learning-task') { const task=flow.part?.tasks?.find(task=>task.id===step.taskId); if(task){taskView.bind(flow.user!.id,flow.state!);renderTask(surface,task,flow.state!,taskView,{orthography:settings?.orthography??'furigana',safe,changed:schedule,play:url=>void play(url),field:(rect,value,changed)=>{libraryInput=changed;if(!editor.composing)editor.element.value=value;nativeField(editor,rect,'Ваш ответ по-японски');},advance:(action,details)=>void advance(action,details)});} }
  else if (step.kind === 'video') renderVideo();
  else message('Часть пройдена', 'Ответы сохранены. Можно перейти к следующей части.', [{ id: 'part-next', text: flow.state!.partIndex === flow.state!.totalParts - 1 ? 'Завершить урок' : 'Следующая часть →', run: () => void advance('continue') }]);
}
function renderReviews() {
  if (!trainingContext && review.course && !reviewStarted) {
    renderReviewOverview(surface, review, {
      safe, start: () => { reviewStarted = true; schedule(); }, lessons: home,
      reference: () => openReference(), refresh: () => void review.open(flow.user!.id, 'mixed'),
    }); return;
  }
  if (review.item?.mode === 'grammar') { renderBuilder(); return; }
  if (review.item?.mode === 'counter') { renderCounter(); return; }
  const item = reviewWord();
  if (item?.preparation && !item.preparation.introduced) { const word = item.word; message('Знакомство', `${word.surface} · ${word.kana}\n${word.meaningRu}`, [{ id: 'training-intro', text: 'К практике', run: () => void review.introduce() }]); return; }
  if (!review.course) { sectionCards(surface, 'Практика словаря', 'Выберите направление для слов этого раздела', [
    { id: 'review-ja', text: 'Японский → русский', description: 'Узнаём слово и вспоминаем значение', run: () => void review.open(flow.user!.id, 'ja-ru', trainingContext) },
    { id: 'review-ru', text: 'Русский → японский', description: 'Вспоминаем японское слово по смыслу', run: () => void review.open(flow.user!.id, 'ru-ja', trainingContext) },
    { id: 'review-audio', text: 'На слух', description: 'Слушаем и узнаём знакомые слова', run: () => void review.open(flow.user!.id, 'listening', trainingContext) },
  ], safe); return; }
  if (!review.item) { message(review.nextDue && !trainingContext ? 'Ближайшее повторение' : review.total ? 'Занятие завершено' : 'На сейчас всё повторено', review.nextDue && !trainingContext ? `Карточки вернутся через ${intervalLabel((Date.parse(review.nextDue)-Date.now())/1000)}. Можно продолжить урок; расписание сохранено.` : review.total ? 'Ответы сохранены. Следующее повторение назначено по вашим ответам.' : 'Новые карточки появятся после изучения материала в уроках.', [
    { id: 'review-done', text: 'К урокам', run: home },
    { id: 'review-next', text: trainingContext ? 'Ещё занятие' : 'К повторению', run: () => { review.clear(); if (trainingContext) schedule(); else openReviewMenu(); } },
  ]); return; }

  if (item?.choices?.length) {
    const choices: StudyChoice[] = item.choices!.map(id => { const value = item.application?.labels?.[id] ?? review.course!.words.find(word => word.id === id)!; return { id, text: value.surface === value.kana ? value.surface : `${value.surface}（${value.kana}）`, japanese: true, enabled: !busy() && !review.pending, run: () => {} }; });
    const plan = surface.quiz('Выберите ответ по ситуации', item.application?.promptRu ?? item.word.meaningRu, choices, undefined, { question: view.prompt, paper: false, titleSize: 16 });
    surface.choices(choices, plan.choices, id => { void review.choose(id); }, plan.columns, plan.size);
  } else renderWordRecall();
}
function renderSettings() {
  if (!settings) { message('Настройки недоступны', 'Загрузите настройки перед изменением.', [{id:'settings-retry',text:'Загрузить',run:()=>void loadSettings()}]); return; }
  let pending: ReturnType<typeof pendingSettings>; try { pending = pendingSettings(flow.user!.id); } catch (error) { message('Настройки недоступны', error instanceof Error ? error.message : 'Хранилище недоступно.', [{id:'settings-home',text:'К урокам',run:home}]); return; }
  renderFullSettings(surface, settings, settingsView, {pending:pending?.value,safe,changed:schedule,save:next=>void saveSettings(next),home,reduced:motionReduced,scene:{id:'scene-next',text:`Место: ${sceneNames[chosenScene]}`,run:()=>{stopMedia();companion.quiet();chosenScene=sceneIds[(sceneIds.indexOf(chosenScene)+1)%sceneIds.length]!;void environment.load(chosenScene,view.width,view.height);schedule();}},retryMedia:environment?.state==='unavailable'||companion?.unavailable||soundState==='blocked'||soundState==='unavailable'?{id:'scene-retry',text:'Повторить загрузку фона и звука',run:()=>{sound.unlock(chosenScene);companion.retry();if(environment.state==='unavailable')void environment.load(chosenScene,view.width,view.height,true);schedule();}}:undefined});
}
async function submitAccess() {
  const revision = access.revision;
  const result = await access.submit(password.element.value);
  if (access.revision !== revision) return;
  if (access.complete) password.element.value = '';
  if (result?.authenticated) {
    await flow.boot();
    if (access.revision === revision && flow.user?.email === result.email) { access.login(); await loadSettings(); }
  }
}
function renderAccess() {
  const mode=access.mode!;
  if(access.complete){
    const actions:StudyAction[]=[{id:'access-login',text:mode==='verify'||mode==='account'?'Продолжить':'Перейти ко входу',run:()=>void finishAccess()}];
    if(['register','invite','resend'].includes(mode))actions.push({id:'access-resend',text:'Повторить письмо',run:()=>openAccess('resend')});
    if(mode==='account')actions.push({id:'access-resend',text:'Повторить письмо',run:()=>openAccess('account')});
    message(mode==='verify'?'Почта подтверждена':mode==='recover'?'Пароль изменён':'Проверьте почту',access.complete,actions);return;
  }
  const a=surface.body,prompt=view.prompt??a,titles:Record<AccessMode,string>={invite:'Принять приглашение',recover:'Новый пароль',register:'Регистрация',forgot:'Восстановить пароль',resend:'Повторить письмо',verify:'Подтвердить почту',account:'Подтвердить вашу почту'};
  surface.text(titles[mode],{x:prompt.x+8,y:prompt.y+8,width:prompt.width-16,height:60},22,false,true);
  let y=a.y+(view.prompt?12:76);
  if(['invite','register','forgot','resend','account'].includes(mode)){
    if(email.element.value!==access.email)email.element.value=access.email;
    email.element.readOnly=access.busy||mode==='account'||mode==='invite'&&access.invitation?.kind==='invite';nativeField(email,box(a.x,y,a.width,48),'Электронная почта');y+=58;
  }
  if(mode==='invite'||mode==='register'){accessName.element.readOnly=access.busy;nativeField(accessName,box(a.x,y,a.width,48),'Имя в приложении');y+=58;}
  if(['invite','register','recover','account'].includes(mode)){
    password.element.autocomplete=mode==='account'?'current-password':'new-password';password.element.minLength=mode==='account'?1:8;password.element.maxLength=128;password.element.readOnly=access.busy;
    nativeField(password,box(a.x,y,a.width,48),mode==='account'?'Текущий пароль':'Пароль · 8–128 символов');y+=60;
  }
  const needsToken=['invite','recover','verify'].includes(mode);
  const hint=mode==='account'?'Подтвердите текущий пароль. Занятия и прогресс останутся доступны.':mode==='verify'?'Нажмите кнопку, чтобы подтвердить адрес из письма.':mode==='forgot'?'Ссылка придёт на подтверждённую почту. Иначе поможет администратор.':mode==='resend'?'Повторное письмо доступно через минуту. Старый аккаунт: подтвердите адрес после входа.':'Для доступа к занятиям подтвердите email по ссылке из письма.';
  const text=access.error||(needsToken&&!access.token?'В ссылке нет токена. Запросите новое письмо.':access.busy?'Подождите…':hint);
  const region=view.prompt?{x:prompt.x+8,y:prompt.y+80,width:prompt.width-16,height:prompt.height-88}:{x:a.x+8,y,width:a.width-16,height:Math.max(54,a.y+a.height-y)};
  surface.text(text,region,16);
  const actions:StudyAction[]=[{id:'access-submit',text:mode==='recover'?'Сохранить пароль':mode==='register'||mode==='invite'?'Создать аккаунт':mode==='verify'?'Подтвердить почту':'Отправить письмо',fontSize:16,enabled:(!needsToken||!!access.token)&&!access.busy&&(mode!=='invite'||!!access.invitation),run:()=>void submitAccess()},{id:'access-back',text:'Назад',fontSize:16,run:()=>void finishAccess()}];
  if(mode==='verify')actions.push({id:'access-resend',text:'Новое письмо',run:()=>openAccess('resend')});
  if(mode==='recover')actions.push({id:'access-request',text:'Новая ссылка',run:()=>openAccess('forgot')});
  footer(actions);
}

let motionReduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
async function saveSettings(next: LearnerSettings) {
  const owner = flow.user?.id; if (!owner) return; settingsBusy = true; schedule();
  try { const saved = await storeSettings(owner, next, settings!); if (owner === flow.user?.id) settings = saved; }
  catch (error) { if (flow.user?.id === owner) { notice = error instanceof Error ? error.message + ' Повторите сохранение в настройках.' : 'Настройки не сохранились. Повторите изменение.'; if (error instanceof Error && 'code' in error && error.code === 'SETTINGS_CONFLICT') { try { const current = await api<LearnerSettings>('/api/settings', {headers:learningHeaders(owner)}); if (flow.user?.id === owner) settings = current; } catch {} } } }
  finally { if (flow.user?.id === owner) settingsBusy = false; schedule(); }
}
function draw() {
  if (!ready || contextLost || suspended || heldPointers.size) return;
  renderCount++;
  const owner = flow.user?.id ?? null;
  if (owner !== displayedOwner) {
    bookNavigation = owner && flow.course ? readBookNavigation(owner, flow.course) : { bookId: starterBookId, places: {} };
    lessonPages.page = bookNavigation.places[bookNavigation.bookId]?.page ?? 0; shelfOpen = false;
    const previous = displayedOwner; displayedOwner = owner; if (previous || !owner) { sound.dispose(); sound = newSound(); } settingsBusy = false; settingsView.volume = null; settingsView.offset = 0; kanaView.offset = 0; review.clear(); reviewStarted = false; grammar.clear(); counters.clear(); library.clear(); reference.clear(); kana.clear(); admin.clear(); for (const field of referenceFields.values()) field.element.value = ''; workspace = null; workspaceInput = null; lastGuided = null; lastAttempt = ''; companion.quiet(); key = ''; autoPlayedKey = ''; stopMedia(); mediaError = ''; notice = ''; menuOpen = false; revealed = false; heard = false; selected = null; order = []; wrong = []; bad = []; correct = null; manual = false; editor.element.value = '';
    if (previous) { page = 'lessons'; settings = null; if (owner) void loadSettings(); }
  }
  const focus = requestedFocus ?? (app.renderer.accessibility.div.contains(document.activeElement) ? document.activeElement?.getAttribute('aria-label') : null); requestedFocus = null;
  leaf.bind(); changedCard(); companion.context(owner, `${page}:${key}`); companion.setActive(!!owner && !document.hidden && !contextLost && !suspended); ui.removeChildren().forEach(child => child.destroy({ children: true, context: true, style: true }));
  placedFields.clear(); referenceCallbacks.clear(); workspaceInput = null; libraryInput = null; video.hidden = true;
  let layout = view.layout;
  if ((view.low || !view.wide && view.height < 650) && flow.user) layout = { ...layout, content: { ...layout.content, y: layout.content.y + 52, height: layout.content.height - 52 } };
  surface = new StudySurface(layout, textures.paper, () => app.render(), settings?.orthography); surface.leftPage = view.prompt; ui.addChild(surface.root);
  const error = flow.error || (page === 'review' ? review.saveError : page === 'counters' ? counters.saveError : page === 'grammar' ? grammar.saveError : '');
  if (access.mode) renderAccess();
  else if (!flow.user && !flow.error) { password.element.readOnly=false; email.element.readOnly=false; password.element.autocomplete='current-password'; renderLogin(); }
  else if (!flow.user) message('Не удалось войти', flow.error, [{ id: 'login-retry', text: 'Ко входу', run: () => { flow.error = ''; schedule(); } },{id:'login-resend',text:'Подтвердить почту',run:()=>openAccess('resend')},{id:'login-recovery',text:'Забыли пароль?',run:()=>openAccess('forgot')}]);
  else if (menuOpen) { /* Hide task/error controls until the menu closes; pending data stays intact. */ }
  else if (error) message('Не удалось подтвердить', error, [{ id: 'retry-save', text: 'Повторить', run: () => { if (page === 'review') void review.retry(); else if (page === 'counters') void counters.retry(); else if (page === 'grammar') void grammar.retry(); else void flow.refresh(); } }, { id: 'error-home', text: 'К урокам', run: home }]);
  else if (flow.busy && !flow.active || review.loading) message('Загружаем занятие', 'Подождите немного.', []);
  else if (notice) { if (renderedNotice !== notice) { noticeReading.scroll = 0; renderedNotice = notice; } renderReading(surface, notice, noticeReading, { title: 'Сообщение', back: { id: 'notice-close', text: 'Вернуться', run: () => { notice = ''; schedule(); } }, safe, changed: schedule }); }
  else if (page === 'lessons') renderLessons();
  else if (page === 'practice') renderTrainers();
  else if (page === 'lesson') renderLesson();
  else if (page === 'review') renderReviews();
  else if (page === 'counters') renderCounter();
  else if (page === 'grammar') renderBuilder();
  else if (page === 'book') { if (library.error) message('Материалы недоступны', library.error, [{id:'book-retry',text:'Повторить',run:()=>void library.load(flow.user!.id)}]); else if (!library.data || library.busy) message('Загружаем урок', 'Подождите немного.', []); else renderBook(surface, library, {safe,changed:schedule,home,learn:id=>void openLesson(id),train:id=>beginTraining({lessonId:id}),trainGrammar:id=>openGrammar({lessonId:id}),field:libraryField,video:openLibraryVideo,play:url=>void play(url)}); }
  else if (page === 'admin') { if (!flow.user.isAdmin) message('Доступ закрыт', 'Требуются права администратора.', [{id:'admin-home',text:'К урокам',run:home}]); else renderAdminAccess(surface,admin,{safe,changed:schedule,home,prompt:view.prompt,field:referenceField}); }
  else if (page === 'kana') renderKana(surface, kana, catalogFor(flow.course!), kanaView, { safe, changed: schedule, home: openPracticeMenu, prompt: view.prompt });
  else if (page === 'reference') { if (library.error) message('Справочник недоступен', library.error, [{id:'reference-retry',text:'Повторить',run:()=>void library.load(flow.user!.id)}]); else if (reference.error && !library.data) message('Личные данные недоступны',reference.error,[{id:'personal-home',text:'К урокам',run:home}]); else if (reference.error) renderReference(surface,reference,{safe,changed:schedule,home,field:referenceField,train:id=>beginTraining({listId:id}),trainGrammar:id=>openGrammar({listId:id}),play:url=>{if(url)void play(url);}}); else if (!library.data || library.busy) message('Загружаем справочник', 'Подождите немного.', []); else renderReference(surface,reference,{safe,changed:schedule,home,field:referenceField,train:id=>beginTraining({listId:id}),trainGrammar:id=>openGrammar({listId:id}),play:url=>{if(url)void play(url);}}); }
  else if (page === 'library-video') renderLibraryVideo();
  else renderSettings();
  for (const field of [email, password, accessName, editor, ...referenceFields.values()]) if (!placedFields.has(field)) field.place(null);
  keepEditorsVisible();
  if (flow.user) topNavigation();
  if (mediaError || busy()) {
    const text = mediaError || 'Сохраняем…', a = surface.body;
    const h = surface.measure(text, a.width - 24, 14);
    const strip = box(a.x + 12, a.y + a.height - h - 8, a.width - 24, h);
    surface.paper({ ...strip, x: strip.x - 6, y: strip.y - 4, width: strip.width + 12, height: strip.height + 8 });
    surface.text(text, strip, 14, false, true);
  }
  if (isRecall() && !error && !menuOpen) {
    const ticket = flow.ticket(), turn = review.turn, counterTurn = counters.turn, bindPage = page;
    const current = () => page === bindPage && counters.turn === counterTurn && ticket.stepId === flow.ticket().stepId && ticket.revision === flow.ticket().revision && turn === review.turn;
    const bounds = albumPages(view).right, layers = liftAlbumPage(surface.root, ui, bounds, textures.paper);
    leaf.bind({ ...layers, bounds, revealBounds: view.prompt ? albumPages(view).spread : bounds, viewportWidth: view.width, canReveal: () => current() && !isRevealed() && !busy() && (!listening() || heard && !mediaError), canGrade: rating => current() && allowed(rating), reveal, grade: () => {}, accept: acceptGrade, controls: () => surface.controls.map(c => c.rect) });
  }
  prepareCurrentAudio();
  sound.configure(settings ?? defaultSoundSettings, chosenScene, !!flow.user && !!settings, !document.hidden);
  const last = feedbackForPage();
  if (last && last.attemptId !== lastAttempt) { lastAttempt = last.attemptId; savedFeedback(last); }
  const localCorrect = workspace?.verdict === 'correct' || correct === true || counterDraft.correct === true;
  const activity = mediaOwner ? 'listening' : error ? 'neutral' : busy() || workspace?.checking ? 'checking' : localCorrect ? 'draft-correct' : isRevealed() ? 'revealed' : placedFields.has(editor) ? 'editing' : 'idle';
  if (!companion.cinematic || activity !== 'idle') companion.activityEvent({ reviewId: `${page}:${key}`, activity, key: `${key}:${activity}` });
  const plan = presentationPlan(), completion = m6Events.observePlan(plan.scope, plan.active, plan.done);
  if (completion && companion.complete(completion) && !document.hidden && !contextLost && !suspended) sound.cue('complete', completion);
  syncDecor();
  const spoken = surface.texts.map(t => t.value).join('\n'); if (transcript.textContent !== spoken) transcript.textContent = spoken; app.render();
  if (focus) requestAnimationFrame(() => [...app.renderer.accessibility.div.querySelectorAll<HTMLElement>('button[aria-label]')].find(node => node.getAttribute('aria-label') === focus)?.focus({ preventScroll: true }));
}
function resize() {
  if (!ready || contextLost || suspended) return;
  heldPointers.clear();
  leaf?.cancel(); app.renderer.resize(preview?.width ?? innerWidth, preview?.height ?? innerHeight);
  const scale = Math.min(1, innerWidth / app.screen.width, innerHeight / app.screen.height);
  Object.assign(app.canvas.style, { width: `${app.screen.width}px`, height: `${app.screen.height}px`, transform: `scale(${scale})`, transformOrigin: 'top left' });
  view = prototypeLayout(app.screen.width, app.screen.height, 'album'); scene = paintScene(world, view, textures); companion.bind(scene.cat, scene.feet, view); world.children[0]!.visible = environment.state !== 'ready'; void environment.load(chosenScene, view.width, view.height); draw();
}
let rendererEpoch = 0, shuttingDown = false;
async function start(restore = false) {
  const epoch = ++rendererEpoch, instance = app, current = () => !shuttingDown && epoch === rendererEpoch;
  const startupMessage = document.querySelector('#startup-message');
  if (startupMessage) startupMessage.textContent = 'Подготавливаем страницы…';
  // Graphics and authenticated data are independent; neither should wait for the other to download.
  const account = restore ? null : access.load().then(async () => { if (!access.mode) await flow.boot(); if (flow.user) await loadSettings(); }).catch(error => { flow.error = error instanceof Error ? error.message : 'Не удалось загрузить занятие.'; });
  Assets.setPreferences({ preferWorkers: false });
  const assets = Promise.all([document.fonts.load('22px Lora', 'Учебник'), Assets.load<Texture>([roomUrl, standUrl, paperUrl, catUrl, logoUrl, neutralUrl])]);
  const [[, loaded]] = await Promise.all([assets, app.init({ width: innerWidth, height: innerHeight, preference: 'webgl', antialias: true, resolution: Math.min(devicePixelRatio, 2), autoDensity: true, autoStart: false, background: '#3b3026', accessibilityOptions: { enabledByDefault: true, deactivateOnMouseMove: false } })]);
  if (!current()) { instance.destroy({ removeView: true }, { children: false }); return; }
  host.prepend(app.canvas); app.canvas.setAttribute('aria-label', 'Учебный альбом');
  // A blur redraw must not replace a Canvas action between pointerdown and pointertap.
  app.canvas.addEventListener('pointerdown', event => { heldPointers.add(event.pointerId); if (flow.user) sound.unlock(chosenScene); if (document.activeElement?.classList.contains('native-editor')) event.preventDefault(); });
  leaf = new AlbumLeaf(app.canvas, () => app.screen, () => app.render(), amount => { companion?.follow(amount); if (Math.abs(amount) > .15) { sound.cue('move', `${key}:leaf`); } }, () => motionReduced || settings?.animations === false, schedule);
  const stand = loaded[standUrl]!;
  if (!current()) return;
  textures = { room: loaded[roomUrl]!, stand, paper: loaded[paperUrl]!, cat: loaded[catUrl]!, logo: loaded[logoUrl]!, rail: new Texture({ source: stand.source, frame: new Rectangle(250, 875, 700, 45) }), wood: new Texture({ source: stand.source, frame: new Rectangle(250, 250, 650, 500) }) };
  companion = new M6Companion(loaded[neutralUrl]!, schedule, () => motionReduced || settings?.animations === false, m6Events, () => { sound.unlock(chosenScene); sound.cue('pet', crypto.randomUUID()); });
  environment = new LivingScene(() => { if (ready && !contextLost) { const background = world.children[0]; if (background) background.visible = environment.state !== 'ready'; schedule(); } });
  app.stage.addChild(environment.root, world, ui, companion.root); ready = true; resize();
  app.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); contextLost = true; stopDecor(); stopMedia(); sound.configure(settings ?? defaultSoundSettings, chosenScene, false, false); leaf.cancel(); companion.setActive(false); recovery.hidden = false; });
  app.canvas.addEventListener('webglcontextrestored', () => { contextLost = false; recovery.hidden = true; resize(); });
  if (!restore) { if (startupMessage) startupMessage.textContent = 'Загружаем уроки…'; await account; if (flow.user) { const lesson = new URLSearchParams(location.search).get('lesson'); if (lesson) openBook(lesson); } }
  recovery.hidden = true; schedule();
}
let recovering = false;
document.querySelector('#retry')!.addEventListener('click', () => { void (async () => {
  if (recovering) return; recovering = true; ready = false; contextLost = false; stopMedia();
  try {
    stopDecor(); leaf?.bind(); companion?.dispose(); environment?.dispose(); counterArt.clear(); world.removeChildren().forEach(c => c.destroy({ children: true, context: true, style: true })); ui.removeChildren().forEach(c => c.destroy({ children: true, context: true, style: true })); textures?.rail.destroy(false); textures?.wood.destroy(false); app.stage.removeChildren();
    try { app.destroy({ removeView: true, releaseGlobalResources: true }, { children: false }); } catch { host.querySelector(':scope > canvas')?.remove(); }
    app = new Application();
    await start(true);
  } catch { contextLost = true; recovery.hidden = false; }
  finally { recovering = false; }
})(); });
const releasePointer = (event: PointerEvent) => { if (heldPointers.delete(event.pointerId) && !heldPointers.size) schedule(); };
window.addEventListener('pointerup', releasePointer, { capture: true }); window.addEventListener('pointercancel', releasePointer, { capture: true });
window.addEventListener('resize', resize);
window.addEventListener('hashchange', () => { access.locationChanged(); accessName.element.value = ''; password.element.value = ''; if (access.mode) void access.load(); schedule(); });
const resume = () => { if (flow.user && !busy() && !document.hidden) { if (page === 'lesson' && !flow.snapshot().confirmedNext) void flow.refresh(); else if (page === 'review' && !trainingContext && review.active) void review.refreshDue(); else void flow.boot().then(() => { if (page === 'settings' && flow.user) void loadSettings(); schedule(); }); } };
window.addEventListener('online', resume); window.addEventListener('focus', resume);
window.addEventListener('storage', event => { if (event.key?.startsWith('japanese-recall-draft:')) schedule(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { stopDecor(); stopMedia(); leaf?.cancel(); companion?.setActive(false); sound.configure(settings ?? defaultSoundSettings, chosenScene, false, false); } else schedule(); });
password.element.addEventListener('keydown', raw => { const event = raw as KeyboardEvent; if (event.key === 'Enter' && !event.isComposing) { event.preventDefault(); sound.unlock(); if (access.mode) void submitAccess(); else void signIn(); } });
function stopDecor() { decorPrevious = 0; if (document.hidden || contextLost || suspended) heldPointers.clear(); if (decorFrame) cancelAnimationFrame(decorFrame); decorFrame = 0; }
function syncDecor() {
  if (!ready || contextLost || suspended || document.hidden || motionReduced || settings?.animations === false || !flow.user) { stopDecor(); environment?.tick(0, true); companion?.tick(performance.now() / 1000); return; }
  if (!decorFrame) decorFrame = requestAnimationFrame(decorTick);
}
function decorTick(now: number) {
  decorFrame = 0;
  if (!ready || contextLost || suspended || document.hidden || motionReduced || settings?.animations === false || !flow.user) { syncDecor(); return; }
  decorTicks++; if (decorPrevious) { decorDeltas.push(now - decorPrevious); if (decorDeltas.length > 240) decorDeltas.shift(); } decorPrevious = now; environment.tick(now / 1000, false); companion.tick(now / 1000); const submitted = performance.now(); if (!leaf?.busy) app.render(); renderSubmit.push(performance.now() - submitted); if (renderSubmit.length > 240) renderSubmit.shift(); syncDecor();
}
const reducedQuery = matchMedia('(prefers-reduced-motion: reduce)');
reducedQuery.addEventListener('change', () => { motionReduced = reducedQuery.matches; schedule(); });
window.addEventListener('keydown', event => { if (event.key === 'Escape' && !event.isComposing && companion?.cinematic) { companion.skip(); schedule(); } });
function disposePresentation() {
  shuttingDown = true; suspended = true; ++rendererEpoch; ready = false; if (frame) cancelAnimationFrame(frame); frame = 0; stopDecor(); stopMedia(); leaf?.bind(); companion?.dispose(); environment?.dispose(); sound.dispose(); counterArt.clear();
  world.removeChildren().forEach(c => c.destroy({ children: true, context: true, style: true })); ui.removeChildren().forEach(c => c.destroy({ children: true, context: true, style: true })); textures?.rail.destroy(false); textures?.wood.destroy(false);
  try { if (app.renderer) app.destroy({ removeView: true, releaseGlobalResources: true }, { children: false }); } catch {}
  void Assets.unload([roomUrl, standUrl, paperUrl, catUrl, logoUrl, neutralUrl]).catch(() => {});
}
window.addEventListener('pagehide', event => { suspended = true; companion?.setActive(false); if (frame) cancelAnimationFrame(frame); frame = 0; stopDecor(); stopMedia(); sound.configure(settings ?? defaultSoundSettings, chosenScene, false, false); if (!event.persisted) disposePresentation(); });
window.addEventListener('pageshow', event => { if (event.persisted) { suspended = false; shuttingDown = false; companion?.quiet(); schedule(); } });
function snapshot() {
  const texts: { text: string; size: number; bounds: Rect }[] = [];
  const collect = (node: Container) => { if (node instanceof Text) texts.push({ text: node.text, size: Number(node.style.fontSize), bounds: node.label === 'scrolling-copy' && node.mask instanceof Container ? node.mask.getBounds().rectangle : node.getBounds().rectangle }); node.children.forEach(collect); }; collect(ui);
  return { ready, page, renderCount, renderedKey: key, authenticated: !!flow.user, guided: flow.snapshot(), review: { active: review.active, mode: review.item?.mode, remaining: review.queue.length, completed: review.completed, total: review.total, pending: review.pending, error: review.saveError, turn: review.turn }, settings: settings ? { orthography: settings.orthography, animations: settings.animations, sceneSoundEnabled: settings.sceneSoundEnabled, musicVolume: settings.musicVolume, ambienceVolume: settings.ambienceVolume, sfxVolume: settings.sfxVolume, speechVolume: settings.speechVolume } : null, access: { mode: access.mode, busy: access.busy, error: access.error, complete: !!access.complete, invitation: access.invitation?.kind }, admin: { screen: admin.screen, busy: admin.busy, error: admin.error, links: admin.links.length }, kana: { sessionId: kana.sessionId, prompt: kana.item?.prompt, script: kana.script, direction: kana.direction, group: kana.group, rows: kana.rows, remaining: kana.queue.length, total: kana.total, completed: kana.completed, turn: kana.turn, active: kana.active, busy: kana.busy, error: kana.error, stats: kana.stats.map(({glyph,direction,attempts,errors,script})=>({glyph,direction,attempts,errors,script})) }, reference: { section: reference.section, form: reference.form, error: reference.error, busy: reference.busy, lists: library.data?.lists.length }, book: { lessons: library.data?.course.lessons.length, videos: library.data?.course.lessons.flatMap(l => l.videos ?? []).length, lessonId: library.lessonId, tab: library.tab, loading: library.busy, error: library.error }, workspace: workspace ? { tokens: workspace.tokens, text: workspace.text, exploring: workspace.exploring, editing: workspace.editing, checking: workspace.checking, verdict: workspace.verdict, result: workspace.result, revision: workspace.revision, error: workspace.error } : null, counter: { draft: counterDraft, kind: counters.item?.counter.kind, remaining: counters.queue.length, completed: counters.completed }, revealed: isRevealed(), heard, mediaError, media: { owner: mediaOwner, speechTime: audio.currentTime, speechPaused: audio.paused, videoTime: video.currentTime, videoPaused: video.paused }, order, wrong, correct: workspace ? workspace.verdict === 'correct' ? true : workspace.verdict === 'incorrect' ? false : null : correct, controls: surface?.controls, problems: surface?.problems, texts, leaf: leaf?.snapshot(), contextLost, companion: companion?.snapshot(), m6: { scene: environment?.snapshot(), sound: { state: soundState, ...sound.snapshot() }, decorFrame: !!decorFrame, decorTicks, timing: { samples: renderSubmit.length, frameIntervalP95Ms: percentile95(decorDeltas), renderSubmitP95Ms: percentile95(renderSubmit) }, reduced: motionReduced || settings?.animations === false }, fixed: { field: view?.layout.paper, prop: scene && !scene.prop.destroyed ? scene.prop.getBounds().rectangle : null } };
}
Object.assign(window, { __ALBUM__: { snapshot, dispose: disposePresentation, preview: (size: typeof preview) => { preview = size; resize(); } } });
try { await start(); } catch (error) { recovery.hidden = false; console.error(error instanceof Error ? error.message : 'Не удалось открыть альбом.'); }
