import type { CounterObject } from '../shared/counters';

const rows = [0, 282, 522, 754, 980, 1254];
export function CounterPicture({ object, quantity, label, age = false }: { object: CounterObject; quantity: number; label: string; age?: boolean }) {
  const row = Math.floor(object.tile / 5), column = object.tile % 5;
  const x = column * 250, y = rows[row]!, width = object.tile === 21 ? 275 : 254, height = rows[row + 1]! - y;
  const copies = age || quantity > 10 ? 1 : quantity;
  return <div className="counter-picture" data-count={quantity} data-age={age} role="img" aria-label={`${label} · ${age ? 'возраст ' : 'количество '}${quantity}`}>
    <div className="counter-picture-objects" data-many={copies > 5}>{Array.from({ length: copies }, (_, index) => <svg className="counter-object" key={index} viewBox={`${x} ${y} ${width} ${height}`} aria-hidden="true" focusable="false"><image href="/counters/objects-atlas.webp" width="1254" height="1254" /></svg>)}</div>
    {(age || quantity > 10) && <strong className="counter-quantity">{quantity.toLocaleString('ru-RU')}{age && <small>Возраст · лет</small>}</strong>}
  </div>;
}
