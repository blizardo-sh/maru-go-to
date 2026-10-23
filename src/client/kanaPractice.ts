import type { KanaEntry } from './referenceData';
import { shuffledTokens } from './study';

export type KanaAudio = { soundKey: string | null; audioUrl?: string; unavailableReason?: string };
export type KanaManifest = { entries: Record<string, KanaAudio> };
export type KanaQuestion = KanaEntry & KanaAudio & { format: 'reading' | 'listening' };

export function kanaDeck(entries: KanaEntry[], manifest: KanaManifest): KanaQuestion[] {
  const questions = entries.flatMap(entry => {
    const audio = manifest.entries[entry.kana] ?? { soundKey: null };
    return [{ ...entry, ...audio, format: 'reading' as const }, ...(audio.audioUrl && audio.soundKey ? [{ ...entry, ...audio, format: 'listening' as const }] : [])];
  });
  return shuffledTokens(questions.map((_, index) => String(index))).slice(0, 20).map(index => questions[Number(index)]!);
}

export function kanaChoices(question: KanaQuestion, entries: KanaEntry[], manifest: KanaManifest): KanaEntry[] {
  const key = (entry: KanaEntry) => question.format === 'reading' ? entry.reading : manifest.entries[entry.kana]?.soundKey;
  const correct = key(question);
  const seen = new Set([correct]);
  const candidates = shuffledTokens(entries.map(entry => entry.kana)).flatMap(kana => {
    const entry = entries.find(entry => entry.kana === kana)!; const sound = key(entry);
    if (!sound || seen.has(sound)) return [];
    seen.add(sound); return [entry];
  }).slice(0, 3);
  return shuffledTokens([question.kana, ...candidates.map(entry => entry.kana)]).map(kana => entries.find(entry => entry.kana === kana) ?? question);
}
