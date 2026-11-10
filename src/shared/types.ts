import type { GuidedLesson, LearningConstruction } from './learning';
export type ContentStatus = "missing" | "draft" | "source-checked" | "reviewed";
export type ReviewStatus = Exclude<ContentStatus, "missing">;
export type Orthography = "kana" | "furigana" | "kanji";
export type LessonStatus = "closed" | "studying" | "completed";
export type MaterialScope = "studied" | "selected" | "all";
export type WordMode = "ja-ru" | "ru-ja" | "listening" | "picture-word" | "word-meaning";
export type ReviewMode = WordMode | "grammar" | "counter";
export type Rating = 1 | 2 | 3 | 4;
export const repeatTypes = ['words', 'counters', 'constructions', 'questions', 'time'] as const;
export type RepeatType = typeof repeatTypes[number];
export type ConstructionMode = 'ja-ru' | 'listening' | 'grammar';

export interface SourceRef {
  part: "katsudoo" | "rikai" | "combined";
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

export interface VideoCaption {
  startSeconds: number;
  endSeconds: number | null;
  text: string | null;
}

export interface LessonVideo {
  id: string;
  canDoId: number;
  variant: "practice" | "challenge";
  title: string;
  sourceUrl: string;
  mediaUrl: string;
  captionsSourceUrl: string;
  captionNote?: string;
  captions: VideoCaption[];
}

export interface Lesson {
  bookId?: string;
  availability?: 'full' | 'vocabulary' | 'preparing';
  id: string;
  number: number;
  title: string;
  topic: string;
  canDoIds: number[];
  sourceRefs: SourceRef[];
  videos?: LessonVideo[];
  readiness: {
    vocabulary: ContentStatus;
    grammar: ContentStatus | "not-applicable";
    exercises: ContentStatus | "not-applicable";
    audio: ContentStatus;
  };
}

export interface Word {
  /** Present only on a study projection; dictionary records keep their original ID. */
  lexemeId?: string;
  meaningContext?: import('./meanings').MeaningContext;
  /** Default study target membership when the lexeme also has separately taught meanings. */
  defaultLessonIds?: string[];
  trainingOnly?: boolean;
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
  canDoRefs?: { bookId: string; number: number }[];
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
  meanings?: import('./meanings').WordMeaning[];
  books?: import('./books').Textbook[];
  media?: string[];
  publicationId?: string;
  catalog?: import("./catalog").CourseCatalog;
  id: string;
  version: string;
  title: string;
  lessons: Lesson[];
  words: Word[];
  forms: WordForm[];
  skills: Skill[];
  exercises: Exercise[];
  learning?: GuidedLesson[];
}

export interface LearnerSettings {
  repeatTypesVersion?: 2;
  lessonStatuses: Record<string, LessonStatus>;
  focusLessonIds: string[];
  focusCanDoIds: number[];
  focusCanDoKeys?: string[];
  focusSkillIds: string[];
  enabledListIds: string[];
  freeLessonIds: string[];
  freeScopes: { words: MaterialScope; particles: MaterialScope; constructions: MaterialScope; forms: MaterialScope };
  orthography: Orthography;
  newWordsPerDay: number;
  newSkillsPerDay: number;
  animations: boolean;
  repeatTypes: RepeatType[];
  sceneSoundEnabled: boolean;
  musicVolume: number;
  ambienceVolume: number;
  sfxVolume: number;
  speechVolume: number;
}

interface ReviewBase {
  schedule?: ReviewSchedule;
  preparation?: import('./training').StudyPreparation;
  publicationId?: string;
  id: string;
  targetId: string;
  version: number;
  due: string;
  isNew: boolean;
}

export type ReviewItem = ReviewBase & (
  | { [Mode in WordMode]: { mode: Mode; word: Word; choices?: string[]; application?: import('./training').TrainingEntry['application']; visual?: import('./training').TrainingEntry['visual'] } }[WordMode]
  | { mode: "grammar"; exercise: Exercise; skill: Skill; construction?: LearningConstruction & { mode: ConstructionMode } }
  | { mode: "counter"; counter: import('./counters').CounterCard }
);

export interface ReviewQueue {
  nextDue?: string;
  reference?: { title: string; text: string };
  items: ReviewItem[];
  remainingDue: number;
  remainingNew: number;
}

interface SubmissionBase {
  practiceFormat?: 'ja-ru' | 'ru-ja' | 'listening' | 'grammar' | 'application';
  publicationId?: string;
  attemptId: string;
  reviewId: string;
  version: number;
}

export type ReviewSubmission = SubmissionBase & (
  | { mode: WordMode; rating: Rating; choiceWordId?: string; helped?: boolean }
  | { mode: "grammar"; tokenIds: string[]; tokenForms?: Record<string, string>; revealed: boolean; rating?: Rating; exploring?: boolean }
  | { mode: "counter"; rating: Rating; choice?: string; helped: boolean }
);

export type ReviewSchedule = { kind: 'review'; intervals: Record<Rating, number> } | { kind: 'learning' | 'practice' };

export interface ReviewResult {
  rating?: Rating;
  publicationId?: string;
  attemptId: string;
  status: "scheduled" | "additional-practice" | "learning";
  version: number;
  nextDue: string;
  correct?: boolean;
  feedback?: string;
}

export interface Progress {
  priorLearning?: {kind:'word'|'grammar';itemId:string;canUndo:boolean}[];
  introducedLexemeIds?: string[];
  repeatDue?: number;
  byType?: Record<RepeatType,{due:number;learned:number;reviewedToday:number}>;
  counters: import('./counters').CounterProgress[];
  introducedWordIds: string[];
  introducedSkillIds: string[];
  completedLessons: number;
  totalLessons: number;
  wordsIntroducedToday: number;
  skillsIntroducedToday: number;
  byMode: Record<Exclude<ReviewMode, "picture-word" | "word-meaning">, { due: number; learned: number; reviewedToday: number }> & Partial<Record<"picture-word" | "word-meaning", { due: number; learned: number; reviewedToday: number }>>;
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
  visualWords?: boolean;
  topicId?: 'questions' | 'time';
  sectionId?: string;
  lessonId?: string;
  listId?: string;
  counters?: boolean;
  skillId?: string;
  constructionMode?: ConstructionMode;
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

export type InvitationDetails =
  | { kind: "invite"; email: string; expiresAt: string }
  | { kind: "registration"; email: null; expiresAt: string | null; remainingRegistrations: number | null };

export interface InvitationAcceptResult {
  ok: true;
  email: string;
  authenticated: boolean; verificationRequired?: boolean;
}

export interface RegistrationLinkInput {
  registrationLimit?: number | null;
  expiresAt?: string | null;
}

export interface RegistrationLink {
  id: string;
  registrationLimit: number | null;
  registrationsCount: number;
  remainingRegistrations: number | null;
  expiresAt: string | null;
  revokedAt: string | null;
  createdAt: string;
  status: "active" | "exhausted" | "expired" | "revoked";
}

export interface RegistrationLinkCreateResult {
  url: string;
  link: RegistrationLink;
}

export interface TargetEvaluationRequest {
  publicationId?: string;
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
