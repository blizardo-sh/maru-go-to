import { Container, Graphics, NineSliceSprite, Rectangle, Sprite, Text, type Texture } from 'pixi.js';
import { japanese, label, textWidth, type JapaneseValue, type Rect, type Script } from './canvas';

export const ink = '#241d17', green = '#304d30', book = 'Lora';
export const jp = '"Hiragino Mincho ProN", "Yu Mincho", serif';
const actionInset = 18;
export type StudyAction = { fontSize?: number; id: string; text: string; run: () => void; enabled?: boolean; selected?: boolean; wrong?: boolean; bare?: boolean; picture?: Texture; accessibleLabel?: string; contrast?: boolean };
export type StudyChoice = StudyAction & { japanese?: boolean };
export type SurfaceLayout = ReturnType<typeof surfaceLayout>;

// Geometry depends on the viewport alone, never on task, selection or revealed content.
export function surfaceLayout(width: number, height: number) {
  const landscape = width / height > 1.45 && height < 650;
  const narrow = width < 600;
  const paperWidth = landscape ? Math.min(width - 74, 1000) : narrow ? width - 38 : Math.min(width - 220, 820);
  const paperHeight = landscape ? height - 76 : height - (narrow ? 154 : 180);
  const paper = { x: (width - paperWidth) / 2, y: landscape ? 65 : narrow ? 153 : 105, width: paperWidth, height: paperHeight };
  const padding = narrow ? 15 : 24, font = narrow || landscape ? 18 : 22;
  const actionHeight = narrow || landscape ? 44 : 50;
  const content = { x: narrow ? 5 : 12, y: 0, width: paperWidth - (narrow ? 10 : 24), height: paperHeight - actionHeight - 14 };
  return { paper, content, landscape, narrow, padding, font, headerTop: landscape ? 7 : narrow ? 78 : 20,
    actions: { x: content.x, y: paperHeight - actionHeight - 6, width: content.width, height: actionHeight },
    frame: { x: paper.x - 24 - 240 * .16, y: paper.y - 20 - 180 * .16, width: paperWidth + 48 + 480 * .16, height: paperHeight + 40 + 630 * .16 } };
}

export class StudySurface {
  readonly root = new Container();
  readonly controls: { id: string; text: string; accessibleLabel?: string; rect: Rect; enabled: boolean }[] = [];
  readonly texts: { value: string; rect: Rect; size: number }[] = [];
  readonly problems: string[] = [];
  body: Rect;
  leftPage?: Rect;
  private actions: Rect;
  constructor(readonly layout: SurfaceLayout, readonly texture: Texture, readonly paint: () => void, readonly script: Script = 'furigana') {
    this.root.position.set(layout.paper.x, layout.paper.y);
    this.body = layout.content;
    this.actions = layout.actions;
  }
  paper(rect: Rect, selected = false, wrong = false) {
    const paper = new NineSliceSprite({ texture: this.texture, leftWidth: 24, rightWidth: 24, topHeight: 20, bottomHeight: 20 });
    paper.width = rect.width / .35; paper.height = rect.height / .35; paper.scale.set(.35); paper.position.set(rect.x, rect.y); paper.tint = wrong ? '#f2ddd1' : selected ? '#e1e9cf' : '#ffffff';
    this.root.addChild(paper); return paper;
  }
  // Reserve the largest sibling state before drawing; revealing an answer never moves its actions.
  reserve(height: number) {
    height = Math.min(height, this.layout.content.height);
    this.body = { ...this.body, y: this.layout.content.y + (this.layout.content.height - height) / 2, height };
    this.actions = { ...this.actions, y: this.body.y + height + 8 };
  }
  pairedPanels(leftPage: Rect) {
    const width = Math.min(leftPage.width, this.body.width);
    const right = { ...this.body, x: this.body.x + (this.body.width - width) / 2, width };
    const left = { ...right, x: leftPage.x + (leftPage.width - width) / 2 };
    this.body = right; this.actions = { ...this.actions, x: right.x, width };
    return { left, right, leftActions: { ...this.actions, x: left.x } };
  }
  text(value: string, rect: Rect, size = this.layout.font, japanese = false, center = false) {
    const view = label(this.root, value, center ? rect.x + rect.width / 2 : rect.x, rect.y, size, { width: rect.width, center, fontFamily: japanese ? jp : book, color: ink });
    if (japanese) view.style.lineHeight = size * 1.25;
    this.texts.push({ value, rect: { x: view.x - (center ? view.width / 2 : 0), y: view.y, width: view.width, height: view.height }, size });
    if (view.height > rect.height + 2) this.problems.push(`Text overflow: ${value.slice(0, 24)} (${Math.round(view.height)} > ${Math.round(rect.height)})`);
    return view;
  }
  measure(value: string, width: number, size = this.layout.font, japanese = false) {
    const view = new Text({ text: value, style: { fontFamily: japanese ? jp : book, fontSize: size, wordWrap: true, wordWrapWidth: width, breakWords: true, lineHeight: size * (japanese ? 1.25 : 1.45) } });
    const height = view.height; view.destroy(); return height;
  }
  japanese(value: JapaneseValue, rect: Rect, maximum = 72, align: 'center' | 'top' = 'center') {
    let size = Math.max(18, Math.min(maximum, Math.floor(rect.height / 1.6)));
    const widthAt = (size: number) => value.segments.reduce((width, segment) => width + Math.max(textWidth(segment.surface, size, jp), segment.reading ? textWidth(segment.reading, Math.max(12, Math.round(size * .4)), jp) : 0), 0);
    while (size > 18 && widthAt(size) > rect.width) size = Math.max(18, size - 2);
    let group = new Container(), result = japanese(group, value, this.script, { ...rect, x: 0, y: 0 }, size, jp);
    let bounds = group.getLocalBounds();
    // Ruby and font ascenders can exceed the estimate; fit actual bounds, retaining 18px/12px minima.
    while (size > 18 && (result.overflow || bounds.height > rect.height + 2)) {
      group.destroy({ children: true }); size = Math.max(18, size - 2);
      group = new Container(); result = japanese(group, value, this.script, { ...rect, x: 0, y: 0 }, size, jp);
      bounds = group.getLocalBounds();
    }
    group.position.set(rect.x + (rect.width - bounds.width) / 2 - bounds.x, rect.y + (align === 'top' ? 0 : (rect.height - bounds.height) / 2) - bounds.y); this.root.addChild(group);
    this.texts.push({ value: this.script === 'kana' ? value.kana : this.script === 'furigana' && value.surface !== value.kana ? `${value.surface} (${value.kana})` : value.surface, rect: { x: group.x + bounds.x, y: group.y + bounds.y, width: bounds.width, height: bounds.height }, size });
    if (result.overflow || bounds.height > rect.height + 2) this.problems.push('Japanese text exceeds its area');
    return { ...result, height: bounds.height };
  }
  line(y: number) { this.root.addChild(new Graphics().moveTo(this.body.x, y).lineTo(this.body.x + this.body.width, y).stroke({ color: '#a68e68', width: 1, alpha: .55 })); }
  action(action: StudyAction, rect: Rect, japanese = false, size = this.layout.font) {
    size = action.fontSize ?? size;
    const playIcon = action.text.startsWith('▶'), caption = playIcon ? action.text.replace(/^▶\s*/, '') : action.text.replace(/[↪⚙]/g, '$&\uFE0E');
    const enabled = action.enabled !== false, node = new Container(); node.label = action.id; node.position.set(rect.x, rect.y);
    if (!action.bare || playIcon) { const paper = this.paper(rect, action.selected, action.wrong); if ((action.contrast || playIcon) && !action.selected && !action.wrong) paper.tint = '#e9cda3'; this.root.removeChild(paper); paper.position.set(0, 0); node.addChild(paper); }
    const outline = new Graphics(); node.addChild(outline);
    const draw = (focused = false) => {
      outline.clear();
      if (focused || action.selected || action.wrong) outline.roundRect(3, 3, rect.width - 6, rect.height - 6, 4).stroke({ color: action.wrong ? '#8b3d2e' : green, width: 2 });
      else if (action.contrast) outline.roundRect(3, 3, rect.width - 6, rect.height - 6, 4).stroke({ color: '#93714c', width: 1.25, alpha: .65 });
      if (action.wrong) outline.moveTo(7, rect.height - 7).lineTo(rect.width - 7, rect.height - 7).stroke({ color: '#8b3d2e', width: 2 });
    };
    draw();
    const text = label(node, caption, rect.width / 2 + (playIcon && caption ? 10 : 0), 0, size, { width: rect.width - (action.id.startsWith('grade-') ? 8 : actionInset) - (playIcon && caption ? 28 : 0), center: true, color: enabled ? ink : '#665b48', fontFamily: japanese ? jp : book });
    if (action.id.startsWith('grade-')) text.style.lineHeight = size * 1.15;
    else if (japanese) text.style.lineHeight = size * 1.25;
    while (size > (japanese ? 18 : 14) && text.height > rect.height - 8) { size--; text.style.fontSize = size; text.style.lineHeight = size * (japanese ? 1.25 : 1.45); }
    const pictureHeight = action.picture ? 60 : 0;
    text.y = pictureHeight + (rect.height - pictureHeight - text.height) / 2;
    if (playIcon) {
      const x = caption ? text.x - text.width / 2 - 16 : rect.width / 2, y = rect.height / 2, radius = caption ? 12 : Math.min(rect.width, rect.height) * .3;
      const mark = new Graphics().circle(x, y, radius).stroke({ color: '#78502b', width: 1.5 });
      mark.moveTo(x - radius * .25, y - radius * .46).lineTo(x + radius * .48, y).lineTo(x - radius * .25, y + radius * .46).closePath().fill(enabled ? '#573719' : '#99836b');
      node.addChild(mark);
    }
    if (action.picture) {
      const image = new Sprite(action.picture); image.scale.set(Math.min((rect.width - 16) / image.texture.width, 56 / image.texture.height));
      image.position.set((rect.width - image.width) / 2, 5); node.addChild(image);
    }
    this.texts.push({ value: action.text, rect: { x: rect.x + (rect.width - text.width) / 2, y: rect.y + text.y, width: text.width, height: text.height }, size });
    if (text.height + pictureHeight > rect.height - 8) this.problems.push(`Action overflow: ${action.id}`);
    node.eventMode = enabled ? 'static' : 'none'; node.cursor = enabled ? 'pointer' : 'default'; node.hitArea = new Rectangle(0, 0, rect.width, rect.height);
    node.accessible = enabled; node.accessibleType = 'button'; node.accessibleTitle = action.accessibleLabel ?? action.text; node.accessibleHint = action.accessibleLabel ?? action.text; node.accessiblePointerEvents = 'none';
    node.on('pointertap', () => { if (enabled) action.run(); });
    node.on('mouseover', () => { draw(true); this.paint(); }); node.on('mouseout', () => { draw(); this.paint(); });
    this.root.addChild(node);
    this.controls.push({ id: action.id, text: action.text, accessibleLabel: action.accessibleLabel??action.text, enabled, rect: { ...rect, x: rect.x + this.layout.paper.x, y: rect.y + this.layout.paper.y } });
    return node;
  }
  // Catalog rows open the complete entry; retain its full name for assistive technology.
  listAction(action: StudyAction, rect: Rect, japanese = false, size = this.layout.font) {
    const full = action.text;
    let text = full;
    while (text.length > 1 && this.measure(text, rect.width - actionInset, size, japanese) > rect.height - 10) text = text.replace(/…$/, '').slice(0, -1).trimEnd() + '…';
    return this.action({ ...action, text, accessibleLabel: action.accessibleLabel ?? full }, rect, japanese, size);
  }
  row(actions: StudyAction[], rect: Rect) {
    const icon = (action: StudyAction) => actions.length > 2 && /^[←→↑↓▶−+]$/.test(action.text);
    const gap = actions.every(action=>action.id.startsWith('grade-')) ? 6 : 10, icons = actions.filter(icon).length;
    const width = (rect.width - gap * (actions.length - 1) - icons * 44) / Math.max(1, actions.length - icons);
    let x = rect.x;
    actions.forEach(action => { const w = icon(action) ? 44 : width; this.action(action, { x, y: rect.y, width: w, height: rect.height }); x += w + gap; });
  }
  header(previous: StudyAction, title: string, next: StudyAction) {
    const r = this.layout.content;
    const y = this.layout.headerTop + 4 - this.layout.paper.y;
    this.action({ ...previous, bare: true }, { x: r.x, y, width: 44, height: 44 });
    this.text(title, { x: r.x + 52, y: y + 27, width: r.width - 104, height: 22 }, 14, false, true);
    this.action({ ...next, bare: true }, { x: r.x + r.width - 44, y, width: 44, height: 44 });
  }
  footer(actions: StudyAction[]) { this.row(actions, this.actions); }
  quiz(title: string, value: string, choices: StudyChoice[], illustration?: Texture, options: { titleSize?: number; titleHeight?: number; question?: Rect; alignQuestion?: boolean; paper?: boolean; ruby?: JapaneseValue } = {}) {
    const area = this.layout.content, titleSize = options.titleSize ?? this.layout.font;
    const titleHeight = options.titleHeight ?? this.measure(title, (options.question?.width ?? area.width) - 24, titleSize);
    const minimumQuestion = options.question ? 0 : titleHeight + (options.ruby ? 55 : this.layout.landscape ? 30 : 35) + 20;
    const sizes = this.layout.narrow || this.layout.landscape ? [22, 20, 18] : options.question ? [36, 32, 28, 26, 24, 22, 20, 18] : [28, 26, 24, 22, 20, 18];
    const columns = this.layout.landscape ? [2, 4, 1] : this.layout.narrow || options.question ? [1, 2] : [2, 1];
    let plan: { size: number; columns: number; height: number } | undefined;
    for (const size of sizes) {
      for (const count of columns) {
        const grid = this.choiceGrid(choices, area.width, count, size);
        if (grid.height + minimumQuestion + 8 <= area.height + .1) { plan = { size, columns: count, height: grid.height }; break; }
      }
      if (plan) break;
    }
    plan ??= { size: 18, columns: 1, height: this.choiceGrid(choices, area.width, 1, 18).height };
    const questionHeight = options.question ? 0 : Math.max(minimumQuestion, Math.min(this.layout.landscape ? 105 : this.layout.narrow ? 185 : 260, area.height - plan.height - 8));
    this.reserve((options.question ? 0 : questionHeight + 8) + plan.height);
    const r = this.body, question = options.question ?? { x: r.x, y: r.y, width: r.width, height: questionHeight };
    if (options.paper !== false) this.paper(question);
    this.text(title, { x: question.x + 12, y: question.y + 6, width: question.width - 24, height: titleHeight }, titleSize, false, true);
    const aligned = options.alignQuestion && options.question;
    const centre = r.y + r.height / 2;
    const available = aligned ? 2 * Math.min(centre - question.y - titleHeight - 10, question.y + question.height - 50 - centre) : question.height - titleHeight - 20;
    const valueTop = aligned ? centre - available / 2 : question.y + titleHeight + 10;
    const valueWidth = question.width - 24 - (illustration ? this.layout.narrow ? 64 : 96 : 0);
    const valueSize = Math.min(this.layout.landscape ? 40 : options.question ? 120 : 72, available / (options.ruby ? 1.85 : 1.25), valueWidth / textWidth(value, 1, jp));
    const valueHeight = this.measure(value, valueWidth, valueSize, true);
    if (options.ruby && aligned) {
      this.japanese(options.ruby, { x: question.x + 12, y: valueTop, width: valueWidth, height: available }, Math.max(18, valueSize));
    } else if (options.ruby) {
      const width = Math.max(textWidth(value, valueSize, jp), textWidth(options.ruby.kana, Math.max(12, Math.round(valueSize * .4)), jp));
      const result = japanese(this.root, options.ruby, this.script, { x: question.x + 12 + (valueWidth - width) / 2, y: question.y + titleHeight + 10 + Math.max(0, (available - valueSize * 1.85) / 2), width: valueWidth, height: available }, valueSize, jp);
      if (result.overflow || result.height > available + 2) this.problems.push('Question ruby exceeds its area');
    } else this.text(value, { x: question.x + 12, y: valueTop + (available - valueHeight) / 2, width: valueWidth, height: valueHeight }, valueSize, true, true);
    if (illustration) {
      const view = new Sprite(illustration), size = Math.min(available, this.layout.narrow ? 58 : 88);
      view.scale.set(Math.min(size / illustration.width, size / illustration.height));
      view.position.set(question.x + question.width - view.width - 12, question.y + titleHeight + 10 + (available - view.height) / 2); this.root.addChild(view);
    }
    return { choices: { x: r.x, y: r.y + (options.question ? 0 : questionHeight + 8), width: r.width, height: plan.height }, size: plan.size, columns: plan.columns, question };
  }
  choiceGrid(choices: StudyChoice[], availableWidth: number, columnCount?: number, size = this.layout.font) {
    const columns = columnCount ?? (choices.length > 4 && this.layout.landscape ? 4 : this.layout.landscape || choices.length > 4 ? 2 : 1), gap = 9;
    const width = (availableWidth - (columns - 1) * gap) / columns;
    const rows = Math.ceil(choices.length / columns), heights = Array.from({ length: rows }, (_, row) => Math.max(44, ...choices.slice(row * columns, row * columns + columns).map(c => this.measure(c.text, width - actionInset, size, c.japanese) + 10 + (c.picture ? 60 : 0))));
    return { columns, gap, width, rows, heights, height: heights.reduce((a, b) => a + b, 0) + gap * (rows - 1) };
  }
  choices(choices: StudyChoice[], rect: Rect, choose: (id: string) => void, columnCount?: number, size = this.layout.font) {
    const { columns, gap, width, heights, height: total } = this.choiceGrid(choices, rect.width, columnCount, size);
    if (total > rect.height + 1) this.problems.push('Full choices exceed their area');
    let y = rect.y;
    choices.forEach((choice, index) => {
      const row = Math.floor(index / columns), column = index % columns;
      const height = heights[row]!;
      const count = Math.min(columns, choices.length - row * columns), offset = (rect.width - count * width - (count - 1) * gap) / 2;
      this.action({ ...choice, contrast: true, run: () => choose(choice.id) }, { x: rect.x + offset + column * (width + gap), y, width, height }, choice.japanese, size);
      if (column === columns - 1 || index === choices.length - 1) y += height + gap;
    });
  }
  tokenGrid(tokens: StudyChoice[], width: number) {
    const maxWidth = Math.max(...tokens.map(token => textWidth(token.text, this.layout.font + 2, jp) + actionInset));
    const columns = Math.max(1, Math.floor((width + 9) / (maxWidth + 9)));
    return { columns, height: Math.ceil(tokens.length / columns) * 46 + (Math.ceil(tokens.length / columns) - 1) * 9 };
  }
  tokens(tokens: StudyChoice[], rect: Rect) {
    this.choices(tokens.map(token => ({ ...token, japanese: true })), rect, id => tokens.find(token => token.id === id)!.run(), this.tokenGrid(tokens, rect.width).columns, this.layout.font + 2);
  }
  tokenFlow(tokens: StudyChoice[], width: number) {
    const gap = 6, size = this.layout.font + 2;
    let x = 0, y = 0;
    const items = tokens.map(token => {
      const tokenWidth = Math.min(width, Math.max(44, textWidth(token.text, size, jp) + actionInset + 4));
      if (x && x + tokenWidth > width) { x = 0; y += 44 + gap; }
      const rect = { x, y, width: tokenWidth, height: 44 }; x += tokenWidth + gap;
      return { token, rect };
    });
    return { items, height: y + 44 };
  }
  builderHeight(tokens: StudyChoice[], width: number) {
    const widest = Math.max(...this.tokenFlow(tokens, width).items.map(item => item.rect.width));
    const perRow = Math.max(1, Math.floor((width + 6) / (widest + 6))), rows = Math.ceil(tokens.length / perRow) + 1;
    // Both areas stay reserved, including an empty row; any chosen order fits this bound.
    return 48 + rows * 44 + Math.max(0, rows - 2) * 6 + 6;
  }
  sentenceBuilder(bank: StudyChoice[], assembled: StudyChoice[], rect: Rect, externalSentence?: Rect, message?: string, labelColor = ink) {
    const sentence = externalSentence ?? rect;
    const chosen = this.tokenFlow(assembled, sentence.width), available = this.tokenFlow(bank, rect.width);
    const sentenceColor = externalSentence ? ink : labelColor;
    const sentenceTitle = message ?? `Предложение · ${assembled.length} / ${assembled.length + bank.length}`;
    this.text(sentenceTitle, { x: sentence.x, y: sentence.y, width: sentence.width, height: 24 }, 16).style.fill = sentenceColor;
    for (const { token, rect: slot } of chosen.items) this.action({ ...token, contrast: true }, { ...slot, x: sentence.x + slot.x, y: sentence.y + 24 + slot.y }, true, this.layout.font + 2);
    if (!assembled.length) this.text(externalSentence ? 'Выберите фрагменты справа' : 'Добавьте фрагменты снизу', { x: sentence.x, y: sentence.y + 28, width: sentence.width, height: 40 }, 16).style.fill = sentenceColor;
    const bankTop = externalSentence ? rect.y + 24 : rect.y + rect.height - available.height;
    this.text(bank.length ? 'Фрагменты' : 'Все фрагменты добавлены', { x: rect.x, y: bankTop - 24, width: rect.width, height: 24 }, 16).style.fill = labelColor;
    for (const { token, rect: slot } of available.items) this.action({ ...token, contrast: true }, { ...slot, x: rect.x + slot.x, y: bankTop + slot.y }, true, this.layout.font + 2);
    if (!externalSentence && sentence.y + 24 + chosen.height + 6 > bankTop - 24) this.problems.push('Sentence and token bank overlap');
    if (externalSentence && 24 + chosen.height > sentence.height + 1) this.problems.push('Sentence exceeds its area');
    if (externalSentence && 24 + available.height > rect.height + 1) this.problems.push('Token bank exceeds its area');
  }
}
