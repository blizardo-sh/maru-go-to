import type { VideoCaption, LessonVideo } from '../shared/types';
import learnerTurns from './videoLearnerTurns.json';

// Cue times for person B in the official challenge XML; shared by both video entry points.
export function videoCaption(material: LessonVideo, seconds: number) {
  const caption = material.captions[captionAt(material.captions, seconds)];
  const turns = learnerTurns as Record<string, number[]>;
  return { text: caption?.text ?? null, learner: material.variant === 'challenge' && !!caption?.text && !!turns[material.id]?.includes(caption.startSeconds) };
}

export function captionAt(captions: VideoCaption[], seconds: number): number {
  if (!Number.isFinite(seconds) || seconds < 0) return -1;
  return captions.findIndex(caption => seconds >= caption.startSeconds && (caption.endSeconds === null || seconds < caption.endSeconds));
}
