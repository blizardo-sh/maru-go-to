// Prototype: does a shared desk and a daily rhythm make the companion feel present?
import { useEffect, useLayoutEffect, useRef, type CSSProperties } from 'react';
import { Cat } from '../../Cat';
import { useReducedMotion } from '../../SceneStage';

export type Daypart = 'morning' | 'day' | 'evening';
export function daypartAt(hour: number): Daypart { return hour >= 6 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'day' : 'evening'; }

export function DailyCat({ period, side, playing, result, reactionKey }: { period: Daypart; side: 'left' | 'right'; playing: boolean; result: 'correct' | 'wrong' | null; reactionKey: string }) {
  const root = useRef<HTMLDivElement>(null), previous = useRef<DOMRect | null>(null), travel = useRef<Animation | null>(null);
  const reduced = useReducedMotion();
  useLayoutEffect(() => {
    const element = root.current!;
    travel.current?.cancel();
    const next = element.getBoundingClientRect(), old = previous.current;
    previous.current = next;
    if (!old || reduced || Math.abs(old.x - next.x) < 1) return;
    // shortcut: existing seated art demonstrates the route; draw walking frames after placement is approved.
    const dx = old.x - next.x, dy = old.y - next.y;
    travel.current = element.animate([
      { transform: `translate(${dx}px, ${dy}px)` },
      { transform: `translate(${dx * .75}px, ${dy - 3}px) rotate(-2deg)`, offset: .25 },
      { transform: `translate(${dx * .5}px, ${dy}px) rotate(1deg)`, offset: .5 },
      { transform: `translate(${dx * .25}px, -3px) rotate(-1deg)`, offset: .75 },
      { transform: 'translate(0, 0)' },
    ], { duration: period === 'evening' ? 1300 : 1000, easing: 'cubic-bezier(.45,0,.2,1)' });
  }, [side, period, reduced]);
  useEffect(() => { const resized = () => { travel.current?.cancel(); previous.current = root.current?.getBoundingClientRect() ?? null; }; window.addEventListener('resize', resized); return () => { window.removeEventListener('resize', resized); travel.current?.cancel(); }; }, []);
  const pose = result === 'correct' ? 'success' : result === 'wrong' ? 'encourage' : playing ? 'thinking' : period === 'evening' ? 'rest' : 'neutral';
  return <div ref={root} className="sd-daily-cat" data-side={side} data-period={period} style={{ '--daily-hop': period === 'morning' ? '-12px' : period === 'day' ? '-6px' : '-2px' } as CSSProperties}>
    <Cat playful pose={pose} activity={result === 'correct' ? 'saved-good' : result === 'wrong' ? 'saved-again' : playing ? 'listening' : 'idle'} reactionKey={reactionKey} />
  </div>;
}
