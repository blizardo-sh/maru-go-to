export type CatPose = 'neutral' | 'blink' | 'wave' | 'standing' | 'thinking' | 'explain' | 'encourage' | 'success' | 'rest';
export type CardActivityKind = 'idle' | 'revealed' | 'listening' | 'editing' | 'checking' | 'draft-correct' | 'neutral';
export type CardActivity = { reviewId: string; activity: CardActivityKind; key: string };
export type SavedFeedback = { attemptId: string; kind: 'good' | 'again' };
export type CompanionState = { activity: CardActivityKind | 'saved-good' | 'saved-again' | 'complete'; pose: CatPose; key: string };
const activityPoses: Record<CardActivityKind, CatPose> = { idle: 'neutral', revealed: 'explain', listening: 'thinking', editing: 'thinking', checking: 'thinking', 'draft-correct': 'explain', neutral: 'neutral' };

export function companionState({ reviewId, activity, feedback, completed, total }: { reviewId?: string; activity: CardActivity | null; feedback: SavedFeedback | null; completed: number; total: number }): CompanionState {
  if (total > 0 && completed >= total) return { activity: 'complete', pose: 'rest', key: 'complete' };
  const current = activity?.reviewId === reviewId ? activity : null;
  if (current?.activity === 'listening') return { ...current, pose: activityPoses.listening };
  if (feedback) return { activity: feedback.kind === 'good' ? 'saved-good' : 'saved-again', pose: feedback.kind === 'good' ? 'success' : 'encourage', key: feedback.attemptId };
  if (current) return { ...current, pose: activityPoses[current.activity] };
  return { activity: 'idle', pose: 'neutral', key: `${reviewId ?? 'loading'}:idle` };
}
