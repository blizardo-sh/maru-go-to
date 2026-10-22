import { createRoot } from 'react-dom/client';
import './styles.css';

const prototype = import.meta.env.DEV && new URLSearchParams(location.search).get('prototype') === 'compact-ux';
if (prototype) {
  const { CompactStudyPrototype } = await import('./prototype/CompactStudyPrototype');
  createRoot(document.getElementById('root')!).render(<CompactStudyPrototype />);
} else {
  const { App } = await import('./App');
  createRoot(document.getElementById('root')!).render(<App />);
}
