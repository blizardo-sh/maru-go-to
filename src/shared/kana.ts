import { defaultCatalog } from './catalog';
// Canonical modern kana rows shared by the reference and static pronunciation whitelist.
export type KanaEntry = { kana: string; reading: string };
export type KanaRow = { label: string; cells: (KanaEntry | null)[] };
export type KanaAudioEntry = { soundKey: string; audioUrl: string } | { soundKey: null; unavailableReason: string };
export interface KanaAudioManifest { voice: string; rate: number; pronunciationReview: 'not-human-reviewed'; entries: Record<string, KanaAudioEntry> }
export const { basic: basicKana, voiced: voicedKana, yoon: yoonKana, small: smallKana } = defaultCatalog.kana;
export const katakana = (value: string): string => [...value].map(character => { const code = character.codePointAt(0)!; return code >= 0x3041 && code <= 0x3096 ? String.fromCodePoint(code + 0x60) : character; }).join('');
