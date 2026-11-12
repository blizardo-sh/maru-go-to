import manifest from '../../../../public/audio/kana-manifest.json';

// Reuse the exact generated production assets; no runtime speech provider.
const entries = Object.entries(manifest.entries) as [string, { soundKey: string | null; audioUrl?: string; unavailableReason?: string }][];
export const kanaAudio: Record<string, string> = Object.fromEntries(entries.flatMap(([kana, entry]) => entry.audioUrl ? [[kana, entry.audioUrl]] : []));
export const kanaSoundKeys: Record<string, string | null> = Object.fromEntries(entries.map(([kana, entry]) => [kana, entry.soundKey]));
