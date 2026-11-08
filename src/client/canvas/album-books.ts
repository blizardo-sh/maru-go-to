import type { Textbook } from '@app/shared/books';
import { unitCountLabel } from '@app/shared/books';
import { bookRows } from './album-book';
import type { StudyAction, StudySurface } from './study-surface';

export function renderBookShelf(surface: StudySurface, books: Textbook[], selected: string, state: { offset: number }, options: {
  safe: (action: StudyAction) => StudyAction; changed: () => void; choose: (id: string) => void; close: () => void;
}) {
  bookRows(surface, 'Выбрать учебник', books.map(book => ({
    id: `choose-book:${book.id}`, text: `${book.title}\n${unitCountLabel(book)}${book.id === selected ? ' · Выбран' : ''}`,
    selected: book.id === selected, run: () => options.choose(book.id),
  })), state, { ...options, back: options.close, centerAction: { id: 'books-close', text: 'Закрыть', run: options.close } });
}
