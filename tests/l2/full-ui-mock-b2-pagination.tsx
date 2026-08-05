import { createRoot } from 'react-dom/client';
import { b2Assets, createB2NativeAsset } from '../../src/prototypes/full-ui-mock/b2-data';
import { FullUiMock } from '../../src/prototypes/full-ui-mock/FullUiMock';

const paginationAssets = [
  ...b2Assets,
  ...Array.from({ length: 13 }, (_, index) =>
    createB2NativeAsset({
      type: 'Skills',
      name: `zz-pagination-${String(index + 1).padStart(2, '0')}`,
      agent: 'Codex',
      scope: '项目',
      project: 'ReinventedWheelAgent',
      mode: '新建',
    }),
  ),
];

const root = document.getElementById('root');
if (root === null) throw new Error('Missing pagination fixture root');

createRoot(root).render(<FullUiMock initialB2Assets={paginationAssets} />);
