import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { DragDropProvider } from '@dnd-kit/react';
import { useSortable } from '@dnd-kit/react/sortable';

const client = new QueryClient();

function Token() {
  const { ref } = useSortable({ id: 'family', index: 0 });
  return <button ref={ref}><ruby>家族<rt>かぞく</rt></ruby></button>;
}

const root = document.getElementById('root');
if (!root) throw new Error('Missing probe root');
createRoot(root).render(
  <BrowserRouter><QueryClientProvider client={client}>
    <main><h1>Stack compatibility probe</h1><DragDropProvider><Token /></DragDropProvider></main>
  </QueryClientProvider></BrowserRouter>,
);
