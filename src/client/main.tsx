import { createRoot } from 'react-dom/client';
import { App } from './App';
import './styles.css';
import './illustrated.css';

const root = createRoot(document.getElementById('root')!);
if (import.meta.env.DEV && new URLSearchParams(location.search).get('prototype') === 'layout-system') {
  void import('./prototype/layoutsystem/LayoutPrototype').then(({ LayoutPrototype }) => root.render(<LayoutPrototype />));
} else root.render(<App />);
