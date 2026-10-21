import type { SceneId } from './scenes';

export type DeskProp = 'brushes' | 'inkstone' | 'tea' | 'teapot' | 'dango' | 'sakura-mochi' | 'dorayaki' | 'linen';
export type DayPeriod = 'morning' | 'day' | 'evening';
export type SceneDecor = { period: DayPeriod; props: readonly [DeskProp, DeskProp, DeskProp, DeskProp] };
const sets: Record<SceneId, Record<DayPeriod, readonly [DeskProp, DeskProp, DeskProp, DeskProp]>> = {
  room: { morning: ['brushes', 'tea', 'dango', 'teapot'], day: ['inkstone', 'tea', 'sakura-mochi', 'teapot'], evening: ['teapot', 'dorayaki', 'tea', 'linen'] },
  garden: { morning: ['sakura-mochi', 'tea', 'brushes', 'teapot'], day: ['dango', 'teapot', 'tea', 'linen'], evening: ['linen', 'tea', 'sakura-mochi', 'teapot'] },
  mountains: { morning: ['linen', 'teapot', 'tea', 'dorayaki'], day: ['dorayaki', 'tea', 'brushes', 'teapot'], evening: ['brushes', 'tea', 'dango', 'teapot'] },
  river: { morning: ['brushes', 'tea', 'dango', 'teapot'], day: ['dango', 'linen', 'tea', 'brushes'], evening: ['teapot', 'dorayaki', 'tea', 'linen'] },
  tokyo: { morning: ['brushes', 'tea', 'dango', 'teapot'], day: ['inkstone', 'tea', 'sakura-mochi', 'teapot'], evening: ['dorayaki', 'teapot', 'tea', 'linen'] },
};

// Called at a new session's explicit start; callers retain the returned snapshot.
export function selectSceneDecor(scene: SceneId, localTime = new Date()): SceneDecor {
  const hour = localTime.getHours();
  const period: DayPeriod = hour >= 6 && hour < 12 ? 'morning' : hour >= 12 && hour < 18 ? 'day' : 'evening';
  return { period, props: sets[scene][period] };
}
