import { useCallback, useEffect, useRef, useState } from 'react';
import type { SceneSound } from './sceneSound';

export function useCardSpeech(url: string | undefined, autoPlay: boolean, active: boolean, volume: number, sound: SceneSound) {
  const audio = useRef<HTMLAudioElement | null>(null), activeRef = useRef(active); activeRef.current = active;
  const [played, setPlayed] = useState(false), [playing, setPlaying] = useState(false), [error, setError] = useState('');
  const play = useCallback(async () => {
    const current = audio.current; if (!current || !activeRef.current || document.hidden) return;
    setError('');
    try { current.currentTime = 0; await current.play(); }
    catch (failure) { setPlaying(false); sound.setSpeechPlaying(false); if (activeRef.current && !(failure instanceof DOMException && ['NotAllowedError', 'AbortError'].includes(failure.name))) setError('Запись не загрузилась. Проверьте соединение и повторите прослушивание.'); }
  }, [sound.setSpeechPlaying]);
  useEffect(() => {
    setPlayed(false); setError('');
    if (!url) return;
    const current = new Audio(url); audio.current = current;
    current.onplaying = () => { if (activeRef.current && !document.hidden) { setPlaying(true); setPlayed(true); sound.setSpeechPlaying(true); } else current.pause(); };
    current.onpause = () => { setPlaying(false); sound.setSpeechPlaying(false); }; current.onended = current.onpause;
    current.onerror = () => { setPlaying(false); sound.setSpeechPlaying(false); setError('Запись недоступна. Аудиозадание не будет оценено.'); };
    const pauseHidden = () => { if (document.hidden) current.pause(); }; document.addEventListener('visibilitychange', pauseHidden);
    return () => { document.removeEventListener('visibilitychange', pauseHidden); sound.setSpeechPlaying(false); current.onplaying = null; current.onpause = null; current.onended = null; current.onerror = null; current.pause(); audio.current = null; };
  }, [url, sound.setSpeechPlaying]);
  useEffect(() => { if (!active) audio.current?.pause(); else if (autoPlay && !played) void play(); }, [active, autoPlay, played, play, url]);
  useEffect(() => { if (audio.current) audio.current.volume = volume; }, [volume, url]);
  return { play, played, playing, error };
}
