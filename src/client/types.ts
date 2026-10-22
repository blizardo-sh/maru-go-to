import type { Course, LearnerSettings, Progress, WordList } from '../shared/types';

export type User = { id: string; name: string; email: string; isAdmin: boolean };
export type Snapshot = { course: Course; settings: LearnerSettings; progress: Progress; lists: WordList[] };
export type StudySource = { kind: 'review' } | { kind: 'lesson'; lessonId: string } | { kind: 'list'; listId: string } | { kind: 'counters' };
