import { booksFor, lessonBookId, starterBookId } from '../shared/books';
import type { Course } from '../shared/types';

export interface BookPlace { page: number; lessonId?: string }
export interface BookNavigation { bookId: string; places: Record<string, BookPlace> }
const key = (owner: string) => `japanese-books-v1:${owner}`;
export function readBookNavigation(owner: string, course: Course): BookNavigation {
  const fallback = { bookId: starterBookId, places: {} };
  try {
    const value = JSON.parse(localStorage.getItem(key(owner)) ?? 'null') as BookNavigation | null;
    if (!value || !booksFor(course).some(book => book.id === value.bookId)) return fallback;
    const places: Record<string, BookPlace> = {};
    for (const book of booksFor(course)) {
      const place = value.places?.[book.id];
      if (place && Number.isSafeInteger(place.page) && place.page >= 0) places[book.id] = {
        page: place.page,
        ...(course.lessons.some(lesson => lesson.id === place.lessonId && lessonBookId(lesson) === book.id) ? { lessonId: place.lessonId } : {}),
      };
    }
    return { bookId: value.bookId, places };
  } catch { return fallback; }
}
export function saveBookNavigation(owner: string, navigation: BookNavigation) {
  // Navigation is optional local convenience; learning acknowledgements use the durable outbox.
  try { localStorage.setItem(key(owner), JSON.stringify(navigation)); } catch { /* The current in-memory place remains usable. */ }
}
