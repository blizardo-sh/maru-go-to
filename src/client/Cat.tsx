import { useEffect, useState } from 'react';
import type { CatPose, CompanionState } from './companion';

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

export function Cat({ pose = 'neutral', text, activity = 'idle', reactionKey, welcome = false }: { pose?: CatPose; text?: string; activity?: CompanionState['activity']; reactionKey?: string; welcome?: boolean }) {
  const [rig, setRig] = useState<CatRig | null>(null); const [failed, setFailed] = useState(false); const [visible, setVisible] = useState(() => !document.hidden);
  const [blink, setBlink] = useState(false);
  useEffect(() => { if (pose !== 'neutral' && !welcome) return; let current = true; void loadRig().then(value => { if (current) setRig(value); }).catch(() => {}); return () => { current = false; }; }, [pose, welcome]);
  useEffect(() => { const update = () => setVisible(!document.hidden); document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update); }, []);
  useEffect(() => {
    if (pose !== 'neutral' || rig && !failed) return;
    let timer: number | undefined; let closeTimer: number | undefined;
    function stop() { window.clearTimeout(timer); window.clearTimeout(closeTimer); setBlink(false); }
    function schedule() { stop(); if (document.hidden) return; timer = window.setTimeout(() => { if (!document.hidden && !matchMedia('(prefers-reduced-motion: reduce)').matches && document.querySelector('[data-motion]')?.getAttribute('data-motion') !== 'false') { setBlink(true); closeTimer = window.setTimeout(() => setBlink(false), 160); } timer = window.setTimeout(schedule, 5200); }, 5200); }
    schedule(); document.addEventListener('visibilitychange', schedule);
    return () => { stop(); document.removeEventListener('visibilitychange', schedule); };
  }, [pose, rig, failed]);
  const useRig = !!rig && !failed && (pose === 'neutral' || welcome);
  return <aside className="companion" data-pose={pose} data-activity={activity} data-event-key={reactionKey} data-visible={visible} data-welcome={welcome} data-rig-ready={useRig}><div className="cat-frame">
    {useRig && rig ? <div key={reactionKey ?? pose} className="cat-rig" aria-hidden="true" style={{ position: 'relative', width: '100%', height: '100%' }}>{(['tail', 'body', 'head'] as const).map(layer => {
      const source = rig.layers[layer]; const pivot = source.pivot ?? { x: .5, y: 1 };
      return <img key={layer} className={`cat-layer cat-${layer}`} src={source.src} width={rig.canvas.width} height={rig.canvas.height} alt="" decoding="async" onError={() => setFailed(true)} style={{ position: 'absolute', inset: 0, width: '100%', height: '100%', transformOrigin: `${pivot.x * 100}% ${pivot.y * 100}%` }} />;
    })}</div> : <img key={reactionKey ?? pose} src={`/mascot/${blink && pose === 'neutral' ? 'blink' : pose}.png`} width="360" height="360" alt="" decoding="async" />}
  </div>{text && <p>{text}</p>}</aside>;
}
