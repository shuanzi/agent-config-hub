import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createGateway } from './gateway';
import { ReadOnlyWorkbenchSession } from './session/ReadOnlyWorkbenchSession';
import { App } from './App';
import './ui/workbench.css';

const query = new URLSearchParams(window.location.search);

/**
 * Throwaway 原型入口：只在显式的开发 query 下挂载。
 * 生产默认路径继续使用正式的 FrontendGateway + WorkspaceSession。
 */
if (import.meta.env.DEV && query.get('prototype') === 'full-ui') {
  const { FullUiMock } = await import('./prototypes/full-ui-mock/FullUiMock');
  const container = document.getElementById('root');
  if (container === null) {
    throw new Error('缺少 #root 挂载点');
  }
  createRoot(container).render(
    <StrictMode>
      <FullUiMock />
    </StrictMode>,
  );
} else {
  void bootstrap();
}

async function bootstrap(): Promise<void> {
  const gateway = await createGateway();
  const session = new ReadOnlyWorkbenchSession(gateway);
  const container = document.getElementById('root');
  if (container === null) {
    throw new Error('缺少 #root 挂载点');
  }
  createRoot(container).render(
    <StrictMode>
      <App session={session} />
    </StrictMode>,
  );
}
