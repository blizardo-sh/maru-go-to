import { Graphics, Rectangle } from 'pixi.js';
import type { StudyAction, StudySurface } from './study-surface';

// Long reference and analysis text scrolls inside the existing page; practice choices never use this view.
export function renderReading(surface: StudySurface, text: string, state: { scroll: number }, options: { title?: string; action?: StudyAction; back: StudyAction; safe: (action: StudyAction) => StudyAction; changed: () => void }) {
  const a = surface.body; let heading = options.title ? surface.measure(options.title, a.width - 16, 20) + 16 : 8;
  if (options.title) surface.text(options.title, { x: a.x + 8, y: a.y + 8, width: a.width - 16, height: heading - 8 }, 20);
  if (options.action) { surface.row([options.safe(options.action)], { x: a.x + 8, y: a.y + heading, width: a.width - 16, height: 48 }); heading += 60; }
  const viewport = { x: a.x + 8, y: a.y + heading, width: a.width - 16, height: a.height - heading - 8 };
  const height = surface.measure(text, viewport.width, 17), maximum = Math.max(0, height - viewport.height);
  state.scroll = Math.max(0, Math.min(state.scroll, maximum));
  const copy = surface.text(text, { ...viewport, y: viewport.y - state.scroll, height: Math.max(height, viewport.height) }, 17);
  const mask = new Graphics().rect(viewport.x, viewport.y, viewport.width, viewport.height).fill('#ffffff');
  surface.root.addChild(mask); copy.mask = mask; copy.label = 'scrolling-copy';
  const move = (delta: number) => { state.scroll = Math.max(0, Math.min(maximum, state.scroll + delta)); options.changed(); };
  const touch = new Graphics().rect(viewport.x, viewport.y, viewport.width, viewport.height).fill({ color: '#ffffff', alpha: .001 });
  touch.eventMode = 'static'; touch.hitArea = new Rectangle(viewport.x, viewport.y, viewport.width, viewport.height);
  touch.on('wheel', event => { move(event.deltaY); }); surface.root.addChild(touch);
  surface.footer([
    { id: 'reading-up', text: '↑', accessibleLabel: 'Прокрутить текст вверх', enabled: state.scroll > 0, run: () => move(-viewport.height * .7) },
    { ...options.back, fontSize: 16 },
    { id: 'reading-down', text: '↓', accessibleLabel: 'Прокрутить текст вниз', enabled: state.scroll < maximum, run: () => move(viewport.height * .7) },
  ].map(options.safe));
}
