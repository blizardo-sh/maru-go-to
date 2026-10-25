// Throwaway: compare three lesson-card compositions on /?prototype=lesson-cards&variant=A.
import { useEffect, useState } from 'react';
import { SceneStage } from './SceneStage';
import type { SceneDecor } from './sceneDecor';
import './TextbookCards.prototype.css';

type Lesson = { id: string; number: number; title: string; topic: number; parts: number; goals: string[] };
type Card = Lesson & { fills: number[] };
type CardsProps = { cards: Card[]; gradual: boolean; advance: (id: string) => void };
const lessons: Lesson[] = await fetch('/__lesson-card-prototype-data').then(response => response.json());
const variants = ['A', 'B', 'C'] as const;
type Variant = typeof variants[number];
const names = { A: 'Компактные карточки', B: 'Альбом', C: 'Список уроков' };
const decor: SceneDecor = { period: 'morning', props: ['brushes', 'tea', 'dango', 'teapot'] };
const initial = (lesson: Lesson) => Array.from({ length: lesson.parts }, (_, index) => lesson.number === 1 ? 1 : lesson.number === 3 ? index < 2 ? 1 : index === 2 ? .45 : 0 : 0);
const finished = (card: Card) => card.fills.filter(value => value === 1).length;
const label = (card: Card) => finished(card) === card.parts ? 'Итог урока' : card.fills.some(Boolean) ? 'Продолжить урок' : 'Начать урок';
function Art({ card }: { card: Card }) { return <span className="lesson-topic-image pc-art" data-topic={card.topic} aria-hidden="true" />; }
function Title({ card }: { card: Card }) { return <div className="pc-heading"><small>Урок {card.number}</small><h3>{card.title}</h3><small>{finished(card) === card.parts ? 'Урок пройден' : card.fills.some(Boolean) ? 'Изучение начато' : 'Новый урок'}</small></div>; }
function Parts({ card, gradual }: { card: Card; gradual: boolean }) {
  const done = finished(card), value = card.fills.reduce((sum, fill) => sum + (gradual ? fill : Math.floor(fill)), 0);
  return <div className="pc-progress"><div className="pc-parts" role="progressbar" aria-label={`Прогресс урока ${card.number}`} aria-valuemin={0} aria-valuemax={card.parts} aria-valuenow={value} aria-valuetext={`Завершено частей: ${done} из ${card.parts}`} style={{ gridTemplateColumns: `repeat(${card.parts}, minmax(0,1fr))` }}>{card.fills.map((fill, index) => <span key={index} className="pc-part" data-current={fill > 0 && fill < 1} aria-hidden="true"><span style={{ width: `${(gradual ? fill : Math.floor(fill)) * 100}%` }} /></span>)}</div><small>Части: {done} из {card.parts}</small></div>;
}
function Material({ card }: { card: Card }) { return <details className="pc-material"><summary>Материал урока</summary><ul>{card.goals.map(goal => <li key={goal}>{goal}</li>)}</ul></details>; }
export function CompactCards({ cards, gradual, advance }: CardsProps) {
  return <div className="pc-compact-grid">{cards.map(card => <article className="pc-card" key={card.id}><div className="pc-compact-top"><Art card={card} /><div className="pc-information"><Title card={card} /><Parts card={card} gradual={gradual} /></div></div><button className="primary" onClick={() => advance(card.id)}>{label(card)}</button><Material card={card} /></article>)}</div>;
}
export function AlbumCards({ cards, gradual, advance }: CardsProps) {
  return <div className="pc-album-grid">{cards.map(card => <article className="pc-album-card pc-card" key={card.id}><Art card={card} /><div className="pc-information"><Title card={card} /><Parts card={card} gradual={gradual} /><button className="primary" onClick={() => advance(card.id)}>{label(card)}</button><Material card={card} /></div></article>)}</div>;
}
export function LessonList({ cards, gradual, advance }: CardsProps) {
  return <div className="pc-list">{cards.map(card => <article className="pc-list-row" key={card.id}><Art card={card} /><Title card={card} /><Parts card={card} gradual={gradual} /><div className="pc-list-actions"><button className="primary" onClick={() => advance(card.id)}>{label(card)}</button><Material card={card} /></div></article>)}</div>;
}
export function LessonCardsPrototype() {
  const query = new URLSearchParams(location.search);
  const [variant, setVariant] = useState<Variant>(variants.includes(query.get('variant') as Variant) ? query.get('variant') as Variant : 'A');
  const [gradual, setGradual] = useState(query.get('fill') !== 'complete');
  const [cards, setCards] = useState<Card[]>(() => lessons.map(lesson => ({ ...lesson, fills: initial(lesson) })));
  const [message, setMessage] = useState('Демо: урок 1 готов, 2 новый, 3 начат. Без сохранения.');
  function choose(value: Variant) { const url = new URL(location.href); url.searchParams.set('variant', value); history.replaceState(null, '', url); setVariant(value); }
  function cycle(offset: number) { choose(variants[(variants.indexOf(variant) + offset + variants.length) % variants.length]!); }
  useEffect(() => { const key = (event: KeyboardEvent) => { if ((event.target as HTMLElement).closest('input,textarea,select,[contenteditable=true]')) return; if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') { event.preventDefault(); cycle(event.key === 'ArrowLeft' ? -1 : 1); } }; window.addEventListener('keydown', key); return () => window.removeEventListener('keydown', key); }, [variant]);
  function advance(id: string) {
    const card = cards.find(card => card.id === id)!;
    const fills = [...card.fills], index = fills.findIndex(fill => fill < 1);
    if (index < 0) { setMessage(`Урок ${card.number}: все ${card.parts} частей завершены. Материалы можно раскрыть на карточке.`); return; }
    fills[index] = Math.min(1, fills[index]! + .25);
    setCards(current => current.map(card => card.id === id ? { ...card, fills } : card));
    setMessage(`Урок ${card.number}: завершено ${fills.filter(fill => fill === 1).length} из ${card.parts} частей; текущая часть ${Math.round(fills[index]! * 100)}%.`);
  }
  const props = { cards, gradual, advance };
  return <div className="shell game-shell pc-shell" data-motion="false" data-entry-phase="ready" data-scene="room"><SceneStage scene="room" decor={decor} entryId={0} phase="ready" active={false} onReady={() => {}} layoutKey={variant} /><header className="game-hud"><nav className="nav" aria-label="Разделы">{['Учебник', 'Тренировки', 'Повторение', 'Справочник'].map((title, index) => <button key={title} aria-current={index === 0 ? 'page' : undefined} onClick={() => setMessage('Макет показывает только карточки учебника.')} >{index === 0 && <span className="nav-leaf" aria-hidden="true">❧</span>}{title}</button>)}<button className="scene-sound-toggle" aria-label="Звуки сцены" onClick={() => setMessage('В макете звук выключен.')}>♫</button><details className="hud-menu"><summary aria-label="Настройки макета">⚙</summary><div className="hud-menu-panel"><button onClick={() => { setCards(lessons.map(lesson => ({ ...lesson, fills: initial(lesson) }))); setMessage('Демонстрационные состояния восстановлены.'); }}>Сбросить демонстрацию</button></div></details></nav></header><main><div className="page"><section className="section-board work-board pc-board"><header className="pagehead"><h1>Учебник</h1><p>Marugoto Starter A1 · 18 уроков · 9 тем</p><p className="muted">Выберите урок. Прогресс сохраняет каждую пройденную часть.</p></header>{variant === 'A' ? <CompactCards {...props} /> : variant === 'B' ? <AlbumCards {...props} /> : <LessonList {...props} />}</section></div></main>{import.meta.env.DEV && <aside className="pc-switcher" aria-label="Переключатель прототипа"><div className="pc-switcher-row"><button aria-label="Предыдущий вариант" onClick={() => cycle(-1)}>←</button><strong>Макет {variant} · {names[variant]}</strong><button aria-label="Следующий вариант" onClick={() => cycle(1)}>→</button><label><span className="pc-visually-hidden">Заполнение прогресса</span><select aria-label="Заполнение прогресса" value={gradual ? 'gradual' : 'complete'} onChange={event => { const next = event.target.value === 'gradual'; setGradual(next); const url = new URL(location.href); url.searchParams.set('fill', next ? 'gradual' : 'complete'); history.replaceState(null, '', url); }}><option value="gradual">Текущая часть постепенно</option><option value="complete">Только готовые части</option></select></label></div><p role="status">{message}</p></aside>}</div>;
}
