import { beforeEach, describe, expect, it, vi } from 'vitest';
const invoke = vi.hoisted(() => vi.fn());
vi.mock('../../../src/lib/api/invoke', () => ({ invoke }));
import * as api from '../../../src/lib/api/nativeSubagents';

describe('原生 Subagent command 边界', () => {
  beforeEach(() => invoke.mockReset());
  it('扫描保留完整配置上下文', async () => {
    const context = { kind: 'project' as const, projectId: 'same-name-but-unique-id' };
    await api.scanNativeSubagents(context);
    expect(invoke).toHaveBeenCalledWith('scan_native_subagents', { context });
  });
  it('读取和接管使用后端 identity，不从名称推导来源', async () => {
    await api.readNativeSubagent('opaque-identity');
    expect(invoke).toHaveBeenLastCalledWith('read_native_subagent', {
      identity: 'opaque-identity',
    });
    await api.adoptNativeSubagent('opaque-identity', 'seen-hash', true);
    expect(invoke).toHaveBeenLastCalledWith('adopt_native_subagent', {
      identity: 'opaque-identity',
      expectedHash: 'seen-hash',
      confirmSymlink: true,
    });
  });
  it('编辑保留原生源码并携带读取时摘要', async () => {
    const content = 'name = "reviewer"\n# Keep comment\ncustom = true\n';
    await api.saveNativeSubagent('codex-global', content, 'original');
    expect(invoke).toHaveBeenCalledWith('save_native_subagent', {
      identity: 'codex-global',
      content,
      expectedHash: 'original',
    });
  });
  it('启停、卸载和备份删除均携带各自摘要，不再传递四 Agent 开关', async () => {
    await api.setNativeSubagentEnabled('project-definition', false, 'original');
    expect(invoke).toHaveBeenLastCalledWith('set_native_subagent_enabled', {
      identity: 'project-definition',
      enabled: false,
      expectedHash: 'original',
    });
    await api.uninstallNativeSubagent('project-definition', 'original');
    expect(invoke).toHaveBeenLastCalledWith('uninstall_native_subagent', {
      identity: 'project-definition',
      expectedHash: 'original',
    });
    await api.deleteNativeSubagentBackup('backup-opaque-id', 'backup-content-hash');
    expect(invoke).toHaveBeenLastCalledWith('delete_native_subagent_backup', {
      backupId: 'backup-opaque-id',
      expectedContentHash: 'backup-content-hash',
    });
  });
});
