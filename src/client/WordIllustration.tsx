import { useEffect, useRef, useState } from 'react';
import { getWordIllustration } from '../shared/word-illustrations';

/** Decorative mnemonic: never mount this component before a quiz answer. */
export function WordIllustration({ wordId, className = '' }: { wordId: string; className?: string }) {
  const image = getWordIllustration(wordId);
  const root = useRef<SVGSVGElement>(null);
  const [visibleWord, setVisibleWord] = useState<string | null>(null);
  useEffect(() => {
    const element = root.current; if (!element) return;
    if (!('IntersectionObserver' in window)) { setVisibleWord(wordId); return; }
    const observer = new IntersectionObserver(entries => { if (entries.some(entry => entry.isIntersecting)) { setVisibleWord(wordId); observer.disconnect(); } }, { rootMargin: '160px' });
    observer.observe(element);
    return () => observer.disconnect();
  }, [wordId, image?.src]);
  if (!image) return null;
  return <svg ref={root} aria-hidden="true" className={`word-illustration ${className}`} viewBox={image.viewBox} preserveAspectRatio="xMidYMid meet">{visibleWord === wordId && <image href={image.src} width={image.width} height={image.height} />}</svg>;
}
