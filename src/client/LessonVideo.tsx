import { useEffect, useRef, useState } from 'react';
import type { LessonVideo as VideoMaterial, Course, Orthography } from '../shared/types';
import { JapaneseText } from './JapaneseText';
import { captionAt } from './videoCaptions';

const variantNames = { practice: 'Сценка · Practice', challenge: 'Попробуйте сами · Challenge' } as const;

export function LessonVideoLibrary({ materials, course, orthography = 'furigana' }: { materials: VideoMaterial[]; course?: Course; orthography?: Orthography }) {
  const [open, setOpen] = useState(false); const [selectedId, setSelectedId] = useState(materials[0]?.id ?? '');
  const selected = materials.find(material => material.id === selectedId) ?? materials[0];
  if (!selected) return null;
  return <details className="lesson-details" name="lesson-video-library" data-testid="lesson-video-library" data-video-count={materials.length} onToggle={event => setOpen(event.currentTarget.open)}>
    <summary>Видеодиалоги Marugoto Plus · {materials.length}</summary>
    <label><span>Выбрать видеодиалог</span><select value={selected.id} onChange={event => setSelectedId(event.target.value)}>{materials.map(material => <option key={material.id} value={material.id}>Can-do {material.canDoId} · {variantNames[material.variant]} · {material.title}</option>)}</select></label>
    {open && <LessonVideo key={selected.id} material={selected} course={course} orthography={orthography} />}
  </details>;
}

export function LessonVideo({ material, active = true, onPlayingChange, course, orthography = 'furigana' }: { material: VideoMaterial; active?: boolean; onPlayingChange?: (playing: boolean) => void; course?: Course; orthography?: Orthography }) {
  const video = useRef<HTMLVideoElement>(null);
  const [activeCaption, setActiveCaption] = useState(-1);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const media = video.current;
    const pauseWhenHidden = () => { if (document.hidden) media?.pause(); };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => { document.removeEventListener('visibilitychange', pauseWhenHidden); media?.pause(); onPlayingChange?.(false); };
  }, [onPlayingChange]);
  useEffect(() => { if (!active) video.current?.pause(); }, [active]);
  const sync = () => { const media = video.current; if (media) setActiveCaption(media.ended || media.error ? -1 : captionAt(material.captions, media.currentTime)); };
  const caption = material.captions[activeCaption];
  return <section className="lesson-video" aria-label={material.title} data-video-id={material.id} data-can-do-id={material.canDoId} data-variant={material.variant}>
    <header><small>Marugoto Plus · Can-do {material.canDoId} · {variantNames[material.variant]}</small><h3>{material.title}</h3><p className="muted">Необязательный материал урока. Просмотр не меняет повторения.</p></header>
    <video ref={video} src={material.mediaUrl} controls controlsList="nodownload" playsInline preload="none" aria-label={material.title} onTimeUpdate={sync} onSeeking={sync} onSeeked={sync} onLoadedMetadata={sync} onPlay={() => { setFailed(false); sync(); }} onPlaying={() => { if (!active || document.hidden) video.current?.pause(); else onPlayingChange?.(true); }} onPause={() => { onPlayingChange?.(false); sync(); }} onEnded={() => { onPlayingChange?.(false); setActiveCaption(-1); }} onError={() => { onPlayingChange?.(false); setFailed(true); setActiveCaption(-1); }} />
    <div className="lesson-video-caption" data-cue={activeCaption} role="group" aria-label="Японский текст видео">
      {caption?.text && <p key={activeCaption}>{course ? <JapaneseText text={caption.text} course={course} mode={orthography} /> : <span className="jp" lang="ja">{caption.text}</span>}</p>}
    </div>
    {material.captionNote && <p className="muted">{material.captionNote}</p>}
    <p className="lesson-video-source"><a href={material.sourceUrl} target="_blank" rel="noopener noreferrer">Оригинал на Marugoto Plus ↗</a> · <a href={material.captionsSourceUrl} target="_blank" rel="noopener noreferrer">Источник японского текста ↗</a><small>Источник: The Japan Foundation Japanese-Language Institute, Kansai.</small></p>
    {failed && <p className="notice" role="status">Не удалось воспроизвести видео. Попробуйте открыть оригинал по ссылке выше.</p>}
  </section>;
}
