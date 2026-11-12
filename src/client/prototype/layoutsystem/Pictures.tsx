import { useId } from 'react';
import type { CounterObject } from '../../../shared/counters';
import { getWordIllustration } from '../../../shared/word-illustrations';

// Clip the authored crop before letterboxing; clipping only the outer SVG leaks its neighbours.
function Tile({ src, crop, width, height, className }: { src: string; crop: number[]; width: number; height: number; className: string }) {
  const id = useId().replaceAll(':', '');
  return <svg className={className} viewBox={crop.join(' ')} aria-hidden="true" focusable="false" data-crop={crop.join(' ')}>
    <defs><clipPath id={`crop-${id}`} clipPathUnits="userSpaceOnUse"><rect x={crop[0]} y={crop[1]} width={crop[2]} height={crop[3]} /></clipPath></defs>
    <image href={src} width={width} height={height} clipPath={`url(#crop-${id})`} />
  </svg>;
}

export function WordIllustration({ wordId }: { wordId: string }) {
  const image = getWordIllustration(wordId);
  return image ? <Tile src={image.src} crop={image.viewBox.split(/\s+/).map(Number)} width={image.width} height={image.height} className="word-illustration" /> : null;
}

export function CounterPicture({ object, quantity, label, age = false, showQuantity = quantity !== 1 }: { object: CounterObject; quantity: number; label: string; age?: boolean; showQuantity?: boolean }) {
  const rows = [0, 282, 522, 754, 980, 1254];
  const row = Math.floor(object.tile / 5), column = object.tile % 5;
  const crop = object.id === 'person' ? [65, 7, 165, 274] : [column * 250, rows[row]!, object.tile === 21 ? 275 : 250, rows[row + 1]! - rows[row]!];
  return <div className="counter-picture" data-count={quantity} data-age={age} role="img" aria-label={`${label} · ${age ? 'возраст' : 'количество'} ${quantity}`}>
    <div className="counter-picture-objects"><Tile src="/counters/objects-atlas.webp" crop={crop} width={1254} height={1254} className="counter-object" /></div>
    {(age || showQuantity) && <strong className="counter-quantity">{!age && '× '}{quantity.toLocaleString('ru-RU')}{age && <small>Возраст · лет</small>}</strong>}
  </div>;
}
