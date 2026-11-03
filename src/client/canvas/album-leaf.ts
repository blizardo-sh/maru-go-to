import { Container, Graphics, NineSliceSprite, type Texture } from 'pixi.js';
import { gestureRating } from '../study';
import type { Rect } from './canvas';

type Binding = { page: Container; ink: Container; bounds: Rect; revealBounds?: Rect; viewportWidth: number; canReveal: () => boolean; canGrade: (rating: 1 | 3) => boolean; reveal: () => void; grade: (rating: 1 | 3) => void; accept?: (rating: 1 | 3) => boolean | void; controls: () => Rect[] };
const inside = (p: { x: number; y: number }, r: Rect) => p.x >= r.x && p.x <= r.x + r.width && p.y >= r.y && p.y <= r.y + r.height;

export class AlbumLeaf {
  private binding?: Binding;
  private pointer?: { id: number; x: number; y: number; scale: number; grade: boolean; time: number; left: number; right: number };
  private frame = 0;
  private dragDisplacement = 0;
  private displacement = 0;
  private phase: 'idle' | 'holding' | 'dragging' | 'settling' = 'idle';
  private mode: 'keep' | 'remove' | null = null;
  private commits = 0;
  private fold = new Graphics();
  constructor(private canvas: HTMLCanvasElement, private screen: () => { width: number; height: number }, private render: () => void, private follow: (amount: number) => void, private reduced: () => boolean = () => matchMedia('(prefers-reduced-motion: reduce)').matches, private settled: () => void = () => {}) {
    canvas.tabIndex = 0; canvas.setAttribute('aria-keyshortcuts', 'Enter Space ArrowLeft ArrowRight');
    canvas.addEventListener('pointerdown', event => this.down(event), { capture: true, passive: false });
    canvas.addEventListener('pointermove', event => this.move(event), { capture: true, passive: false });
    canvas.addEventListener('pointerup', event => this.up(event), { capture: true, passive: false });
    canvas.addEventListener('pointercancel', () => this.cancel(), { capture: true });
    canvas.addEventListener('lostpointercapture', () => { if (this.pointer) this.cancel(); });
    canvas.addEventListener('keydown', event => {
      if (event.target !== canvas || event.altKey || event.ctrlKey || event.metaKey || this.busy) return;
      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); this.commit(event.key === 'ArrowLeft' ? 1 : 3); }
      else if ((event.key === 'Enter' || event.key === ' ') && this.binding?.canReveal()) { event.preventDefault(); this.binding.reveal(); }
    });
  }
  get busy() { return this.phase !== 'idle'; }
  snapshot() { return { phase: this.phase, mode: this.mode, displacement: this.displacement, commits: this.commits, bounds: this.binding?.bounds ?? null, scaleX: this.binding?.page.scale.x ?? 1 }; }
  bind(binding?: Binding) {
    this.cancel(false); this.binding = binding;
    if (binding) { this.fold = new Graphics(); binding.page.addChild(this.fold); this.paint(0); }
  }
  private local(event: PointerEvent) {
    const r = this.canvas.getBoundingClientRect(), scale = r.width / this.screen().width;
    return { x: (event.clientX - r.x) / scale, y: (event.clientY - r.y) / scale, scale };
  }
  private down(event: PointerEvent) {
    const b = this.binding;
    if (!b || event.button !== 0) return;
    if (this.busy) { if (this.pointer && event.pointerId !== this.pointer.id) this.cancel(); event.preventDefault(); event.stopImmediatePropagation(); return; }
    const p = this.local(event);
    if ((!inside(p, b.bounds) && !(b.canReveal() && b.revealBounds && inside(p, b.revealBounds))) || b.controls().some(r => inside(p, r))) return;
    if (!b.canReveal() && !b.canGrade(1)) return;
    event.preventDefault(); event.stopImmediatePropagation();
    this.pointer = { id: event.pointerId, x: event.clientX, y: event.clientY, scale: p.scale, grade: inside(p, b.bounds), time: event.timeStamp, left: p.x * p.scale, right: (this.screen().width - p.x) * p.scale }; this.phase = 'holding';
    this.canvas.focus({ preventScroll: true });
    this.canvas.setPointerCapture(event.pointerId);
  }
  private move(event: PointerEvent) {
    const start = this.pointer, b = this.binding; if (!start || !b || event.pointerId !== start.id) return;
    const dx = event.clientX - start.x, dy = event.clientY - start.y;
    event.preventDefault(); event.stopImmediatePropagation();
    if (Math.abs(dy) > 12 && Math.abs(dy) > Math.abs(dx) * 1.25) { this.cancel(); return; }
    if (Math.abs(dx) > 8 && Math.abs(dx) > Math.abs(dy) * 1.25 && start.grade && b.canGrade(1)) {
      this.phase = 'dragging'; this.dragDisplacement = dx / start.scale;
      if (!this.frame) this.frame = requestAnimationFrame(() => { this.frame = 0; this.paint(this.dragDisplacement); this.render(); });
    }
  }
  private up(event: PointerEvent) {
    const start = this.pointer, b = this.binding; if (!start || !b || event.pointerId !== start.id) return;
    event.preventDefault(); event.stopImmediatePropagation();
    const dx = event.clientX - start.x, dy = event.clientY - start.y, dragged = this.phase === 'dragging';
    this.pointer = undefined; if (this.canvas.hasPointerCapture(event.pointerId)) this.canvas.releasePointerCapture(event.pointerId);
    if (!dragged) { this.phase = 'idle'; if (Math.hypot(dx, dy) < 10 && b.canReveal()) b.reveal(); return; }
    cancelAnimationFrame(this.frame); this.frame = 0; this.paint(dx / start.scale);
    const elapsed = Math.max(1, event.timeStamp - start.time);
    const flick = Math.abs(dx) >= 18 && Math.abs(dx) >= Math.abs(dy) * 1.5 && Math.abs(dx) / elapsed >= .35;
    const available = dx < 0 ? start.left : start.right;
    const edgeDrag = Math.abs(dx) >= Math.min(64, Math.max(18, available * .65)) && Math.abs(dx) >= Math.abs(dy) * 1.5;
    const rating = gestureRating(dx, dy) ?? (flick || edgeDrag ? dx > 0 ? 3 : 1 : null);
    if (rating && b.canGrade(rating)) this.settle(rating); else this.springBack();
  }
  commit(rating: 1 | 3) {
    if (this.busy || !this.binding?.canGrade(rating)) return;
    this.settle(rating);
  }
  advance(run: () => void) { if (this.busy) return; if (this.binding) this.settle(1, run); else run(); }
  private tween(target: number, duration: number, done: () => void) {
    const start = performance.now(), from = this.displacement;
    this.phase = 'settling';
    if (this.reduced()) { this.paint(target); done(); return; }
    const tick = (now: number) => {
      const p = Math.min(1, (now - start) / duration), eased = 1 - (1 - p) ** 3;
      this.paint(from + (target - from) * eased); this.render();
      if (p < 1) this.frame = requestAnimationFrame(tick); else { this.frame = 0; done(); }
    }; this.frame = requestAnimationFrame(tick);
  }
  private settle(rating: 1 | 3, after?: () => void) {
    const b = this.binding!; this.mode = rating === 1 ? 'keep' : 'remove'; this.phase = 'settling';
    // Connected grading enters the durable outbox before decorative motion can be cancelled.
    if (!after && b.accept?.(rating) === false) { this.springBack(); return; }
    const target = rating === 1 ? -b.bounds.width : b.viewportWidth - b.bounds.x + 32;
    this.tween(target, 320, () => { this.phase = 'idle'; this.pointer = undefined; this.commits++; this.follow(0); if (after) after(); else if (!b.accept) b.grade(rating); this.settled(); });
  }
  private springBack() { this.tween(0, 160, () => { this.phase = 'idle'; this.mode = null; this.follow(0); this.render(); this.settled(); }); }
  cancel(render = true) {
    cancelAnimationFrame(this.frame); this.frame = 0;
    const pointer = this.pointer; this.pointer = undefined; this.phase = 'idle'; this.mode = null;
    if (pointer && this.canvas.hasPointerCapture(pointer.id)) this.canvas.releasePointerCapture(pointer.id);
    const visible = this.binding && !this.binding.page.destroyed;
    if (visible) this.paint(0);
    this.displacement = 0; this.follow(0);
    if (visible && render) this.render();
  }
  private paint(dx: number) {
    const b = this.binding; if (!b || b.page.destroyed) return;
    this.displacement = dx; const p = Math.min(1, Math.abs(dx) / b.bounds.width);
    this.mode = dx < 0 ? 'keep' : dx > 0 ? 'remove' : null;
    b.page.position.set(b.bounds.x, b.bounds.y); b.page.scale.set(1); b.page.skew.set(0); b.page.rotation = 0; b.page.alpha = 1; b.ink.visible = true;
    if (dx < 0) {
      b.page.scale.x = Math.cos(Math.PI * p); b.page.skew.y = -.035 * Math.sin(Math.PI * p);
      b.ink.visible = p < .5; b.page.alpha = 1 - .2 * p;
    } else if (dx > 0) { b.page.x += dx; b.page.y -= Math.min(24, dx * .035); b.page.rotation = .045 * p; b.page.alpha = 1 - .18 * p; }
    this.fold.clear();
    if (p > .01) {
      const w = Math.min(30, p * 44), h = b.bounds.height;
      this.fold.moveTo(b.bounds.width - w, 0).lineTo(b.bounds.width, w).lineTo(b.bounds.width, h).lineTo(b.bounds.width - w, h - w).closePath().fill({ color: '#9b8060', alpha: .18 });
    } else this.fold.moveTo(b.bounds.width - 17, b.bounds.height).lineTo(b.bounds.width, b.bounds.height - 17).lineTo(b.bounds.width, b.bounds.height).closePath().fill({ color: '#b39770', alpha: .25 });
    this.follow(Math.max(-1, Math.min(1, dx / b.bounds.width)));
  }
}

export function liftAlbumPage(root: Container, ui: Container, bounds: Rect, texture: Texture) {
  const page = new Container(), ink = new Container(); page.position.set(bounds.x, bounds.y);
  const sheet = new NineSliceSprite({ texture, leftWidth: 24, rightWidth: 24, topHeight: 20, bottomHeight: 20 });
  sheet.width = bounds.width / .35; sheet.height = bounds.height / .35; sheet.scale.set(.35); page.addChild(sheet, ink);
  for (const child of [...root.children]) {
    const r = child.getBounds().rectangle, x = r.x + r.width / 2, y = r.y + r.height / 2;
    if (x >= bounds.x && y >= bounds.y && y <= bounds.y + bounds.height) {
      root.removeChild(child); child.x += root.x - bounds.x; child.y += root.y - bounds.y; ink.addChild(child);
    }
  }
  ui.addChild(page); return { page, ink };
}
