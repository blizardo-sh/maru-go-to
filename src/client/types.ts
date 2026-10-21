import type { Course, LearnerSettings, Progress, WordList } from '../shared/types';
import type { LearningState } from '../shared/learning';

export type User = { id: string; name: string; email: string; isAdmin: boolean };
export type Snapshot = { course: Course; settings: LearnerSettings; progress: Progress; lists: WordList[]; learning?: LearningState[] };
export type StudySource = { kind: 'review' } | { kind: 'lesson' | 'guided'; lessonId: string } | { kind: 'list'; listId: string };
