import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './illustrated.css';

const root = createRoot(document.getElementById('root')!);
if (import.meta.env.DEV && new URLSearchParams(location.search).get('prototype') === 'study-cards') {
  void import('./prototype/study-cards/StudyCardsPrototype').then(({ StudyCardsPrototype }) => root.render(<StudyCardsPrototype />));
} else root.render(<App />);
