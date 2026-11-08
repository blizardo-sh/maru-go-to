import type { Course } from '../shared/types';

/** A learner projection, not an authored publication: grading and provenance stay on the server. */
export function learnerCourse(course: Course): Course {
  const copy: Course & { sourceImports?: unknown } = {
    ...course,
    words: course.words.map(word => ({ ...word, sourceRefs: [] })),
    forms: course.forms.map(form => ({ ...form, sourceRefs: [] })),
    ...(course.meanings ? { meanings: course.meanings.map(meaning => ({ ...meaning, sourceRefs: [] })) } : {}),
    // Authored records have already been merged into the top-level collections by loadCourse.
    ...(course.learning ? { learning: course.learning.map(({ authored: _authored, ...route }) => route) } : {}),
  };
  delete copy.sourceImports;
  // Lesson and skill references are visible in the book and reference interfaces.
  return copy;
}
