import manifest from "../../public/word-illustrations/manifest.json";

export interface WordIllustration {
  src: string;
  width: number;
  height: number;
  viewBox: string;
}

const illustrations = new Map<string, WordIllustration>();
for (const asset of manifest.assets) {
  for (const cell of asset.cells) {
    for (const wordId of cell.wordIds) {
      illustrations.set(wordId, {
        src: asset.src,
        width: asset.width,
        height: asset.height,
        viewBox: cell.bounds.join(" "),
      });
    }
  }
}

export function getWordIllustration(wordId: string): WordIllustration | undefined {
  return illustrations.get(wordId);
}
