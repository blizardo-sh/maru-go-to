import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { counterAnswer, type CounterDefinition } from '../shared/counters';

export function counterAudio(counter: CounterDefinition, quantity: number | null): string | undefined {
  const text = counterAnswer(counter, quantity).kana;
  const name = createHash('sha256').update(`Kyoko:150:${text}`).digest('hex').slice(0, 20) + '.m4a';
  return existsSync(new URL(`../../public/audio/${name}`, import.meta.url)) ? `/audio/${name}` : undefined;
}
