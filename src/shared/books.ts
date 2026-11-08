import type { Course, Lesson } from './types';

export interface Textbook {
  id: string;
  title: string;
  shortTitle: string;
  level: 'A1' | 'A2' | 'A2/B1';
  order: number;
  unit: 'lesson' | 'topic';
  unitCount: number;
  canDoCount: number;
}
export const starterBookId = 'marugoto.starter-a1';
export const marugotoBooks: Textbook[] = [
  { id: starterBookId, title: 'Marugoto Starter A1', shortTitle: 'A1', level: 'A1', order: 0, unit: 'lesson', unitCount: 18, canDoCount: 50 },
  { id: 'marugoto.elementary1-a2', title: 'Marugoto Elementary 1 · A2-1', shortTitle: 'A2-1', level: 'A2', order: 1, unit: 'lesson', unitCount: 18, canDoCount: 53 },
  { id: 'marugoto.elementary2-a2', title: 'Marugoto Elementary 2 · A2-2', shortTitle: 'A2-2', level: 'A2', order: 2, unit: 'lesson', unitCount: 18, canDoCount: 49 },
  { id: 'marugoto.pre-intermediate-a2b1', title: 'Marugoto Pre-Intermediate · A2/B1', shortTitle: 'A2/B1', level: 'A2/B1', order: 3, unit: 'topic', unitCount: 9, canDoCount: 44 },
];
export const booksFor = (course: Pick<Course, 'books'>): Textbook[] => course.books ?? [marugotoBooks[0]!];
export const lessonBookId = (lesson: Pick<Lesson, 'bookId'>) => lesson.bookId ?? starterBookId;
export const bookForLesson = (course: Pick<Course, 'books'>, lesson: Pick<Lesson, 'bookId'>) => booksFor(course).find(book => book.id === lessonBookId(lesson))!;
export const unitLabel = (book: Textbook) => book.unit === 'topic' ? 'Тема' : 'Урок';
export const unitCountLabel = (book: Textbook) => `${book.unitCount} ${book.unit === 'topic' ? 'тем' : 'уроков'}`;
export const canDoKey = (bookId: string, number: number) => `${bookId}.cando.${number}`;
export function lessonAvailability(course: Pick<Course, 'learning'>, lesson: Lesson): 'full' | 'vocabulary' | 'preparing' {
  return lesson.availability ?? (course.learning?.some(route => route.lessonId === lesson.id) ? 'full' : lesson.readiness.vocabulary === 'missing' ? 'preparing' : 'vocabulary');
}

export function bookResources(bookId: string): {title: string; url: string}[] {
  if(bookId==='marugoto.elementary1-a2')return [
    {title:'Официальные видеодиалоги A2-1',url:'https://a2.marugotoweb.jp/en/conversation/'},
    {title:'Challenge Drama · A2-1',url:'https://a2.marugotoweb.jp/en/challenge_drama/'},
  ];
  if(bookId==='marugoto.elementary2-a2')return [{title:'Официальная практика и видео A2-2',url:'https://a2-2.marugotoweb.jp/en/'}];
  if(bookId==='marugoto.pre-intermediate-a2b1')return [{title:'Официальные онлайн-курсы Marugoto',url:'https://marugoto.jpf.go.jp/en/e-learning/'}];
  return [];
}
