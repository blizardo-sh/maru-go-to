import { Graphics, NineSliceSprite, Text, type Texture } from 'pixi.js';
import type { Rect } from './canvas';
import { green, type StudyAction, type StudySurface } from './study-surface';

export function contentPages(surface: StudySurface, full = false): Rect[] {
  const right = { ...surface.layout.content, ...(full ? { height: surface.layout.paper.height - surface.layout.content.y - 14 } : {}) };
  const left = surface.leftPage;
  return left ? [{ ...right, x: left.x + (left.width - right.width) / 2 }, right] : [right];
}

export function woodenTab(surface: StudySurface, texture: Texture, action: StudyAction, rect: Rect, fontSize = 15) {
  const node = surface.action({ ...action, bare: true }, rect, false, fontSize);
  const shadow = new Graphics().roundRect(1, 4, rect.width, rect.height, 4).fill({ color: '#24160d', alpha: .55 });
  const board = new NineSliceSprite({ texture, leftWidth: 18, rightWidth: 18, topHeight: 8, bottomHeight: 8 });
  board.width = rect.width; board.height = rect.height; board.tint = action.selected ? '#ffe0a0' : '#cda879';
  node.addChildAt(shadow, 0); node.addChildAt(board, 1);
  const edge = new Graphics().roundRect(1, 1, rect.width - 2, rect.height - 2, 4).stroke({ color: '#52301c', width: 2 });
  edge.moveTo(7, 5).lineTo(rect.width - 7, 5).stroke({ color: '#f0cd8e', alpha: .7, width: 1 });
  for (const x of [7, rect.width - 7]) edge.circle(x, rect.height / 2, 1.5).fill('#513422');
  if (action.selected) edge.roundRect(10, rect.height - 6, rect.width - 20, 3, 1).fill('#ffe4a3');
  node.addChildAt(edge, 2);
  for (const child of node.children) if (child instanceof Text) { child.style.fill = '#fff5d6'; child.style.dropShadow = { color: '#24150d', alpha: 1, blur: 1, distance: 1, angle: Math.PI / 2 }; }
  return node;
}

export function sectionCards(surface: StudySurface, title: string, description: string, actions: (StudyAction & { description?: string })[], safe: (action: StudyAction) => StudyAction) {
  const pages = contentPages(surface), compact = surface.layout.landscape || pages[0]!.height < 400;
  const header = compact ? 44 : 88;
  pages.forEach((page, side) => {
    surface.text(title, { ...page, y: page.y + 4, height: 40 }, compact ? 21 : 28);
    if (!compact && !side) surface.text(description, { ...page, y: page.y + 47, height: 42 }, 15);
  });
  const perPage = Math.ceil(actions.length / pages.length);
  pages.forEach((page, side) => {
    const items = actions.slice(side * perPage, (side + 1) * perPage);
    const gap = 12, maxRows = Math.max(1, Math.floor((page.height - header + gap) / 56)), columns = Math.max(1, Math.ceil(items.length / maxRows)), rows = Math.ceil(items.length / columns);
    const width = (page.width - gap * (columns - 1)) / columns, height = Math.min(compact ? 64 : 112, (page.height - header - gap * (rows - 1)) / Math.max(1, rows));
    items.forEach((action, index) => {
      const rect = { x: page.x + index % columns * (width + gap), y: page.y + header + Math.floor(index / columns) * (height + gap), width, height };
      const showDetail = !!action.description && height >= 84 && width >= 230;
      surface.action(safe({ ...action, text: showDetail ? '' : action.text, accessibleLabel: action.accessibleLabel ?? action.text }), rect, false, columns > 1 ? 14 : compact ? 16 : 20);
      if (showDetail) {
        surface.text(action.text, { x: rect.x + 18, y: rect.y + 14, width: rect.width - 36, height: 38 }, 21).style.fill = green;
        surface.text(action.description!, { x: rect.x + 18, y: rect.y + 53, width: rect.width - 36, height: height - 57 }, 14);
      }
    });
  });
}
