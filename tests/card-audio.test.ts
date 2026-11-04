import { expect, test } from 'bun:test';
import { prepareCardAudio } from '../src/client/cardAudio';
test('preparing or replaying a card retains its buffer; a new source loads once', () => {
  let loads = 0;
  const audio = { src: '', preload: '', getAttribute() { return this.src; }, load() { loads++; } };
  prepareCardAudio(audio as unknown as HTMLAudioElement, '/audio/a.m4a');
  prepareCardAudio(audio as unknown as HTMLAudioElement, '/audio/a.m4a');
  expect(loads).toBe(1); expect(audio.preload).toBe('auto');
  prepareCardAudio(audio as unknown as HTMLAudioElement, '/audio/b.m4a');
  expect(loads).toBe(2); expect(audio.src).toBe('/audio/b.m4a');
});
