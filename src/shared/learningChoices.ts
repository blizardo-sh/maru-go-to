import type { Course, Word } from './types';
import type { GuidedLesson, LearningStep } from './learning';
import { catalogFor, defaultCatalog, type CourseCatalog } from './catalog';

const normalized = (text: string) => text.normalize('NFKC').toLowerCase().replace(/[\s\p{P}\p{S}]/gu, '');
const reading = (text: string) => normalized(text).replace(/[ァ-ヶ]/g, char => String.fromCharCode(char.charCodeAt(0) - 0x60));
const meanings = (word: Word, catalog: CourseCatalog) => {
  const parts = word.meaningRu.normalize('NFKC').toLowerCase().replace(/\([^)]*\)/g, '').split(/[,;/]/).map(normalized).filter(Boolean);
  // A shared courtesy marker does not make different requests the same answer.
  const hasContent = parts.some(part => !catalog.quiz.courtesyMarkers.includes(part));
  return parts.filter(part => !hasContent || !catalog.quiz.courtesyMarkers.includes(part));
};
export function confusableLearningWords(left: Word, right: Word, catalog = defaultCatalog): boolean {
  if (left.id === right.id || normalized(left.surface) === normalized(right.surface) || reading(left.audioText ?? left.kana) === reading(right.audioText ?? right.kana)) return true;
  if (meanings(left, catalog).some(meaning => meanings(right, catalog).includes(meaning))) return true;
  const spellings = (word: Word) => [normalized(word.surface), reading(word.kana), reading(word.audioText ?? word.kana)];
  return catalog.quiz.equivalent.some(group => {
    const keys = group.map(reading);
    return spellings(left).some(key => keys.includes(key)) && spellings(right).some(key => keys.includes(key));
  });
}

// Stable across GET/reload and independent of the learner's SRS state.
export function learningWordChoices(course: Course, route: GuidedLesson, step: Extract<LearningStep, { kind: 'word-practice' }>): string[] {
  const target = course.words.find(word => word.id === step.wordId);
  if (!target || !target.lessonIds.includes(route.lessonId) || target.reviewStatus === 'draft') throw new Error('Missing quiz target.');
  const catalog = catalogFor(course);
  const wrongIds = catalog.quiz.choices[target.id];
  if (wrongIds?.length !== 3) throw new Error(`Missing prepared quiz choices: ${route.lessonId}/${step.wordId}`);
  const selected = [target];
  for (const id of wrongIds) {
    const candidate = course.words.find(word => word.id === id);
    if (!candidate || candidate.reviewStatus === 'draft' || candidate.kind !== target.kind || selected.some(word => confusableLearningWords(word, candidate, catalog))) throw new Error(`Invalid prepared quiz choice: ${step.wordId}/${id}`);
    selected.push(candidate);
  }
  // The target position varies by question, without rerandomizing a saved question.
  let hash = 2166136261;
  for (const char of step.id) hash = Math.imul(hash ^ char.charCodeAt(0), 16777619);
  const offset = (hash >>> 0) % 4;
  return [...selected.slice(offset), ...selected.slice(0, offset)].map(word => word.id);
}
