import type { LearningExample } from './learning';
export interface TaskOption { id: string; text: string }
interface TaskBase { id: string; titleRu: string; instructionRu: string; canDoIds: number[] }
export type LearningTask = TaskBase & (
  | { kind: 'reading' | 'listening'; layout?: 'vertical-menu'; passage: LearningExample[]; questionRu: string; options: TaskOption[]; acceptedAnswers: string[]; explanationRu: string }
  | { kind: 'production'; response: 'spoken' | 'written'; supports: string[]; model: LearningExample; rubric: string[] }
);
export interface TaskEvidence { taskId: string; basis: 'objective' | 'self-assessed'; correct?: boolean; answer?: string; rating?: 'achieved' | 'with-help' | 'retry'; attempted?: boolean }
export const normalizeTaskAnswer = (answer: string) => answer.normalize('NFKC').trim().replace(/\s+/g,' ').toLocaleLowerCase('ja');
export function checkTaskAnswer(task: Extract<LearningTask,{kind:'reading'|'listening'}>, answer: string): boolean {
  return task.acceptedAnswers.some(value => normalizeTaskAnswer(value) === normalizeTaskAnswer(answer));
}
