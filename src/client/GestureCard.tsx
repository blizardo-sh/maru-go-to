import { useEffect, useId, useRef, useState, type ReactNode } from 'react';
import { gestureRating } from './study';

export function GestureCard({ enabled, onAdvance, children, actions, mode, reviewId, phase, active = true }: { enabled: boolean; onAdvance: (rating: 1 | 3) => void | Promise<unknown>; children: ReactNode; actions?: ReactNode; mode: string; reviewId: string; phase: 'question' | 'answer' | 'choice' | 'workspace'; active?: boolean }) {
  const root = useRef<HTMLDivElement>(null);
  const pointer = useRef<{ x: number; y: number; id: number } | null>(null);
  const suppressClick = useRef(false); const submitting = useRef(false); const mounted = useRef(true);
  const helpId = useId();
  const [drag, setDrag] = useState(0);
  const [dragging, setDragging] = useState(false); const [flight, setFlight] = useState(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  function follow(value: number) { const scene = root.current?.closest<HTMLElement>('.study-session'); if (scene) { scene.style.setProperty('--cat-follow', `${Math.max(-5, Math.min(5, value / 26))}deg`); scene.dataset.cardDragging = value ? 'true' : 'false'; } }
  function reset() { pointer.current = null; setDrag(0); setDragging(false); setFlight(false); follow(0); }
  useEffect(() => { if (active) root.current?.focus({ preventScroll: true }); else reset(); return () => follow(0); }, [active]);
  function nestedControl(target: EventTarget | null) {
    if (!(target instanceof Element)) return false;
    if (target.closest('dialog, input, textarea, select, [contenteditable="true"], [data-card-scroll]')) return true;
    const control = target.closest('button, summary, a');
    return !!control && !control.matches('[data-card-face]');
  }
  async function advance(rating: 1 | 3) {
    if (!active || document.hidden || phase !== 'answer' || !enabled || submitting.current) return;
    submitting.current = true; pointer.current = null; setDragging(false); follow(0);
    if (mode !== 'grammar') { setFlight(true); setDrag((rating === 3 ? 1 : -1) * ((root.current?.clientWidth ?? 320) + 120)); } else setDrag(0);
    try { await onAdvance(rating); } catch { /* The owner displays its existing save error and retry. */ }
    finally { submitting.current = false; if (mounted.current) { setDrag(0); setFlight(false); } }
  }
  const direction = drag < -30 ? 'again' : drag > 30 ? 'good' : undefined;
  return <div className="gesture-well" data-direction={direction} data-mode={mode}>
    {phase === 'answer' && <div className="gesture-dropzones" aria-hidden="true"><div>← Ещё раз</div><div>Помню →</div></div>}
    <div ref={root} className="gesture-card" data-testid="review-gesture" data-mode={mode} data-review-id={reviewId} data-card-phase={phase} data-direction={direction} data-dragging={dragging} data-flight={flight} aria-busy={flight} role="group" aria-label="Карточка практики" aria-describedby={helpId} aria-keyshortcuts={phase === 'answer' ? 'ArrowLeft ArrowRight' : phase === 'question' ? 'Enter Space' : undefined} tabIndex={0}
      style={{ transform: `translate(${drag}px, ${Math.abs(drag) * .04}px) rotate(${drag / 30}deg)` }}
      onKeyDown={event => { if (!active || document.hidden || nestedControl(event.target) || event.altKey || event.ctrlKey || event.metaKey) return; if ((event.key === 'Enter' || event.key === ' ') && event.target === event.currentTarget) { const face = root.current?.querySelector<HTMLButtonElement>('[data-card-face]'); if (face) { event.preventDefault(); face.click(); } } else if (event.key === 'ArrowRight' || event.key === 'ArrowLeft') { event.preventDefault(); event.stopPropagation(); advance(event.key === 'ArrowRight' ? 3 : 1); } }}
      onPointerDown={event => { if (!active || document.hidden || !['question', 'answer'].includes(phase) || phase === 'answer' && !enabled || submitting.current || event.button !== 0 || nestedControl(event.target)) return; pointer.current = { x: event.clientX, y: event.clientY, id: event.pointerId }; event.currentTarget.setPointerCapture(event.pointerId); }}
      onPointerMove={event => { if (phase !== 'answer' || !pointer.current || pointer.current.id !== event.pointerId) return; const dx = event.clientX - pointer.current.x; const dy = event.clientY - pointer.current.y; if (Math.abs(dx) > Math.abs(dy) * 1.25 && Math.abs(dx) > 7) { const offset = Math.max(-420, Math.min(420, dx)); setDragging(true); setDrag(offset); follow(offset); } }}
      onPointerUp={event => { const start = pointer.current; const moved = dragging || !!start && (Math.abs(event.clientX - start.x) > 7 || Math.abs(event.clientY - start.y) > 7); pointer.current = null; setDragging(false); follow(0); if (!start || start.id !== event.pointerId) { reset(); return; } if (moved) { suppressClick.current = true; window.setTimeout(() => { suppressClick.current = false; }, 0); } const rating = phase === 'answer' ? gestureRating(event.clientX - start.x, event.clientY - start.y) : null; if (rating) void advance(rating); else reset(); }}
      onPointerCancel={reset}
      onClickCapture={event => { if (suppressClick.current) { suppressClick.current = false; event.preventDefault(); event.stopPropagation(); } }}
      onClick={event => { if (phase === 'question' && active && !document.hidden && !nestedControl(event.target) && !(event.target as Element).closest('[data-card-face]')) root.current?.querySelector<HTMLElement>('[data-card-face]')?.click(); }}>
      {direction && <span className="gesture-stamp" data-direction={direction} aria-hidden="true">{direction === 'good' ? 'Помню →' : '← Ещё раз'}</span>}
      {children}
      <div className="gesture-footer"><small id={helpId}>{phase === 'question' ? 'Нажмите, чтобы открыть ответ' : phase === 'answer' ? <>Влево — ещё раз, вправо — помню<span className="sr-only">. Можно использовать стрелки на клавиатуре или меню карточки.</span></> : phase === 'choice' ? 'Выберите вариант — дальше автоматически' : 'Соберите фразу и нажмите «Дальше»'}</small>{(actions || phase === 'answer') && <details className="card-actions"><summary aria-label="Действия карточки">···</summary><div className="card-action-menu">{phase === 'answer' && <><button disabled={!active || !enabled} onClick={() => advance(3)}>Вспомнил — дальше</button><button disabled={!active || !enabled} onClick={() => advance(1)}>Повторить — дальше</button></>}{actions}</div></details>}</div>
    </div>
  </div>;
}
