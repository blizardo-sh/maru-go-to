import { useEffect, useRef, useState, type ReactNode } from 'react';
import { gestureRating } from './study';

export function GestureCard({ enabled, onAdvance, children, actions, mode, reviewId, active = true }: { enabled: boolean; onAdvance: (rating: 1 | 3) => void; children: ReactNode; actions?: ReactNode; mode: string; reviewId: string; active?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number; id: number } | null>(null);
  const suppressClick = useRef(false);
  const [drag, setDrag] = useState(0);
  useEffect(() => { if (active) root.current?.focus({ preventScroll: true }); else { pointer.current = null; setDrag(0); } }, [active]);
  function nestedControl(target: EventTarget | null) {
    if (!(target instanceof Element)) return false;
    if (target.closest('dialog, input, textarea, select, [contenteditable="true"], [data-card-scroll]')) return true;
    const control = target.closest('button, summary, a');
    return !!control && !control.matches('[data-card-face]');
  }
  function advance(rating: 1 | 3) { if (active && enabled) onAdvance(rating); }
  return <div ref={root} className="gesture-card work-board" data-testid="review-gesture" data-mode={mode} data-review-id={reviewId} data-direction={drag < -24 ? 'again' : drag > 24 ? 'good' : undefined} role="group" aria-label="Карточка практики" aria-describedby="gesture-help" aria-keyshortcuts="ArrowLeft ArrowRight" tabIndex={0}
    style={{ transform: drag ? `translateX(${drag}px)` : undefined }}
    onKeyDown={event => { if (!active) return; if (nestedControl(event.target) || event.altKey || event.ctrlKey || event.metaKey) return; if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) { const face = root.current?.querySelector<HTMLButtonElement>('[data-card-face]'); if (face) { event.preventDefault(); face.click(); } } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); advance(event.key === 'ArrowRight' ? 3 : 1); } }}
    onPointerDown={event => { if (!active || !enabled || event.button !== 0 || nestedControl(event.target)) return; pointer.current = { x: event.clientX, y: event.clientY, id: event.pointerId }; const face = event.target instanceof Element ? event.target.closest<HTMLElement>('[data-card-face]') : null; (face ?? event.currentTarget).setPointerCapture(event.pointerId); }}
    onPointerMove={event => { if (!pointer.current || pointer.current.id !== event.pointerId) return; const dx = event.clientX - pointer.current.x; const dy = event.clientY - pointer.current.y; if (Math.abs(dx) > Math.abs(dy) * 1.25) setDrag(Math.max(-90, Math.min(90, dx))); }}
    onPointerUp={event => { const start = pointer.current; pointer.current = null; setDrag(0); if (!start || start.id !== event.pointerId) return; const rating = gestureRating(event.clientX - start.x, event.clientY - start.y); if (rating) { suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 0); advance(rating); } }}
    onPointerCancel={() => { pointer.current = null; setDrag(0); }}
    onClickCapture={event => { if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); } }}>
    {children}
    <div className="gesture-footer"><small id="gesture-help">← Ещё раз <span aria-hidden="true">·</span> Помню →<span className="sr-only">. После раскрытия используйте горизонтальный свайп или стрелки на карточке.</span></small><details className="card-actions"><summary aria-label="Действия карточки">···</summary><div className="card-action-menu"><button disabled={!active || !enabled} onClick={() => advance(3)}>Вспомнил — дальше</button><button disabled={!active || !enabled} onClick={() => advance(1)}>Повторить — дальше</button>{actions}</div></details></div>
  </div>;
}
