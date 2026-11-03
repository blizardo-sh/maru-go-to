import { defaultCatalog, type CourseCatalog } from '../shared/catalog';
import { useId } from 'react';
import type { CounterObject } from '../shared/counters';

export function CounterPicture({ object, quantity, label, catalog = defaultCatalog, age = false, showQuantity = quantity !== 1 }: { object: CounterObject; quantity: number; label: string; catalog?: CourseCatalog; age?: boolean; showQuantity?: boolean }) {
  const clipId = useId();
  const atlas = catalog.counterAtlas ?? defaultCatalog.counterAtlas!;
  const bounds = atlas.cells[object.id]; if (!bounds) return null;
  const [x,y,width,height] = bounds;
  return <div className="counter-picture" data-count={quantity} data-age={age} role="img" aria-label={`${label} · ${age ? 'возраст ' : 'количество '}${quantity}`}>
    <svg className="counter-object" viewBox={`${x} ${y} ${width} ${height}`} aria-hidden="true" focusable="false"><defs><clipPath id={clipId} clipPathUnits="userSpaceOnUse"><rect x={x} y={y} width={width} height={height} /></clipPath></defs><image href={atlas.src} width={atlas.width} height={atlas.height} clipPath={`url(#${clipId})`} /></svg>
    {(age || showQuantity) && <strong className="counter-quantity">{!age && <span aria-hidden="true">× </span>}{quantity.toLocaleString('ru-RU')}{age && <small>Возраст · лет</small>}</strong>}
  </div>;
}
