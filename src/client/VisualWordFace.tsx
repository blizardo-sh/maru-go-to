import { useEffect, useState } from 'react';
import type { VisualWordCard, VisualWordMode } from '../shared/word-cards';
import { visualWordTitle } from '../shared/word-cards';
import { Japanese } from './Japanese';

export function VisualWordFace({card,mode,revealed}:{card:VisualWordCard;mode:VisualWordMode;revealed:boolean}) {
 const [x,y,width,height]=card.image.viewBox.split(/\s+/).map(Number) as [number,number,number,number];
 const showImage=revealed||mode==='picture-word';
 return <div className="visual-word-face" data-visual-word-mode={mode} data-revealed={revealed}>
  <small>{visualWordTitle(mode)}</small>
  {showImage&&<div className="visual-word-art" role="img" aria-label={revealed?card.captionRu:'Иллюстрация: вспомните изученное слово'} style={{backgroundImage:`url(${card.image.src})`,backgroundSize:`${card.image.width/width*100}% ${card.image.height/height*100}%`,backgroundPosition:`${card.image.width===width?0:x/(card.image.width-width)*100}% ${card.image.height===height?0:y/(card.image.height-height)*100}%`,aspectRatio:`${width}/${height}`}}/>}
  {(revealed||mode==='word-meaning')&&<div className="visual-word-spelling"><Japanese value={card} mode="furigana"/></div>}
  {revealed?<><strong>{card.meaningRu}</strong><p className="visual-word-caption">{card.captionRu}</p></>:<p>{mode==='picture-word'?'Назовите изученное слово по-японски.':'Вспомните значение слова.'}</p>}
 </div>;
}

export function useVisualWordImage(card: VisualWordCard | undefined) {
 const src=card?.image.src, [attempt,setAttempt]=useState(0), [loaded,setLoaded]=useState(''), [failed,setFailed]=useState('');
 useEffect(()=>{if(!src)return;let active=true;const image=new Image();image.onload=()=>{if(active){setLoaded(src);setFailed('');}};image.onerror=()=>{if(active)setFailed(src);};image.src=src;return()=>{active=false;};},[src,attempt]);
 return {ready:!src||loaded===src,error:!!src&&failed===src,retry:()=>{setFailed('');setAttempt(value=>value+1);}};
}
export function VisualImageNotice({state}:{state:ReturnType<typeof useVisualWordImage>}) {
 return state.ready?null:state.error?<p role="alert">Картинку не удалось загрузить. <button type="button" onClick={state.retry}>Повторить загрузку</button></p>:<p role="status">Загружаем картинку…</p>;
}
