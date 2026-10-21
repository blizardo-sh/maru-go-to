import { useEffect, useRef, useState } from 'react';
import type { SceneId } from './scenes';
import type { SceneDecor } from './sceneDecor';

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

export function SceneStage({ scene, decor, entryId, phase, active, onReady }: { scene: SceneId; decor: SceneDecor; entryId: number; phase: EntryPhase; active: boolean; onReady: (scene: SceneId, failed: boolean) => void }) {
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
  return <div className="scene-atmosphere" data-scene={scene} data-ready={readyScene === scene} data-active={active && visible} data-visible={visible} aria-hidden="true">
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
      <div className="scene-desk-props" data-period={decor.period}>{decor.props.map(id => <span className="desk-prop" data-prop={id} key={id} />)}</div>
    </div>
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
