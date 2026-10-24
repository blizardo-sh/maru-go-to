import { useId } from 'react';
import type { CounterObject } from '../shared/counters';

const rows = [0, 282, 522, 754, 980, 1254];
export function CounterPicture({ object, quantity, label, age = false, showQuantity = quantity !== 1 }: { object: CounterObject; quantity: number; label: string; age?: boolean; showQuantity?: boolean }) {
  const clipId = useId();
  const row = Math.floor(object.tile / 5), column = object.tile % 5;
  const x = column * 250, y = rows[row]!, width = object.tile === 21 ? 275 : 250, height = rows[row + 1]! - y;
  return <div className="counter-picture" data-count={quantity} data-age={age} role="img" aria-label={`${label} · ${age ? 'возраст ' : 'количество '}${quantity}`}>
    <svg className="counter-object" viewBox={`${x} ${y} ${width} ${height}`} aria-hidden="true" focusable="false"><defs><clipPath id={clipId} clipPathUnits="userSpaceOnUse"><rect x={x} y={y} width={width} height={height} /></clipPath></defs><image href="/counters/objects-atlas.webp" width="1254" height="1254" clipPath={`url(#${clipId})`} /></svg>
    {(age || showQuantity) && <strong className="counter-quantity">{!age && <span aria-hidden="true">× </span>}{quantity.toLocaleString('ru-RU')}{age && <small>Возраст · лет</small>}</strong>}
  </div>;
}
