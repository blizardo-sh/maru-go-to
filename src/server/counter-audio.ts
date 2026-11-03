import type { CourseCatalog } from '../shared/catalog';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { counterAnswer, type CounterDefinition } from '../shared/counters';

export function counterAudio(counter: CounterDefinition, quantity: number | null, catalog?: CourseCatalog, available?: string[]): string | undefined {
  const text = counterAnswer(counter, quantity, catalog).kana;
  const name = createHash('sha256').update(`Kyoko:150:${text}`).digest('hex').slice(0, 20) + '.m4a';
  const url = `/audio/${name}`;
  if (available) return available.includes(url) ? url : undefined;
  return existsSync(join(process.env.CONTENT_MEDIA_ROOT ?? new URL('../../public', import.meta.url).pathname, 'audio', name)) ? url : undefined;
}
