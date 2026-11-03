import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import type { SceneId } from './scenes';
import type { SceneDecor } from './sceneDecor';
import sceneManifest from '../../public/scenes/manifest.json';
import propsManifest from '../../public/scenes/props/manifest.json';

export type EntryPhase = 'loading' | 'entering' | 'ready';
const sceneNames: Record<SceneId, string> = { room: 'Тёплая комната', garden: 'Сад и веранда', mountains: 'Горная хижина', river: 'У реки', tokyo: 'Вечер в Токио' };

export function useReducedMotion() {
  const [reduced, setReduced] = useState(() => window.matchMedia('(prefers-reduced-motion: reduce)').matches);
  useEffect(() => {
    const media = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(media.matches);
    media.addEventListener('change', update);
    return () => media.removeEventListener('change', update);
  }, []);
  return reduced;
}

export function SceneStage({ scene, decor, entryId, phase, active, onReady, layoutKey }: { scene: SceneId; decor: SceneDecor; entryId: number; phase: EntryPhase; active: boolean; onReady: (scene: SceneId, failed: boolean) => void; layoutKey: string }) {
  const surface = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const root = surface.current?.closest<HTMLElement>('.game-shell'); if (!root) return;
    let frame = 0; let observed: Element | null = null;
    const update = () => {
      const width = window.innerWidth, height = window.innerHeight, mobile = width <= 540;
      const material = sceneManifest.scenes.find(value => value.id === scene)!;
      const source = matchMedia('(min-width: 56rem), (orientation: landscape)').matches ? material.desktop : material.mobile;
      const scale = Math.max(width / source.width, height / source.height);
      const tableTop = material.tableBackEdge * source.height * scale - (source.height * scale - height);
      const board = root.querySelector<HTMLElement>('.study-session[data-active="true"] .session-stage, .section-board, .today');
      if (board && observed !== board) { if (observed) resize.unobserve(observed); resize.observe(board); observed = board; }
      const rect = board?.getBoundingClientRect() ?? { left: width * .1, right: width * .9, bottom: height * .65 };
      const safeBottom = height - Math.max(16, mobile ? 24 : 32);
      const baseline = mobile ? safeBottom : Math.min(safeBottom, Math.max(tableTop + 24, rect.bottom + 16));
      const catSize = height <= 480 ? 100 : mobile ? width <= 360 ? 104 : 120 : width >= 1700 ? 320 : width >= 1400 ? 270 : 220;
      const catLeft = mobile ? width - catSize - 8 : Math.min(width - catSize - 12, rect.right - catSize * .35);
      root.style.setProperty('--scene-cat-size', `${catSize}px`); root.style.setProperty('--scene-cat-left', `${catLeft}px`); root.style.setProperty('--scene-cat-top', `${baseline - catSize}px`);
      // Reserve the cat's actual overlap, so fixed scenery cannot cover study controls.
      const studyScroll = root.querySelector<HTMLElement>('.study-session[data-active="true"] .session-scroll')?.getBoundingClientRect();
      const overlap = studyScroll && baseline - catSize < studyScroll.bottom && baseline > studyScroll.top ? Math.max(0, studyScroll.right - catLeft + 12) : 0;
      root.style.setProperty('--scene-content-safe-inline', `${mobile ? 0 : overlap}px`);
      const propBase = Math.min(safeBottom, Math.max(baseline + 100, tableTop + (safeBottom - tableTop) * .8));
      const widths: Record<string, number> = { tea: 160, teapot: 240, brushes: 270, inkstone: 200, dango: 210, 'sakura-mochi': 210, dorayaki: 220, linen: 260 };
      const props = [...root.querySelectorAll<HTMLElement>('.desk-prop')];
      const shortDesktop = !mobile && height <= 800;
      const teaSet = props.filter(prop => ['tea', 'teapot'].includes(prop.dataset.prop ?? ''));
      const visibleProps = mobile ? props.slice(0, 2) : shortDesktop ? teaSet.length === 2 ? teaSet : props.slice(0, 2) : props;
      const maxHeight = Math.max(...visibleProps.map(prop => { const tile = propsManifest.tiles.find(value => value.id === prop.dataset.prop)!; return widths[tile.id]! / tile.contentBounds.width * tile.contentBounds.height; }));
      // One scale for the whole still life: changing the arrangement never shrinks only a teapot.
      const propScale = Math.min(mobile ? .48 : width >= 1700 ? 1.5 : width >= 1400 ? 1.15 : .9, Math.max(48, propBase - tableTop - 8) / maxHeight);
      const visibleWidths = visibleProps.map(prop => widths[prop.dataset.prop!]! * propScale);
      const gap = mobile ? 8 : 16, edge = mobile || shortDesktop ? 8 : width * .025;
      const positions = visibleProps.length === 4
        ? [edge, edge + visibleWidths[0]! + gap, width - edge - visibleWidths[3]! - gap - visibleWidths[2]!, width - edge - visibleWidths[3]!]
        : mobile ? [edge, edge + visibleWidths[0]! + gap] : [edge, width - edge - visibleWidths[1]!];
      props.forEach(prop => {
        const tile = propsManifest.tiles.find(value => value.id === prop.dataset.prop)!;
        const size = widths[tile.id]! / tile.contentBounds.width * propScale;
        const order = visibleProps.indexOf(prop); prop.style.display = order >= 0 ? 'block' : 'none';
        const x = (positions[order] ?? edge) - tile.contentBounds.x * size;
        prop.style.width = `${size}px`; prop.style.left = `${Math.max(8, Math.min(width - size - 8, x))}px`; prop.style.top = `${propBase - size * (tile.contentBounds.y + tile.contentBounds.height)}px`;
      });
    };
    const schedule = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(update); };
    const resize = new ResizeObserver(schedule); resize.observe(root);
    const mutation = new MutationObserver(schedule); mutation.observe(root, { childList: true, subtree: true });
    window.addEventListener('resize', schedule); update();
    return () => { cancelAnimationFrame(frame); resize.disconnect(); mutation.disconnect(); window.removeEventListener('resize', schedule); };
  }, [scene, decor, active, phase, layoutKey]);
  const [readyScene, setReadyScene] = useState<SceneId | null>(null);
  const [failedScene, setFailedScene] = useState<SceneId | null>(null);
  const currentScene = useRef(scene); currentScene.current = scene;
  const [visible, setVisible] = useState(() => !document.hidden);
  useEffect(() => { const update = () => setVisible(!document.hidden); document.addEventListener('visibilitychange', update); return () => document.removeEventListener('visibilitychange', update); }, []);
  useEffect(() => {
    if (!entryId || !active || phase !== 'loading') return;
    if (readyScene === scene) { onReady(scene, false); return; }
    if (failedScene === scene) { onReady(scene, true); return; }
    const timeout = window.setTimeout(() => onReady(scene, true), 4000);
    return () => window.clearTimeout(timeout);
  }, [scene, entryId, phase, active, readyScene, failedScene, onReady]);
  const accent = scene === 'river' || scene === 'garden' ? 'water' : scene === 'mountains' ? 'mist' : 'light';
  return <div ref={surface} className="scene-atmosphere" data-scene={scene} data-ready={readyScene === scene} data-active={active && visible} data-visible={visible} aria-hidden="true">
    <div className="scene-camera" data-phase={phase}>
      <picture className="scene-plate" key={scene}>
        <source media="(min-width: 56rem), (orientation: landscape)" srcSet={`/scenes/${scene}-v1.webp`} />
        <img src={`/scenes/${scene}-mobile-v1.webp`} alt="" decoding="async" fetchPriority="high" onLoad={event => {
          const image = event.currentTarget;
          void image.decode().then(() => { if (currentScene.current === scene) setReadyScene(scene); }).catch(() => { if (currentScene.current === scene) setFailedScene(scene); });
        }} onError={() => setFailedScene(scene)} />
      </picture>
      {entryId > 0 && <>
        <div className={`scene-accent scene-${accent}`} data-accent={accent} />
        {scene === 'tokyo' ? <div className="scene-accent scene-windows" data-accent="windows" /> : <img className={`scene-accent scene-foliage${scene === 'garden' ? ' sakura' : ''}`} data-accent="foliage" src={`/scenes/layers/${scene === 'garden' ? 'sakura' : 'foliage'}-v1.webp`} width="640" height="427" alt="" decoding="async" />}
      </>}
    </div>
    <div className="scene-desk-props" data-period={decor.period}>{decor.props.map(id => <span className="desk-prop" data-prop={id} key={id} />)}</div>
  </div>;
}

export function SceneIntro({ scene, entryId, phase, onReady }: { scene: SceneId; entryId: number; phase: Exclude<EntryPhase, 'ready'>; onReady: () => void }) {
  const skip = useRef<HTMLButtonElement>(null);
  useEffect(() => { skip.current?.focus({ preventScroll: true }); }, []);
  useEffect(() => {
    if (phase !== 'entering') return;
    const timer = window.setTimeout(onReady, 3000);
    return () => window.clearTimeout(timer);
  }, [phase, entryId, onReady]);
  return <section className="scene-intro" data-phase={phase} data-entry-id={entryId} role="region" aria-label="Начало занятия">
    <div className="scene-intro-caption"><p>{phase === 'loading' ? 'Готовим место…' : sceneNames[scene]}</p><button ref={skip} onClick={onReady}>Перейти к занятию <span aria-hidden="true">→</span></button></div>
  </section>;
}
