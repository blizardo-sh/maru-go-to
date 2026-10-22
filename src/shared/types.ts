export type ContentStatus = "missing" | "draft" | "source-checked" | "reviewed";
export type ReviewStatus = Exclude<ContentStatus, "missing">;
export type Orthography = "kana" | "furigana" | "kanji";
export type LessonStatus = "closed" | "studying" | "completed";
export type MaterialScope = "studied" | "selected" | "all";
export type ReviewMode = "ja-ru" | "ru-ja" | "listening" | "grammar" | "counter";
export type Rating = 1 | 2 | 3 | 4;

export interface SourceRef {
  part: "katsudoo" | "rikai";
  url: string;
  label?: string;
  page?: number;
  row?: number;
  entry?: string;
}

export interface Segment {
  surface: string;
  reading?: string;
}

export interface Lesson {
  id: string;
  number: number;
  title: string;
  topic: string;
  canDoIds: number[];
  sourceRefs: SourceRef[];
  readiness: {
    vocabulary: ContentStatus;
    grammar: ContentStatus | "not-applicable";
    exercises: ContentStatus | "not-applicable";
    audio: ContentStatus;
  };
}

export interface Word {
  id: string;
  lessonIds: string[];
  surface: string;
  kana: string;
  meaningRu: string;
  segments: Segment[];
  kind: "word" | "phrase";
  pos: string;
  reviewStatus: ReviewStatus;
  sourceRefs: SourceRef[];
  audioUrl?: string;
  audioText?: string;
}

export interface WordForm {
  id: string;
  wordId: string;
  lessonIds: string[];
  surface: string;
  kana: string;
  segments: Segment[];
  reviewStatus: ReviewStatus;
  sourceRefs: SourceRef[];
}

export interface Skill {
  id: string;
  lessonIds: string[];
  canDoIds: number[];
  title: string;
  explanationRu: string;
  reviewStatus: ReviewStatus;
  sourceRefs: SourceRef[];
}

export interface Exercise {
  id: string;
  lessonId: string;
  skillId: string;
  promptRu: string;
  translationRu?: string;
  contextRu?: string;
  tokens: { id: string; formId: string }[];
  // Authored orders share the task meaning and skill; contextual omissions are explicit subsets.
  acceptedOrders: string[][];
  sentenceEnd: string;
  reviewStatus: ReviewStatus;
}

export interface Course {
  id: string;
  version: string;
  title: string;
  lessons: Lesson[];
  words: Word[];
  forms: WordForm[];
  skills: Skill[];
  exercises: Exercise[];
}

export interface LearnerSettings {
  lessonStatuses: Record<string, LessonStatus>;
  focusLessonIds: string[];
  focusCanDoIds: number[];
  focusSkillIds: string[];
  enabledListIds: string[];
  freeLessonIds: string[];
  freeScopes: { words: MaterialScope; particles: MaterialScope; constructions: MaterialScope; forms: MaterialScope };
  orthography: Orthography;
  newWordsPerDay: number;
  newSkillsPerDay: number;
  animations: boolean;
  sceneSoundEnabled: boolean;
  musicVolume: number;
  ambienceVolume: number;
  sfxVolume: number;
  speechVolume: number;
}

interface ReviewBase {
  id: string;
  targetId: string;
  version: number;
  due: string;
  isNew: boolean;
}

export type ReviewItem = ReviewBase & (
  | { mode: "ja-ru" | "ru-ja" | "listening"; word: Word }
  | { mode: "grammar"; exercise: Exercise; skill: Skill }
  | { mode: "counter"; counter: import('./counters').CounterCard }
);

export interface ReviewQueue {
  items: ReviewItem[];
  remainingDue: number;
  remainingNew: number;
}

interface SubmissionBase {
  attemptId: string;
  reviewId: string;
  version: number;
}

export type ReviewSubmission = SubmissionBase & (
  | { mode: "ja-ru" | "ru-ja" | "listening"; rating: Rating }
  | { mode: "grammar"; tokenIds: string[]; tokenForms?: Record<string, string>; revealed: boolean; rating?: 1 | 3; exploring?: boolean }
  | { mode: "counter"; rating: 1 | 3; choice?: string; helped: boolean }
);

export interface ReviewResult {
  attemptId: string;
  status: "scheduled" | "additional-practice";
  version: number;
  nextDue: string;
  correct?: boolean;
  feedback?: string;
}

export interface Progress {
  counters: import('./counters').CounterProgress[];
  introducedWordIds: string[];
  introducedSkillIds: string[];
  completedLessons: number;
  totalLessons: number;
  wordsIntroducedToday: number;
  skillsIntroducedToday: number;
  byMode: Record<ReviewMode, { due: number; learned: number; reviewedToday: number }>;
}

export interface WordList {
  id: string;
  name: string;
  words: Word[];
}

export interface WordUpdate {
  surface?: string;
  kana?: string;
  meaningRu?: string;
  segments?: Segment[];
  pos?: string;
}

export interface TrainingContext {
  lessonId?: string;
  listId?: string;
  counters?: boolean;
}

export interface AnalysisRequest extends TrainingContext {
  exerciseId?: string;
  text: string;
  revision: number;
  wordIds: string[];
}

export type AnalysisResult =
  | {
      status: "ok";
      revision: number;
      text: string;
      translationRu: string;
      grammar: "correct" | "incorrect" | "uncertain" | "incomplete";
      naturalness: "natural" | "awkward" | "uncertain";
      explanationRu: string;
      materialViolations: string[];
      warnings: string[];
    }
  | { status: "unavailable"; revision: number; text: string; reason: string };

export interface ApiError {
  error: { code: string; message: string };
}

export interface InvitationDetails {
  email: string;
  expiresAt: string;
}

export interface TargetEvaluationRequest {
  reviewId: string;
  version: number;
  tokenIds: string[];
  tokenForms?: Record<string, string>;
  revision: number;
  exploring?: boolean;
}

export interface TargetEvaluationResult {
  revision: number;
  outcome: "correct" | "incorrect" | "incomplete" | "exploration";
  feedback: string;
}
