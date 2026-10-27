import 'pixi.js/unsafe-eval';
import 'pixi.js/accessibility';
import { Application, Assets, Container, Graphics, HTMLText, Rectangle, Sprite, Texture } from 'pixi.js';
import fixtures from './fixtures.json';
import { button, EditorBridge, green, ink, japanese, label, panel, rubyMarkup, textWidth, type Control, type Rect, type Script } from './canvas';
import { probeVideo } from './media';
import './style.css';

const params = new URLSearchParams(location.search);
let view = params.get('view') === 'lab' ? 'lab' : 'cards';
let variant = ['A', 'B', 'C'].includes(params.get('variant') ?? '') ? params.get('variant')! : 'A';
let exercise = params.get('exercise') === 'construction' ? 'construction' : 'word';
let script: Script = 'furigana';
let wordIndex = 0;
let chosen: number | null = null;
let selectedTokens: number[] = [];
let feedback = '';
let manual = false;
let ready = false;
let rendering = false;
let frame = 0;
let controls: Control[] = [];
let rubyGeometry: ReturnType<typeof japanese>[] = [];
const host = document.querySelector<HTMLElement>('#stage')!;
const ui = new Container(), footer = new Container(), world = new Container();
const app = new Application();
const background = new Sprite(), cat = new Sprite();
const statusCopy = document.createElement('p'); statusCopy.className = 'semantic-copy'; statusCopy.setAttribute('role', 'status'); host.append(statusCopy);
const questionCopy = document.createElement('h1'); questionCopy.className = 'semantic-copy'; host.append(questionCopy);
const report: Record<string, unknown> = { renderer: 'starting', cspViolations: [], video: 'not-run', htmlText: 'not-run', physicalIME: 'manual-required', passwordAutofill: 'manual-required' };
document.addEventListener('securitypolicyviolation', event => {
  (report.cspViolations as object[]).push({ directive: event.effectiveDirective, blocked: event.blockedURI });
  schedule();
});
const editor = new EditorBridge(false, schedule), password = new EditorBridge(true, schedule);
editor.element.value = fixtures.construction.example.surface;
const video = document.createElement('video');
video.className = 'native-video'; video.playsInline = true; video.preload = 'none'; video.hidden = true;
video.setAttribute('aria-label', 'Официальный видеодиалог Marugoto'); video.style.pointerEvents = 'none'; host.append(video);
let videoBusy = false;
video.addEventListener('pause', schedule); video.addEventListener('play', schedule);
const scenes = ['room', 'garden', 'mountains', 'river', 'tokyo'];
const sceneLabels = ['Комната', 'Сад', 'Горы', 'Река', 'Токио'];
let sceneIndex = 0, sceneTicket = 0;
let paper: Texture;
const art = new Map<string, Texture>();
const catTextures = new Map<string, Texture>();
let catUntil = 0;
let htmlSample: HTMLText;
let disposed = false;
let restoreGraphics: (() => void) | undefined;

function schedule() { if (!ready || disposed) return; cancelAnimationFrame(frame); frame = requestAnimationFrame(() => { frame = 0; render(); }); }
function rect(x: number, y: number, width: number, height: number): Rect { return { x, y, width, height }; }
function say(value: string) { feedback = value; statusCopy.textContent = value; schedule(); }
function go(next: string) {
  view = next;
  if (view !== 'lab') video.pause();
  updateUrl(); resize();
}
function updateUrl() {
  const url = new URL(location.href); url.searchParams.set('view', view); url.searchParams.set('variant', variant); url.searchParams.set('exercise', exercise);
  history.replaceState(null, '', url);
}
function changeVariant(direction: number) {
  variant = ['A', 'B', 'C'][(Math.max(0, ['A', 'B', 'C'].indexOf(variant)) + direction + 3) % 3]!;
  updateUrl(); resize();
}
function reset() { chosen = null; selectedTokens = []; manual = false; feedback = ''; schedule(); }
function reaction(good: boolean) { cat.texture = catTextures.get(good ? 'success' : 'encourage')!; catUntil = performance.now() + 1400; }

async function changeScene() {
  const ticket = ++sceneTicket;
  const scene = scenes[sceneIndex]!;
  const mobile = innerWidth <= 600 || innerHeight > innerWidth;
  const texture = await Assets.load<Texture>(`/scenes/${scene}${mobile ? '-mobile' : ''}-v1.webp`);
  if (ticket !== sceneTicket || disposed) return;
  background.texture = texture; placeWorld(); schedule();
}

function placeWorld() {
  const { width, height } = app.screen;
  const scale = Math.max(width / background.texture.width, height / background.texture.height);
  background.scale.set(scale); background.position.set((width - background.width) / 2, height - background.height);
  const phone = width < 1100;
  const size = phone ? 145 : Math.min(290, width * .22);
  cat.width = size; cat.height = size; cat.anchor.set(.5, .97);
  cat.position.set(phone ? width * .82 : width * .86, phone ? height - 95 : Math.min(height - 130, 685));
}

function resize() {
  if (!ready) return;
  const phone = innerWidth < 700, compact = innerWidth < 1100;
  const minimum = view === 'lab' ? (phone ? 2060 : 1860) : compact ? (exercise === 'construction' ? 1180 : variant === 'B' ? 1150 : 1010) : exercise === 'construction' ? 980 : 870;
  host.style.height = `${Math.max(innerHeight, minimum)}px`;
  app.resize(); placeWorld(); render();
}

function canvasButton(id: string, value: string, r: Rect, action: () => void, active = false, small = false, parent = ui) {
  return button(parent, controls, id, value, r, action, active, small);
}

function toolbar() {
  const w = app.screen.width, phone = w < 1000;
  panel(ui, rect(16, 16, w - 32, phone ? 124 : 82), paper);
  label(ui, 'まるごと', 32, 26, phone ? 24 : 30);
  label(ui, view === 'lab' ? 'Технический Canvas-стенд' : 'Карточки · три варианта', phone ? 32 : 215, phone ? 65 : 30, phone ? 15 : 24, { display: !phone });
  if (!phone) label(ui, 'Предпросмотр · ответы не сохраняются', 215, 65, 13, { color: '#6c6250' });
  const x = phone ? 24 : w - 410, y = phone ? 91 : 36;
  canvasButton('word', 'Слово', rect(x, y, 82, 44), () => { exercise = 'word'; reset(); go('cards'); }, view === 'cards' && exercise === 'word');
  canvasButton('construction', 'Фраза', rect(x + 90, y, 82, 44), () => { exercise = 'construction'; reset(); go('cards'); }, view === 'cards' && exercise === 'construction');
  canvasButton('lab', 'Стенд', rect(x + 180, y, 82, 44), () => go('lab'), view === 'lab');
  canvasButton('scene', sceneLabels[sceneIndex]!, rect(phone ? w - 126 : w - 138, phone ? 27 : 36, 108, 44), () => { sceneIndex = (sceneIndex + 1) % scenes.length; void changeScene().catch(failure); }, false, true);
}

function drawFooter() {
  if (view !== 'cards') return;
  const w = app.screen.width, phone = w < 700, width = Math.min(700, w - 24);
  const y = Math.min(app.screen.height - 92, scrollY + innerHeight - 92), x = (w - width) / 2;
  const root = panel(footer, rect(x, y, width, 76), paper);
  canvasButton('previous-variant', '←', rect(10, 15, 48, 46), () => changeVariant(-1), false, false, root);
  canvasButton('next-variant', '→', rect(width - 58, 15, 48, 46), () => changeVariant(1), false, false, root);
  const name = variant === 'A' ? 'Карточка / колода' : variant === 'B' ? 'Разворот альбома' : 'Вопрос и ответы';
  label(root, `${variant} · ${name}`, width / 2, 8, phone ? (w < 360 ? 17 : 21) : 25, { center: true, display: true });
  label(root, phone ? 'Стрелки — другой вариант' : '← → переключить вариант · состояние задания сохраняется', width / 2, 43, phone ? 11 : 13, { center: true, color: '#6c6250' });
}

function imageAt(root: Container, source: Texture, area: Rect) {
  const sprite = new Sprite(source); const scale = Math.min(area.width / source.width, area.height / source.height);
  sprite.scale.set(scale); sprite.position.set(area.x + (area.width - sprite.width) / 2, area.y + (area.height - sprite.height) / 2); root.addChild(sprite);
}

function choose(index: number) {
  if (chosen !== null) return;
  chosen = index;
  const good = index === wordIndex;
  reaction(good);
  say(good ? 'Верно. Хорошо получилось!' : `Это «${fixtures.words[wordIndex]!.meaningRu}». Попробуем ещё.`);
}

function drawWord(area: Rect, layout: 'A' | 'B' | 'C') {
  const word = fixtures.words[wordIndex]!, phone = app.screen.width < 700;
  const root = new Container(); root.position.set(area.x, area.y); ui.addChild(root);
  const w = area.width;
  const split = layout === 'B' && !phone;
  const promptWidth = split ? w * .43 : w;
  label(root, phone ? 'Переведите слово' : 'Как переводится это слово?', 24, 20, phone ? 23 : 28, { display: true, width: promptWidth - 48 });
  canvasButton('script', script === 'furigana' ? 'С фуриганой' : script === 'kana' ? 'Кана' : 'Кандзи', rect(promptWidth - 144, 67, 120, 44), () => { script = script === 'furigana' ? 'kana' : script === 'kana' ? 'kanji' : 'furigana'; schedule(); }, false, true, root);
  const questionY = layout === 'C' ? 122 : 125;
  const size = phone ? 56 : split ? 70 : 82;
  const questionWidth = Math.max(textWidth(word.surface, size), textWidth(word.kana, size * .4));
  rubyGeometry.push(japanese(root, word, script, rect((promptWidth - questionWidth) / 2, questionY, promptWidth - 48, 120), size));
  let answersX = 24, answersY = layout === 'C' ? 310 : phone ? 260 : 290, answersW = w - 48;
  if (split) { answersX = w * .47; answersY = 48; answersW = w - answersX - 28; }
  const vertical = layout === 'B';
  const gap = 12, h = phone ? 50 : 56;
  const order = [2, 3, 0, 1];
  order.forEach((index, orderIndex) => {
    const columns = vertical ? 1 : 2;
    const width = (answersW - (columns - 1) * gap) / columns;
    const x = answersX + orderIndex % columns * (width + gap);
    const y = answersY + Math.floor(orderIndex / columns) * (h + gap);
    canvasButton(`answer-${index}`, fixtures.words[index]!.meaningRu, rect(x, y, width, h), () => choose(index), chosen === index && index === wordIndex, false, root);
  });
  const bottom = answersY + (vertical ? 4 : 2) * (h + gap);
  if (chosen !== null) {
    label(root, feedback, answersX, bottom + 2, phone ? 16 : 18, { width: answersW, color: chosen === wordIndex ? green : '#754b36' });
    canvasButton('next-word', 'Другое слово', rect(answersX, bottom + (phone ? 62 : 58), answersW, 46), () => { wordIndex = (wordIndex + 1) % fixtures.words.length; reset(); }, true, false, root);
    const illustration = art.get(word.id);
    if (illustration && split) imageAt(root, illustration, rect(56, 270, promptWidth - 112, 180));
  } else label(root, 'Выберите один ответ. Прогресс не изменится.', answersX, bottom + 12, 13, { width: answersW, color: '#6c6250' });
  if (layout === 'C') {
    label(root, 'Ваш ответ', 24, 282, 18, { display: true });
  }
}

function drawConstruction(area: Rect, layout: 'A' | 'B' | 'C') {
  const phone = app.screen.width < 700;
  const root = new Container(); root.position.set(area.x, area.y); ui.addChild(root);
  const w = area.width, split = layout === 'B' && !phone;
  const x = split ? w * .46 : 24, workW = split ? w - x - 24 : w - 48;
  label(root, 'Соберите фразу', 24, 20, phone ? 25 : 32, { display: true, width: split ? x - 48 : w - 48 });
  label(root, fixtures.construction.promptRu, 24, 76, layout === 'C' ? (phone ? 34 : 42) : phone ? 26 : 34, { width: split ? x - 48 : w - 48 });
  if (split) label(root, fixtures.construction.explanationRu, 24, 160, 17, { width: x - 64 });
  const top = split ? 28 : layout === 'C' ? 178 : layout === 'B' && phone ? 190 : 146;
  panel(root, rect(x, top, workW, 145), undefined);
  let tx = x + 10, ty = top + 14;
  if (!selectedTokens.length && !manual) label(root, 'Нажимайте слова внизу', tx + 4, ty + 18, 17, { width: workW - 28, color: '#746c5b' });
  if (manual) {
    const global = root.toGlobal({ x, y: top });
    editor.draw(ui, rect(global.x, global.y, workW, 145), 'Введите японскую фразу');
  } else selectedTokens.forEach((index, order) => {
    const token = fixtures.construction.tokens[index]!;
    const width = Math.min(workW - 20, Math.max(56, textWidth(token.surface, phone ? 20 : 25) + 24));
    if (tx + width > x + workW - 8) { tx = x + 10; ty += 56; }
    canvasButton(`selected-${order}`, token.surface, rect(tx, ty, width, 48), () => { selectedTokens.splice(order, 1); say(''); }, false, false, root);
    tx += width + 8;
  });
  let bx = x, by = top + 174;
  [1, 3, 0, 2].forEach(index => {
    const token = fixtures.construction.tokens[index]!;
    const width = Math.min(workW, Math.max(64, textWidth(token.surface, phone ? 20 : 25) + 28));
    if (bx + width > x + workW) { bx = x; by += 58; }
    if (selectedTokens.includes(index)) {
      root.addChild(new Graphics().roundRect(bx, by, width, 48, 5).stroke({ color: '#c9b99e', width: 1 }));
      label(root, token.surface, bx + width / 2, by + 10, 17, { center: true, color: '#9c917e' });
    } else canvasButton(`token-${index}`, token.surface, rect(bx, by, width, 48), () => { manual = false; selectedTokens.push(index); say(''); }, false, false, root);
    bx += width + 8;
  });
  const controlsY = top + (phone ? 308 : 300);
  canvasButton('manual', manual ? 'Слова' : 'Ввести самому', rect(x, controlsY, workW, 44), () => { manual = !manual; if (manual) { schedule(); setTimeout(() => editor.element.focus(), 0); } else schedule(); }, false, true, root);
  canvasButton('check-phrase', 'Проверить', rect(x, controlsY + 56, (workW - 12) * .62, 48), () => {
    if (editor.composing) { say('Завершите ввод японского текста.'); return; }
    const value = manual ? editor.element.value.trim().replace(/[。\s]/g, '') : selectedTokens.map(index => fixtures.construction.tokens[index]!.surface).join('');
    const good = value === fixtures.construction.example.surface.replace(/[。\s]/g, '');
    reaction(good); say(good ? 'Верно: ' + fixtures.construction.example.surface : 'Соберите исходную фразу целиком.');
  }, true, false, root);
  canvasButton('reset-phrase', 'Сначала', rect(x + (workW - 12) * .62 + 12, controlsY + 56, (workW - 12) * .38, 48), reset, false, true, root);
  label(root, feedback || 'Можно нажать на добавленное слово, чтобы убрать его.', x, controlsY + 118, 14, { width: workW, color: feedback.startsWith('Верно') ? green : '#6c6250' });
}

function cards() {
  const w = app.screen.width, phone = w < 700;
  const catSpace = w >= 1100 ? Math.min(290, w * .22) + 24 : 0;
  const width = Math.min(variant === 'B' ? 1000 : variant === 'C' ? 970 : 670, w - (phone ? 32 : 80) - catSpace);
  const x = phone ? 16 : Math.max(40, (w - width - catSpace) / 2), y = phone ? 169 : 145;
  const height = exercise === 'construction' ? (variant === 'B' ? (phone ? 740 : 560) : variant === 'C' ? 700 : 650) : variant === 'B' ? (phone ? 720 : 520) : 570;
  report.cardBounds = rect(x - (variant === 'A' ? 7 : 0), y - (variant === 'A' ? 7 : 0), width + (variant === 'A' ? 22 : 0), height + (variant === 'A' ? 22 : 0));
  if (variant === 'A') {
    panel(ui, rect(x + 8, y + 10, width, height), paper);
    panel(ui, rect(x + 4, y + 5, width, height), paper);
  }
  if (variant === 'C' || variant === 'B' && phone) {
    const questionH = exercise === 'construction' ? 146 : variant === 'B' ? 234 : 258;
    panel(ui, rect(x, y, width, questionH), paper);
    panel(ui, rect(x, y + questionH + 20, width, height - questionH - 20), paper);
  } else panel(ui, rect(x, y, width, height), paper, variant === 'A');
  if (variant === 'A') {
    ui.addChild(new Graphics().rect(x + 16, y + 17, 5, height - 34).fill('#e2ccaa'));
  } else if (variant === 'B' && !phone) {
    ui.addChild(new Graphics().rect(x + width * .44, y + 12, 9, height - 24).fill('#d8c4a3'));
  } else if (variant === 'C') {
    ui.addChild(new Graphics().rect(x + 16, y + 14, width - 32, 5).fill(green));
  }
  if (exercise === 'word') drawWord(rect(x, y, width, height), variant as 'A' | 'B' | 'C');
  else drawConstruction(rect(x, y, width, height), variant as 'A' | 'B' | 'C');
  label(ui, 'Материал настоящего курса · учебные ответы не сохраняются', x + 12, y + height + 14, 12, { width: width - 24, color: '#fff8e9' });
}

function lab() {
  const w = app.screen.width, phone = w < 700, x = phone ? 16 : Math.max(40, (w - 1020) / 2), width = Math.min(1020, w - x * 2);
  const aY = 166, aH = phone ? 570 : 400;
  panel(ui, rect(x, aY, width, aH), paper);
  label(ui, 'Фуригана: два способа', x + 22, aY + 16, phone ? 24 : 28, { display: true });
  label(ui, 'Canvas: основа и чтение отдельно', x + 22, aY + 65, 15);
  const sample = fixtures.rubySamples.find(value => value.surface === '新聞') ?? fixtures.rubySamples[1]!;
  rubyGeometry.push(japanese(ui, sample, 'furigana', rect(x + 24, aY + 102, phone ? width - 48 : width * .45, 110), 46));
  const htmlX = phone ? x + 24 : x + width * .54, htmlY = phone ? aY + 248 : aY + 102;
  label(ui, 'HTMLText: HTML → текстура', htmlX, htmlY - 37, 15);
  htmlSample.position.set(htmlX, htmlY); htmlSample.style.wordWrapWidth = phone ? width - 48 : width * .4;
  ui.addChild(htmlSample);
  label(ui, 'Проверка переноса: настоящие слова курса', x + 24, aY + aH - 176, 15);
  const long = fixtures.rubySamples.slice(0, phone ? 6 : 14);
  const combined = { surface: long.map(v => v.surface).join(' '), kana: long.map(v => v.kana).join(' '), segments: long.flatMap(v => [...v.segments, { surface: ' ' }]) };
  rubyGeometry.push(japanese(ui, combined, 'furigana', rect(x + 24, aY + aH - 138, width - 48, 110), phone ? 22 : 26));

  const bY = aY + aH + 24;
  panel(ui, rect(x, bY, width, 350), paper);
  label(ui, 'Японский ввод и пароль', x + 22, bY + 16, phone ? 24 : 28, { display: true });
  editor.draw(ui, rect(x + 22, bY + 66, width - 44, 130), 'Нажмите и введите японскую фразу');
  label(ui, editor.composing ? 'Идёт композиция IME — проверка не запускается' : `Композиция завершена · изменений: ${editor.commits}`, x + 24, bY + 207, 14, { width: width - 48 });
  label(ui, 'Пробный пароль — не вводите настоящий', x + 24, bY + 252, 14);
  password.draw(ui, rect(x + 22, bY + 284, width - 44, 48), 'Только пробные символы');

  const cY = bY + 374, videoW = Math.min(width - 44, 660), videoH = videoW * 9 / 16;
  panel(ui, rect(x, cY, width, videoH + 190), paper);
  label(ui, 'Настоящий видеодиалог', x + 22, cY + 16, phone ? 24 : 28, { display: true });
  const videoRect = rect(x + 22, cY + 66, videoW, videoH);
  ui.addChild(new Graphics().rect(videoRect.x, videoRect.y, videoRect.width, videoRect.height).fill('#282c24'));
  Object.assign(video.style, { left: `${videoRect.x}px`, top: `${videoRect.y}px`, width: `${videoRect.width}px`, height: `${videoRect.height}px` });
  video.hidden = !video.src;
  if (!video.src) label(ui, 'Кнопка ниже загружает официальный ролик Marugoto', videoRect.x + 14, videoRect.y + 20, 16, { width: videoW - 28, color: '#ffffff' });
  const bw = (videoW - 16) / 3;
  canvasButton('probe-video', videoBusy ? 'Проверяем…' : 'Проверить', rect(x + 22, cY + videoH + 80, bw, 46), () => {
    if (videoBusy) return; videoBusy = true; schedule();
    void probeVideo(video).then(result => { report.video = result; }).catch(error => { report.video = { error: String(error) }; }).finally(() => { videoBusy = false; schedule(); });
  }, true, true);
  canvasButton('pause-video', video.paused ? 'Смотреть' : 'Пауза', rect(x + 30 + bw, cY + videoH + 80, bw, 46), () => { if (video.paused) void video.play().catch(error => { report.videoPlay = String(error); schedule(); }); else video.pause(); }, false, true);
  canvasButton('seek-video', '+5 сек', rect(x + 38 + bw * 2, cY + videoH + 80, bw, 46), () => { if (Number.isFinite(video.duration)) video.currentTime = Math.min(video.currentTime + 5, video.duration - .2); }, false, true);
  const result = report.video as { crossOrigin?: string; upload?: string; native?: string };
  label(ui, typeof report.video === 'string' ? 'Видео запускается только вашим действием.' : `CORS: ${result.crossOrigin} · WebGL: ${result.upload} · video: ${result.native}`, x + 24, cY + videoH + 140, 13, { width: width - 48 });

  const dY = cY + videoH + 214;
  panel(ui, rect(x, dY, width, phone ? 350 : 300), paper);
  label(ui, 'Графика и production CSP', x + 22, dY + 16, phone ? 24 : 28, { display: true });
  label(ui, `Renderer: ${report.renderer}\nCSP без unsafe-eval · workers отключены\nЗафиксировано CSP violations: ${(report.cspViolations as object[]).length}\nФизический IME, автозаполнение и VoiceOver требуют ручной проверки.`, x + 24, dY + 63, 15, { width: width - 48 });
  canvasButton('download-report', 'Скачать отчёт', rect(x + 22, dY + (phone ? 224 : 174), Math.min(width - 44, 230), 46), () => {
    const blob = new Blob([JSON.stringify(snapshot(), null, 2)], { type: 'application/json' });
    const link = document.createElement('a'); link.href = URL.createObjectURL(blob); link.download = 'pixi-lab-report.json'; link.click(); setTimeout(() => URL.revokeObjectURL(link.href), 1000);
  }, false, true);
  canvasButton('lose-context', 'Проверить восстановление', rect(x + 22, dY + (phone ? 284 : 234), Math.min(width - 44, 300), 46), () => {
    const gl = app.canvas.getContext('webgl2') ?? app.canvas.getContext('webgl');
    const extension = gl?.getExtension('WEBGL_lose_context');
    if (extension) { restoreGraphics = () => extension.restoreContext(); extension.loseContext(); }
  }, false, true);
}

function snapshot() {
  const bounds = cat.getBounds();
  return { ...report, pendingRender: frame !== 0, catBounds: rect(bounds.minX, bounds.minY, bounds.width, bounds.height), ready, view, variant, exercise, wordIndex, chosen, selectedTokens: [...selectedTokens], feedback, composing: editor.composing, inputCommits: editor.commits, passwordLength: password.element.value.length, rubyGeometry, controls, source: fixtures.source, userAgent: navigator.userAgent };
}

function render() {
  if (!ready || disposed || rendering) return;
  rendering = true;
  const focused = document.activeElement?.getAttribute('aria-label');
  htmlSample.parent?.removeChild(htmlSample);
  for (const layer of [ui, footer]) layer.removeChildren().forEach(child => child.destroy({ children: true }));
  controls = []; rubyGeometry = [];
  if (view !== 'lab' && !(exercise === 'construction' && manual)) editor.place(null);
  if (view !== 'lab') { password.place(null); video.hidden = true; }
  toolbar();
  if (view === 'lab') lab(); else cards();
  const word = fixtures.words[wordIndex]!;
  const description = view === 'lab' ? 'Технический стенд Canvas: фуригана, японский ввод, видео и CSP.'
    : exercise === 'construction' ? `Соберите фразу: ${fixtures.construction.promptRu} Выбрано: ${selectedTokens.map(index => fixtures.construction.tokens[index]!.surface).join(' ')}.`
    : `Как переводится слово ${script === 'kana' ? word.kana : word.surface}${script === 'furigana' ? `, чтение ${word.kana}` : ''}?`;
  if (questionCopy.textContent !== description) questionCopy.textContent = description;
  drawFooter();
  app.render();
  report.htmlText = { width: htmlSample.width, height: htmlSample.height, method: 'foreignObject' };
  if (focused && document.activeElement === document.body) {
    const target = [...document.querySelectorAll<HTMLElement>('[aria-label]')].find(node => node.getAttribute('aria-label') === focused && node.tagName === 'BUTTON');
    target?.focus({ preventScroll: true });
  }
  rendering = false;
}

function failure(error: unknown) {
  report.error = String(error); document.querySelector('#recovery')!.removeAttribute('hidden');
  document.querySelector('#failure')!.textContent = 'Пробная графика недоступна. Данные приложения не затронуты.';
  console.error(error);
}

async function start() {
  Assets.setPreferences({ preferWorkers: false });
  await document.fonts.load('24px Neucha');
  await app.init({ resizeTo: host, preference: 'webgl', autoDensity: true, resolution: Math.min(devicePixelRatio, 2), background: '#c5b492', antialias: true,
    accessibilityOptions: { enabledByDefault: true, deactivateOnMouseMove: false } });
  host.prepend(app.canvas);
  const graphicsRecovery = (app.canvas.getContext('webgl2') ?? app.canvas.getContext('webgl'))?.getExtension('WEBGL_lose_context');
  app.canvas.addEventListener('webglcontextlost', event => {
    event.preventDefault(); app.stop(); video.pause(); report.context = 'lost';
    restoreGraphics ??= () => graphicsRecovery?.restoreContext();
    document.querySelector('#failure')!.textContent = 'Графика временно недоступна. Ответ и введённый текст сохранены в памяти. Нажмите «Повторить».';
    document.querySelector('#recovery')!.removeAttribute('hidden');
  });
  app.canvas.addEventListener('webglcontextrestored', () => {
    report.context = 'restored'; restoreGraphics = undefined;
    document.querySelector('#recovery')!.setAttribute('hidden', ''); app.start(); schedule();
  });
  app.canvas.setAttribute('aria-label', 'Рисованный интерфейс; доступные элементы управления расположены поверх Canvas');
  app.stage.addChild(world, ui, footer); world.addChild(background, cat);
  const urls = ['/ui/materials/paper-v1.webp', '/mascot/neutral.png', '/mascot/success.png', '/mascot/encourage.png', ...fixtures.words.flatMap(word => word.illustration ? [word.illustration.src] : [])];
  const textures = await Assets.load<Texture>([...new Set(urls)]);
  paper = textures['/ui/materials/paper-v1.webp']!;
  for (const pose of ['neutral', 'success', 'encourage']) catTextures.set(pose, textures[`/mascot/${pose}.png`]!);
  cat.texture = catTextures.get('neutral')!;
  for (const word of fixtures.words) if (word.illustration) {
    const [x, y, width, height] = word.illustration.bounds;
    art.set(word.id, new Texture({ source: textures[word.illustration.src]!.source, frame: new Rectangle(x, y, width, height) }));
  }
  const sample = fixtures.rubySamples.find(value => value.surface === '新聞') ?? fixtures.rubySamples[1]!;
  htmlSample = new HTMLText({ text: rubyMarkup(sample), style: { fontFamily: 'sans-serif', fontSize: 46, fill: ink, wordWrap: true, wordWrapWidth: 400 } });
  report.renderer = 'WebGL'; ready = true;
  resize(); await changeScene();
  app.ticker.maxFPS = 30;
  app.ticker.add(() => {
    if (catUntil && performance.now() > catUntil) { cat.texture = catTextures.get('neutral')!; catUntil = 0; }
    if (!matchMedia('(prefers-reduced-motion: reduce)').matches) cat.rotation = Math.sin(performance.now() / 2400) * .012;
    else cat.rotation = 0;
  });
  Object.assign(window, { __LAB__: { snapshot, editor: editor.element, password: password.element, video, app } });
}

window.addEventListener('resize', () => { resize(); void changeScene().catch(failure); });
window.addEventListener('scroll', schedule, { passive: true });
window.addEventListener('keydown', event => {
  if (view !== 'cards' || event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement) return;
  if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); changeVariant(event.key === 'ArrowLeft' ? -1 : 1); }
});
document.addEventListener('visibilitychange', () => { if (!ready) return; if (document.hidden) { app.stop(); video.pause(); } else app.start(); });
document.querySelector('#retry')!.addEventListener('click', () => { if (restoreGraphics) restoreGraphics(); else if (!ready) location.reload(); });
void start().catch(failure);
