import type { Course, ReviewStatus, Segment, SourceRef, Word } from './types';

export interface MeaningContext {
  surface: string;
  kana: string;
  segments: Segment[];
  meaningRu: string;
  audioUrl?: string;
}
export interface WordMeaning {
  id: string;
  wordId: string;
  meaningRu: string;
  lessonIds: string[];
  context: MeaningContext;
  reviewStatus: ReviewStatus;
  sourceRefs: SourceRef[];
}
export function wordTarget(course: Pick<Course,'words'|'meanings'>, targetId: string): Word | undefined {
  const original = course.words.find(word => word.id === targetId);
  if (original) return original.defaultLessonIds ? { ...original, lessonIds: original.defaultLessonIds } : original;
  const meaning = course.meanings?.find(meaning => meaning.id === targetId);
  const word = meaning && course.words.find(word => word.id === meaning.wordId);
  if (!meaning || !word) return undefined;
  return { ...word, id: meaning.id, lexemeId: word.id, meaningRu: meaning.meaningRu, lessonIds: meaning.lessonIds,
    meaningContext: meaning.context, audioUrl: meaning.context.audioUrl, reviewStatus: meaning.reviewStatus, sourceRefs: meaning.sourceRefs };
}
export function wordTargets(course: Pick<Course,'words'|'meanings'>, words = course.words): Word[] {
  return [...words.map(word => word.defaultLessonIds ? { ...word, lessonIds: word.defaultLessonIds } : word), ...(course.meanings ?? []).map(meaning => wordTarget(course, meaning.id)!)];
}
export function lexemeIds(course: Pick<Course,'words'|'meanings'>, targets: Iterable<string>): Set<string> {
  return new Set([...targets].map(id => course.meanings?.find(meaning => meaning.id === id)?.wordId ?? id));
}
export function validateMeanings(course: Course): void {
  const ids = new Set(course.words.map(word => word.id));
  for (const word of course.words) if (word.lexemeId || word.meaningContext || word.defaultLessonIds?.some(id => !word.lessonIds.includes(id))) throw new Error(`Study projection in dictionary: ${word.id}`);
  for (const meaning of course.meanings ?? []) {
    const word = course.words.find(word => word.id === meaning.wordId), context = meaning.context;
    if (!meaning.id || ids.has(meaning.id) || !word || !meaning.meaningRu?.trim() || !meaning.lessonIds.length ||
      meaning.lessonIds.some(id => !word.lessonIds.includes(id) || !course.lessons.some(lesson => lesson.id === id)) ||
      !['draft','source-checked','reviewed'].includes(meaning.reviewStatus) || !meaning.sourceRefs.length ||
      !context?.surface?.trim() || !context.kana?.trim() || !context.meaningRu?.trim() ||
      context.segments?.map(segment => segment.surface).join('') !== context.surface ||
      context.segments?.map(segment => segment.reading ?? segment.surface).join('') !== context.kana)
      throw new Error(`Invalid word meaning: ${meaning.id}`);
    ids.add(meaning.id);
  }
}

export function meaningDisplay<T extends { surface: string; kana: string; segments: Segment[]; meaningRu: string; meaningContext?: MeaningContext }>(word: T): T {
  return word.meaningContext ? { ...word, ...word.meaningContext, meaningRu: `${word.meaningRu}\n${word.meaningContext.meaningRu}` } : word;
}

export function dictionaryMeanings(course: Pick<Course,'words'|'meanings'>, word: Word, known: Set<string>) {
  return [wordTarget(course,word.id)??word,...(course.meanings??[]).filter(meaning=>meaning.wordId===word.id).map(meaning=>wordTarget(course,meaning.id)!)].map(target=>({...target,learned:known.has(target.id)}));
}
