import { defaultCatalog, type CourseCatalog } from './catalog';

export interface WordIllustration {
  src: string;
  width: number;
  height: number;
  viewBox: string;
}

const indexes = new WeakMap<CourseCatalog, Map<string, WordIllustration>>();
export function getWordIllustration(wordId: string, catalog = defaultCatalog): WordIllustration | undefined {
  let illustrations = indexes.get(catalog);
  if (!illustrations) {
    illustrations = new Map();
    for (const asset of catalog.illustrations.assets) for (const cell of asset.cells) for (const id of cell.wordIds) illustrations.set(id, { src: asset.src, width: asset.width, height: asset.height, viewBox: cell.bounds.join(' ') });
    indexes.set(catalog, illustrations);
  }
  return illustrations.get(wordId);
}
