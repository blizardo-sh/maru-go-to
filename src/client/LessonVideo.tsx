import { useEffect, useRef, useState } from 'react';
import type { LessonVideo as VideoMaterial } from '../shared/types';
import { captionAt } from './videoCaptions';

export function LessonVideo({ material }: { material: VideoMaterial }) {
  const video = useRef<HTMLVideoElement>(null);
  const [activeCaption, setActiveCaption] = useState(-1);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    const media = video.current;
    const pauseWhenHidden = () => { if (document.hidden) media?.pause(); };
    document.addEventListener('visibilitychange', pauseWhenHidden);
    return () => { document.removeEventListener('visibilitychange', pauseWhenHidden); media?.pause(); };
  }, []);
  const sync = () => { const media = video.current; if (media) setActiveCaption(media.ended || media.error ? -1 : captionAt(material.captions, media.currentTime)); };
  const caption = material.captions[activeCaption];
  return <section className="lesson-video" aria-label={material.title}>
    <header><small>Marugoto Plus · видеодиалог</small><h3>{material.title}</h3><p className="muted">Необязательный материал урока. Просмотр не меняет повторения.</p></header>
    <video ref={video} src={material.mediaUrl} controls controlsList="nodownload" playsInline preload="none" aria-label={material.title} onTimeUpdate={sync} onSeeking={sync} onSeeked={sync} onLoadedMetadata={sync} onPlay={() => { setFailed(false); sync(); }} onPause={sync} onEnded={() => setActiveCaption(-1)} onError={() => { setFailed(true); setActiveCaption(-1); }} />
    <div className="lesson-video-caption" data-cue={activeCaption} role="group" aria-label="Японский текст сцены">
      {caption?.text && <p key={activeCaption} className="jp" lang="ja">{caption.text}</p>}
    </div>
    {material.captionNote && <p className="muted">{material.captionNote}</p>}
    <p className="lesson-video-source"><a href={material.sourceUrl} target="_blank" rel="noopener noreferrer">Оригинал на Marugoto Plus ↗</a><small>Источник: The Japan Foundation Japanese-Language Institute, Kansai.</small></p>
    {failed && <p className="notice" role="status">Не удалось воспроизвести видео. Попробуйте открыть оригинал по ссылке выше.</p>}
  </section>;
}
