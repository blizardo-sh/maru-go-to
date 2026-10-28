import { Container, Graphics, Text, TextStyle, type Texture, Sprite, Rectangle } from 'pixi.js';

export const ink = '#241d17';
export const green = '#405b40';
export const jpFont = 'sans-serif';
export type Rect = { x: number; y: number; width: number; height: number };
export type JapaneseValue = { surface: string; kana: string; segments: { surface: string; reading?: string }[] };
export type Script = 'kana' | 'furigana' | 'kanji';
export type Control = { id: string; label: string; rect: Rect };
const measure = document.createElement('canvas').getContext('2d')!;

export function label(root: Container, value: string, x: number, y: number, size = 18, options: { width?: number; color?: string; display?: boolean; center?: boolean; fontFamily?: string } = {}) {
  const text = new Text({ text: value, style: new TextStyle({
    fontFamily: options.fontFamily ?? (options.display ? 'Neucha' : 'system-ui, sans-serif'), fontSize: size,
    fill: options.color ?? ink, wordWrap: !!options.width, wordWrapWidth: options.width,
    breakWords: true, lineHeight: size * 1.45,
  }) });
  text.position.set(x, y);
  if (options.center) text.anchor.x = .5;
  root.addChild(text);
  return text;
}

export function panel(root: Container, rect: Rect, paper?: Texture, wood = false, radius = 8) {
  const container = new Container(); container.position.set(rect.x, rect.y);
  if (wood) container.addChild(new Graphics().roundRect(-7, -7, rect.width + 14, rect.height + 14, 3).fill('#896744'));
  container.addChild(new Graphics().roundRect(0, 0, rect.width, rect.height, radius).fill('#fff7e6'));
  if (paper) {
    const image = new Sprite(paper); image.width = rect.width; image.height = rect.height; image.alpha = .65;
    container.addChild(image);
  }
  root.addChild(container);
  return container;
}

export function button(root: Container, controls: Control[], id: string, value: string, rect: Rect, action: () => void, active = false, small = false) {
  const view = new Container(); view.position.set(rect.x, rect.y);
  const bg = new Graphics();
  const draw = (focused = false) => {
    bg.clear().roundRect(0, 0, rect.width, rect.height, 5).fill(active ? green : '#eadfc9');
    if (focused) bg.roundRect(2, 2, rect.width - 4, rect.height - 4, 4).stroke({ color: active ? '#ffffff' : green, width: 3 });
  };
  draw(); view.addChild(bg);
  const caption = label(view, value, rect.width / 2, 0, small ? 13 : 17, { color: active ? '#ffffff' : ink, center: true, width: rect.width - 12 });
  caption.y = (rect.height - caption.height) / 2;
  view.eventMode = 'static'; view.cursor = 'pointer'; view.hitArea = new Rectangle(0, 0, rect.width, rect.height);
  view.on('pointertap', action);
  view.on('mouseover', () => draw(true)); view.on('mouseout', () => draw(false));
  view.accessible = true; view.accessibleType = 'button'; view.accessibleHint = value;
  view.accessiblePointerEvents = 'none';
  root.addChild(view);
  const bounds = root.toGlobal({ x: rect.x, y: rect.y });
  controls.push({ id, label: value, rect: { ...rect, x: bounds.x, y: bounds.y } });
  return view;
}

export function textWidth(value: string, size: number, family = jpFont) {
  measure.font = `${size}px ${family}`; return measure.measureText(value).width;
}

// Ruby groups stay together; curated course segments retain their original readings.
export function japanese(root: Container, value: JapaneseValue, mode: Script, rect: Rect, size = 42, family = jpFont, readingScale = .4) {
  const readingSize = Math.max(12, Math.round(size * readingScale)), gap = 5;
  const lineHeight = Math.max(size * 1.65, readingSize + size + gap + 5);
  const segments: JapaneseValue['segments'] = mode === 'furigana' ? value.segments.flatMap(segment =>
    (!segment.reading || segment.reading === segment.surface) && textWidth(segment.surface, size, family) > rect.width
      ? Array.from(segment.surface).map(surface => ({ surface })) : [segment]) : Array.from(mode === 'kana' ? value.kana : value.surface).map(surface => ({ surface }));
  let x = 0, y = 0;
  const groups: { surface: string; reading?: string; x: number; y: number; width: number }[] = [];
  for (const segment of segments) {
    const reading = mode === 'furigana' && segment.reading !== segment.surface ? segment.reading : undefined;
    const width = Math.max(textWidth(segment.surface, size, family), reading ? textWidth(reading, readingSize, family) : 0);
    if (x > 0 && x + width > rect.width) { x = 0; y += lineHeight; }
    groups.push({ surface: segment.surface, reading, x, y, width });
    if (reading) label(root, reading, rect.x + x + width / 2, rect.y + y, readingSize, { center: true, fontFamily: family });
    const base = new Text({ text: segment.surface, style: { fontFamily: family, fontSize: size, fill: ink } });
    base.position.set(rect.x + x + width / 2, rect.y + y + readingSize + gap); base.anchor.x = .5; root.addChild(base);
    x += width;
  }
  return { groups, height: y + lineHeight, overflow: groups.some(group => group.width > rect.width) };
}

export function escapeMarkup(value: string) {
  return value.replace(/[&<>"']/g, char => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&apos;' })[char]!);
}

export function rubyMarkup(value: JapaneseValue) {
  return value.segments.map(segment => segment.reading && segment.reading !== segment.surface
    ? `<ruby>${escapeMarkup(segment.surface)}<rt>${escapeMarkup(segment.reading)}</rt></ruby>`
    : escapeMarkup(segment.surface)).join('');
}

export class EditorBridge {
  readonly element: HTMLTextAreaElement | HTMLInputElement;
  composing = false;
  commits = 0;
  focused = false;
  private changed: () => void;

  constructor(password: boolean | 'email', changed: () => void) {
    this.changed = changed;
    this.element = document.createElement(password ? 'input' : 'textarea');
    if (this.element instanceof HTMLInputElement) {
      // Email keyboards need inputMode; type=email does not expose caret/selection to Canvas.
      this.element.type = password === 'email' ? 'text' : 'password';
      if (password === 'email') this.element.inputMode = 'email';
      this.element.autocomplete = password === 'email' ? 'username' : 'new-password';
    }
    else { this.element.rows = 3; this.element.lang = 'ja'; this.element.inputMode = 'text'; this.element.autocomplete = 'off'; this.element.maxLength = 1000; }
    this.element.className = 'native-editor';
    this.element.setAttribute('aria-label', password ? 'Пробный пароль' : 'Японская фраза');
    this.element.spellcheck = false;
    this.element.addEventListener('compositionstart', () => { this.composing = true; changed(); });
    this.element.addEventListener('compositionend', () => { this.composing = false; this.commits++; changed(); });
    this.element.addEventListener('input', () => { if (!this.composing) this.commits++; changed(); });
    for (const event of ['select', 'keyup', 'click', 'scroll']) this.element.addEventListener(event, changed);
    this.element.addEventListener('focus', () => { this.focused = true; changed(); });
    this.element.addEventListener('blur', () => { this.focused = false; changed(); });
    document.querySelector('#stage')!.append(this.element);
  }

  place(rect: Rect | null) {
    this.element.hidden = !rect;
    if (rect) Object.assign(this.element.style, { left: `${rect.x}px`, top: `${rect.y}px`, width: `${rect.width}px`, height: `${rect.height}px` });
  }

  draw(root: Container, rect: Rect, placeholder: string) {
    const box = new Graphics().roundRect(rect.x, rect.y, rect.width, rect.height, 4).fill('#fffdf4').stroke({ color: this.focused ? green : '#b5a485', width: this.focused ? 3 : 1 });
    root.addChild(box);
    const content = new Container();
    const clip = new Graphics().rect(rect.x + 8, rect.y + 6, rect.width - 16, rect.height - 12).fill('#ffffff');
    root.addChild(clip, content); content.mask = clip;
    const raw = this.element.value;
    const shown = this.element instanceof HTMLInputElement && this.element.type === 'password' ? '•'.repeat(raw.length) : raw;
    const start = this.element.selectionStart ?? 0, end = this.element.selectionEnd ?? start;
    const scrollTop = this.element.scrollTop;
    let x = rect.x + 12, y = rect.y + 12 - scrollTop;
    let caret = { x, y };
    for (let index = 0; index < shown.length;) {
      const char = String.fromCodePoint(shown.codePointAt(index)!);
      const width = textWidth(char, 20);
      if (char === '\n' || x + width > rect.x + rect.width - 12) { x = rect.x + 12; y += 34; }
      if (index === start) caret = { x, y };
      if (char !== '\n') {
        if (index >= start && index < end) content.addChild(new Graphics().rect(x, y, width, 30).fill('#cddbc1'));
        const glyph = new Text({ text: char, style: { fontFamily: jpFont, fontSize: 20, fill: ink } }); glyph.position.set(x, y); content.addChild(glyph); x += width;
      }
      index += char.length;
    }
    if (start === shown.length) caret = { x, y };
    if (!shown) label(content, placeholder, rect.x + 12, rect.y + 12, 16, { color: '#716958', width: rect.width - 24 });
    if (this.focused && start === end) content.addChild(new Graphics().rect(caret.x, caret.y, 2, 28).fill(green));
    this.place(rect);
  }

  destroy() { this.element.remove(); }
}
