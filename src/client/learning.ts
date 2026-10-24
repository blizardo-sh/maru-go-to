import type { TrainingContext, Word } from '../shared/types';
import type { Snapshot, StudySource } from './types';

export function sourceKey(source: StudySource): string {
  return source.kind === 'topic' ? `topic:${source.topicId}:${source.sectionId ?? ''}` : source.kind === 'lesson' || source.kind === 'guided' ? `${source.kind}:${source.lessonId}` : source.kind === 'list' ? `list:${source.listId}` : source.kind === 'construction' ? `construction:${source.skillId}:${source.mode}` : source.kind;
}

export function trainingContext(source: StudySource): TrainingContext {
  return source.kind === 'topic' ? { topicId: source.topicId, ...(source.sectionId ? { sectionId: source.sectionId } : {}) } : source.kind === 'lesson' || source.kind === 'guided' ? { lessonId: source.lessonId } : source.kind === 'list' ? { listId: source.listId } : source.kind === 'counters' ? { counters: true } : source.kind === 'construction' ? { skillId: source.skillId, constructionMode: source.mode } : {};
}

export function studyWord(word: Word): boolean {
  return word.reviewStatus !== 'draft' && !!word.kana && word.segments.map(segment => segment.surface).join('') === word.surface && word.segments.map(segment => segment.reading ?? segment.surface).join('') === word.kana;
}

export function editorWordIds(data: Snapshot, source: StudySource): Set<string> {
  const ids = new Set(data.progress.introducedWordIds);
  if (source.kind === 'lesson' || source.kind === 'guided') for (const word of data.course.words) { if (word.lessonIds.includes(source.lessonId)) ids.add(word.id); }
  if (source.kind === 'list') for (const word of data.lists.find(list => list.id === source.listId)?.words ?? []) { if (studyWord(word)) ids.add(word.id); }
  return ids;
}
