import 'pixi.js/unsafe-eval';
import 'pixi.js/accessibility';
import { Application, Assets, Container, Graphics, NineSliceSprite, Rectangle, Sprite, Text, Texture, type FederatedPointerEvent } from 'pixi.js';
import data from './paper-fixtures.json';
import { EditorBridge, japanese, label, textWidth, type JapaneseValue, type Rect } from './canvas';
import deskUrl from './art/runtime/desk.webp';
import desktopDeskUrl from './art/runtime/desk-landscape.webp';
import cardUrl from './art/runtime/plain-paper.webp';
import roomStudyUrl from './art/runtime/room-study.webp';
import standUrl from './art/runtime/stand.webp';
import standRoomUrl from './art/runtime/room-stand.webp';
import catUrl from './art/runtime/cat.webp';
import logoUrl from './art/runtime/logo.webp';
import './paper.css';
import { LessonFlow, lessonCatalog as fixtureCatalog } from './lesson-flow';
import { ConnectedFlow, liveCatalog } from './connected-flow';
import type { LearningAdvance } from '../../src/shared/learning';
import { PracticeStudy, practiceFixture } from './practice-study';
import sceneManifest from '../../public/scenes/manifest.json';

const tasks = {
  'word-ja': 'Японский → русский', 'word-ru': 'Русский → японский', 'word-listen': 'Словарное аудирование',
  'recall-ja': 'Раскрытие: японский → русский', 'recall-ru': 'Раскрытие: русский → японский', 'recall-listen': 'Вспоминание на слух',
  'word-intro': 'Знакомство со словом', 'construction-intro': 'Объяснение конструкции', construction: 'Конструктор фразы',
  'counter-intro': 'Знакомство со счётным словом', 'count-category': 'Предмет → суффикс', 'count-picture': 'Суффикс → предмет',
  'count-reading': 'Чтение количества', 'count-listen': 'Количество на слух', 'count-recall': 'Вспомнить количество',
  video: 'Видеодиалог', textbook: 'Учебник', reference: 'Справочник',
};
const taskTitles = { ...tasks, 'practice-study': 'Сравнение закрепления', 'lesson-overview': 'Начало занятия', 'part-complete': 'Часть пройдена', 'lesson-complete': 'Занятие завершено' };
type Task = keyof typeof taskTitles;
type Word = JapaneseValue & { id: string; meaningRu: string; audioUrl?: string | null; illustration?: { src: string; bounds: number[] } | null; introduction?: { explanationRu: string } | null };
type Counter = { kind: string; definition: { surface: string; kana: string; explanation: string }; word: Word; object: { tile: number }; quantity: number | null; answer: JapaneseValue; audioUrl?: string | null; acceptedKeys: string[]; options: { key: string; label: string; quantity?: number; object?: { tile: number } }[]; examples: (JapaneseValue & { audioUrl?: string | null })[] };
type Control = { id: string; label: string; rect: Rect; enabled: boolean; docked?: boolean };
type ActionOptions = { enabled?: boolean; hand?: boolean; selected?: boolean; wrong?: boolean; value?: JapaneseValue; size?: number; bare?: boolean };
type ActionSpec = { node: Container; id: string; title: string; rect: Rect; run: () => void; options: ActionOptions };
const counters: Counter[] = data.counterCards;
const countKinds: Record<string, string> = { 'count-category': 'image-counter', 'count-picture': 'counter-image', 'count-reading': 'reading-choice', 'count-listen': 'listening-image', 'count-recall': 'recall' };
const answerUrl = cardUrl;
const ink = '#241d17', sage = '#263d25', hand = 'Lora', book = 'Lora', jp = '"Hiragino Mincho ProN", "Yu Mincho", serif';
const params = new URLSearchParams(location.search);
let task: Task = params.get('task') && Object.hasOwn(taskTitles, params.get('task')!) ? params.get('task') as Task : 'textbook';
const connected = location.pathname === '/learn.html' ? new ConnectedFlow(() => schedule()) : null;
const flow = connected ?? new LessonFlow();
const practice = !connected && params.get('study') === 'compare' ? new PracticeStudy() : null;
if (practice) task = 'practice-study';
const lessonCatalog = connected ? liveCatalog : fixtureCatalog;
if (connected) task = 'textbook';
const connectionBlocked = () => !!connected && (!connected.user || !!connected.error || connected.busy && !flow.active);
type Composition = 'zoom' | 'window' | 'surround' | 'stand';
let composition: Composition = ['zoom', 'window', 'surround', 'stand'].includes(params.get('composition') ?? '') ? params.get('composition') as Composition : 'stand';
const locationScene = sceneManifest.scenes.find(scene => scene.id === params.get('scene')) ?? sceneManifest.scenes[0]!;
let cameraStarted = 0, cameraProgress = 1, viewRevision = 0;
let mobileApproach = false, approachStarted = 0;
let autoTimer: ReturnType<typeof setTimeout> | undefined, autoDeadline = 0, guideText = '', dockTop = 0;
let speechBounds: Rect | null = null;
let introSlotHeight = 0, infoSlotHeight = 0, recallAnswerHeight = 0, introTabbed = false, introTab = 0, overviewTab = 0;
let paintedScroll = 0, pointerHeld = false, deferredPaint = false;
let maxSheetScroll = 0, scrollMore: Container | null = null, scrollBack: Container | null = null;
const actionSpecs = new Map<string, ActionSpec>();
const controlRuns = new Map<string, () => void>();
let dockIds: string[] = [];
if (!connected && lessonCatalog.lessons.some(lesson => lesson.id === params.get('lesson'))) { flow.open(params.get('lesson')!); task = 'lesson-overview'; }
let words: Word[] = data.words, wordIndex = 0, selection: string | null = null, revealed = false;
let tokenOrder: number[] = [], manual = false, feedback = '', correct: boolean | null = null, hadMistake = false, showBreakdown = false;
let ready = false, frame = 0, rendering = false, enteredAt = performance.now(), played = false, playing = false, mediaEpoch = 0;
let controls: Control[] = [], ruby: ReturnType<typeof japanese>[] = [], topCard: Container | null = null, cardOrigin = { x: 0, y: 0 };
let captions: { id: string; rect: Rect; view: ReturnType<typeof copy> }[] = [];
let motion = { x: 0, y: 0, rotation: 0 }, manualHint = false;
let motionElapsed = 0;
let menuOpen = false, menuPainting = false;
const seenHints = new Set<string>(), csp: object[] = [];
const host = document.querySelector<HTMLElement>('#stage')!;
const app = new Application(), world = new Container(), viewRoot = new Container(), overlay = new Container(), bodyMask = new Graphics();
let ui = viewRoot;
const background = new Sprite(), room = new Sprite(), cat = new Sprite();
let stand: NineSliceSprite, catHit: Container | null = null, catBubble: Container | null = null, catShadow: Graphics | null = null, catPerch = 0;
let catTravel: { from: { x: number; y: number }; to: { x: number; y: number }; start: number } | null = null;
const roomWindow = new Sprite(), windowMask = new Graphics(), tableMask = new Graphics(), windowFrame = new Graphics();
const standFootShadow = new Graphics();
const textures = new Map<string, Texture>(), pictures = new Map<string, Texture>();
const current = (): Word => { if (practice) return practice.phase === 'intro' ? practice.introWord : practice.word ?? practice.introWord; if (connected && flow.active && !flow.word) throw new Error('В опубликованном задании нет слова.'); return flow.active && flow.word ? flow.word : words[wordIndex]!; };
const currentConstruction = () => { if (connected && flow.active && ['construction', 'construction-intro'].includes(task) && !flow.construction) throw new Error('В опубликованном задании нет конструкции.'); return flow.active && flow.construction ? flow.construction : data.construction; };
const currentVideo = () => { if (connected && flow.active && !flow.video && flow.step?.kind === 'video') throw new Error('В опубликованном задании нет видео.'); return flow.active && flow.video ? flow.video : data.video; };
const box = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const counter = (): Counter => { if (connected && flow.active) { if (!connected.counter) throw new Error('В опубликованном задании нет счётной карточки.'); return connected.counter; } return counters.find(value => value.kind === countKinds[task]) ?? counters[0]!; };
const isWord = () => task.startsWith('word-') || task.startsWith('recall-');
const isListening = () => ['word-listen', 'recall-listen', 'count-listen'].includes(task);
const hintKey = () => task === 'word-listen' || task === 'recall-listen' ? task : task.startsWith('word-') && task !== 'word-intro' ? 'word-quiz' : task.startsWith('recall-') ? 'recall' : task;
const semantic = document.createElement('h1'); semantic.className = 'semantic-copy'; host.append(semantic);
const screenCopy = document.createElement('p'); screenCopy.id = 'canvas-description'; screenCopy.className = 'semantic-copy'; host.append(screenCopy);
const status = document.createElement('p'); status.className = 'semantic-copy'; status.setAttribute('role', 'status'); host.append(status);
const loginEmail = new EditorBridge('email', schedule); loginEmail.element.setAttribute('aria-label', 'Электронная почта');
const loginPassword = new EditorBridge(true, schedule); loginPassword.element.setAttribute('aria-label', 'Пароль локальной копии');
loginPassword.element.autocomplete = 'current-password';
const editor = new EditorBridge(false, () => { correct = null; feedback = ''; schedule(); }); editor.element.value = '';
const audio = new Audio(); audio.preload = 'none';
const video = document.createElement('video'); video.className = 'native-video'; video.playsInline = true; video.preload = 'none'; video.hidden = true; host.append(video);
video.setAttribute('aria-label', 'Официальный видеодиалог Marugoto');
for (const media of [audio, video]) {
  media.addEventListener('play', () => { if (media === audio) video.pause(); else audio.pause(); playing = true; played = true; learnAction(); schedule(); });
  media.addEventListener('pause', () => { playing = !audio.paused || !video.paused; schedule(); });
  media.addEventListener('ended', () => { playing = !audio.paused || !video.paused; schedule(); });
  media.addEventListener('error', () => { if (media.getAttribute('src')) say('Запись не загрузилась. Попробуйте ещё раз.'); });
}
let caption = '';
video.addEventListener('timeupdate', () => {
  const next = currentVideo().captions.find(value => video.currentTime >= value.startSeconds && (value.endSeconds === null || video.currentTime < value.endSeconds))?.text ?? '';
  if (caption !== next) { caption = next; schedule(); }
});
document.addEventListener('securitypolicyviolation', event => csp.push({ directive: event.effectiveDirective, blocked: event.blockedURI }));

function schedule() { if (!ready) return; cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { frame = 0; render(); }); }
function say(value: string) { feedback = value; status.textContent = value; schedule(); }
function learnAction() { seenHints.add(hintKey()); manualHint = false; }
function cancelAuto() { clearTimeout(autoTimer); autoTimer = undefined; autoDeadline = 0; }
function queueAuto(run: () => void) {
  cancelAuto(); const owner = viewRevision; autoDeadline = performance.now() + 1200;
  autoTimer = setTimeout(() => { autoTimer = undefined; autoDeadline = 0; if (owner === viewRevision && correct === true && !document.hidden && !menuOpen) run(); }, 1200);
}
function enterCard() { enteredAt = performance.now(); motionElapsed = 0; motion = { x: 0, y: reduced() ? -8 : 0, rotation: 0 }; if (ready) app.start(); }
function finishApproach() { mobileApproach = false; host.classList.remove('stand-enter'); cameraProgress = 1; schedule(); }
function navigate(value: Task, keepLesson = false) {
  if (connected && !['textbook', 'lesson-overview', 'part-complete', 'lesson-complete'].includes(value) && !keepLesson) return;
  cancelAuto(); catTravel = null; viewRevision++;
  mediaEpoch++;
  if (!keepLesson) flow.active = false;
  audio.pause(); audio.removeAttribute('src'); audio.load(); video.pause(); task = value; selection = null; revealed = false; correct = null; hadMistake = false; feedback = ''; tokenOrder = []; manual = false; showBreakdown = false; played = false; manualHint = false; menuOpen = false; introTab = 0; overviewTab = 0;
  editor.element.value = ''; caption = ''; video.removeAttribute('src'); video.load();
  const url = new URL(location.href); url.searchParams.set('task', task);
  if (keepLesson && flow.selectedId) url.searchParams.set('lesson', flow.selectedId); else url.searchParams.delete('lesson');
  history.replaceState(null, '', url); scrollTo(0, 0); enterCard(); resize();
}
async function openLesson(id: string) { await flow.open(id); if (connected?.error) return; learnAction(); navigate('lesson-overview', true); }
function syncLesson() {
  const step = flow.step;
  if (step?.kind === 'counter-practice') { navigate(step.format === 'recall' ? 'count-recall' : step.format === 'listening-image' ? 'count-listen' : 'count-reading', true); return; }
  const next: Task = !step ? 'lesson-complete' : step.kind === 'word-practice' ? ({ 'ja-ru': 'word-ja', listening: 'word-listen', 'ru-ja': 'word-ru' } as const)[step.mode]
    : step.kind === 'construction-practice' ? ({ 'ja-ru': 'recall-ja', listening: 'recall-listen', grammar: 'construction' } as const)[step.mode] : step.kind;
  navigate(next, true);
}
function lessonAdvance(action: LearningAdvance['action'], requireResult = false) {
  const ticket = flow.ticket();
  return async () => { if (requireResult && (correct === null || editor.composing || manual)) return;
    const details = task === 'construction' && connected ? { tokenIds: tokenOrder.map(index => currentConstruction().tokens[index]!.id) } : {};
    if (await flow.advance(ticket, action, details)) syncLesson(); };
}
function startLesson(restart = false) { flow.start(restart); cameraStarted = performance.now(); syncLesson(); }
function nextWord() { wordIndex = (wordIndex + 1) % words.length; navigate(task); }
async function speak(source: string | null | undefined) {
  if (!source) { say('Запись для этого примера недоступна.'); return; }
  const epoch = ++mediaEpoch; audio.pause(); audio.src = source; audio.currentTime = 0;
  try { await audio.play(); } catch (error) { if (epoch === mediaEpoch && !(error instanceof DOMException && error.name === 'AbortError')) say('Нажмите на воспроизведение ещё раз.'); }
}
function copy(root: Container, value: string, x: number, y: number, size = 20, options: { width?: number; center?: boolean; hand?: boolean; sans?: boolean; color?: string } = {}) {
  return label(root, value, x, y, size, { width: options.width, center: options.center, color: options.color ?? ink, fontFamily: options.hand ? hand : options.sans ? 'system-ui, sans-serif' : book });
}
function surface(root: Container, r: Rect, texture: Texture, tint = '#ffffff') {
  const sourceW = texture.width, scale = Math.min(r.width / sourceW, .36);
  const paper = new NineSliceSprite({ texture, leftWidth: 24, rightWidth: 24, topHeight: 20, bottomHeight: 20 });
  paper.width = r.width / scale; paper.height = r.height / scale; paper.scale.set(scale); paper.position.set(r.x, r.y); paper.tint = tint; root.addChild(paper); return paper;
}
function image(root: Container, texture: Texture, r: Rect, multiply = false) {
  const sprite = new Sprite(texture), scale = Math.min(r.width / texture.width, r.height / texture.height);
  sprite.scale.set(scale); sprite.position.set(r.x + (r.width - sprite.width) / 2, r.y + (r.height - sprite.height) / 2);
  if (multiply) sprite.blendMode = 'multiply'; root.addChild(sprite); return sprite;
}
function interactive(root: Container, id: string, title: string, r: Rect, action: () => void, enabled = true) {
  enabled = enabled && !connected?.busy && (!menuOpen || menuPainting);
  const node = new Container(); node.position.set(r.x, r.y); node.eventMode = enabled ? 'static' : 'none'; node.cursor = 'pointer'; node.hitArea = new Rectangle(0, 0, r.width, r.height);
  node.accessible = enabled; node.accessibleType = 'button'; node.accessibleHint = title; node.accessiblePointerEvents = 'none';
  node.on('pointertap', () => { if (enabled && !suppressTap) action(); }); root.addChild(node);
  let parent: Container | null = root, attached = false;
  while (parent) { if (parent === overlay) attached = true; parent = parent.parent; }
  const global = root.toGlobal({ x: r.x, y: r.y }); controls.push({ id, label: title, rect: { ...r, x: global.x, y: global.y + scrollY }, enabled, docked: attached });
  controlRuns.set(id, action);
  return node;
}
function action(root: Container, id: string, title: string, r: Rect, run: () => void, options: ActionOptions = {}) {
  const enabled = options.enabled ?? true, node = interactive(root, id, title, r, run, enabled);
  const inset = r.width < 180 ? 8 : 12, contentWidth = r.width - inset * 2, center = r.width / 2;
  const paper = options.bare ? null : surface(node, box(0, 0, r.width, r.height), textures.get(answerUrl)!, options.wrong ? '#f5e0d1' : options.selected ? '#e3eccf' : '#ffffff');
  const focus = new Graphics(); node.addChild(focus); node.alpha = 1;
  const drawFocus = (hover = false) => { focus.clear(); if (options.selected || options.wrong || hover) focus.roundRect(6, 5, r.width - 12, r.height - 10, 6).stroke({ color: options.wrong ? '#823e32' : sage, width: options.selected || options.wrong ? 3 : 2 }); };
  drawFocus();
  node.on('mouseover', () => { drawFocus(true); app.render(); });
  node.on('mouseout', () => { drawFocus(); app.render(); });
  if (options.wrong) node.accessibleHint = `${title || 'Этот вариант'}. Неверно. Можно выбрать другой ответ.`;
  if (options.value) {
    const size = options.size ?? Math.min(27, Math.max(22, contentWidth / Math.max(1, options.value.surface.length)));
    const width = Math.max(textWidth(options.value.surface, size, jp), textWidth(options.value.kana, Math.max(12, Math.round(size * .4)), jp));
    ruby.push(japanese(node, options.value, 'furigana', box(width <= contentWidth ? center - width / 2 : inset, 6, contentWidth, r.height - 8), size, jp));
  } else {
    const size = options.size ?? (options.hand ? 23 : 21);
    const text = copy(node, title, center, 0, size, { center: true, width: contentWidth, hand: options.hand, color: options.selected ? sage : ink });
    while (text.height > r.height - 12 && Number(text.style.fontSize) > 14) {
      const size = Number(text.style.fontSize) - 1; text.style.fontSize = size; text.style.lineHeight = size * 1.45;
    }
    text.y = (r.height - text.height) / 2;
    captions.push({ id, rect: controls[controls.length - 1]!.rect, view: text });
  }
  if (paper) paper.label = 'paper'; actionSpecs.set(id, { node, id, title, rect: r, run, options }); return node;
}
function deck(r: Rect) {
  const texture = textures.get(cardUrl)!;
  ui.addChild(new Graphics().roundRect(r.x + 3, r.y + 9, r.width - 6, r.height + 5, 8).fill({ color: '#382313', alpha: .17 }));
  surface(ui, box(r.x + 1, r.y + 8, r.width - 2, r.height), texture, '#d4c2a2');
  surface(ui, box(r.x, r.y + 4, r.width, r.height), texture, '#eee2cb');
  const root = new Container(); root.position.set(r.x, r.y + motion.y); ui.addChild(root); surface(root, box(0, 0, r.width, r.height), texture);
  topCard = root; cardOrigin = { x: r.x, y: r.y }; return root;
}
type SpokenLine = { id: string; title: string; audioUrl?: string | null };
function centeredJapanese(root: Container, value: JapaneseValue, y: number, width: number, size = 94, speech?: SpokenLine, record = true) {
  const margin = introTabbed ? 16 : 24, available = width - margin * 2 - (speech ? 52 : 0);
  size = Math.max(22, Math.min(size, available / Math.max(1, value.surface.length)));
  const longest = Math.max(...value.segments.filter(segment => segment.reading && segment.reading !== segment.surface).map(segment => segment.surface.length), 1);
  size = Math.min(size, available / longest);
  const actual = Math.max(textWidth(value.surface, size, jp), textWidth(value.kana, Math.max(12, Math.round(size * .28)), jp));
  const left = actual <= available ? (width - actual - (speech ? 52 : 0)) / 2 : margin;
  const layout = japanese(root, value, 'furigana', box(left, y, available, 300), size, jp, .28);
  if (record) ruby.push(layout);
  const last = layout.groups.at(-1);
  if (speech && last && record) {
    const button = action(root, speech.id, '▶', box(left + last.x + last.width + 8, y + last.y + Math.max(0, (size * 1.65 - 44) / 2), 44, 44), () => { void speak(speech.audioUrl); }, { bare: true, size: 22 });
    button.accessibleHint = speech.title;
  }
  return Math.max(layout.height, speech ? 44 : 0);
}
function wordIntroduction(root: Container, width: number, word: Word, example: (JapaneseValue & { meaningRu: string; audioUrl?: string | null }) | null | undefined, record = true) {
  if (introTabbed) {
    let height = 0;
    if (introTab === 0) {
      height = 20 + centeredJapanese(root, word, 20, width, shortWide() ? 36 : 44, { id: 'intro-listen', title: 'Прослушать слово', audioUrl: word.audioUrl }, record);
      const meaning = copy(root, word.meaningRu, width / 2, height + 8, 20, { center: true, width: width - 32 }); height += meaning.height + 20;
    } else if (introTab === 1) {
      const explanation = copy(root, word.introduction?.explanationRu ?? 'Послушайте слово и сравните его с примером.', 16, 20, 16, { width: width - 32, sans: true }); height = 20 + explanation.height + 12;
    } else if (example) {
      height = 20 + centeredJapanese(root, example, 20, width, width < 300 ? 22 : 25, { id: 'intro-example-listen', title: 'Прослушать пример', audioUrl: example.audioUrl }, record);
      const translation = copy(root, example.meaningRu, 16, height + 8, 16, { width: width - 32, sans: true }); height += translation.height + 20;
    }
    if (record) {
      const titles = example ? ['Слово', 'Смысл', 'Пример'] : ['Слово', 'Смысл'];
      titles.forEach((title, index) => action(root, `intro-tab-${index}`, title, box(12 + index * (width - 24) / titles.length, introSlotHeight - 52, (width - 24) / titles.length, 44), () => { introTab = index; schedule(); }, { bare: true, selected: introTab === index, size: 17 }));
    }
    return height + 60;
  }
  const height = centeredJapanese(root, word, 64, width, 58, { id: 'intro-listen', title: 'Прослушать слово', audioUrl: word.audioUrl }, record), meaningY = 64 + height + 12;
  const meaning = copy(root, word.meaningRu, width / 2, meaningY, 24, { center: true, width: width - 48 });
  const bodyY = meaningY + meaning.height + 12;
  const rule = copy(root, word.introduction?.explanationRu ?? 'Послушайте слово, затем перейдём к практике.', 24, bodyY, 16, { width: width - 48, sans: true });
  if (!example) return bodyY + rule.height + 24;
  const y = bodyY + rule.height + 14;
  const exampleHeight = centeredJapanese(root, example, y, width, 25, { id: 'intro-example-listen', title: 'Прослушать пример', audioUrl: example.audioUrl }, record);
  const translation = copy(root, example.meaningRu, 24, y + exampleHeight + 12, 17, { width: width - 48, sans: true });
  return y + exampleHeight + 12 + translation.height + 20;
}
function measureIntroduction(width: number) {
  const entries = practice ? practiceFixture.introduced.map(intro => ({ word: { ...practiceFixture.words.find(word => word.id === intro.wordId)!, introduction: intro }, example: intro.example })) : flow.active && flow.part ? flow.part.words.map(intro => ({ word: { ...lessonCatalog.words.find(word => word.id === intro.wordId)!, introduction: intro }, example: intro.example })) : [{ word: current(), example: null }];
  const measure = () => Math.max(...entries.map(({ word, example }) => {
    const root = new Container(), height = wordIntroduction(root, width, word, example, false);
    root.destroy({ children: true }); return height;
  }));
  introTabbed = false;
  const full = measure();
  if (!fitStudy() || full <= paperCapacity()) return full;
  introTabbed = true;
  const previous = introTab, heights = [0, 1, 2].map(index => { introTab = index; return measure(); }); introTab = previous;
  return Math.max(...heights);
}
function woodenSign(root: Container, rect: Rect) {
  root.addChild(new Graphics().roundRect(rect.x + 1, rect.y + 4, rect.width, rect.height, 5).fill({ color: '#28190f', alpha: .3 }));
  surface(root, rect, pictures.get('stand-rail')!, '#ffffff');
  root.addChild(new Graphics().roundRect(rect.x, rect.y, rect.width, rect.height, 5).fill({ color: '#ffe7bd', alpha: .68 }));
  root.addChild(new Graphics().roundRect(rect.x + 3, rect.y + 3, rect.width - 6, rect.height - 6, 4).stroke({ color: '#744522', width: 1.5 }));
}
function header(root: Container = ui) {
  if (standMode()) {
    const width = studyWidth(), x = studyX(width), compact = app.screen.width < 700;
    for (const offset of [.14, .86]) root.addChild(new Graphics().roundRect(x + width * offset - 6, 20, 12, shortWide() ? 42 : signHeight() + 48, 3).fill('#8a572f').stroke({ color: '#c58b50', width: 1.5 }));
    woodenSign(root, box(x, 4, width, 50));
    const menu = action(root, 'menu', '', box(x, 8, 44, 44), () => { if (practice) { practice.phase = 'choose'; navigate('practice-study'); return; } menuOpen = true; cancelAuto(); audio.pause(); video.pause(); schedule(); }, { bare: true, size: 24 }); menu.accessibleHint = 'Открыть разделы';
    const menuInk = new Graphics(); for (const y of [16, 22, 28]) menuInk.moveTo(13, y).lineTo(31, y).stroke({ color: ink, width: 2.5 }); menu.addChild(menuInk);
    image(root, textures.get(logoUrl)!, box(x + width / 2 - (denseStudy() ? 45 : 75), 7, (denseStudy() ? 90 : 150), 44));
    if (denseStudy()) action(root, 'help', '?', box(x + 44, 8, 44, 44), () => { manualHint = !manualHint; schedule(); }, { bare: true, size: 22 });
    copy(root, practice ? practice.phase === 'question' ? String(practice.queue.length) : 'A1' : introTabbed && flow.active ? `${flow.session!.introIndex + 1}/${flow.part!.words.length}` : flow.active ? `${flow.progress().percent}%` : isWord() ? `${wordIndex + 1} из ${words.length}` : 'A1', x + width - 42, 16, 20, { center: true, hand: true });
    if (shortWide() || denseStudy()) return;
    woodenSign(root, box(x, 58, width, 45));
    if (practice) {
      copy(root, practice.phase === 'choose' ? 'Сравним закрепление' : `${practice.variant === 'choice' ? 'А · Выбор ответа' : 'Б · Вспоминание'}${practice.delayed ? ' · После паузы' : ''}`, x + width / 2, 65, 20, { center: true, width: width - 100 });
      action(root, 'study-home', '≡', box(x, 58, 44, 44), () => { cancelAuto(); practice.phase = 'choose'; navigate('practice-study'); }, { bare: true, size: 22 });
      return;
    }
    if (connected && !flow.active) {
      action(root, 'section', 'Учебник', box(x, 58, width - 86, 44), () => navigate('textbook'), { bare: true, size: 22 });
      if (connected.user) action(root, 'logout', 'Выйти', box(x + width - 86, 58, 86, 44), () => { void connected.logout().then(() => navigate('textbook')); }, { bare: true, size: 18 });
    } else if (flow.active) {
      copy(root, compact ? `Урок ${flow.lesson!.number}` : `Урок ${flow.lesson!.number} · ${flow.lesson!.title}`, x + width / 2 - 22, 65, 20, { center: true, width: width - 150 });
      action(root, 'lesson-exit', 'Выйти', box(x + width - 80, 58, 80, 44), () => navigate('textbook'), { bare: true, size: 20 });
      action(root, 'help', '?', box(x, 58, 44, 44), () => { cancelAuto(); manualHint = !manualHint; schedule(); }, { bare: true, size: 24 });
    } else if (compact) {
      action(root, 'section', task === 'textbook' ? 'Учебник' : task === 'reference' ? 'Справочник' : 'Повторение', box(x, 58, width - 52, 44), () => { menuOpen = true; cancelAuto(); audio.pause(); video.pause(); schedule(); }, { bare: true, size: 22 });
      action(root, 'help', '?', box(x + width - 44, 58, 44, 44), () => { cancelAuto(); manualHint = !manualHint; schedule(); }, { bare: true, size: 24 });
    } else for (const [index, [title, destination]] of [['Учебник', 'textbook'], ['Повторение', 'word-ja'], ['Справочник', 'reference']].entries()) action(root, `nav-${destination}`, title!, box(x + index * width / 3, 58, width / 3, 44), () => navigate(destination as Task), { bare: true, size: 21 });
    return;
  }
  const w = app.screen.width, x = Math.max(14, (w - 800) / 2), width = Math.min(w - 28, 800);
  if (shortWide() && usesDock()) {
    surface(root, box(14, 8, w - 28, 52), textures.get(answerUrl)!);
    const menu = action(root, 'menu', '≡', box(18, 12, 44, 44), () => { if (practice) { practice.phase = 'choose'; navigate('practice-study'); return; } menuOpen = true; cancelAuto(); audio.pause(); video.pause(); schedule(); }, { bare: true, size: 24 }); menu.accessibleHint = 'Открыть разделы';
    image(root, textures.get(logoUrl)!, box(78, 10, 130, 45));
    copy(root, flow.active ? `Урок ${flow.lesson!.number} · ${flow.progress().percent}%` : task.startsWith('count') ? 'Счёт' : task.includes('construction') ? 'Фразы' : task === 'video' ? 'Видео' : 'Занятие', w / 2, 20, 22, { hand: true, center: true, width: w - 460 });
    const help = action(root, 'help', '?', box(w - 142, 12, 44, 44), () => { cancelAuto(); manualHint = !manualHint; schedule(); }, { bare: true, size: 24 }); help.accessibleHint = 'Как пользоваться заданием';
    action(root, 'lesson-exit', 'К урокам', box(w - 90, 12, 76, 44), () => navigate('textbook'), { hand: true, size: 20, bare: true }); return;
  }
  const logoW = Math.min(174, width - 154);
  image(root, textures.get(logoUrl)!, box(x + 50 + (width - 140 - logoW) / 2, 20, logoW, 54));
  const compact = w < 700;
  surface(root, box(x, 82, width, 54), textures.get(answerUrl)!);
  const left = action(root, 'menu', '≡', box(x, 23, 44, 44), () => { menuOpen = true; cancelAuto(); audio.pause(); video.pause(); schedule(); }, { size: 25 });
  left.accessibleHint = 'Открыть разделы';
  if (!compact) { const help = action(root, 'help', '?', box(x + 52, 23, 44, 44), () => { cancelAuto(); manualHint = !manualHint; schedule(); }, { size: 25 }); help.accessibleHint = 'Как пользоваться заданием'; }
  const progress = flow.active ? `${flow.progress().percent}%` : isWord() ? `${wordIndex + 1} из ${words.length}` : task.startsWith('count') ? 'Счёт' : task === 'video' ? 'Видео' : 'A1';
  const slip = surface(root, box(x + width - 80, 24, 80, 43), textures.get(answerUrl)!);
  copy(root, progress, slip.x + 40, 29, 23, { hand: true, center: true });
  if (flow.active) {
    copy(root, compact ? `Урок ${flow.lesson!.number}` : `Урок ${flow.lesson!.number} · ${flow.lesson!.title}`, x + width / 2 - 25, 90, compact ? 22 : 25, { center: true, hand: true, width: width - 164 });
    action(root, 'lesson-exit', 'Выйти', box(x + width - 91, 85, 91, 47), () => navigate('textbook'), { hand: true, bare: true, size: 22 });
    if (compact) action(root, 'help', '?', box(x, 85, 44, 47), () => { cancelAuto(); manualHint = !manualHint; schedule(); }, { bare: true, size: 25 });
  } else if (compact) {
    const section = flow.active || task === 'lesson-overview' || task === 'textbook' ? 'Учебник' : task === 'reference' ? 'Справочник' : 'Повторение';
    action(root, 'section', section, box(x, 85, width - 60, 47), () => { menuOpen = true; audio.pause(); video.pause(); schedule(); }, { hand: true, size: 25 });
    const help = action(root, 'help', '?', box(x + width - 46, 85, 44, 47), () => { cancelAuto(); manualHint = !manualHint; schedule(); }, { hand: true, size: 27, bare: true }); help.accessibleHint = 'Как пользоваться заданием';
  } else {
    const tabW = (width - 16) / 3;
    for (const [index, [title, destination]] of [['Учебник', 'textbook'], ['Повторение', 'word-ja'], ['Справочник', 'reference']].entries()) action(root, `nav-${destination}`, title!, box(x + index * (tabW + 8), 85, tabW, 47), () => navigate(destination as Task), { hand: true, size: 25, bare: true });
  }
}
function drawMenu() {
  if (!menuOpen) return;
  cancelAuto();
  if (connected) { menuOpen = false; navigate('textbook'); return; }
  const width = Math.min(440, standMode() ? studyWidth() - 12 : app.screen.width - 32), x = standMode() ? studyX() + (studyWidth() - width) / 2 : (app.screen.width - width) / 2, height = app.screen.width >= 1100 ? 418 : 305;
  const y = paintedScroll + (standMode() ? Math.max(stageTop() + 8, Math.min(headerHeight() + 8, stageHeight() - height - 8)) : Math.max(16, Math.min(145, (innerHeight - height) / 2)));
  const blocker = new Graphics().rect(0, 0, app.screen.width, app.screen.height).fill({ color: '#20170e', alpha: .35 }); blocker.eventMode = 'static'; blocker.on('pointertap', () => { menuOpen = false; schedule(); }); overlay.addChild(blocker);
  surface(overlay, box(x, y, width, height), textures.get(cardUrl)!); menuPainting = true;
  copy(overlay, 'Разделы', x + width / 2, y + 18, 28, { hand: true, center: true });
  const close = action(overlay, 'menu-close', '×', box(x + width - 47, y + 7, 44, 44), () => { menuOpen = false; schedule(); }, { hand: true, bare: true }); close.accessibleHint = 'Закрыть разделы';
  for (const [index, [title, destination]] of [['Учебник', 'textbook'], ['Повторение', 'word-ja'], ['Справочник', 'reference']].entries()) action(overlay, `nav-${destination}`, title!, box(x + 23, y + 68 + index * 52, width - 46, 45), () => navigate(destination as Task), { hand: true, size: 25 });
  if (app.screen.width >= 1100) {
    copy(overlay, 'Композиция стенда', x + 24, y + 234, 19, { hand: true });
    const cell = (width - 54) / 3;
    for (const [index, [id, title]] of [['zoom', 'Переход'], ['window', 'Окно'], ['surround', 'Окружение']].entries()) action(overlay, `composition-${id}`, title!, box(x + 21 + index * (cell + 6), y + 276, cell, 57), () => setComposition(id as Composition), { hand: true, size: 19, selected: composition === id });
    action(overlay, 'composition-stand', 'Стойка для занятий', box(x + 21, y + 344, width - 42, 52), () => setComposition('stand'), { size: 21, selected: standMode() });
  }
  menuPainting = false;
}
function setComposition(value: Composition) {
  composition = value; menuOpen = false; catTravel = null; mobileApproach = false; host.classList.remove('stand-enter'); cameraStarted = performance.now(); cancelAuto();
  const url = new URL(location.href); url.searchParams.set('composition', value); history.replaceState(null, '', url);
  enterCard(); resize();
}
function fitStudy() { return standMode() && (practice ? practice.phase === 'intro' || practice.phase === 'question' : ['lesson-overview', 'part-complete', 'lesson-complete', 'word-intro', 'word-ja', 'word-ru', 'word-listen'].includes(task)); }
function signHeight() { return shortWide() || denseStudy() ? 58 : 110; }
function standCapacity() { return shortWide() ? innerHeight - 66 : Math.max(220, innerHeight - signHeight() - 12 - (denseStudy() ? 180 : 630) * standScale() - 24); }
function paperCapacity() { return standCapacity() - 18 - 82 - 26; }
function introPage() { return task === 'word-intro' || practice?.phase === 'intro'; }
function usesDock() { if (practice) return practice.phase === 'intro' || practice.phase === 'question'; return task !== 'textbook' && task !== 'reference'; }
function standMode() { return composition === 'stand'; }
function denseStudy() { return fitStudy() && app.screen.width < 700 && innerHeight < 740; }
function standScale() { return denseStudy() ? .09 : app.screen.width >= 1000 ? Math.min(.42, Math.max(.18, (innerHeight - 700) / 630)) : shortWide() ? .3 : .18; }
function shortWide() { return app.screen.width >= 700 && innerHeight < 560; }
function desktopStage() { return app.screen.width >= 1000 && innerHeight >= 620; }
function studySpan() {
  const desired = introPage() && introSlotHeight ? 18 + introSlotHeight + 26 + 82 + (!fitStudy() && !wideStage() && !collapsedHint() ? 104 : 0)
    : infoSlotHeight ? 18 + infoSlotHeight + 26 + 82
    : practice?.phase === 'question' && practice.recall && !practice.hinted ? practiceRecallLayout(studyWidth(), practice.revealed, recallAnswerHeight).height
    : wideStage() ? 710 : innerHeight;
  return Math.min(standCapacity(), desired);
}
function stageTop() { return standMode() ? shortWide() ? 66 : signHeight() + 180 * standScale() + 24 + Math.max(0, (innerHeight - studySpan() - signHeight() - 12 - 630 * standScale() - 24) / 2) : desktopStage() && usesDock() ? Math.max(0, (innerHeight - 720) / 2) : 0; }
function headerHeight() { return standMode() ? stageTop() + 8 : stageTop() + (shortWide() && usesDock() ? 66 : 142); }
function wideStage() { return desktopStage() || shortWide(); }
function collapsedHint() { return standMode() && innerHeight < 740 && !wideStage() && !manualHint && !feedback; }
function shortQuiz() { return standMode() && innerHeight < 740 && !wideStage() && (task.startsWith('word-') && task !== 'word-intro' || task.startsWith('count-') && task !== 'count-recall'); }
function stageHeight() { return standMode() ? stageTop() + studySpan() : desktopStage() ? stageTop() + Math.min(innerHeight, 720) : innerHeight; }
function contentOffset() { return standMode() ? stageTop() - 140 : usesDock() ? shortWide() ? -76 : desktopStage() ? stageTop() + 44 : 0 : 0; }
function studyWidth() { return Math.min(!standMode() && task === 'textbook' && app.screen.width >= 1000 ? 1000 : shortWide() && usesDock() ? standMode() ? app.screen.width - 54 : Math.min(470, app.screen.width - 340) : desktopStage() && (usesDock() || standMode()) ? Math.min(640, app.screen.width - 500) : 640, app.screen.width - (standMode() ? 54 : 38)); }
function studyX(width = studyWidth()) { return shortWide() && usesDock() && !standMode() ? Math.max(24, (app.screen.width - width - 340) / 2) : (app.screen.width - width) / 2; }
function shortGuide() {
  if (task === 'construction') return manual ? 'Введите фразу японской клавиатурой и проверьте.' : 'Выбирайте слова по порядку. Нажатие на слово в фразе убирает его.';
  if (task.startsWith('recall-') || task === 'count-recall') return 'Вспомните ответ, затем откройте карточку и сравните.';
  if (isListening()) return 'Послушайте запись, затем выберите ответ.';
  if (task.endsWith('intro')) return 'Послушайте слово и пример. Затем — «Дальше».';
  if (task === 'video') return 'Посмотрите фрагмент. Его можно пропустить и продолжить урок.';
  return 'Выберите ответ. Я подскажу, как получилось.';
}
function dockControls(x: number, width: number) {
  const compactDock = shortWide() && !fitStudy();
  const get = (id: string) => actionSpecs.get(id);
  let primary: ActionSpec | undefined, secondary: ActionSpec | undefined, upper: ActionSpec[] = [];
  if (practice) {
    if (practice.phase === 'question' && practice.revealed) { primary = get('study-self-remember'); secondary = get('study-self-again'); }
    else if (practice.phase === 'question' && practice.recall && !practice.hinted) {
      if (shortWide()) { primary = get('study-reveal'); secondary = get('study-hint'); }
      else { primary = get('study-hint'); upper = [get('study-reveal')!]; }
    }
    else { primary = get('study-next') ?? get('next'); secondary = get('study-prev'); }
  }
  else if (task.endsWith('intro')) { primary = get('intro-next'); secondary = get('intro-prev'); upper = (task === 'word-intro' ? [] : [get('intro-listen'), get('intro-example-listen')]).filter((v): v is ActionSpec => !!v); }
  else if (task === 'construction') { primary = get('next') ?? get('check'); secondary = get('clear'); upper = [get('manual')!]; }
  else if (task === 'video') { primary = get('video-next'); upper = [get('video-play')!, get('video-seek')!]; }
  else if (task === 'lesson-overview') { primary = get('lesson-start'); secondary = get('lesson-back'); }
  else if (task === 'lesson-complete') { primary = get('lesson-back'); secondary = get('lesson-restart'); }
  else if (task === 'part-complete') primary = get('part-next');
  else if (task.startsWith('recall-') || task === 'count-recall') { primary = get('remember') ?? get('reveal-counter'); secondary = get('again'); }
  else primary = get('next') ?? get('next-counter');
  const removed = ['study-next', 'study-prev', 'study-hint', 'study-reveal', 'study-self-remember', 'study-self-again', ...(task === 'word-intro' ? [] : ['intro-listen', 'intro-example-listen']), 'intro-prev', 'intro-next', 'manual', 'check', 'clear', 'next', 'next-counter', 'video-next', 'video-play', 'video-seek', 'lesson-start', 'lesson-back', 'lesson-restart', 'part-next', 'again', 'remember', 'reveal-counter'];
  for (const id of removed) { const spec = get(id); if (!spec) continue; spec.node.removeFromParent(); spec.node.destroy({ children: true }); actionSpecs.delete(id); controls = controls.filter(c => c.id !== id); captions = captions.filter(c => c.id !== id); }
  const compactSpeech = !fitStudy() && !wideStage() && (introPage() ? !collapsedHint() : !!(feedback || guideText)), extra = upper.length > 0;
  let speechHeight = 0;
  if (compactSpeech) {
    const measure = new Text({ text: feedback || shortGuide(), style: { fontFamily: 'system-ui, sans-serif', fontSize: 16, lineHeight: 23.2, wordWrap: true, wordWrapWidth: standMode() ? width - 94 : app.screen.width - 132, breakWords: true } });
    speechHeight = shortQuiz() && !manualHint ? 104 : Math.max(104, measure.height + 73); measure.destroy();
  }
  const base = extra && !compactDock ? 146 : 82;
  dockTop = stageHeight() - base - speechHeight;
  const root = new Container(); root.y = paintedScroll; overlay.addChild(root);
  const blocker = new Graphics().rect(0, dockTop, app.screen.width, stageHeight() - dockTop).fill({ color: '#70482c', alpha: .001 }); blocker.eventMode = 'static'; root.addChild(blocker);
  surface(root, box(x, stageHeight() - base + 4, width, base - 8), textures.get(cardUrl)!);
  const half = (width - 12) / 2, y = stageHeight() - 68, compactCell = (width - 36) / 4;
  dockIds = [];
  const paint = (spec: ActionSpec, rect: Rect) => {
    const short: Record<string, string> = { 'Начать занятие': 'Начать', 'Посмотреть итог': 'Итог', 'К выбору урока': 'К урокам', 'Пройти ещё раз': 'Ещё раз', 'Следующая часть': 'Дальше', 'Завершить занятие': 'Завершить', 'Продолжить урок': 'Дальше', ...(compactDock ? { 'Ввести самому': 'Ввод', 'Собирать из слов': 'Слова', 'Показать ответ': 'Открыть' } : {}) };
    const title = short[spec.title] ?? (spec.title.startsWith('Продолжить ·') ? 'Продолжить' : spec.title);
    const node = action(root, spec.id, title, rect, spec.run, spec.options); node.accessibleHint = spec.title;
    controls[controls.length - 1]!.docked = true; dockIds.push(spec.id);
  };
  if (upper.length) upper.forEach((spec, index) => paint(spec, compactDock ? box(x + (index + 1) * (compactCell + 12), y, compactCell, 52) : box(x + (upper.length === 1 ? 0 : index * (half + 12)), y - 64, upper.length === 1 ? width : half, 52)));
  if (secondary) paint(secondary, box(x, y, compactDock ? compactCell : half, 52));
  const primaryRect = compactDock ? box(x + 3 * (compactCell + 12), y, compactCell, 52) : box(x + half + 12, y, half, 52);
  if (primary) paint(primary, primaryRect);
  else if (task.startsWith('recall-')) {
    const reveal = controlRuns.get('reveal')!;
    const button = action(root, 'dock-reveal', 'Открыть', primaryRect, reveal, { hand: true }); button.accessibleHint = 'Открыть ответ'; controls[controls.length - 1]!.docked = true; dockIds.push('dock-reveal');
  } else if (task.startsWith('word-') || task.startsWith('count-')) {
    action(root, 'next', 'Дальше', primaryRect, () => {}, { hand: true, enabled: false }); controls[controls.length - 1]!.docked = true; dockIds.push('next');
  }
  if (autoDeadline) { action(root, 'auto-pause', 'Остаться', box(x, y, compactDock ? compactCell : half, 52), () => { cancelAuto(); schedule(); }, { hand: true }); controls[controls.length - 1]!.docked = true; dockIds.push('auto-pause'); }
  else if (!secondary && !compactDock) { const note = copy(root, fitStudy() && feedback ? correct ? 'Кот: Верно!' : 'Кот: Попробуй ещё.' : practice?.recall && !practice.hinted ? 'Без подсказки' : connected?.busy ? 'Сохраняем…' : correct === false ? 'Можно выбрать ещё раз' : selection !== null ? 'Ответ принят' : task.endsWith('intro') ? 'Знакомимся с новым' : 'Не торопитесь', x + 18, 0, 16, { width: half - 24 }); note.y = y + (52 - note.height) / 2; }
  return { root, base, speech: compactSpeech };
}
function catSeat(index: number, speaking = false) {
  if (!wideStage() && usesDock() && !speaking) return { x: index ? studyX() + studyWidth() + 14 - cat.width : studyX() - 14, y: paintedScroll + innerHeight - 8 - cat.height };
  if (!wideStage() && usesDock()) return { x: index ? studyX() + studyWidth() + 14 - cat.width : studyX() - 14, y: paintedScroll + dockTop + 28 };
  const span = stageHeight() - stageTop(), s = standScale();
  const ledge = index ? stageHeight() + 12 + 35 * s : stageTop() - 12 + (500 - 180) / 650 * (span + 24);
  return { x: studyX() + studyWidth() + 24 + 135 * s - cat.width / 2, y: paintedScroll + ledge - cat.height + 3 };
}
// shortcut: one pose hops between two perches; add gait frames after the stand design is accepted.
function moveCat() {
  if (!standMode() || catTravel) return;
  catPerch = 1 - catPerch; cancelAuto();
  if (reduced()) { schedule(); return; }
  catTravel = { from: { x: cat.x, y: cat.y }, to: catSeat(catPerch, !!speechBounds), start: performance.now() };
  if (catBubble) catBubble.visible = false;
  if (catShadow) catShadow.visible = false;
  app.start();
}
function companion(x: number, width: number, dock?: ReturnType<typeof dockControls>) {
  const wide = wideStage(), fullGuide = wide && !shortWide(), message = fitStudy() && !wide && !manualHint ? '' : collapsedHint() ? '' : manualHint && usesDock() ? fullGuide ? helpMessage() : shortGuide() : feedback || (guideText ? fullGuide ? guideText : shortGuide() : '');
  const side = wide && (usesDock() || app.screen.width - width >= 260);
  const size = side ? usesDock() ? shortWide() ? 100 : Math.min(184, app.screen.width - x - width - 48) : Math.max(84, Math.min(196, app.screen.width - x - width - 44)) : dock ? 66 : 78;
  cat.width = size; cat.height = size / cat.texture.width * cat.texture.height;
  if (wide && usesDock()) cat.position.set(x + width + 32, paintedScroll + Math.min(stageTop() + 400, stageHeight() - (dock?.base ?? 82) - size - 22));
  else cat.position.set(app.screen.width - size - 14, side ? paintedScroll + 410 : app.screen.height - cat.height - 20);
  if (!wide && dock) cat.position.set(13, paintedScroll + dockTop + 28);
  cat.visible = side || !!dock && !!message;
  catHit = null; catBubble = null; catShadow = null;
  if (standMode()) {
    const close = !wideStage();
    cat.width = close ? 66 : Math.max(44, Math.min(110, standScale() * 260, 2 * (app.screen.width - x - width - 24 - 135 * standScale() - 8))); cat.height = cat.width / cat.texture.width * cat.texture.height;
    const seat = catSeat(catPerch, !!message || !!dock?.speech); if (!catTravel) cat.position.set(seat.x, seat.y); cat.visible = close ? !!dock && (dock.speech || cat.y >= paintedScroll + stageHeight() - 4) : seat.x + cat.width <= app.screen.width;
    if (close && dock && (message || dock.speech)) surface(overlay, box(x - 18, paintedScroll + dockTop + 89, width + 36, 24), pictures.get('stand-rail')!);
  }
  if (cat.visible) {
    catShadow = new Graphics().ellipse(cat.x + cat.width / 2, cat.y + cat.height - 3, cat.width * .42, cat.width * .045).fill({ color: '#382313', alpha: .24 }); overlay.addChild(catShadow);
  }
  if (message) {
    const bx = wide ? x + width + 20 : standMode() ? catPerch ? x - 14 : x + 62 : 87, bubbleWidth = wide ? Math.min(284, app.screen.width - bx - 16) : standMode() ? width - 62 : app.screen.width - 100;
    const text = copy(overlay, message, 16, 44, wide ? 18 : 16, { width: bubbleWidth - 32, sans: true });
    const height = Math.max(84, text.height + 57), by = fitStudy() && !wide ? paintedScroll + Math.max(headerHeight() + 8, dockTop - height - 14) : wide ? Math.max(paintedScroll + 16, cat.y - height - 28) : paintedScroll + dockTop + 8;
    speechBounds = box(bx, by, bubbleWidth, height);
    const bubble = new Container(); bubble.position.set(bx, by); overlay.addChild(bubble); catBubble = bubble;
    bubble.addChild(new Graphics().roundRect(2, 4, bubbleWidth, height, 13).fill({ color: '#281b10', alpha: .2 }));
    bubble.addChild(new Graphics().roundRect(0, 0, bubbleWidth, height, 13).fill('#fff7e7').stroke({ color: '#6c5035', width: 1.5 }).poly(wide ? [45, height - 1, 69, height - 1, 73, height + 23] : standMode() && catPerch ? [bubbleWidth - 2, 39, bubbleWidth - 2, 57, bubbleWidth + 14, 61] : [2, 39, 2, 57, -14, 61]).fill('#fff7e7').stroke({ color: '#6c5035', width: 1 }));
    copy(bubble, 'Кот', 16, 6, 19, { hand: true }); bubble.addChild(text);
    if (!feedback || manualHint) { const close = action(bubble, 'dismiss-hint', '×', box(bubbleWidth - 45, 0, 44, 44), () => { learnAction(); schedule(); }, { bare: true, size: 22 }); close.accessibleHint = 'Скрыть подсказку'; }
  }
  if (catTravel) { if (catBubble) catBubble.visible = false; if (catShadow) catShadow.visible = false; }
  if (standMode() && cat.visible) { catHit = action(overlay, 'cat-call', '', box(cat.x, cat.y, cat.width, cat.height), moveCat, { bare: true }); catHit.accessibleHint = 'Позвать кота на другую полку'; }
  overlay.addChild(cat);
}
function helpMessage() {
  if (task === 'construction') return manual ? 'Введите фразу японской клавиатурой. Пока выбирается IME-кандидат, проверка подождёт.' : 'Нажмите на слово — оно добавится в фразу. На компьютере слова можно перетаскивать.';
  if (task.startsWith('recall-') || task === 'count-recall') return revealed ? '«Ещё раз» — повторить; «Помню» — дальше. Можно смахнуть карточку в нужную сторону.' : task.endsWith('listen') ? 'Сначала прослушайте запись. Затем коснитесь карточки, чтобы сравнить ответ.' : 'Сначала вспомните ответ. Коснитесь верхней карточки, чтобы открыть его.';
  if (isListening()) return played ? 'Теперь выберите то, что вы услышали.' : 'Нажмите «Прослушать». После начала записи станут доступны ответы.';
  if (task.startsWith('count-')) return 'Рассмотрите задание и нажмите на подходящий вариант. Подсказка объясняет действие, не ответ.';
  if (task === 'video') return 'Нажмите воспроизведение. Японские субтитры появятся под видео; запись можно повторить.';
  if (task === 'textbook') return 'Выберите урок. Затем познакомимся со словами, выполним задания и подведём итог занятия.';
  if (task === 'reference') return 'Здесь можно открыть правило или вернуться к словам без оценки ответа.';
  if (task.endsWith('intro')) return 'Послушайте пример и прочитайте объяснение. К практике можно перейти, когда будете готовы.';
  return 'Нажмите на подходящий перевод. Правильный ответ откроется после выбора.';
}
function drawHelp(y: number, x: number, width: number) {
  if (seenHints.has(hintKey()) && !manualHint) return 0;
  const message = helpMessage();
  if (usesDock()) { guideText = message; return 0; }
  const root = new Container(); root.position.set(x, y); ui.addChild(root);
  const text = copy(root, message, 71, 14, 16, { width: width - 126, sans: true });
  const height = Math.max(80, text.height + 28);
  const paper = surface(root, box(0, 0, width, height), textures.get(answerUrl)!); root.setChildIndex(paper, 0);
  const close = action(root, 'dismiss-hint', '×', box(width - 46, 7, 44, 44), () => { learnAction(); schedule(); }, { hand: true, size: 27, bare: true }); close.accessibleHint = 'Скрыть подсказку';
  return height;
}
function feedbackAt(y: number, x: number, width: number, next = true) {
  if (!feedback) return;
  if (next) action(ui, 'next', 'Дальше', box(x, y + 56, width, 52), practice ? () => { if (practice.next()) navigate('practice-study'); } : flow.active ? lessonAdvance(correct && !hadMistake ? 'remember' : 'again', true) : nextWord, { hand: true });
}
function choiceGrid<T>(items: T[], y: number, x: number, width: number, make: (item: T, r: Rect, index: number) => void, height = 59, columns = 2) {
  const gap = 12, cell = (width - (columns - 1) * gap) / columns;
  items.forEach((item, index) => { const last = items.length % 2 === 1 && index === items.length - 1; make(item, box(x + index % columns * (cell + gap), y + Math.floor(index / columns) * (height + gap), last ? width : cell, height), index); });
  return y + Math.ceil(items.length / columns) * (height + gap);
}

function quiz(x: number, width: number) {
  const short = shortWide() || fitStudy() && app.screen.width < 700, split = shortWide() && standMode(), compact = standMode() && !short, word = current(), listening = practice ? practice.current?.mode === 'listening' : task === 'word-listen', reverse = practice ? practice.current?.mode === 'ru-ja' : task === 'word-ru';
  const options: Word[] = practice ? practice.choices : flow.active ? flow.choices : words, choiceSize = short ? 18 : 21;
  const questionWidth = split ? Math.min(320, width * .4) : width, answersWidth = split ? width - questionWidth - 20 : width;
  const measuredHeight = (columnWidth: number) => reverse ? Math.max(59, ...options.map(word => {
    const measure = new Container(), size = short ? 20 : Math.min(27, Math.max(22, columnWidth / Math.max(1, word.surface.length)));
    const layout = japanese(measure, word, 'furigana', box(0, 0, columnWidth, 1000), size, jp); measure.destroy({ children: true }); return layout.height + 14;
  })) : Math.max(59, ...options.map(word => {
    const root = new Container(), text = copy(root, word.meaningRu, 0, 0, choiceSize, { width: columnWidth }); const height = text.height + 20; root.destroy({ children: true }); return height;
  }));
  const optionWidth = (answersWidth - 12) / 2;
  const columns = 2, height = measuredHeight(optionWidth - (optionWidth < 180 ? 16 : 24)), promptY = denseStudy() ? 36 : short ? 52 : reverse ? compact ? 88 : 111 : compact ? 66 : 88;
  let promptSize = reverse ? short ? 26 : 38 : short ? 44 : compact ? 76 : 94;
  let questionHeight = short ? 150 : compact ? 196 : 261;
  if (short && !split) {
    const budget = paperCapacity() + 26 - 24 - 2 * (height + 12);
    const measure = () => {
      if (listening) return 62;
      const root = new Container(), height = reverse ? copy(root, word.meaningRu, width / 2, 0, promptSize, { center: true, width: width - 40 }).height : centeredJapanese(root, word, 0, width, promptSize, undefined, false);
      root.destroy({ children: true }); return height;
    };
    let measured = measure();
    while (promptY + measured + 12 > budget && promptSize > 20) { promptSize--; measured = measure(); }
    questionHeight = promptY + measured + (denseStudy() ? 4 : 12);
  }
  if (split) questionHeight = Math.min(196, standCapacity() - 18 - 82 - 16);
  const r = box(x, 158, questionWidth, questionHeight), root = deck(r);
  copy(root, short ? listening ? 'Что прозвучало?' : reverse ? 'По-японски' : 'Как перевести?' : listening ? 'Что прозвучало?' : reverse ? 'Выберите японское слово' : 'Как переводится слово?', questionWidth / 2, denseStudy() ? 4 : short ? 12 : 24, denseStudy() ? 18 : short ? 20 : 22, { center: true, width: questionWidth - 42 });
  if (listening) action(root, 'listen', playing ? 'Слушаем…' : '▶ Прослушать', box(24, short ? promptY : compact ? 80 : 104, questionWidth - 48, short ? 62 : 78), () => { void speak(word.audioUrl); }, { hand: true, size: short ? 22 : 26 });
  else if (reverse) copy(root, word.meaningRu, questionWidth / 2, promptY, promptSize, { center: true, width: questionWidth - 40 });
  else centeredJapanese(root, word, promptY, questionWidth, promptSize);
  const bottom = choiceGrid<Word>(options, split ? r.y : r.y + r.height + (denseStudy() ? 12 : 24), split ? x + questionWidth + 20 : x, answersWidth, (candidate, area, index) => {
    action(ui, `word-option-${index}`, reverse ? candidate.surface : candidate.meaningRu, area, async () => {
      if (correct === true || connected?.busy) return;
      audio.pause(); selection = candidate.id;
      if (connected) feedback = 'Проверяю…';
      const result = practice ? (practice.choose(candidate.id), practice.correct) : connected ? await connected.choose(candidate.id) : candidate.id === word.id;
      if (result === undefined) { selection = null; schedule(); return; }
      correct = result; hadMistake ||= !correct; learnAction();
      say(shortQuiz() ? correct ? 'Верно!' : 'Попробуй ещё раз.' : correct ? hadMistake ? 'Да, теперь верно! Позже повторим это слово.' : 'Да, всё верно!' : 'Не совсем. Попробуй выбрать ещё раз — я подожду.');
      if (correct) queueAuto(practice ? () => { practice.next(); navigate('practice-study'); } : flow.active ? lessonAdvance(hadMistake ? 'again' : 'remember', true) : nextWord);
    }, { enabled: correct !== true && (!listening || played), selected: correct === true && candidate.id === selection, wrong: correct === false && candidate.id === selection, value: reverse ? candidate : undefined, size: reverse ? short ? 20 : undefined : choiceSize });
  }, height, columns);
  if (selection !== null) feedbackAt(bottom + 7, x, width); else drawHelp(bottom + 24, x, width);
}

function recall(x: number, width: number) {
  const word = current(), content = new Container();
  const listening = task === 'recall-listen', reverse = task === 'recall-ru';
  copy(content, listening ? 'Вспомните смысл услышанного' : reverse ? 'Вспомните по-японски' : 'Вспомните перевод', width / 2, 24, 21, { center: true, width: width - 44 });
  if (reverse && !revealed) copy(content, word.meaningRu, width / 2, 126, 38, { center: true, width: width - 50 });
  else if (!listening || revealed) centeredJapanese(content, word, 93, width, 80);
  if (revealed) copy(content, word.meaningRu, width / 2, 242, 26, { center: true, width: width - 50 });
  const height = Math.max(318, content.getLocalBounds().maxY + 40), root = deck(box(x, 158, width, height)); root.addChild(content);
  if (listening && !revealed) action(root, 'listen', playing ? 'Слушаем…' : '▶ Прослушать', box(30, 100, width - 60, 74), () => { void speak(word.audioUrl); }, { hand: true, size: 26 });
  const reveal = () => { if (listening && !played) { void speak(word.audioUrl); return; } revealed = true; learnAction(); say('Сравни с тем, что вспомнил. Если было трудно — повторим.'); status.textContent = `Ответ открыт: ${word.surface}, ${word.kana} — ${word.meaningRu}.`; };
  const again = flow.active ? lessonAdvance('again') : nextWord, remember = flow.active ? lessonAdvance('remember') : nextWord;
  const touch = interactive(root, 'reveal', 'Раскрыть карточку', box(10, listening && !revealed ? 205 : 70, width - 20, listening && !revealed ? 80 : 230), reveal);
  let start: { x: number; y: number } | null = null;
  touch.on('pointerdown', event => { start = { x: event.global.x, y: event.global.y }; });
  touch.on('pointerup', event => { if (!start || !revealed) return; const dx = event.global.x - start.x, dy = event.global.y - start.y; if (Math.abs(dx) > 70 && Math.abs(dx) > Math.abs(dy) * 1.5) { suppressTap = true; (dx < 0 ? again : remember)(); setTimeout(() => { suppressTap = false; }, 0); } start = null; });
  if (!revealed) copy(root, listening ? 'Коснитесь после прослушивания' : 'Коснитесь карточки', width / 2, 276, 17, { center: true, hand: true });
  if (revealed) {
    action(ui, 'again', 'Ещё раз', box(x, 501, (width - 12) / 2, 58), again, { hand: true });
    action(ui, 'remember', 'Помню', box(x + (width + 12) / 2, 501, (width - 12) / 2, 58), remember, { hand: true });
  }
  drawHelp(590, x, width);
}

let dropZone: Rect | null = null, drag: { token: number; x: number; y: number; moved: boolean; ghost: Container } | null = null, suppressTap = false;
function beginDrag(node: Container, token: number, source: Rect) {
  node.on('pointerdown', (event: FederatedPointerEvent) => {
    if (event.pointerType === 'touch') return;
    const ghost = new Container(); ghost.visible = false; ui.addChild(ghost); surface(ghost, box(0, 0, source.width, source.height), textures.get(answerUrl)!);
    copy(ghost, currentConstruction().tokens[token]!.surface, source.width / 2, 10, 22, { center: true }); ghost.alpha = .9;
    drag = { token, x: event.global.x, y: event.global.y, moved: false, ghost };
  });
  node.on('globalpointermove', (event: FederatedPointerEvent) => { if (!drag) return; if (Math.hypot(event.global.x - drag.x, event.global.y - drag.y) > 8) drag.moved = true; if (drag.moved) { const point = ui.toLocal(event.global); drag.ghost.visible = true; drag.ghost.position.set(point.x - source.width / 2, point.y - source.height / 2); app.render(); } });
  const finish = (event: FederatedPointerEvent) => {
    if (!drag) return; const moved = drag.moved, token = drag.token; drag.ghost.destroy({ children: true }); drag = null;
    if (moved) { suppressTap = true; if (dropZone && new Rectangle(dropZone.x, dropZone.y, dropZone.width, dropZone.height).contains(event.global.x, event.global.y + scrollY)) addToken(token); setTimeout(() => { suppressTap = false; }, 0); }
  };
  node.on('pointerup', finish); node.on('pointerupoutside', finish);
  node.on('pointercancel', () => { drag?.ghost.destroy({ children: true }); drag = null; });
}
function addToken(index: number) { if (!tokenOrder.includes(index)) tokenOrder.push(index); correct = null; learnAction(); say(''); }
function construction(x: number, width: number) {
  const exercise = currentConstruction();
  const prompt = copy(ui, exercise.promptRu, width / 2, 69, 29, { center: true, width: width - 50 });
  const selectedY = Math.max(139, 69 + prompt.height + 26);
  let tx = 19, ty = selectedY;
  const chips = tokenOrder.map((index, order) => {
    const token = exercise.tokens[index]!, w = Math.min(width - 38, Math.max(56, textWidth(token.surface, 21, jp) + 22));
    if (tx + w > width - 18) { tx = 19; ty += 59; }
    const rect = box(tx, ty, w, 49); tx += w + 7; return { index, order, token, rect };
  });
  const height = Math.max(315, ty + 90), root = deck(box(x, 158, width, height)); root.addChild(prompt);
  copy(root, 'Соберите фразу', width / 2, 21, 24, { hand: true, center: true });
  dropZone = box(x + 18, 158 + selectedY - 5, width - 36, Math.max(150, ty - selectedY + 59));
  if (manual && !menuOpen) editor.draw(ui, dropZone, 'Введите фразу по-японски');
  else {
    if (!tokenOrder.length) copy(root, 'Ваша фраза появится здесь', width / 2, 170, 18, { center: true, hand: true, width: width - 50, color: '#74614b' });
    chips.forEach(({ order, token, rect }) => action(root, `selected-${order}`, token.surface, rect, () => { tokenOrder.splice(order, 1); correct = null; say(''); }, { size: 21 }));
  }
  const bank = exercise.tokens.length === 4 ? [1, 3, 0, 2] : exercise.tokens.map((_, index) => (index + 1) % exercise.tokens.length);
  const bottom = choiceGrid(bank, 158 + height + 25, x, width, (index, area) => {
    if (tokenOrder.includes(index)) { const p = surface(ui, area, textures.get(answerUrl)!); p.alpha = .25; return; }
    const button = action(ui, `token-${index}`, exercise.tokens[index]!.surface, area, () => { manual = false; addToken(index); }, { size: 22 });
    beginDrag(button, index, area);
  }, 53);
  action(ui, 'manual', manual ? 'Собирать из слов' : 'Ввести самому', box(x, bottom + 10, width, 48), () => { manual = !manual; correct = null; feedback = ''; schedule(); if (manual) setTimeout(() => editor.element.focus(), 50); }, { hand: true, size: 22 });
  action(ui, 'check', 'Проверить', box(x, bottom + 70, (width - 12) * .62, 51), async () => {
    if (editor.composing) { say('Завершите выбор японского текста.'); return; }
    const value = manual ? editor.element.value : tokenOrder.map(index => exercise.tokens[index]!.surface).join('');
    correct = flow.active ? await flow.checkConstruction(tokenOrder, manual ? value : undefined) : value.replace(/[。\s]/g, '') === exercise.example.surface.replace(/[。\s]/g, '');
    if (correct !== null) hadMistake ||= !correct;
    learnAction(); say(correct === null && connected?.checkFeedback ? connected.checkFeedback : correct ? 'Получилось! Фраза собрана.' : 'Попробуем ещё раз. Можно исправить фразу или вернуться к ней позже.');
    if (correct && flow.active) queueAuto(lessonAdvance(hadMistake ? 'again' : 'remember', true));
  }, { hand: true });
  action(ui, 'clear', 'Сначала', box(x + (width - 12) * .62 + 12, bottom + 70, (width - 12) * .38, 51), () => { tokenOrder = []; editor.element.value = ''; correct = null; say(''); }, { hand: true });
  if (feedback) feedbackAt(bottom + 138, x, width, flow.active && correct !== null); else drawHelp(bottom + 139, x, width);
}

function objects(root: Container, tile: number, quantity: number, r: Rect) {
  const texture = pictures.get(`counter-${tile}`)!;
  const copies = Math.min(quantity, 10), columns = Math.min(copies, 5), rows = Math.ceil(copies / columns), cellW = r.width / columns, cellH = r.height / rows;
  for (let i = 0; i < copies; i++) image(root, texture, box(r.x + i % columns * cellW, r.y + Math.floor(i / columns) * cellH, cellW - 3, cellH - 3), true);
  if (quantity > 10) copy(root, String(quantity), r.x + r.width - 22, r.y + r.height - 38, 28, { hand: true });
}
function count(x: number, width: number) {
  const card = counter(), kind = card.kind;
  const titles: Record<string, string> = { 'image-counter': 'Какое счётное слово подходит?', 'counter-image': 'Что считают этим суффиксом?', 'reading-choice': 'Выберите чтение количества', 'listening-image': 'Послушайте и выберите количество', recall: 'Вспомните количество по-японски' };
  const root = deck(box(x, 158, width, 279));
  copy(root, titles[kind]!, width / 2, 20, 21, { center: true, width: width - 42 });
  if (correct === true || revealed) {
    centeredJapanese(root, card.answer, 102, width, 64);
  } else if (kind === 'counter-image') centeredJapanese(root, card.answer, 101, width, 77);
  else if (kind === 'listening-image') action(root, 'listen', playing ? 'Слушаем…' : '▶ Прослушать', box(26, 115, width - 52, 73), () => { void speak(card.audioUrl); }, { hand: true, size: 26 });
  else {
    objects(root, card.object.tile, card.quantity ?? 1, box(54, 103, width - 108, 112));
    copy(root, `${card.word.kana} · ${card.word.meaningRu}`, width / 2, 235, 17, { center: true, width: width - 44 });
  }
  if (kind === 'recall') {
    if (!revealed) action(ui, 'reveal-counter', 'Показать ответ', box(x, 463, width, 58), () => { revealed = true; learnAction(); schedule(); }, { hand: true });
    else {
      action(ui, 'again', 'Ещё раз', box(x, 463, (width - 12) / 2, 58), flow.active ? lessonAdvance('again') : () => navigate(task), { hand: true });
      action(ui, 'remember', 'Помню', box(x + (width + 12) / 2, 463, (width - 12) / 2, 58), flow.active ? lessonAdvance('remember') : () => navigate(task), { hand: true });
      copy(ui, card.definition.explanation, x + 14, 547, 16, { width: width - 28, sans: true });
    }
    drawHelp(revealed ? 657 : 548, x, width); return;
  }
  const pictureOptions = kind === 'counter-image' || kind === 'listening-image';
  const bottom = choiceGrid(card.options, 461, x, width, (option, area, index) => {
    const choice = action(ui, `count-option-${index}`, pictureOptions ? '' : option.label, area, async () => {
      if (correct === true || connected?.busy) return; selection = option.key;
      if (connected) feedback = 'Проверяю…';
      const result = connected ? await connected.chooseCounter(option.key) : card.acceptedKeys.includes(option.key);
      if (result === undefined) { selection = null; schedule(); return; }
      correct = result; hadMistake ||= !correct; audio.pause(); learnAction();
      say(correct ? 'Верно!' : shortQuiz() ? 'Попробуй ещё раз.' : 'Не совсем. Попробуй выбрать ещё раз.');
      if (correct) queueAuto(flow.active ? lessonAdvance(hadMistake ? 'again' : 'remember', true) : () => navigate(task));
    }, { enabled: correct !== true && (kind !== 'listening-image' || played), selected: correct === true && option.key === selection, wrong: correct === false && option.key === selection, size: kind === 'reading-choice' ? 22 : 21 });
    if (pictureOptions && option.object) {
      choice.accessibleHint = `${option.label}, количество ${option.quantity ?? 1}${correct === false && option.key === selection ? '. Неверно. Можно выбрать другой ответ.' : ''}`;
      const inset = Math.min(44, area.width * .24);
      const text = copy(choice, kind === 'listening-image' ? String(option.quantity ?? 1) : option.label, (inset + area.width - 12) / 2, 0, 17, { center: true, width: area.width - inset - 12 });
      text.y = area.height - text.height - 8;
      objects(choice, option.object.tile, option.quantity ?? 1, box(12, 7, area.width - 24, text.y - 12));
      captions.push({ id: `count-option-${index}-picture-label`, rect: controls.find(c => c.id === `count-option-${index}`)!.rect, view: text });
    }
  }, pictureOptions ? 126 : 55);
  if (selection !== null) {
    action(ui, 'next-counter', 'Дальше', box(x, bottom + 59, width, 52), flow.active ? lessonAdvance(hadMistake ? 'again' : 'remember', true) : () => navigate(task), { hand: true });
  } else drawHelp(bottom + 18, x, width);
}

function introduction(x: number, width: number) {
  const isCounter = task === 'counter-intro', isConstruction = task === 'construction-intro';
  const bodyInset = 24, content = new Container(), exercise = currentConstruction();
  let paperHeight = 525;
  if (!introTabbed || isCounter || isConstruction) copy(content, isCounter ? 'Знакомимся со счётным словом' : isConstruction ? 'Как устроена фраза' : flow.active ? `Знакомство · ${flow.session!.introIndex + 1} из ${flow.part!.words.length}` : 'Знакомимся со словом', width / 2, 23, 23, { hand: true, center: true, width: width - 44 });
  if (isCounter) {
    const card = counters[2]!;
    centeredJapanese(content, { surface: card.definition.surface, kana: card.definition.kana, segments: [{ surface: card.definition.surface, reading: card.definition.kana }] }, 92, width, 68);
    copy(content, data.counterDefinition!.title, width / 2, 205, 23, { center: true });
    copy(content, card.definition.explanation, 23, 255, 16, { width: width - 46, sans: true });
    card.examples.forEach((example, index) => { const cell = (width - bodyInset - 19) / 3; ruby.push(japanese(content, example, 'furigana', box(bodyInset + index * cell, 360, cell - 4, 54), 26, jp)); });
  } else if (isConstruction) {
    const height = centeredJapanese(content, exercise.example, 100, width, 29), meaningY = Math.max(180, 100 + height + 20);
    const meaning = copy(content, exercise.promptRu, width / 2, meaningY, 27, { center: true, width: width - 48 });
    const ruleY = meaningY + meaning.height + 20, rule = copy(content, exercise.explanationRu, 24, ruleY, 16, { width: width - 48, sans: true });
    paperHeight = Math.max(532, ruleY + rule.height + Math.max(150, width * .3));
  } else {
    paperHeight = introSlotHeight;
  }
  const root = deck(box(x, 158, width, paperHeight)); root.addChild(content);
  if (!isCounter && !isConstruction) wordIntroduction(root, width, current(), flow.active ? flow.introduction?.example : null);
  if (isCounter) counters[2]!.examples.forEach((example, index) => { const cell = (width - bodyInset - 19) / 3; action(root, `example-${index}`, '▶', box(bodyInset + index * cell, 419, cell - 9, 45), () => { void speak(example.audioUrl); }, { hand: true }); });
  if (isConstruction) action(root, 'breakdown', showBreakdown ? 'Свернуть разбор' : 'Разбор по частям', box(26, paperHeight - 83, width - 52, 48), () => { showBreakdown = !showBreakdown; learnAction(); resize(); }, { hand: true });
  const bottom = 158 + paperHeight + 26;
  const example = flow.active && !isConstruction ? flow.introduction?.example : null;
  if (isCounter || isConstruction) action(ui, 'intro-listen', playing ? 'Слушаем…' : example ? '▶ Слово' : '▶ Послушать', box(x, bottom, example ? (width - 12) / 2 : width, 52), () => { void speak(isConstruction ? exercise.example.audioUrl : isCounter ? counters[2]!.audioUrl : current().audioUrl); }, { hand: true });
  if (example && isCounter) action(ui, 'intro-example-listen', '▶ Пример', box(x + (width + 12) / 2, bottom, (width - 12) / 2, 52), () => { void speak(example.audioUrl); }, { hand: true });
  if (flow.active && !isConstruction) {
    const ticket = flow.ticket(), index = flow.session!.introIndex, last = index === flow.part!.words.length - 1;
    action(ui, 'intro-prev', '← Назад', box(x, bottom + 66, 100, 53), () => { if (flow.introduce(ticket, -1)) syncLesson(); }, { hand: true, enabled: index > 0, size: 21 });
    action(ui, 'intro-next', last ? 'К заданиям' : 'Дальше', box(x + 112, bottom + 66, width - 112, 53), async () => { if (last ? await flow.advance(ticket, 'start-practice') : flow.introduce(ticket, 1)) syncLesson(); }, { hand: true });
  } else action(ui, 'intro-next', 'К практике', box(x, bottom + 66, width, 53), flow.active ? lessonAdvance('continue') : () => navigate(isConstruction ? 'construction' : isCounter ? 'count-category' : 'word-ja'), { hand: true });
  if (isConstruction && showBreakdown) {
    let y = bottom + 141;
    for (const piece of exercise.breakdown) { copy(ui, piece.text, x + 18, y, 24); const explanation = copy(ui, piece.explanationRu, x + 18, y + 38, 16, { width: width - 36, sans: true }); y += explanation.height + 63; }
  } else drawHelp(bottom + 145, x, width);
}

function practiceRecallLayout(width: number, revealed: boolean, answerHeight: number) {
  const split = revealed && shortWide(), questionHeight = revealed ? 140 : shortWide() ? 180 : 230;
  const questionWidth = split ? Math.min(320, width * .4) : width;
  const answerWidth = split ? width - questionWidth - 20 : width;
  const cardsHeight = revealed ? split ? Math.max(questionHeight, answerHeight) : questionHeight + 24 + answerHeight : questionHeight;
  return { split, questionWidth, questionHeight, answerWidth, height: 18 + cardsHeight + 26 + (revealed || shortWide() ? 82 : 146) };
}
function practiceAnswer(root: Container, width: number, word: Word, reverse: boolean, record = true) {
  return reverse ? centeredJapanese(root, word, 14, width, 32, undefined, record) + 30
    : copy(root, word.meaningRu, width / 2, 16, 20, { center: true, width: width - 32 }).height + 32;
}
function measurePracticeAnswer(width: number) {
  const answerWidth = practiceRecallLayout(width, true, 0).answerWidth;
  const known = new Set([...practiceFixture.familiar, ...practiceFixture.introduced.map(intro => intro.wordId)]);
  return Math.max(100, ...practiceFixture.words.filter(word => known.has(word.id)).flatMap(word => [false, true].map(reverse => {
    const root = new Container(), height = practiceAnswer(root, answerWidth, word, reverse, false);
    root.destroy({ children: true }); return height;
  })));
}
function practicePage(x: number, width: number) {
  if (!practice) return;
  const repaint = () => navigate('practice-study'), gap = 12, half = (width - gap) / 2;
  if (practice.phase === 'choose' || practice.phase === 'summary') {
    const summary = practice.phase === 'summary', content = new Container();
    let y = 24;
    const paragraph = (text: string, size = 18, sans = true, gap = 20) => {
      const line = copy(content, text, 24, y, size, { width: width - 48, sans }); y += line.height + gap;
    };
    paragraph(summary ? 'Как прошло закрепление' : 'Два способа закрепления', 26, false);
    paragraph(summary ? 'Сравниваем ощущения, а не ставим оценку памяти.' : 'Учебный пример: пять фраз уже знакомы. Познакомимся с тремя следующими словами урока 2.');
    if (summary) {
      for (const variant of ['choice', 'recall'] as const) {
        const records = practice.records[variant].filter(record => !record.delayed);
        paragraph(`${variant === 'choice' ? 'А · Выбор' : 'Б · Вспоминание'}${records.length ? '' : ' — ещё не проходили'}`, 22, false, 10);
        if (records.length) paragraph(`Первые ошибки: ${records.filter(r => r.firstError).length} · Подсказки: ${records.filter(r => r.hint).length}\nСамооценка «совпало»: ${records.filter(r => r.self === true).length} · «ещё раз»: ${records.filter(r => r.self === false).length}`, 16);
      }
      const delayed = practice.records.recall.filter(record => record.delayed);
      if (delayed.length) paragraph(`После паузы · Самооценка «совпало»: ${delayed.filter(r => r.self === true).length} · «ещё раз»: ${delayed.filter(r => r.self === false).length} · Подсказки: ${delayed.filter(r => r.hint).length}`, 16);
      paragraph('Проверку после паузы запускайте, когда захотите вернуться. Самооценка не доказывает удержание материала.', 16, true, 8);
    } else {
      paragraph('А · Сразу четыре варианта', 23, false, 8);
      paragraph('Текущие задания и опубликованные ответы.', 17);
      paragraph('Б · От узнавания к вспоминанию', 23, false, 8);
      paragraph('Сначала лёгкий круг, затем знакомые слова вперемешку. Можно вспомнить самому или попросить варианты.', 17);
      paragraph('Только демонстрация. Оценки и расписание ученика не меняются.', 16, true, 8);
    }
    const root = deck(box(x, 158, width, y + 16)); root.addChild(content);
    const bottom = 158 + y + 40;
    for (const [index, variant] of (['choice', 'recall'] as const).entries()) action(ui, `study-start-${variant}`, `${index ? 'Б' : 'А'} · ${summary ? 'Ещё раз' : 'Попробовать'}`, box(x + index * (half + gap), bottom, half, 54), () => { practice.start(variant); repaint(); });
    if (summary) action(ui, 'study-recheck', 'Проверить после паузы', box(x, bottom + 68, width, 54), () => { practice.recheck(); repaint(); });
    return;
  }
  if (practice.phase === 'intro') {
    const root = deck(box(x, 158, width, introSlotHeight));
    if (!introTabbed) copy(root, `Знакомство · ${practice.introIndex + 1} из ${practiceFixture.introduced.length}`, width / 2, 23, 23, { center: true, width: width - 44 });
    wordIntroduction(root, width, practice.introWord, practice.intro.example);
    action(ui, 'study-prev', '← Назад', box(x, 158 + introSlotHeight + 26, half, 52), () => { practice.introduce(-1); repaint(); }, { enabled: practice.introIndex > 0 });
    action(ui, 'study-next', practice.introIndex === practiceFixture.introduced.length - 1 ? 'К заданиям' : 'Дальше', box(x + half + gap, 158 + introSlotHeight + 26, half, 52), () => { if (practice.introIndex === practiceFixture.introduced.length - 1) practice.begin(); else practice.introduce(1); repaint(); });
    return;
  }
  if (!practice.recall || practice.hinted) {
    quiz(x, width);
    if (practice.correct !== true) action(ui, 'study-next', 'Дальше', box(x, 0, 44, 44), () => {}, { enabled: false });
    return;
  }
  const word = practice.word!, reverse = practice.current!.mode === 'ru-ja', listening = practice.current!.mode === 'listening';
  const layout = practiceRecallLayout(width, practice.revealed, recallAnswerHeight);
  const root = deck(box(x, 158, layout.questionWidth, layout.questionHeight));
  copy(root, practice.revealed ? 'Сравните с ответом' : practice.recall ? 'Сначала попробуйте вспомнить' : listening ? 'Что прозвучало?' : reverse ? 'Выберите японское слово' : 'Как переводится слово?', layout.questionWidth / 2, 24, 22, { center: true, width: layout.questionWidth - 48 });
  if (listening) action(root, 'study-listen', '▶ Прослушать', box(24, 96, layout.questionWidth - 48, 62), () => { void speak(word.audioUrl); });
  else if (reverse) copy(root, word.meaningRu, layout.questionWidth / 2, practice.revealed ? 58 : 96, practice.revealed ? 20 : 28, { center: true, width: layout.questionWidth - 48 });
  else centeredJapanese(root, word, practice.revealed ? 58 : 88, layout.questionWidth, practice.revealed ? 32 : 58);
  let bottom = layout.split ? 158 : 158 + layout.questionHeight + 24;
  if (practice.revealed) {
    const content = new Container();
    practiceAnswer(content, layout.answerWidth, word, reverse);
    const answer = deck(box(layout.split ? x + layout.questionWidth + 20 : x, bottom, layout.answerWidth, recallAnswerHeight)); answer.addChild(content);
    bottom += (layout.split ? Math.max(layout.questionHeight, recallAnswerHeight) : recallAnswerHeight) + 24;
    action(ui, 'study-self-again', 'Ещё раз', box(x, bottom, half, 54), () => { practice.assess(false); practice.next(); repaint(); });
    action(ui, 'study-self-remember', 'Совпало', box(x + half + gap, bottom, half, 54), () => { practice.assess(true); practice.next(); repaint(); });
  } else if (practice.recall && !practice.hinted) {
    action(ui, 'study-reveal', 'Вспомнил — проверить', box(x, bottom, width, 56), () => { practice.reveal(); repaint(); });
    action(ui, 'study-hint', 'Нужна подсказка', box(x, bottom + 70, width, 54), () => { practice.hint(); repaint(); });

  }
  action(ui, 'study-next', 'Дальше', box(x + half + gap, bottom + 24, half, 52), () => { if (practice.next()) repaint(); }, { enabled: practice.correct === true });
}

function videoPage(x: number, width: number) {
  const area = box(x + 20, 306, width - 40, (width - 40) * 9 / 16), y = area.y + area.height + 17;
  const inset = Math.max(25, width * .28);
  const subtitles = copy(ui, caption || 'Японские субтитры появятся при воспроизведении.', inset, y + 76 - 158, 18, { width: width - inset - 25, sans: true });
  const paperHeight = Math.max(482, y + 76 - 158 + subtitles.height + 40);
  const root = deck(box(x, 158, width, paperHeight)); root.addChild(subtitles);
  copy(root, 'Видеодиалог', width / 2, 23, 25, { hand: true, center: true });
  copy(root, currentVideo().title, 23, 73, 19, { width: width - 46 });
  root.addChild(new Graphics().rect(20, area.y - 158, area.width, area.height).fill('#292d23'));
  Object.assign(video.style, { left: `${area.x}px`, top: `${area.y}px`, width: `${area.width}px`, height: `${area.height}px` }); video.hidden = !video.src || menuOpen;
  action(ui, 'video-play', video.paused ? '▶ Смотреть' : 'Ⅱ Пауза', box(x + 18, y, (width - 48) * .68, 50), () => {
    if (!video.src) video.src = currentVideo().mediaUrl;
    const epoch = ++mediaEpoch;
    if (video.paused) void video.play().catch(error => { if (epoch === mediaEpoch && !(error instanceof DOMException && error.name === 'AbortError')) say('Нажмите воспроизведение ещё раз.'); }); else video.pause();
  }, { hand: true });
  action(ui, 'video-seek', '+5 с', box(x + 30 + (width - 48) * .68, y, (width - 48) * .32, 50), () => { if (Number.isFinite(video.duration)) video.currentTime = Math.min(video.duration - .1, video.currentTime + 5); }, { hand: true });
  const bottom = 158 + paperHeight + 26;
  if (flow.active) action(ui, 'video-next', 'Продолжить урок', box(x, bottom, width, 53), lessonAdvance('skip'), { hand: true });
  if (feedback) copy(ui, feedback, x + 14, bottom + (flow.active ? 76 : 0), 17, { width: width - 28 });
  else drawHelp(bottom + (flow.active ? 76 : 0), x, width);
}
function overviewContent(width: number, tabbed: boolean) {
  const lesson = flow.lesson!, root = new Container(); let y = 20;
  const paragraph = (value: string, size = 18, sans = true) => { const text = copy(root, value, 20, y, size, { width: width - 40, sans }); y += text.height + (shortWide() ? 8 : 14); };
  paragraph(`Урок ${lesson.number} · ${lesson.title}`, width < 400 || shortWide() ? 24 : 28, false);
  if (!tabbed || overviewTab === 0) {
    const count = new Set(lesson.route.goals.flatMap(goal => goal.parts.flatMap(part => part.words.map(word => word.wordId)))).size;
    paragraph(`${count} слов и фраз · ${flow.parts.length} части`, 17);
    if (!tabbed) {
      paragraph('Чему научимся', 22, false);
      lesson.route.goals.forEach((goal, index) => paragraph(`${index + 1}. ${goal.titleRu}`));
    }
    paragraph(tabbed ? 'Слова → задания → итог. Трудные слова повторим.' : 'Знакомство со словами → практика → итог. Трудные слова встретим ещё раз.', 17);
  } else {
    paragraph(`Чему научимся · ${overviewTab} из ${lesson.route.goals.length}`, 18, false);
    paragraph(lesson.route.goals[overviewTab - 1]!.titleRu, 18);
  }
  return { root, height: y + (tabbed ? 58 : 8) };
}
function overviewLayout(width: number) {
  const full = overviewContent(width, false);
  if (!fitStudy() || full.height <= paperCapacity()) return { ...full, tabbed: false };
  full.root.destroy({ children: true });
  const selected = overviewTab;
  const heights = [-1, ...flow.lesson!.route.goals.map((_, index) => index)].map(index => { overviewTab = index + 1; const page = overviewContent(width, true); page.root.destroy({ children: true }); return page.height; });
  overviewTab = selected;
  return { ...overviewContent(width, true), height: Math.max(...heights), tabbed: true };
}
function lessonOverview(x: number, width: number) {
  if (!flow.lesson) { textbook(x, width); return; }
  const page = overviewLayout(width), root = deck(box(x, 158, width, page.height)); root.addChild(page.root);
  if (page.tabbed) {
    const labels = ['План', ...flow.lesson.route.goals.map((_, index) => `Цель ${index + 1}`)];
    labels.forEach((title, index) => { const button = action(root, `overview-tab-${index}`, (width - 24) / labels.length < 70 && index ? String(index) : title, box(12 + index * (width - 24) / labels.length, page.height - 52, (width - 24) / labels.length, 44), () => { overviewTab = index; schedule(); }, { bare: true, selected: overviewTab === index, size: 17 }); button.accessibleHint = title; });
  }
  const progress = flow.progress(), bottom = 158 + page.height + 26;
  action(ui, 'lesson-start', progress.finished ? 'Посмотреть итог' : progress.started ? `Продолжить · ${progress.percent}%` : 'Начать занятие', box(x, bottom, width, 55), () => startLesson(), { hand: true, size: 25 });
  action(ui, 'lesson-back', 'К выбору урока', box(x, bottom + 69, width, 52), () => navigate('textbook'), { hand: true });
}
function boundaryContent(width: number, record = true) {
  const finished = task === 'lesson-complete', root = new Container(); let y = 20;
  const paragraph = (value: string, size = 18, center = false) => { const text = copy(root, value, center ? width / 2 : 20, y, size, { center, width: width - 40, sans: size === 18 }); y += text.height + 14; };
  paragraph(finished ? 'Занятие завершено' : 'Часть пройдена', 26, true);
  if (finished) {
    y += centeredJapanese(root, { surface: 'おつかれさまでした', kana: 'おつかれさまでした', segments: [{ surface: 'おつかれさまでした' }] }, y, width, 25, undefined, record) + 14;
    const count = new Set(flow.lesson!.route.goals.flatMap(goal => goal.parts.flatMap(part => part.words.map(word => word.wordId)))).size;
    paragraph(connected ? `Пройдено: ${flow.progress().completed}/${flow.progress().total} шагов. Прогресс сохранён.` : `Слов и фраз: ${count}\nЗаданий: ${flow.session!.attempts}\nПовторов сложного: ${flow.session!.again}`);
    paragraph('Можно отдохнуть или выбрать следующий урок.');
  } else {
    paragraph(flow.goal?.titleRu ?? '', 20);
    paragraph(`Часть ${flow.session!.state.partIndex + 1} из ${flow.parts.length}. Все задания этой части пройдены.`);
  }
  return { root, height: y - 6 };
}
function lessonBoundary(x: number, width: number) {
  if (!flow.lesson || !flow.session) { textbook(x, width); return; }
  const page = boundaryContent(width), root = deck(box(x, 158, width, page.height)); root.addChild(page.root);
  const bottom = 158 + page.height + 26;
  if (task === 'lesson-complete') {
    action(ui, 'lesson-back', 'К выбору урока', box(x, bottom, width, 55), () => navigate('textbook'), { hand: true, size: 25 });
    if (!connected) action(ui, 'lesson-restart', 'Пройти ещё раз', box(x, bottom + 69, width, 52), () => startLesson(true), { hand: true });
  } else action(ui, 'part-next', flow.session.state.partIndex === flow.parts.length - 1 ? 'Завершить занятие' : 'Следующая часть', box(x, bottom, width, 55), lessonAdvance('continue'), { hand: true, size: 24 });
}
function connectionScreen(x: number, width: number) {
  const root = deck(box(x, 158, width, 400));
  copy(root, connected!.busy ? 'Подождите…' : connected!.error ? 'Нужна проверка' : 'Вход в локальную копию', width / 2, 26, 26, { center: true, width: width - 42 });
  if (connected!.busy) { copy(root, 'Получаем урок и подтверждение сохранения.', 24, 110, 18, { width: width - 48 }); return; }
  if (connected!.error) {
    copy(root, connected!.error, 24, 96, 18, { width: width - 48 });
    action(root, 'connection-retry', 'Загрузить сохранённое состояние', box(24, 275, width - 48, 60), () => { void connected!.boot().then(() => { if (!connected!.error) navigate('textbook'); }); }, { size: 19 });
    return;
  }
  copy(root, 'Электронная почта', 24, 85, 17);
  loginEmail.draw(ui, box(x + 24, 276, width - 48, 54), 'Адрес ученика');
  copy(root, 'Пароль локальной копии', 24, 186, 17);
  loginPassword.draw(ui, box(x + 24, 378, width - 48, 54), 'Пароль');
  action(root, 'sign-in', 'Войти', box(24, 300, width - 48, 58), () => { void connected!.signIn(loginEmail.element.value.trim(), loginPassword.element.value).then(() => { loginPassword.element.value = ''; schedule(); }); });
}
function textbook(x: number, width: number) {
  copy(ui, 'Учебник', x + width / 2, 153, 32, { hand: true, center: true });
  copy(ui, `Стартовый A1 · ${lessonCatalog.lessons.length} уроков`, x + width / 2, 200, 16, { center: true });
  const columns = app.screen.width > 900 ? 3 : 2, gap = 14, cellW = (width - (columns - 1) * gap) / columns;
  const start = 248;
  lessonCatalog.lessons.forEach((lesson, index) => {
    const r = box(x + index % columns * (cellW + gap), start + Math.floor(index / columns) * 245, cellW, 230);
    const item = action(ui, `lesson-${lesson.number}`, '', r, () => openLesson(lesson.id));
    const topic = Math.max(0, Number(lesson.topic) - 1);
    image(item, pictures.get(`topic-${topic}`)!, box(17, 13, cellW - 34, 68));
    copy(item, `Урок ${lesson.number}`, cellW / 2, 87, 18, { hand: true, center: true });
    const title = copy(item, lesson.title, cellW / 2, 119, 18, { center: true, width: cellW - 28 }); item.accessibleHint = `Урок ${lesson.number}. ${lesson.title}`;
    captions.push({ id: `lesson-${lesson.number}-title`, rect: controls.find(c => c.id === `lesson-${lesson.number}`)!.rect, view: title });
    const progress = flow.progress(lesson.id);
    copy(item, progress.finished ? 'Пройден' : progress.started ? `${progress.percent}%` : 'Новый урок', cellW / 2, 202, 14, { center: true, hand: true, color: sage });
  });
}
function reference(x: number, width: number) {
  const root = deck(box(x, 158, width, 382));
  copy(root, 'Справочник', width / 2, 23, 30, { hand: true, center: true });
  copy(root, 'Правила и примеры под рукой', width / 2, 77, 17, { center: true, width: width - 40 });
  for (const [index, [name, destination]] of [['Слова и примеры', 'word-intro'], ['Конструкции и частицы', 'construction-intro'], ['Счётные слова', 'counter-intro']].entries()) action(root, `reference-${index}`, name!, box(22, 133 + index * 70, width - 44, 57), () => navigate(destination as Task), { hand: true, size: 23 });
  drawHelp(574, x, width);
}

function resize() { if (!ready) return; catTravel = null; app.resize(); render(); }
function cover(sprite: Sprite, texture: Texture, area: Rect, zoom = 1) {
  sprite.texture = texture;
  const scale = Math.max(area.width / texture.width, area.height / texture.height) * zoom;
  sprite.scale.set(scale); sprite.position.set(area.x + (area.width - sprite.width) / 2, area.y + (area.height - sprite.height) / 2);
}
function placeWorld() {
  app.stage.y = -scrollY;
  const w = app.screen.width, area = box(0, scrollY, w, innerHeight), width = studyWidth(), x = studyX(width), scenic = textures.get(locationScene.desktop.src)!;
  const entering = flow.active && task === 'word-intro' && flow.session?.revision === 0;
  cameraProgress = mobileApproach ? Math.min(1, Number(host.getAnimations()[0]?.currentTime ?? performance.now() - approachStarted) / 800) : composition === 'zoom' && entering && !reduced() ? Math.min(1, (performance.now() - cameraStarted) / 850) : 1;
  const t = cameraProgress * cameraProgress * (3 - 2 * cameraProgress);
  cover(room, scenic, area, composition === 'zoom' && entering ? 1 + t * .08 : 1);
  if (standMode()) cover(room, locationScene.id === 'room' ? textures.get(standRoomUrl)! : scenic, area, app.screen.width < 1000 ? 1.15 : 1);
  if (composition === 'surround' && wideStage() && usesDock()) {
    const texture = locationScene.id === 'room' ? textures.get(roomStudyUrl)! : scenic;
    const edge = Math.min(innerHeight * .55, stageTop() + 182), ratio = locationScene.id === 'room' ? .37 : locationScene.tableBackEdge;
    const scale = Math.max(w / texture.width, (innerHeight - edge) / (texture.height * (1 - ratio)), edge / (texture.height * ratio));
    room.texture = texture; room.scale.set(scale); room.position.set((w - room.width) / 2, scrollY + edge - room.height * ratio);
  }
  cover(background, textures.get(w >= 900 ? desktopDeskUrl : deskUrl)!, area);
  room.visible = standMode() || wideStage() && (composition !== 'window' || !usesDock()); room.alpha = 1;
  background.alpha = 1; background.mask = null; tableMask.clear();
  if (wideStage() && composition === 'window' && !usesDock()) background.alpha = 0;
  if (wideStage() && composition === 'zoom') {
    background.alpha = !['textbook', 'reference', 'lesson-overview', 'lesson-complete'].includes(task) ? t : 0;
  }
  if (wideStage() && composition === 'surround') {
    background.alpha = 0;
  }
  stand.visible = standMode(); standFootShadow.visible = standMode();
  if (standMode()) {
    background.alpha = 0;
    const scale = standScale(); stand.scale.set(1); stand.width = (width + 32) / scale + 480; stand.height = (stageHeight() - stageTop() + 24) / scale + 630; stand.scale.set(scale);
    stand.position.set(x - 16 - 240 * scale, scrollY + stageTop() - 12 - 180 * scale);
    standFootShadow.clear().ellipse(x + width / 2, Math.min(scrollY + innerHeight - 8, stand.y + stand.height * scale - 42 * scale), stand.width * scale * .4, 12).fill({ color: '#25190f', alpha: .24 });
  }
  const showWindow = wideStage() && composition === 'window' && usesDock();
  roomWindow.visible = showWindow; windowFrame.visible = showWindow; windowMask.clear(); windowFrame.clear();
  if (showWindow) {
    const paneX = x + width + 28, pane = box(paneX, scrollY + 150, Math.min(314, w - paneX - 12), 226);
    cover(roomWindow, scenic, pane); windowMask.roundRect(pane.x, pane.y, pane.width, pane.height, 10).fill('#ffffff'); roomWindow.mask = windowMask;
    windowFrame.roundRect(pane.x - 5, pane.y - 5, pane.width + 10, pane.height + 10, 13).stroke({ color: '#63452c', width: 10 });
  }
}
function snapshot() {
  const shift = scrollY - paintedScroll;
  const controlText = captions.map(({ id, rect, view }) => { const b = view.getBounds(); return { id, rect: controls.find(control => control.id === id)?.docked ? { ...rect, y: rect.y + shift } : rect, value: view.text, fontSize: view.style.fontSize, fontFamily: view.style.fontFamily, fontStyle: view.style.fontStyle, bounds: box(b.minX, b.minY + scrollY, b.width, b.height) }; });
  const rotatedUi: string[] = [];
  const inspect = (node: Container) => { if (Math.abs(node.rotation) > 1e-7 || Math.abs(node.skew.x) > 1e-7 || Math.abs(node.skew.y) > 1e-7) rotatedUi.push(node.label || 'unnamed'); node.children.forEach(inspect); }; inspect(ui); inspect(overlay);
  return { ready, task, practice: practice?.snapshot(), scroll: { max: maxSheetScroll, position: scrollY }, taskName: taskTitles[task], lesson: flow.snapshot(), composition, cameraProgress, stand: standMode() ? { board: box(studyX() - 16, scrollY + stageTop() - 12, studyWidth() + 32, stageHeight() - stageTop() + 24), frame: box(stand.x, stand.y, stand.width * stand.scale.x, stand.height * stand.scale.y), camera: app.screen.width < 1000 ? 'close' : 'room', catPerch, moving: !!catTravel } : null, location: locationScene.id, dock: usesDock() ? { top: dockTop, ids: dockIds, stageHeight: stageHeight() } : null, autoAdvance: autoDeadline > 0, feedbackSpeaker: 'cat', speechBounds: speechBounds ? { ...speechBounds, y: speechBounds.y + shift } : null, colors: { ink, bubble: '#fff7e7' }, catVisible: cat.visible, catBounds: box(cat.x, cat.y + shift, cat.width, cat.height), studyBounds: box(studyX(), Math.max(158 + contentOffset(), scrollY + headerHeight()), studyWidth(), Math.max(0, Math.min(contentBottom, scrollY + (usesDock() ? dockTop : standMode() ? stageHeight() : innerHeight)) - Math.max(158 + contentOffset(), scrollY + headerHeight()))), view: standMode() ? 'flat-front' : 'orthographic-top-down', desktopBackground: app.screen.width >= 900, rotatedUi, wordIndex, selection, correct, hadMistake, revealed, constructionDrop: dropZone, layout: { maskTop: headerHeight(), introTabbed, introTab, overviewTab, infoSlotHeight, introSlotHeight, card: topCard ? { x: cardOrigin.x, y: cardOrigin.y + contentOffset() - 8, width: studyWidth(), height: introSlotHeight } : null, stageTop: stageTop(), centered: !shortWide(), font: book, plainPaper: true, deskBackEdge: composition === 'surround' && wideStage() && usesDock() ? room.y - scrollY + room.height * (locationScene.id === 'room' ? .37 : locationScene.tableBackEdge) : null }, tokens: [...tokenOrder], manual, menuOpen, composing: editor.composing, feedback, played, playing, hintVisible: !seenHints.has(hintKey()) || manualHint, hintKey: hintKey(), controls: controls.filter(control => control.id !== 'scroll-more' || scrollY < maxSheetScroll - 1).filter(control => control.id !== 'scroll-back' || scrollY > 1).map(control => ({ ...control, rect: control.id === 'cat-call' ? box(cat.x, cat.y + shift, cat.width, cat.height) : control.docked ? { ...control.rect, y: control.rect.y + shift } : control.rect, opacity: actionSpecs.get(control.id)?.node.alpha ?? 1, highlight: actionSpecs.get(control.id)?.options.wrong ? 'wrong' : actionSpecs.get(control.id)?.options.selected ? 'selected' : null })), controlText, contentBottom, catTop: cat.y + shift, ruby, pendingRender: frame !== 0, motion: { ...motion, reduced: reduced(), enteredAt }, cspViolations: [...csp], fontLoaded: document.fonts.check('24px "Lora"'), source: data.source, video: { paused: video.paused, time: video.currentTime }, editorValue: editor.element.value };
}
let contentBottom = 0;
function updateScrollCues() {
  if (scrollMore) scrollMore.visible = scrollY < maxSheetScroll - 1;
  if (scrollBack) scrollBack.visible = scrollY > 1;
}
function drawScrollCues(x: number, width: number, bottom: number) {
  scrollMore = null; scrollBack = null;
  if (!maxSheetScroll) return;
  const root = new Container(); root.y = paintedScroll; overlay.addChild(root);
  const more = new Container(); root.addChild(more);
  surface(more, box(x + 6, bottom - 47, width - 12, 43), textures.get(cardUrl)!, '#e5d6b5');
  const list = task === 'textbook', half = (width - 12) / 2, title = list ? 'Ниже ещё уроки ↓' : 'Ниже ↓';
  const next = action(more, 'scroll-more', title, box(list ? x : x + half + 12, bottom - 44, list ? width : half, 44), () => scrollTo({ top: Math.min(maxSheetScroll, scrollY + Math.max(100, bottom - headerHeight() - 75)), behavior: reduced() ? 'instant' : 'smooth' }), { size: 18 });
  next.accessibleHint = list ? title : 'Продолжение карточки ниже';
  scrollMore = more;
  scrollBack = action(root, 'scroll-back', '↑ Выше', list ? box(x + width - 108, headerHeight() + 1, 108, 44) : box(x, bottom - 44, half, 44), () => scrollTo({ top: Math.max(0, scrollY - Math.max(100, bottom - headerHeight() - 75)), behavior: reduced() ? 'instant' : 'smooth' }), { size: 18 });
  controls.slice(-2).forEach(control => { control.docked = true; });
  updateScrollCues();
}
function clipNative() {
  for (const element of [video, editor.element]) {
    const r = element.getBoundingClientRect(), bottom = usesDock() ? Math.max(0, r.bottom - dockTop) : 0, top = Math.max(0, headerHeight() - r.top);
    element.style.clipPath = top || bottom ? `inset(${Math.min(r.height, top)}px 0 ${Math.min(r.height, bottom)}px 0)` : '';
  }
}
function updateViewport() {
  if (!ready || rendering) return;
  if (mobileApproach && scrollY > 0) finishApproach();
  overlay.y = scrollY - paintedScroll; bodyMask.y = scrollY - paintedScroll;
  placeWorld(); updateScrollCues(); app.render(); clipNative();
}
function render() {
  if (!ready || rendering) return;
  if (pointerHeld) { deferredPaint = true; updateViewport(); return; }
  rendering = true; paintedScroll = scrollY; overlay.y = 0; bodyMask.y = 0;
  const focus = document.activeElement?.getAttribute('aria-label');
  ui.mask = null;
  cat.removeFromParent(); overlay.removeChildren().forEach(child => child.destroy({ children: true }));
  if (drag) { drag.ghost.destroy({ children: true }); drag = null; }
  ui.removeChildren().forEach(child => child.destroy({ children: true })); controls = []; captions = []; ruby = []; topCard = null; dropZone = null; guideText = ''; speechBounds = null; dockIds = []; actionSpecs.clear(); controlRuns.clear();
  if (task !== 'construction' || !manual || menuOpen) editor.place(null);
  if (!connected || connected.user || connected.busy || connected.error) { loginEmail.place(null); loginPassword.place(null); }
  editor.element.readOnly = !!connected?.busy;
  if (connected?.busy) status.textContent = 'Ожидаем подтверждения локального сервера.';
  if (task !== 'video') video.hidden = true;
  introTabbed = false; infoSlotHeight = 0;
  recallAnswerHeight = practice?.phase === 'question' && practice.recall && !practice.hinted ? measurePracticeAnswer(studyWidth()) : 0;
  if (task === 'lesson-overview' && flow.lesson) { const page = overviewLayout(studyWidth()); infoSlotHeight = page.height; page.root.destroy({ children: true }); }
  if ((task === 'part-complete' || task === 'lesson-complete') && flow.session) { const page = boundaryContent(studyWidth(), false); infoSlotHeight = page.height; page.root.destroy({ children: true }); }
  introSlotHeight = introPage() && !connectionBlocked() ? measureIntroduction(studyWidth()) : 0;
  placeWorld();
  const fixedHeader = new Container(); fixedHeader.y = paintedScroll + (standMode() ? shortWide() ? 0 : stageTop() - 12 - 180 * standScale() - signHeight() - 12 : stageTop()); overlay.addChild(fixedHeader); header(fixedHeader);
  const w = app.screen.width, width = studyWidth(), x = studyX(width);
  const contentLayer = new Container(), bodyOffset = contentOffset();
  contentLayer.y = bodyOffset; viewRoot.addChild(contentLayer); ui = contentLayer;
  try {
  if (practice) practicePage(x, width);
  else if (connectionBlocked()) connectionScreen(x, width);
  else if (task === 'lesson-overview') lessonOverview(x, width);
  else if (task === 'part-complete' || task === 'lesson-complete') lessonBoundary(x, width);
  else if (task.startsWith('word-') && task !== 'word-intro') quiz(x, width);
  else if (task.startsWith('recall-')) recall(x, width);
  else if (task === 'construction') construction(x, width);
  else if (task.startsWith('count-')) count(x, width);
  else if (task.endsWith('intro')) introduction(x, width);
  else if (task === 'video') videoPage(x, width);
  else if (task === 'textbook') textbook(x, width);
  else reference(x, width);
  } finally { ui = viewRoot; }
  if (dropZone && bodyOffset) (dropZone as Rect).y += bodyOffset;
  if (bodyOffset) for (const element of [video, editor.element, loginEmail.element, loginPassword.element]) if (!element.hidden) element.style.top = `${parseFloat(element.style.top) + bodyOffset}px`;
  if (manualHint && usesDock()) guideText = helpMessage();
  const dock = usesDock() && !(connectionBlocked()) ? dockControls(x, width) : undefined;
  contentBottom = ui.getLocalBounds().maxY;
  const bottom = dock ? dockTop : standMode() ? stageHeight() : innerHeight;
  const overflow = contentBottom > bottom + .5;
  maxSheetScroll = overflow ? Math.max(0, Math.ceil(contentBottom - bottom + 54)) : 0;
  const height = innerHeight + maxSheetScroll;
  if (host.style.height !== `${height}px`) host.style.height = `${height}px`;
  bodyMask.clear(); ui.mask = bodyMask;
  bodyMask.rect(0, paintedScroll + headerHeight(), w, Math.max(1, bottom - headerHeight() - (overflow ? 48 : 0))).fill('#ffffff');
  drawScrollCues(x, width, bottom);
  companion(x, width, dock);
  if (cameraProgress < 1) action(overlay, 'skip-camera', 'Пропустить', mobileApproach ? box(w - 144, paintedScroll + stageTop() + 5, 132, 46) : box(w - 226, paintedScroll + 24, 200, 48), () => { cameraStarted = 0; finishApproach(); }, { hand: true, size: 20 });
  drawMenu();
  const description = connectionBlocked() ? 'Вход и сохранение локального занятия' : menuOpen ? 'Разделы приложения' : `${taskTitles[task]}. ${flow.active ? `Урок ${flow.lesson!.number}. ${flow.goal?.titleRu ?? flow.lesson!.title}. ` : ''}${task === 'word-ja' || task === 'recall-ja' || task === 'word-intro' ? `${current().surface}, ${current().kana}` : task === 'word-ru' || task === 'recall-ru' ? current().meaningRu : task === 'construction' ? currentConstruction().promptRu : ''}. ${isListening() && !played ? 'Сначала прослушайте запись.' : ''}`;
  if (semantic.textContent !== description) semantic.textContent = description;
  const visibleText: string[] = [];
  const collect = (node: Container) => { if (!node.visible) return; if (node instanceof Text && node.text.trim()) visibleText.push(node.text); node.children.forEach(collect); };
  collect(ui); collect(overlay);
  const transcript = menuOpen ? 'Учебник. Повторение. Справочник.' : visibleText.join('\n');
  if (screenCopy.textContent !== transcript) screenCopy.textContent = transcript;
  overlay.y = scrollY - paintedScroll; bodyMask.y = scrollY - paintedScroll;
  app.render(); clipNative();
  if (focus && document.activeElement === document.body) [...document.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find(node => node.getAttribute('aria-label') === focus)?.focus({ preventScroll: true });
  if (menuOpen && document.activeElement === document.body) [...document.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find(node => node.getAttribute('aria-label') === 'Учебник')?.focus({ preventScroll: true });
  rendering = false;
  if (app.stage.y !== -scrollY) updateViewport();
}
async function start() {
  Assets.setPreferences({ preferWorkers: false }); await document.fonts.load('24px "Lora"', 'Учебник 1 из 4');
  await app.init({ resizeTo: window, preference: 'webgl', autoDensity: true, resolution: Math.min(devicePixelRatio, 2), antialias: true, background: '#b8773d', autoStart: false, accessibilityOptions: { enabledByDefault: true, deactivateOnMouseMove: false } });
  Object.assign(app.renderer.accessibility.div.style, { position: 'fixed', top: '0', left: '0' });
  host.prepend(app.canvas); app.canvas.setAttribute('aria-label', 'Учебный стол まるごと'); app.canvas.style.touchAction = 'pan-y'; app.stage.addChild(world, ui, bodyMask, overlay); world.addChild(room, background, tableMask, roomWindow, windowMask, windowFrame);
  const urls = [deskUrl, desktopDeskUrl, cardUrl, catUrl, logoUrl, roomStudyUrl, standUrl, standRoomUrl, locationScene.desktop.src, '/counters/objects-atlas.webp', '/ui/topics-atlas-v1.webp'];
  const loaded = await Assets.load<Texture>(urls); for (const url of urls) textures.set(url, loaded[url]!);
  const atlas = textures.get('/counters/objects-atlas.webp')!, rows = [0, 282, 522, 754, 980, 1254];
  for (let tile = 0; tile < 25; tile++) { const row = Math.floor(tile / 5), x = tile % 5 * 250, y = rows[row]!; pictures.set(`counter-${tile}`, new Texture({ source: atlas.source, frame: new Rectangle(x, y, Math.min(tile === 21 ? 275 : 254, atlas.width - x), rows[row + 1]! - y) })); }
  const topics = textures.get('/ui/topics-atlas-v1.webp')!;
  for (let tile = 0; tile < 9; tile++) pictures.set(`topic-${tile}`, new Texture({ source: topics.source, frame: new Rectangle(tile % 3 * topics.width / 3, Math.floor(tile / 3) * topics.height / 3, topics.width / 3, topics.height / 3) }));
  background.texture = textures.get(deskUrl)!; cat.texture = textures.get(catUrl)!;
  stand = new NineSliceSprite({ texture: textures.get(standUrl)!, leftWidth: 240, rightWidth: 240, topHeight: 180, bottomHeight: 450 }); world.addChild(standFootShadow, stand);
  pictures.set('stand-rail', new Texture({ source: textures.get(standUrl)!.source, frame: new Rectangle(58, 850, 1080, 80) }));
  ready = true; enterCard(); resize();
  if (standMode() && app.screen.width < 1000 && !reduced() && task !== 'video') {
    mobileApproach = true; approachStarted = performance.now(); host.style.transformOrigin = `${innerWidth / 2}px ${scrollY + innerHeight / 2}px`; host.classList.add('stand-enter'); schedule(); app.start();
  }
  app.ticker.maxFPS = 60;
  app.ticker.add(() => {
    motionElapsed += Math.min(app.ticker.deltaMS, 50);
    const t = Math.min(1, motionElapsed / 320);
    const lift = reduced() ? -8 : -8 * (1 - (1 - t) ** 3);
    motion = { x: 0, y: lift, rotation: 0 };
    if (topCard) topCard.position.set(cardOrigin.x, cardOrigin.y + lift);
    placeWorld();
    if (catTravel) {
      const t = Math.min(1, (performance.now() - catTravel.start) / 520), eased = t * t * (3 - 2 * t);
      cat.position.set(catTravel.from.x + (catTravel.to.x - catTravel.from.x) * eased + Math.sin(Math.PI * t) * (wideStage() ? 20 : 0), catTravel.from.y + (catTravel.to.y - catTravel.from.y) * eased - Math.sin(Math.PI * t) * 22);
      if (catHit) catHit.position.copyFrom(cat.position);
      if (t >= 1) { catTravel = null; schedule(); }
    }
    if ((t >= 1 || reduced() || !topCard) && cameraProgress >= 1 && !catTravel) app.stop();
  });
  const gl = app.canvas.getContext('webgl2') ?? app.canvas.getContext('webgl'), recovery = gl?.getExtension('WEBGL_lose_context');
  app.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); cancelAuto(); catTravel = null; app.stop(); audio.pause(); video.pause(); document.querySelector('#recovery')!.removeAttribute('hidden'); });
  app.canvas.addEventListener('webglcontextrestored', () => { document.querySelector('#recovery')!.setAttribute('hidden', ''); schedule(); });
  document.querySelector('#retry')!.addEventListener('click', () => recovery?.restoreContext());
  if (connected) {
    await connected.boot();
    if (connected.user && params.get('lesson') && !connected.error) await openLesson(params.get('lesson')!);
    schedule();
  }
  Object.assign(window, { __PAPER__: { snapshot, tasks, navigate, setComposition, editor: editor.element, app, audio, video, replay: enterCard } });
}
window.addEventListener('resize', resize); window.addEventListener('scroll', updateViewport, { passive: true });
host.addEventListener('animationend', event => { if (event.animationName === 'stand-approach') finishApproach(); });
matchMedia('(prefers-reduced-motion: reduce)').addEventListener('change', event => { if (event.matches && mobileApproach) finishApproach(); });
window.addEventListener('pointerdown', () => { if (mobileApproach) finishApproach(); updateViewport(); pointerHeld = true; if (autoTimer) cancelAuto(); }, true);
window.addEventListener('wheel', () => { if (mobileApproach) finishApproach(); }, { passive: true });
const releasePointer = () => { pointerHeld = false; if (deferredPaint) { deferredPaint = false; schedule(); } };
window.addEventListener('pointerup', releasePointer, true); window.addEventListener('pointercancel', releasePointer, true);
window.addEventListener('blur', () => { cancelAuto(); releasePointer(); schedule(); });
document.addEventListener('visibilitychange', () => { if (document.hidden) { cancelAuto(); catTravel = null; audio.pause(); video.pause(); app.stop(); } else schedule(); });
document.addEventListener('focusin', event => {
  if (!(event.target instanceof HTMLElement)) return;
  const label = event.target.getAttribute('aria-label');
  for (const spec of actionSpecs.values()) if (spec.node.accessibleHint === label) {
    let parent: Container | null = spec.node;
    while (parent) { if (parent === overlay) return; parent = parent.parent; }
  }
  const rect = event.target.getBoundingClientRect();
  const bottom = (usesDock() ? dockTop : stageHeight()) - (maxSheetScroll ? 48 : 0);
  if (rect.height > 0 && rect.bottom > bottom - 12) scrollBy(0, rect.bottom - bottom + 20);
  else if (rect.height > 0 && rect.top < headerHeight()) scrollBy(0, rect.top - headerHeight() - 16);
  updateViewport();
});
void start().catch(error => { console.error(error); document.querySelector('#recovery')!.removeAttribute('hidden'); });
