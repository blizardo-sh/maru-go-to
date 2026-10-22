import { useEffect, useRef, useState, type CSSProperties } from 'react';
import { Cat } from '../Cat';
import { useReducedMotion } from '../SceneStage';
import type { CatPose } from '../companion';
// Transparent lower margins measured from the existing PNG alpha; no artwork is changed.
const footGap: Record<CatPose, number> = { neutral: .028, blink: .0306, wave: .0278, standing: .0139, thinking: .0333, explain: .0278, encourage: .0278, success: .0361, rest: .0361 };
export function PlayfulCat({ pose, eventKey, drag, complete }: { pose: CatPose; eventKey: number; drag: number; complete: boolean }) {
  const reduced = useReducedMotion();
  const [ready, setReady] = useState<Set<CatPose>>(() => new Set(['neutral']));
  const [localPose, setLocalPose] = useState<CatPose | null>(null);
  const [blink, setBlink] = useState(false);
  const [visible, setVisible] = useState(!document.hidden);
  const [previous, setPrevious] = useState<CatPose | null>(null);
  const last = useRef<CatPose>('neutral');
  const petTimer = useRef<number | undefined>(undefined);
  const actual: CatPose = complete ? 'wave' : pose !== 'neutral' ? localPose ?? pose : drag ? 'thinking' : localPose ?? (blink ? 'blink' : 'neutral');
  useEffect(() => { let live = true; for (const value of Object.keys(footGap) as CatPose[]) { const image = new Image(); image.src = `/mascot/${value}.png`; void image.decode().then(() => { if (live) setReady(previous => new Set([...previous, value])); }).catch(() => {}); } return () => { live = false; }; }, []);
  const shown = ready.has(actual) ? actual : 'neutral';
  useEffect(() => {
    setLocalPose(null); if (!visible || reduced || pose !== 'success') return;
    const timer = window.setTimeout(() => setLocalPose('wave'), 220);
    return () => window.clearTimeout(timer);
  }, [pose, eventKey, visible, reduced]);
  useEffect(() => { setPrevious(last.current); last.current = shown; const timer = window.setTimeout(() => setPrevious(null), 180); return () => window.clearTimeout(timer); }, [shown]);
  useEffect(() => {
    if (!visible || reduced || pose !== 'neutral' || complete || drag) return;
    let close: number | undefined;
    const timer = window.setInterval(() => { setBlink(true); close = window.setTimeout(() => setBlink(false), 160); }, 4400);
    return () => { window.clearInterval(timer); window.clearTimeout(close); setBlink(false); };
  }, [visible, reduced, pose, complete, !!drag]);
  useEffect(() => { const update = () => { setVisible(!document.hidden); if (document.hidden) { window.clearTimeout(petTimer.current); setLocalPose(null); setBlink(false); } }; document.addEventListener('visibilitychange', update); return () => { document.removeEventListener('visibilitychange', update); window.clearTimeout(petTimer.current); }; }, []);
  const pet = () => { if (!visible) return; window.clearTimeout(petTimer.current); setLocalPose('wave'); petTimer.current = window.setTimeout(() => setLocalPose(null), 900); };
  const picture = (value: CatPose, outgoing = false) => <img key={`${outgoing ? 'old' : 'new'}-${value}`} className={`p-pet-pose${outgoing ? ' p-pet-outgoing' : ''}`} src={`/mascot/${value}.png`} alt="" style={{ '--p-foot-gap': `${footGap[value] * 100}%` } as CSSProperties} />;
  return <button className="p-pet" aria-label="Погладить кота" onClick={pet} onPointerEnter={() => { if (pose === 'neutral' && !drag) pet(); }} data-pose={actual} data-reaction={complete ? 'complete' : pose === 'success' ? 'good' : pose === 'encourage' ? 'again' : drag ? 'following' : 'idle'} data-visible={visible} style={{ '--p-follow': `${Math.max(-5, Math.min(5, drag / 26))}deg` } as CSSProperties}>
    <span className="p-pet-shadow" aria-hidden="true" />
    <span className="p-pet-motion" key={eventKey} aria-hidden="true"><span className="p-pet-base" data-hidden={shown !== 'neutral'}><Cat pose="neutral" activity={pose === 'thinking' ? 'listening' : 'idle'} /></span>{previous && previous !== 'neutral' && previous !== shown && picture(previous, true)}{shown !== 'neutral' && picture(shown)}</span>
    {complete && <span className="p-pet-cheer" aria-hidden="true">Отличная работа!</span>}
  </button>;
}
