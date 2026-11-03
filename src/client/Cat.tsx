import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import type { CatPose, CompanionState } from './companion';
import { useReducedMotion } from './SceneStage';

type Pivot = { x: number; y: number };
type CatRig = { canvas: { width: number; height: number }; layers: Record<'tail' | 'body' | 'head', { src: string; pivot?: Pivot }> };
let rigRequest: Promise<CatRig> | null = null;
function loadRig() {
  if (!rigRequest) rigRequest = fetch('/mascot/rig/v1/manifest.json').then(async response => {
    if (!response.ok) throw new Error('Rig unavailable');
    const rig: CatRig = await response.json();
    if (!(rig.canvas.width > 0 && rig.canvas.height > 0)) throw new Error('Invalid rig canvas');
    await Promise.all((['tail', 'body', 'head'] as const).map(async layer => {
      const source = rig.layers[layer];
      if (!source.src.startsWith('/mascot/rig/')) throw new Error('Invalid rig layer');
      const image = new Image(); image.src = source.src; await image.decode();
    }));
    return rig;
  }).catch(error => { rigRequest = null; throw error; });
  return rigRequest;
}
// Alpha margins of the existing poses, expressed against their common 360px width.
const footGap: Record<CatPose, number> = { neutral: .028, blink: .0306, wave: .0278, standing: .0139, thinking: .0333, explain: .0278, encourage: .0278, success: .0361, rest: .0361 };
let poseRequest: Promise<Set<CatPose>> | undefined;
function loadPoses() { return poseRequest ??= Promise.all((Object.keys(footGap) as CatPose[]).map(async pose => { const image = new Image(); image.src = `/mascot/${pose}.png`; try { await image.decode(); return pose; } catch { return null; } })).then(poses => new Set(poses.filter((pose): pose is CatPose => pose !== null))); }

export function Cat({ pose = 'neutral', text, activity = 'idle', reactionKey, welcome = false, playful = false }: { pose?: CatPose; text?: string; activity?: CompanionState['activity']; reactionKey?: string; welcome?: boolean; playful?: boolean }) {
  const [rig, setRig] = useState<CatRig | null>(null); const [failed, setFailed] = useState(false); const [visible, setVisible] = useState(() => !document.hidden);
  const [ready, setReady] = useState<Set<CatPose>>(() => new Set(['neutral']));
  const [blink, setBlink] = useState(false); const [petting, setPetting] = useState(false);
  const [reaction, setReaction] = useState<{ pose: CatPose; key?: string } | null>(null);
  const [wave, setWave] = useState(false); const [previous, setPrevious] = useState<CatPose | null>(null);
  const reactionTimers = useRef<number[]>([]); const reacted = useRef('');
  const last = useRef<CatPose>('neutral'); const petTimer = useRef<number | undefined>(undefined);
  const reduced = useReducedMotion();
  useEffect(() => { let current = true; void loadRig().then(value => { if (current) setRig(value); }).catch(() => {}); void loadPoses().then(value => { if (current) setReady(value); }); return () => { current = false; }; }, []);
  useEffect(() => { const update = () => { setVisible(!document.hidden); if (document.hidden) { setPetting(false); setBlink(false); setReaction(null); reactionTimers.current.forEach(window.clearTimeout); window.clearTimeout(petTimer.current); } }; document.addEventListener('visibilitychange', update); return () => { document.removeEventListener('visibilitychange', update); window.clearTimeout(petTimer.current); reactionTimers.current.forEach(window.clearTimeout); }; }, []);
  useEffect(() => {
    if (!visible || !reactionKey || reacted.current === reactionKey || !['saved-good', 'saved-again', 'complete'].includes(activity)) return;
    reacted.current = reactionKey; reactionTimers.current.forEach(window.clearTimeout);
    setReaction({ pose: activity === 'complete' ? 'wave' : pose, key: reactionKey }); setWave(false);
    const waveTimer = activity === 'saved-good' ? window.setTimeout(() => setWave(true), 220) : undefined;
    const end = window.setTimeout(() => setReaction(null), activity === 'complete' ? 1400 : 950);
    reactionTimers.current = waveTimer ? [waveTimer, end] : [end];
  }, [reactionKey, activity === 'saved-good' || activity === 'saved-again' || activity === 'complete', visible]);
  useEffect(() => {
    if (!visible || reduced || pose !== 'neutral' || reaction) return;
    let close: number | undefined;
    const timer = window.setInterval(() => { setBlink(true); close = window.setTimeout(() => setBlink(false), 160); }, 4400);
    return () => { window.clearInterval(timer); window.clearTimeout(close); setBlink(false); };
  }, [visible, reduced, pose, !!reaction]);
  const reactionPose = reaction?.pose === 'success' && wave ? 'wave' : reaction?.pose;
  const actual: CatPose = reactionPose ?? (petting ? 'wave' : blink && pose === 'neutral' ? 'blink' : activity === 'complete' ? 'wave' : pose);
  const shown = ready.has(actual) ? actual : 'neutral';
  useLayoutEffect(() => { setPrevious(last.current); last.current = shown; const timer = window.setTimeout(() => setPrevious(null), 180); return () => window.clearTimeout(timer); }, [shown]);
  const pet = () => { if (!visible) return; setPetting(true); window.clearTimeout(petTimer.current); petTimer.current = window.setTimeout(() => setPetting(false), 900); };
  const useRig = !!rig && !failed;
  const picture = (value: CatPose, outgoing = false) => <img key={`${outgoing ? 'old' : 'new'}:${value}`} className={`cat-pose${outgoing ? ' cat-pose-outgoing' : ''}`} src={`/mascot/${value}.png`} width="360" height="360" alt="" decoding="async" style={{ '--cat-foot-gap': `${footGap[value] * 100}%` } as CSSProperties} />;
  const frame = <div className="cat-frame"><span className="cat-shadow" aria-hidden="true" /><span className="cat-motion" aria-hidden="true"><span className="cat-base" data-hidden={shown !== 'neutral'}>
    {useRig && rig ? <span className="cat-rig">{(['tail', 'body', 'head'] as const).map(layer => { const source = rig.layers[layer]; const pivot = source.pivot ?? { x: .5, y: 1 }; return <img key={layer} className={`cat-layer cat-${layer}`} src={source.src} width={rig.canvas.width} height={rig.canvas.height} alt="" decoding="async" onError={() => setFailed(true)} style={{ transformOrigin: `${pivot.x * 100}% ${pivot.y * 100}%` }} />; })}</span> : picture('neutral')}
  </span>{previous && previous !== 'neutral' && previous !== shown && picture(previous, true)}{shown !== 'neutral' && picture(shown)}</span></div>;
  return <aside className="companion" data-pose={actual} data-activity={activity} data-event-key={reaction?.key ?? reactionKey} data-visible={visible} data-welcome={welcome} data-playful={playful} data-rig-ready={useRig} data-reaction={reaction?.pose === 'success' ? 'good' : reaction?.pose === 'encourage' ? 'again' : activity === 'complete' ? 'complete' : 'idle'}>
    {frame}{playful && <button className="cat-pet" aria-label="Погладить кота" onClick={pet} onPointerEnter={() => { if (pose === 'neutral') pet(); }} />}{text && <p>{text}</p>}
  </aside>;
}
