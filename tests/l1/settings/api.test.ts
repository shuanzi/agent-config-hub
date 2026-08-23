import { describe, expect, it, vi, beforeEach } from 'vitest';

const mockInvoke = vi.fn();

vi.mock('@tauri-apps/api/core', () => ({
  invoke: mockInvoke,
}));

async function loadSettingsApi() {
  const mod = await import('../../../src/lib/api/settings');
  return mod;
}

describe('settings API wrappers', () => {
  beforeEach(() => {
    mockInvoke.mockReset();
  });

  it('setSyncMethod invokes the dedicated single-field command', async () => {
    mockInvoke.mockResolvedValue(undefined);
    const api = await loadSettingsApi();
    await api.setSyncMethod('symlink');
    expect(mockInvoke).toHaveBeenCalledWith('set_sync_method_command', { method: 'symlink' });
  });
});
