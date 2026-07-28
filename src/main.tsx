import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { createGateway } from './gateway';
import { WorkspaceSession } from './session/WorkspaceSession';
import { App } from './App';
import './ui/workbench.css';

async function bootstrap(): Promise<void> {
  const gateway = await createGateway();
  const session = new WorkspaceSession(gateway);
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

void bootstrap();
