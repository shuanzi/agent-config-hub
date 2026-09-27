import { createRoot } from 'react-dom/client';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { App, type InitialNavigation } from '../../src/App';
import '../../src/ui/workbench.css';
import '../../src/ui/polished.css';
import { MockFilePicker } from '../acceptance/MockFilePicker';
import { setupAcceptanceFixture } from '../acceptance/browser-fixture';
import { setupMockInvoke } from './mock-invoke';

setupMockInvoke();
setupAcceptanceFixture();

const params = new URLSearchParams(location.search);
const page = params.get('page');
const initialNavigation: InitialNavigation =
  params.get('fixture') === 'polished'
    ? {
        view:
          page === 'instructions' || page === 'subagents' || page === 'settings' ? page : 'skills',
        subView: params.get('tab') === 'discovery' ? 'discovery' : 'installed',
        narrowStep:
          params.get('step') === 'context'
            ? 'context'
            : params.get('step') === 'type'
              ? 'type'
              : 'content',
      }
    : {};

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: Infinity,
      retry: false,
      refetchOnWindowFocus: false,
    },
  },
});

const container = document.getElementById('root');
if (container === null) {
  throw new Error('缺少 #root 挂载点');
}

createRoot(container).render(
  <QueryClientProvider client={queryClient}>
    <App initialNavigation={initialNavigation} />
    {params.get('fixture') === 'polished' && <MockFilePicker />}
  </QueryClientProvider>,
);
