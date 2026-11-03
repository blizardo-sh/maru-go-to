import { defaultCatalog } from './catalog';

// Legacy fixture export. Runtime questions use the catalog of their publication.
export const preparedLearningChoices: ReadonlyMap<string, readonly string[]> = new Map(Object.entries(defaultCatalog.quiz.choices));
