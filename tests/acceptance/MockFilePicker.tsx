import { useEffect, useState } from 'react';
import { FocusedDialog } from '../../src/components/workbench/FocusedDialog';
import { setDialogTestAdapter } from '../../src/lib/dialog';

/** Browser acceptance only: explicit select/cancel with no native filesystem access. */
export function MockFilePicker() {
  const [request, setRequest] = useState<{
    directory: boolean;
    resolve: (path: string | null) => void;
  } | null>(null);
  useEffect(() => {
    setDialogTestAdapter(
      (options) =>
        new Promise((resolve) => setRequest({ directory: !!options?.directory, resolve })),
    );
    return () => setDialogTestAdapter(undefined);
  }, []);
  if (!request) return null;
  const path = request.directory
    ? '/workspaces/acceptance-project'
    : '/fixtures/acceptance-skill.zip';
  const finish = (result: string | null) => {
    request.resolve(result);
    setRequest(null);
  };
  return (
    <FocusedDialog
      open
      title="模拟文件选择"
      onClose={() => finish(null)}
      footer={
        <>
          <button className="skill-button" onClick={() => finish(null)}>
            取消选择
          </button>
          <button className="skill-button primary" onClick={() => finish(path)}>
            选择样例{request.directory ? '目录' : '文件'}
          </button>
        </>
      }
    >
      <p>浏览器验收使用模拟路径；不会访问或修改真实文件。</p>
      <code>{path}</code>
    </FocusedDialog>
  );
}
