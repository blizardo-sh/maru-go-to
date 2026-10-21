import type { VideoCaption } from '../shared/types';

export function captionAt(captions: VideoCaption[], seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) return -1;
  return captions.findIndex(caption => seconds >= caption.startSeconds && (caption.endSeconds === null || seconds < caption.endSeconds));
}
