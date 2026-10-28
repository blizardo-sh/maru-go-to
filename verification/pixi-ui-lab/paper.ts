import 'pixi.js/unsafe-eval';
import 'pixi.js/accessibility';
import { Application, Assets, Container, Graphics, NineSliceSprite, Rectangle, Sprite, Text, Texture, type FederatedPointerEvent } from 'pixi.js';
import data from './paper-fixtures.json';
import { EditorBridge, japanese, label, textWidth, type JapaneseValue, type Rect } from './canvas';
import deskUrl from './art/runtime/desk.webp';
import desktopDeskUrl from './art/runtime/desk-landscape.webp';
import cardUrl from './art/runtime/card.webp';
import answerUrl from './art/runtime/answer.webp';
import catUrl from './art/runtime/cat.webp';
import logoUrl from './art/runtime/logo.webp';
import './paper.css';
import { LessonFlow, lessonCatalog } from './lesson-flow';
import type { LearningAdvance } from '../../src/shared/learning';

// Selected direction 2; offline design prototype. No application API or persistent storage.
const tasks = {
  'word-ja': 'Японский → русский', 'word-ru': 'Русский → японский', 'word-listen': 'Словарное аудирование',
  'recall-ja': 'Раскрытие: японский → русский', 'recall-ru': 'Раскрытие: русский → японский', 'recall-listen': 'Вспоминание на слух',
  'word-intro': 'Знакомство со словом', 'construction-intro': 'Объяснение конструкции', construction: 'Конструктор фразы',
  'counter-intro': 'Знакомство со счётным словом', 'count-category': 'Предмет → суффикс', 'count-picture': 'Суффикс → предмет',
  'count-reading': 'Чтение количества', 'count-listen': 'Количество на слух', 'count-recall': 'Вспомнить количество',
  video: 'Видеодиалог', textbook: 'Учебник', reference: 'Справочник',
};
const taskTitles = { ...tasks, 'lesson-overview': 'Начало занятия', 'part-complete': 'Часть пройдена', 'lesson-complete': 'Занятие завершено' };
type Task = keyof typeof taskTitles;
type Word = JapaneseValue & { id: string; meaningRu: string; audioUrl: string | null; illustration?: { src: string; bounds: number[] } | null; introduction?: { explanationRu: string } | null };
type Counter = { kind: string; definition: { surface: string; kana: string; explanation: string }; word: Word; object: { tile: number }; quantity: number | null; answer: JapaneseValue; audioUrl: string | null; acceptedKeys: string[]; options: { key: string; label: string; quantity?: number; object?: { tile: number } }[]; examples: (JapaneseValue & { audioUrl: string | null })[] };
type Control = { id: string; label: string; rect: Rect; enabled: boolean };
const counters: Counter[] = data.counterCards;
const countKinds: Record<string, string> = { 'count-category': 'image-counter', 'count-picture': 'counter-image', 'count-reading': 'reading-choice', 'count-listen': 'listening-image', 'count-recall': 'recall' };
const ink = '#3c281b', sage = '#4c6037', hand = 'Marck Script', book = 'Georgia', jp = '"Hiragino Mincho ProN", "Yu Mincho", serif';
const params = new URLSearchParams(location.search);
let task: Task = params.get('task') && Object.hasOwn(taskTitles, params.get('task')!) ? params.get('task') as Task : 'textbook';
const flow = new LessonFlow();
if (lessonCatalog.lessons.some(lesson => lesson.id === params.get('lesson'))) { flow.open(params.get('lesson')!); task = 'lesson-overview'; }
let words: Word[] = data.words, wordIndex = 0, selection: string | null = null, revealed = false;
let tokenOrder: number[] = [], manual = false, feedback = '', correct: boolean | null = null, showBreakdown = false;
let ready = false, frame = 0, rendering = false, enteredAt = performance.now(), played = false, playing = false, mediaEpoch = 0;
let controls: Control[] = [], ruby: ReturnType<typeof japanese>[] = [], topCard: Container | null = null, cardOrigin = { x: 0, y: 0 };
let captions: { id: string; rect: Rect; view: ReturnType<typeof copy> }[] = [];
let motion = { x: 0, y: 0, rotation: 0 }, manualHint = false;
let menuOpen = false, menuPainting = false;
const seenHints = new Set<string>(), csp: object[] = [];
const host = document.querySelector<HTMLElement>('#stage')!;
const app = new Application(), world = new Container(), ui = new Container();
const background = new Sprite(), cat = new Sprite();
const textures = new Map<string, Texture>(), pictures = new Map<string, Texture>();
const current = (): Word => flow.active && flow.word ? flow.word : words[wordIndex]!;
const currentConstruction = () => flow.active && flow.construction ? flow.construction : data.construction;
const currentVideo = () => flow.active && flow.video ? flow.video : data.video;
const box = (x: number, y: number, width: number, height: number): Rect => ({ x, y, width, height });
const reduced = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const counter = () => counters.find(value => value.kind === countKinds[task]) ?? counters[0]!;
const isWord = () => task.startsWith('word-') || task.startsWith('recall-');
const isListening = () => ['word-listen', 'recall-listen', 'count-listen'].includes(task);
const hintKey = () => task === 'word-listen' || task === 'recall-listen' ? task : task.startsWith('word-') && task !== 'word-intro' ? 'word-quiz' : task.startsWith('recall-') ? 'recall' : task;
const semantic = document.createElement('h1'); semantic.className = 'semantic-copy'; host.append(semantic);
const screenCopy = document.createElement('p'); screenCopy.id = 'canvas-description'; screenCopy.className = 'semantic-copy'; host.append(screenCopy);
const status = document.createElement('p'); status.className = 'semantic-copy'; status.setAttribute('role', 'status'); host.append(status);
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
function enterCard() { enteredAt = performance.now(); if (ready) app.start(); }
function navigate(value: Task, keepLesson = false) {
  mediaEpoch++;
  if (!keepLesson) flow.active = false;
  audio.pause(); audio.removeAttribute('src'); audio.load(); video.pause(); task = value; selection = null; revealed = false; correct = null; feedback = ''; tokenOrder = []; manual = false; showBreakdown = false; played = false; manualHint = false; menuOpen = false;
  editor.element.value = ''; caption = ''; video.removeAttribute('src'); video.load();
  const url = new URL(location.href); url.searchParams.set('task', task);
  if (keepLesson && flow.selectedId) url.searchParams.set('lesson', flow.selectedId); else url.searchParams.delete('lesson');
  history.replaceState(null, '', url); scrollTo(0, 0); enterCard(); resize();
}
function openLesson(id: string) { flow.open(id); learnAction(); navigate('lesson-overview', true); }
function syncLesson() {
  const step = flow.step;
  const next: Task = !step ? 'lesson-complete' : step.kind === 'word-practice' ? ({ 'ja-ru': 'word-ja', listening: 'word-listen', 'ru-ja': 'word-ru' } as const)[step.mode]
    : step.kind === 'construction-practice' ? ({ 'ja-ru': 'recall-ja', listening: 'recall-listen', grammar: 'construction' } as const)[step.mode] : step.kind;
  navigate(next, true);
}
function lessonAdvance(action: LearningAdvance['action'], requireResult = false) {
  const ticket = flow.ticket();
  return () => { if (requireResult && (correct === null || editor.composing)) return; if (flow.advance(ticket, action)) syncLesson(); };
}
function startLesson(restart = false) { flow.start(restart); syncLesson(); }
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
  const paper = new NineSliceSprite({ texture, leftWidth: sourceW * .25, rightWidth: sourceW * .12, topHeight: texture.height * .14, bottomHeight: texture.height * (texture === textures.get(cardUrl) ? .62 : .27) });
  paper.width = r.width / scale; paper.height = r.height / scale; paper.scale.set(scale); paper.position.set(r.x, r.y); paper.tint = tint; root.addChild(paper); return paper;
}
function image(root: Container, texture: Texture, r: Rect, multiply = false) {
  const sprite = new Sprite(texture), scale = Math.min(r.width / texture.width, r.height / texture.height);
  sprite.scale.set(scale); sprite.position.set(r.x + (r.width - sprite.width) / 2, r.y + (r.height - sprite.height) / 2);
  if (multiply) sprite.blendMode = 'multiply'; root.addChild(sprite); return sprite;
}
function interactive(root: Container, id: string, title: string, r: Rect, action: () => void, enabled = true) {
  enabled = enabled && (!menuOpen || menuPainting);
  const node = new Container(); node.position.set(r.x, r.y); node.eventMode = enabled ? 'static' : 'none'; node.cursor = 'pointer'; node.hitArea = new Rectangle(0, 0, r.width, r.height);
  node.accessible = enabled; node.accessibleType = 'button'; node.accessibleHint = title; node.accessiblePointerEvents = 'none';
  node.on('pointertap', () => { if (enabled && !suppressTap) action(); }); root.addChild(node);
  const global = root.toGlobal({ x: r.x, y: r.y }); controls.push({ id, label: title, rect: { ...r, x: global.x, y: global.y }, enabled });
  return node;
}
function action(root: Container, id: string, title: string, r: Rect, run: () => void, options: { enabled?: boolean; hand?: boolean; selected?: boolean; value?: JapaneseValue; size?: number; bare?: boolean } = {}) {
  const enabled = options.enabled ?? true, node = interactive(root, id, title, r, run, enabled);
  const inset = options.bare ? 12 : Math.min(44, r.width * .24), contentWidth = r.width - inset - 12, center = inset + contentWidth / 2;
  const paper = options.bare ? null : surface(node, box(0, 0, r.width, r.height), textures.get(answerUrl)!, options.selected ? '#e3eccf' : '#ffffff');
  const focus = new Graphics(); node.addChild(focus); node.alpha = enabled ? 1 : .52;
  node.on('mouseover', () => { focus.clear().roundRect(7, 6, r.width - 14, r.height - 12, 6).stroke({ color: sage, width: 2 }); app.render(); });
  node.on('mouseout', () => { focus.clear(); app.render(); });
  if (options.value) {
    const size = Math.min(27, Math.max(22, contentWidth / Math.max(1, options.value.surface.length)));
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
  if (paper) paper.label = 'paper'; return node;
}
function deck(r: Rect) {
  const texture = textures.get(cardUrl)!;
  surface(ui, box(r.x + 1, r.y + 8, r.width - 2, r.height), texture, '#d4c2a2');
  surface(ui, box(r.x, r.y + 4, r.width, r.height), texture, '#eee2cb');
  const root = new Container(); root.position.set(r.x, r.y); ui.addChild(root); surface(root, box(0, 0, r.width, r.height), texture);
  topCard = root; cardOrigin = { x: r.x, y: r.y }; return root;
}
function centeredJapanese(root: Container, value: JapaneseValue, y: number, width: number, size = 94) {
  const available = width - 48;
  size = Math.max(22, Math.min(size, available / Math.max(1, value.surface.length)));
  const longest = Math.max(...value.segments.filter(segment => segment.reading && segment.reading !== segment.surface).map(segment => segment.surface.length), 1);
  size = Math.min(size, available / longest);
  const actual = Math.max(textWidth(value.surface, size, jp), textWidth(value.kana, Math.max(12, Math.round(size * .28)), jp));
  const layout = japanese(root, value, 'furigana', box(actual <= available ? (width - actual) / 2 : 24, y, available, 300), size, jp, .28);
  ruby.push(layout); return layout.height;
}
function header() {
  const w = app.screen.width, x = Math.max(14, (w - 800) / 2), width = Math.min(w - 28, 800);
  const logoW = Math.min(174, width - 154);
  image(ui, textures.get(logoUrl)!, box(x + 50 + (width - 140 - logoW) / 2, 20, logoW, 54));
  const compact = w < 700;
  const left = action(ui, compact ? 'menu' : 'help', compact ? '≡' : '?', box(x, 23, 44, 44), () => { if (compact) { menuOpen = true; audio.pause(); video.pause(); } else manualHint = !manualHint; schedule(); }, { hand: true, size: 29, bare: true });
  left.accessibleHint = compact ? 'Открыть разделы' : 'Как пользоваться заданием';
  const progress = flow.active ? `${flow.progress().percent}%` : isWord() ? `${wordIndex + 1} из ${words.length}` : task.startsWith('count') ? 'Счёт' : task === 'video' ? 'Видео' : 'A1';
  const slip = surface(ui, box(x + width - 80, 24, 80, 43), textures.get(answerUrl)!);
  copy(ui, progress, slip.x + 40, 29, 23, { hand: true, center: true });
  if (flow.active) {
    copy(ui, compact ? `Урок ${flow.lesson!.number}` : `Урок ${flow.lesson!.number} · ${flow.lesson!.title}`, x + width / 2 - 25, 90, compact ? 22 : 25, { center: true, hand: true, width: width - 164 });
    action(ui, 'lesson-exit', 'Выйти', box(x + width - 91, 85, 91, 47), () => navigate('textbook'), { hand: true, bare: true, size: 22 });
    if (compact) action(ui, 'help', '?', box(x, 85, 44, 47), () => { manualHint = !manualHint; schedule(); }, { bare: true, size: 25 });
  } else if (compact) {
    const section = flow.active || task === 'lesson-overview' || task === 'textbook' ? 'Учебник' : task === 'reference' ? 'Справочник' : 'Повторение';
    action(ui, 'section', section, box(x, 85, width - 60, 47), () => { menuOpen = true; audio.pause(); video.pause(); schedule(); }, { hand: true, size: 25 });
    const help = action(ui, 'help', '?', box(x + width - 46, 85, 44, 47), () => { manualHint = !manualHint; schedule(); }, { hand: true, size: 27, bare: true }); help.accessibleHint = 'Как пользоваться заданием';
  } else {
    const tabW = (width - 16) / 3;
    for (const [index, [title, destination]] of [['Учебник', 'textbook'], ['Повторение', 'word-ja'], ['Справочник', 'reference']].entries()) action(ui, `nav-${destination}`, title!, box(x + index * (tabW + 8), 85, tabW, 47), () => navigate(destination as Task), { hand: true, size: 25, bare: true });
  }
}
function drawMenu() {
  if (!menuOpen) return;
  const width = Math.min(380, app.screen.width - 32), x = (app.screen.width - width) / 2, y = scrollY + 145;
  const blocker = new Graphics().rect(0, 0, app.screen.width, app.screen.height).fill({ color: '#000000', alpha: .001 }); blocker.eventMode = 'static'; blocker.on('pointertap', () => { menuOpen = false; schedule(); }); ui.addChild(blocker);
  surface(ui, box(x, y, width, 305), textures.get(cardUrl)!); menuPainting = true;
  copy(ui, 'Разделы', x + width / 2, y + 20, 28, { hand: true, center: true });
  const close = action(ui, 'menu-close', '×', box(x + width - 47, y + 7, 44, 44), () => { menuOpen = false; schedule(); }, { hand: true, bare: true }); close.accessibleHint = 'Закрыть разделы';
  for (const [index, [title, destination]] of [['Учебник', 'textbook'], ['Повторение', 'word-ja'], ['Справочник', 'reference']].entries()) action(ui, `nav-${destination}`, title!, box(x + 23, y + 81 + index * 67, width - 46, 53), () => navigate(destination as Task), { hand: true, size: 27 });
  menuPainting = false;
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
  const root = new Container(); root.position.set(x, y); ui.addChild(root);
  const text = copy(root, message, 71, 14, 16, { width: width - 126, sans: true });
  const height = Math.max(80, text.height + 28);
  const paper = surface(root, box(0, 0, width, height), textures.get(answerUrl)!); root.setChildIndex(paper, 0);
  const close = action(root, 'dismiss-hint', '×', box(width - 46, 7, 44, 44), () => { learnAction(); schedule(); }, { hand: true, size: 27, bare: true }); close.accessibleHint = 'Скрыть подсказку';
  return height;
}
function feedbackAt(y: number, x: number, width: number, next = true) {
  if (!feedback) return;
  const text = copy(ui, feedback, x + 8, y, 18, { width: width - 16, color: correct === false ? '#6f3822' : sage });
  if (next) action(ui, 'next', 'Дальше', box(x, y + text.height + 16, width, 52), flow.active ? lessonAdvance(correct ? 'remember' : 'again', true) : nextWord, { hand: true });
}
function choiceGrid<T>(items: T[], y: number, x: number, width: number, make: (item: T, r: Rect, index: number) => void, height = 59, columns = 2) {
  const gap = 12, cell = (width - (columns - 1) * gap) / columns;
  items.forEach((item, index) => { const last = items.length % 2 === 1 && index === items.length - 1; make(item, box(x + index % columns * (cell + gap), y + Math.floor(index / columns) * (height + gap), last ? width : cell, height), index); });
  return y + Math.ceil(items.length / columns) * (height + gap);
}

function quiz(x: number, width: number) {
  const word = current(), r = box(x, 158, width, 261), root = deck(r), listening = task === 'word-listen', reverse = task === 'word-ru';
  copy(root, listening ? 'Что прозвучало?' : reverse ? 'Выберите японское слово' : 'Как переводится слово?', width / 2, 24, width < 300 ? 20 : 22, { center: true, width: width - 42 });
  if (listening) action(root, 'listen', playing ? 'Слушаем…' : '▶ Прослушать', box(32, 104, width - 64, 78), () => { void speak(word.audioUrl); }, { hand: true, size: 26 });
  else if (reverse) copy(root, word.meaningRu, width / 2, 111, 38, { center: true, width: width - 50 });
  else centeredJapanese(root, word, 88, width);
  const options: Word[] = flow.active ? flow.choices : words;
  const single = options.some(word => reverse ? word.surface.length > 6 : word.meaningRu.length > 23);
  const height = single ? reverse ? Math.max(78, ...options.map(word => Math.ceil(word.surface.length * 22 / (width - 70)) * 44 + 14)) : Math.max(78, ...options.map(word => Math.ceil(textWidth(word.meaningRu, 21, book) / (width - 70)) * 31 + 20)) : reverse ? 78 : 59;
  const bottom = choiceGrid<Word>(options, 445, x, width, (candidate, area, index) => {
    action(ui, `word-option-${index}`, reverse ? candidate.surface : candidate.meaningRu, area, () => {
      if (selection !== null) return;
      audio.pause(); selection = candidate.id; correct = candidate.id === word.id; learnAction();
      say(correct ? 'Верно. Хорошо получилось!' : `Запомним: ${word.surface} — ${word.meaningRu}.${flow.active ? ' Этот формат вернётся.' : ''}`);
    }, { enabled: selection === null && (!listening || played), selected: selection !== null && candidate.id === word.id, value: reverse ? candidate : undefined });
  }, height, single ? 1 : 2);
  if (selection !== null) feedbackAt(bottom + 7, x, width); else drawHelp(bottom + 24, x, width);
}

function recall(x: number, width: number) {
  const word = current(), root = deck(box(x, 158, width, 318));
  const listening = task === 'recall-listen', reverse = task === 'recall-ru';
  copy(root, listening ? 'Вспомните смысл услышанного' : reverse ? 'Вспомните по-японски' : 'Вспомните перевод', width / 2, 24, 21, { center: true, width: width - 44 });
  if (listening && !revealed) action(root, 'listen', playing ? 'Слушаем…' : '▶ Прослушать', box(30, 100, width - 60, 74), () => { void speak(word.audioUrl); }, { hand: true, size: 26 });
  else if (reverse && !revealed) copy(root, word.meaningRu, width / 2, 126, 38, { center: true });
  else centeredJapanese(root, word, 93, width, 80);
  if (revealed) copy(root, word.meaningRu, width / 2, 242, 26, { center: true });
  const reveal = () => { if (listening && !played) { void speak(word.audioUrl); return; } revealed = true; learnAction(); say(`Ответ открыт: ${word.surface}, ${word.kana} — ${word.meaningRu}.`); };
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
  node.on('globalpointermove', (event: FederatedPointerEvent) => { if (!drag) return; if (Math.hypot(event.global.x - drag.x, event.global.y - drag.y) > 8) drag.moved = true; if (drag.moved) { drag.ghost.visible = true; drag.ghost.position.set(event.global.x - source.width / 2, event.global.y - source.height / 2); app.render(); } });
  const finish = (event: FederatedPointerEvent) => {
    if (!drag) return; const moved = drag.moved, token = drag.token; drag.ghost.destroy({ children: true }); drag = null;
    if (moved) { suppressTap = true; if (dropZone && new Rectangle(dropZone.x, dropZone.y, dropZone.width, dropZone.height).contains(event.global.x, event.global.y)) addToken(token); setTimeout(() => { suppressTap = false; }, 0); }
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
  action(ui, 'check', 'Проверить', box(x, bottom + 70, (width - 12) * .62, 51), () => {
    if (editor.composing) { say('Завершите выбор японского текста.'); return; }
    const value = manual ? editor.element.value : tokenOrder.map(index => exercise.tokens[index]!.surface).join('');
    correct = flow.active ? flow.checkConstruction(tokenOrder, manual ? value : undefined) : value.replace(/[。\s]/g, '') === exercise.example.surface.replace(/[。\s]/g, '');
    learnAction(); say(correct ? 'Верно: ' + exercise.example.surface : flow.active ? 'Этот формат вернётся. Можно поправить фразу или продолжить.' : 'Соберите исходную фразу целиком.');
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
  if (selection !== null || revealed) {
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
      action(ui, 'again', 'Ещё раз', box(x, 463, (width - 12) / 2, 58), () => navigate(task), { hand: true });
      action(ui, 'remember', 'Помню', box(x + (width + 12) / 2, 463, (width - 12) / 2, 58), () => navigate(task), { hand: true });
      copy(ui, card.definition.explanation, x + 14, 547, 16, { width: width - 28, sans: true });
    }
    drawHelp(revealed ? 657 : 548, x, width); return;
  }
  const pictureOptions = kind === 'counter-image' || kind === 'listening-image';
  const bottom = choiceGrid(card.options, 461, x, width, (option, area, index) => {
    const choice = action(ui, `count-option-${index}`, pictureOptions ? '' : option.label, area, () => {
      if (selection !== null) return; selection = option.key; correct = card.acceptedKeys.includes(option.key); audio.pause(); learnAction();
      say(correct ? 'Верно!' : `Запомним: ${card.answer.surface} — ${card.answer.kana}.`);
    }, { enabled: selection === null && (kind !== 'listening-image' || played), selected: selection !== null && card.acceptedKeys.includes(option.key), size: kind === 'reading-choice' ? 22 : 21 });
    if (pictureOptions && option.object) {
      choice.accessibleHint = `${option.label}, количество ${option.quantity ?? 1}`;
      const inset = Math.min(44, area.width * .24);
      const text = copy(choice, kind === 'listening-image' ? String(option.quantity ?? 1) : option.label, (inset + area.width - 12) / 2, 0, 17, { center: true, width: area.width - inset - 12 });
      text.y = area.height - text.height - 8;
      objects(choice, option.object.tile, option.quantity ?? 1, box(12, 7, area.width - 24, text.y - 12));
      captions.push({ id: `count-option-${index}-picture-label`, rect: area, view: text });
    }
  }, pictureOptions ? 126 : 55);
  if (selection !== null) {
    copy(ui, feedback, x + 12, bottom + 5, 18, { width: width - 24, color: correct ? sage : ink });
    action(ui, 'next-counter', 'Дальше', box(x, bottom + 59, width, 52), () => navigate(task), { hand: true });
  } else drawHelp(bottom + 18, x, width);
}

function introduction(x: number, width: number) {
  const isCounter = task === 'counter-intro', isConstruction = task === 'construction-intro';
  const bodyInset = Math.max(24, width * .28), content = new Container(), exercise = currentConstruction();
  let paperHeight = 525;
  copy(content, isCounter ? 'Знакомимся со счётным словом' : isConstruction ? 'Как устроена фраза' : flow.active ? `Знакомство · ${flow.session!.introIndex + 1} из ${flow.part!.words.length}` : 'Знакомимся со словом', width / 2, 23, 23, { hand: true, center: true, width: width - 44 });
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
    const word = current(), height = centeredJapanese(content, word, 90, width, 75), meaningY = Math.max(219, 90 + height + 20);
    const meaning = copy(content, word.meaningRu, width / 2, meaningY, 27, { center: true, width: width - 48 });
    const bodyY = meaningY + meaning.height + 22;
    const rule = copy(content, word.introduction?.explanationRu ?? 'Послушайте слово, затем перейдём к практике.', bodyInset, bodyY, 16, { width: width - bodyInset - 24, sans: true });
    paperHeight = Math.max(367, bodyY + rule.height + 40);
    const example = flow.active ? flow.introduction?.example : null;
    if (example) {
      const y = bodyY + rule.height + 24, height = centeredJapanese(content, example, y, width, 25);
      const translation = copy(content, example.meaningRu, 24, y + height + 15, 17, { width: width - 48, sans: true });
      paperHeight = y + height + 15 + translation.height + 180;
    }
  }
  const root = deck(box(x, 158, width, paperHeight)); root.addChild(content);
  if (isCounter) counters[2]!.examples.forEach((example, index) => { const cell = (width - bodyInset - 19) / 3; action(root, `example-${index}`, '▶', box(bodyInset + index * cell, 419, cell - 9, 45), () => { void speak(example.audioUrl); }, { hand: true }); });
  if (isConstruction) action(root, 'breakdown', showBreakdown ? 'Свернуть разбор' : 'Разбор по частям', box(26, paperHeight - 83, width - 52, 48), () => { showBreakdown = !showBreakdown; learnAction(); resize(); }, { hand: true });
  const bottom = 158 + paperHeight + 26;
  const example = flow.active && !isConstruction ? flow.introduction?.example : null;
  action(ui, 'intro-listen', playing ? 'Слушаем…' : example ? '▶ Слово' : '▶ Послушать', box(x, bottom, example ? (width - 12) / 2 : width, 52), () => { void speak(isConstruction ? exercise.example.audioUrl : isCounter ? counters[2]!.audioUrl : current().audioUrl); }, { hand: true });
  if (example) action(ui, 'intro-example-listen', '▶ Пример', box(x + (width + 12) / 2, bottom, (width - 12) / 2, 52), () => { void speak(example.audioUrl); }, { hand: true });
  if (flow.active && !isConstruction) {
    const ticket = flow.ticket(), index = flow.session!.introIndex, last = index === flow.part!.words.length - 1;
    action(ui, 'intro-prev', '← Назад', box(x, bottom + 66, 100, 53), () => { if (flow.introduce(ticket, -1)) syncLesson(); }, { hand: true, enabled: index > 0, size: 21 });
    action(ui, 'intro-next', last ? 'К заданиям' : 'Дальше', box(x + 112, bottom + 66, width - 112, 53), () => { if (last ? flow.advance(ticket, 'start-practice') : flow.introduce(ticket, 1)) syncLesson(); }, { hand: true });
  } else action(ui, 'intro-next', 'К практике', box(x, bottom + 66, width, 53), flow.active ? lessonAdvance('continue') : () => navigate(isConstruction ? 'construction' : isCounter ? 'count-category' : 'word-ja'), { hand: true });
  if (isConstruction && showBreakdown) {
    let y = bottom + 141;
    for (const piece of exercise.breakdown) { copy(ui, piece.text, x + 18, y, 24); const explanation = copy(ui, piece.explanationRu, x + 18, y + 38, 16, { width: width - 36, sans: true }); y += explanation.height + 63; }
  } else drawHelp(bottom + 145, x, width);
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
function lessonOverview(x: number, width: number) {
  const lesson = flow.lesson;
  if (!lesson) { textbook(x, width); return; }
  const content = new Container();
  copy(content, `Урок ${lesson.number}`, width / 2, 22, 25, { hand: true, center: true });
  image(content, pictures.get(`topic-${Number(lesson.topic) - 1}`)!, box(width / 2 - 55, 72, 110, 80));
  const title = copy(content, lesson.title, width / 2, 169, 32, { center: true, width: width - 64 });
  let y = 169 + title.height + 26;
  copy(content, 'Чему научимся', 32, y, 24, { hand: true }); y += 49;
  for (const [index, goal] of lesson.route.goals.entries()) { const text = copy(content, `${index + 1}. ${goal.titleRu}`, 32, y, 18, { width: width - 64, sans: true }); y += text.height + 18; }
  const wordCount = new Set(lesson.route.goals.flatMap(goal => goal.parts.flatMap(part => part.words.map(word => word.wordId)))).size;
  const meta = copy(content, `Слов и фраз: ${wordCount} · Частей: ${flow.parts.length}`, 32, y + 8, 17, { width: width - 64, sans: true });
  const height = y + meta.height + 180, root = deck(box(x, 158, width, height)); root.addChild(content);
  const progress = flow.progress(), bottom = 158 + height + 26;
  action(ui, 'lesson-start', progress.finished ? 'Посмотреть итог' : progress.started ? `Продолжить · ${progress.percent}%` : 'Начать занятие', box(x, bottom, width, 55), () => startLesson(), { hand: true, size: 25 });
  action(ui, 'lesson-back', 'К выбору урока', box(x, bottom + 69, width, 52), () => navigate('textbook'), { hand: true });
  copy(ui, 'Познакомимся со словами, потренируемся и завершим занятие. Трудные задания вернутся перед итогом.', x + 8, bottom + 145, 16, { width: width - 16, sans: true });
}
function lessonBoundary(x: number, width: number) {
  if (!flow.lesson || !flow.session) { textbook(x, width); return; }
  const finished = task === 'lesson-complete', content = new Container();
  copy(content, finished ? 'Занятие завершено' : 'Часть пройдена', width / 2, 26, 32, { hand: true, center: true, width: width - 60 });
  let y = 102;
  if (finished) {
    y += centeredJapanese(content, { surface: 'おつかれさまでした', kana: 'おつかれさまでした', segments: [{ surface: 'おつかれさまでした' }] }, y, width, 27) + 26;
    const count = new Set(flow.lesson.route.goals.flatMap(goal => goal.parts.flatMap(part => part.words.map(word => word.wordId)))).size;
    const stats = copy(content, `Познакомились: ${count} слов и фраз\nВыполнили: ${flow.session.attempts} заданий\nВернулись к сложному: ${flow.session.again}`, 30, y, 18, { width: width - 60, sans: true }); y += stats.height + 26;
    const note = copy(content, 'Все обязательные форматы этого урока пройдены. Можно отдохнуть или выбрать следующий урок.', 30, y, 18, { width: width - 60, sans: true }); y += note.height;
  } else {
    const goal = copy(content, flow.goal?.titleRu ?? '', width / 2, y, 26, { center: true, width: width - 60 }); y += goal.height + 28;
    const note = copy(content, `Часть ${flow.session.state.partIndex + 1} из ${flow.parts.length}.\nСлова и задания этой части пройдены, включая те, к которым возвращались.`, 30, y, 18, { width: width - 60, sans: true }); y += note.height;
  }
  const height = y + 180, root = deck(box(x, 158, width, height)); root.addChild(content);
  const bottom = 158 + height + 26;
  if (finished) {
    action(ui, 'lesson-back', 'К выбору урока', box(x, bottom, width, 55), () => navigate('textbook'), { hand: true, size: 25 });
    action(ui, 'lesson-restart', 'Пройти ещё раз', box(x, bottom + 69, width, 52), () => startLesson(true), { hand: true });
  } else action(ui, 'part-next', flow.session.state.partIndex === flow.parts.length - 1 ? 'Завершить занятие' : 'Следующая часть', box(x, bottom, width, 55), lessonAdvance('continue'), { hand: true, size: 24 });
}
function textbook(x: number, width: number) {
  copy(ui, 'Учебник', x + width / 2, 153, 32, { hand: true, center: true });
  copy(ui, 'Стартовый A1 · 18 уроков', x + width / 2, 200, 16, { center: true });
  const columns = app.screen.width > 900 ? 3 : 2, gap = 14, cellW = (width - (columns - 1) * gap) / columns;
  const hintHeight = drawHelp(245, x, width), start = hintHeight ? 245 + hintHeight + 24 : 248;
  lessonCatalog.lessons.forEach((lesson, index) => {
    const r = box(x + index % columns * (cellW + gap), start + Math.floor(index / columns) * 245, cellW, 230);
    const item = action(ui, `lesson-${lesson.number}`, '', r, () => openLesson(lesson.id));
    const topic = Math.max(0, Number(lesson.topic) - 1);
    image(item, pictures.get(`topic-${topic}`)!, box(17, 13, cellW - 34, 68));
    copy(item, `Урок ${lesson.number}`, cellW / 2, 87, 18, { hand: true, center: true });
    const title = copy(item, lesson.title, cellW / 2, 119, 18, { center: true, width: cellW - 28 }); item.accessibleHint = `Урок ${lesson.number}. ${lesson.title}`;
    captions.push({ id: `lesson-${lesson.number}-title`, rect: r, view: title });
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

function frameHeight() {
  if (task === 'textbook') return 248 + Math.ceil(data.lessons.length / (innerWidth > 900 ? 3 : 2)) * 245 + 158;
  if (task === 'construction-intro') return showBreakdown ? 1570 : 1120;
  if (task === 'word-intro') return 1120;
  if (task === 'video') return 1120;
  if (task === 'counter-intro' || task === 'construction') return 1050;
  if (['count-picture', 'count-listen', 'count-category'].includes(task)) return 1040;
  return 860;
}
function resize() { if (!ready) return; host.style.height = `${Math.max(innerHeight, frameHeight())}px`; app.resize(); render(); }
function placeWorld() {
  const w = app.screen.width, h = app.screen.height;
  background.texture = textures.get(w >= 900 ? desktopDeskUrl : deskUrl)!;
  const scale = Math.max(w / background.texture.width, innerHeight / background.texture.height);
  background.scale.set(scale); background.position.set((w - background.width) / 2, scrollY + (innerHeight - background.height) / 2);
  const size = w < 700 ? 78 : 215;
  cat.width = size; cat.height = size / cat.texture.width * cat.texture.height; cat.position.set(w - size - 14, h - cat.height - 20);
}
function snapshot() {
  const controlText = captions.map(({ id, rect, view }) => { const b = view.getBounds(); return { id, rect, value: view.text, fontSize: view.style.fontSize, bounds: box(b.minX, b.minY, b.width, b.height) }; });
  const rotatedUi: string[] = [];
  const inspect = (node: Container) => { if (Math.abs(node.rotation) > 1e-7 || Math.abs(node.skew.x) > 1e-7 || Math.abs(node.skew.y) > 1e-7) rotatedUi.push(node.label || 'unnamed'); node.children.forEach(inspect); }; inspect(ui);
  return { ready, task, taskName: taskTitles[task], lesson: flow.snapshot(), view: 'orthographic-top-down', desktopBackground: app.screen.width >= 900, rotatedUi, wordIndex, selection, correct, revealed, tokens: [...tokenOrder], manual, menuOpen, composing: editor.composing, feedback, played, playing, hintVisible: !seenHints.has(hintKey()) || manualHint, hintKey: hintKey(), controls, controlText, contentBottom, catTop: cat.y, ruby, pendingRender: frame !== 0, motion: { ...motion, reduced: reduced(), enteredAt }, cspViolations: [...csp], fontLoaded: document.fonts.check('24px "Marck Script"'), source: data.source, video: { paused: video.paused, time: video.currentTime }, editorValue: editor.element.value };
}
let contentBottom = 0;
function render() {
  if (!ready || rendering) return; rendering = true;
  const focus = document.activeElement?.getAttribute('aria-label');
  if (drag) { drag.ghost.destroy({ children: true }); drag = null; }
  ui.removeChildren().forEach(child => child.destroy({ children: true })); controls = []; captions = []; ruby = []; topCard = null; dropZone = null;
  if (task !== 'construction' || !manual || menuOpen) editor.place(null);
  if (task !== 'video') video.hidden = true;
  placeWorld(); header();
  const w = app.screen.width, width = Math.min(task === 'textbook' && w >= 1000 ? 1000 : 640, w - 38), x = (w - width) / 2;
  if (task === 'lesson-overview') lessonOverview(x, width);
  else if (task === 'part-complete' || task === 'lesson-complete') lessonBoundary(x, width);
  else if (task.startsWith('word-') && task !== 'word-intro') quiz(x, width);
  else if (task.startsWith('recall-')) recall(x, width);
  else if (task === 'construction') construction(x, width);
  else if (task.startsWith('count-')) count(x, width);
  else if (task.endsWith('intro')) introduction(x, width);
  else if (task === 'video') videoPage(x, width);
  else if (task === 'textbook') textbook(x, width);
  else reference(x, width);
  contentBottom = ui.getLocalBounds().maxY;
  const height = Math.ceil(Math.max(innerHeight, frameHeight(), contentBottom + (w < 700 ? 130 : 270)));
  if (app.screen.height !== height) { host.style.height = `${height}px`; app.resize(); placeWorld(); }
  copy(ui, 'Стенд · прогресс до обновления страницы', 17, app.screen.height - 47, 13, { hand: true });
  drawMenu();
  const description = menuOpen ? 'Разделы приложения' : `${taskTitles[task]}. ${flow.active ? `Урок ${flow.lesson!.number}. ${flow.goal?.titleRu ?? flow.lesson!.title}. ` : ''}${task === 'word-ja' || task === 'recall-ja' || task === 'word-intro' ? `${current().surface}, ${current().kana}` : task === 'word-ru' || task === 'recall-ru' ? current().meaningRu : task === 'construction' ? currentConstruction().promptRu : ''}. ${isListening() && !played ? 'Сначала прослушайте запись.' : ''}`;
  if (semantic.textContent !== description) semantic.textContent = description;
  const visibleText: string[] = [];
  const collect = (node: Container) => { if (!node.visible) return; if (node instanceof Text && node.text.trim()) visibleText.push(node.text); node.children.forEach(collect); };
  collect(ui);
  const transcript = menuOpen ? 'Учебник. Повторение. Справочник.' : visibleText.join('\n');
  if (screenCopy.textContent !== transcript) screenCopy.textContent = transcript;
  app.render();
  if (focus && document.activeElement === document.body) [...document.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find(node => node.getAttribute('aria-label') === focus)?.focus({ preventScroll: true });
  if (menuOpen && document.activeElement === document.body) [...document.querySelectorAll<HTMLButtonElement>('button[aria-label]')].find(node => node.getAttribute('aria-label') === 'Учебник')?.focus({ preventScroll: true });
  rendering = false;
}
async function start() {
  Assets.setPreferences({ preferWorkers: false }); await document.fonts.load('24px "Marck Script"', 'Учебник 1 из 4');
  await app.init({ resizeTo: host, preference: 'webgl', autoDensity: true, resolution: Math.min(devicePixelRatio, 2), antialias: true, background: '#b8773d', autoStart: false, accessibilityOptions: { enabledByDefault: true, deactivateOnMouseMove: false } });
  host.prepend(app.canvas); app.canvas.setAttribute('aria-label', 'Учебный стол まるごと'); app.canvas.style.touchAction = 'pan-y'; app.stage.addChild(world, ui); world.addChild(background, cat);
  const urls = [deskUrl, desktopDeskUrl, cardUrl, answerUrl, catUrl, logoUrl, '/counters/objects-atlas.webp', '/ui/topics-atlas-v1.webp'];
  const loaded = await Assets.load<Texture>(urls); for (const url of urls) textures.set(url, loaded[url]!);
  const atlas = textures.get('/counters/objects-atlas.webp')!, rows = [0, 282, 522, 754, 980, 1254];
  for (let tile = 0; tile < 25; tile++) { const row = Math.floor(tile / 5), x = tile % 5 * 250, y = rows[row]!; pictures.set(`counter-${tile}`, new Texture({ source: atlas.source, frame: new Rectangle(x, y, Math.min(tile === 21 ? 275 : 254, atlas.width - x), rows[row + 1]! - y) })); }
  const topics = textures.get('/ui/topics-atlas-v1.webp')!;
  for (let tile = 0; tile < 9; tile++) pictures.set(`topic-${tile}`, new Texture({ source: topics.source, frame: new Rectangle(tile % 3 * topics.width / 3, Math.floor(tile / 3) * topics.height / 3, topics.width / 3, topics.height / 3) }));
  background.texture = textures.get(deskUrl)!; cat.texture = textures.get(catUrl)!;
  ready = true; resize(); enterCard();
  app.ticker.maxFPS = 60;
  app.ticker.add(() => {
    const t = Math.min(1, (performance.now() - enteredAt) / 560);
    const still = reduced() || t >= 1;
    const lift = still ? 0 : -8 * Math.sin(Math.PI * t) * (1 - t * .35), sway = still ? 0 : Math.sin(t * Math.PI * 10) * 1.6 * (1 - t);
    motion = { x: sway, y: lift, rotation: 0 };
    if (topCard) topCard.position.set(cardOrigin.x + sway, cardOrigin.y + lift);
    if (t >= 1 || reduced() || !topCard) app.stop();
  });
  const gl = app.canvas.getContext('webgl2') ?? app.canvas.getContext('webgl'), recovery = gl?.getExtension('WEBGL_lose_context');
  app.canvas.addEventListener('webglcontextlost', event => { event.preventDefault(); app.stop(); audio.pause(); video.pause(); document.querySelector('#recovery')!.removeAttribute('hidden'); });
  app.canvas.addEventListener('webglcontextrestored', () => { document.querySelector('#recovery')!.setAttribute('hidden', ''); schedule(); });
  document.querySelector('#retry')!.addEventListener('click', () => recovery?.restoreContext());
  Object.assign(window, { __PAPER__: { snapshot, tasks, navigate, editor: editor.element, app, audio, video, replay: enterCard } });
}
window.addEventListener('resize', resize); window.addEventListener('scroll', schedule, { passive: true });
document.addEventListener('visibilitychange', () => { if (document.hidden) { audio.pause(); video.pause(); app.stop(); } });
void start().catch(error => { console.error(error); document.querySelector('#recovery')!.removeAttribute('hidden'); });
