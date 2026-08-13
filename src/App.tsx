import type { ReadOnlyWorkbenchSession } from './session/ReadOnlyWorkbenchSession';
import { ReadOnlyWorkbench } from './ui/ReadOnlyWorkbench';

/** FE-01 正式入口：只读 workbench；不渲染 legacy Hook 或任何写入控件。 */
export function App({ session }: { session: ReadOnlyWorkbenchSession }) {
  return <ReadOnlyWorkbench session={session} />;
}
