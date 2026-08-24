import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App } from './App';
import './ui/workbench.css';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      refetchOnWindowFocus: false,
    },
  },
});

const query = new URLSearchParams(window.location.search);

async function bootstrap(): Promise<void> {
  if (import.meta.env.DEV && query.get('prototype') === 'full-ui') {
    const { FullUiMock } = await import('./prototypes/full-ui-mock/FullUiMock');
    const container = document.getElementById('root');
    if (container === null) {
      throw new Error('缺少 #root 挂载点');
    }
    createRoot(container).render(
      <StrictMode>
        <QueryClientProvider client={queryClient}>
          <FullUiMock />
        </QueryClientProvider>
      </StrictMode>,
    );
    return;
  }

  const container = document.getElementById('root');
  if (container === null) {
    throw new Error('缺少 #root 挂载点');
  }
  createRoot(container).render(
    <StrictMode>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </StrictMode>,
  );
}

void bootstrap();
