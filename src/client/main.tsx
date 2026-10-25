/// <reference types="vite/client" />
import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './illustrated.css';

const root = createRoot(document.getElementById('root')!);
if (import.meta.env.DEV && new URLSearchParams(location.search).get('prototype') === 'lesson-cards') {
  void import('./TextbookCards.prototype').then(({ LessonCardsPrototype }) => root.render(<LessonCardsPrototype />));
} else root.render(<App />);
