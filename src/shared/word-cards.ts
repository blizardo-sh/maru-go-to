import type { CourseCatalog } from './catalog';
import type { Word } from './types';

export const visualWordModes = ['picture-word', 'word-meaning'] as const;
export type VisualWordMode = typeof visualWordModes[number];
export const isVisualWordMode = (mode: string): mode is VisualWordMode => visualWordModes.some(value => value === mode);
export interface VisualWordCard {
 surface: string; kana: string; segments: Word['segments']; meaningRu: string; captionRu: string;
 image: {src: string; width: number; height: number; viewBox: string};
}
export interface WordCardCatalog { version: number; scope: string; entries: Record<string,VisualWordCard> }
export function wordCardFor(word: Pick<Word,'id'|'lexemeId'> | string, catalog?: CourseCatalog) {
 const id=typeof word==='string'?word:word.id;
 return catalog?.wordCards?.entries[id];
}
export const visualWordTitle = (mode: VisualWordMode) => mode === 'picture-word' ? 'Картинка → слово' : 'Слово → значение';
