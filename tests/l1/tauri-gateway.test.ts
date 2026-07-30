/**
 * TauriFrontendGateway observe 行为测试（L1，D1）：
 * vi.mock @tauri-apps/api/event 与 @tauri-apps/api/core，注入极小重试/重建
 * 延迟保持确定性。断言 listen 注册竞态、有界重试、降级与后台重建语义。
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { listen } from '@tauri-apps/api/event';
import type { WorkspaceEvent } from '../../src/contract/types';
import { createTauriGateway } from '../../src/gateway/tauri';
import { GATEWAY_WIRE_VERSION } from '../../src/gateway/wire/gateway-wire';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

type EventHandler = (message: { payload: unknown }) => void;
type ListenFn = (event: string, handler: EventHandler) => Promise<() => void>;

const listenMock = listen as unknown as Mock<ListenFn>;

function invalidatedMessage(): { payload: unknown } {
  return {
    payload: { wireVersion: GATEWAY_WIRE_VERSION, event: { kind: 'assetsInvalidated' } },
  };
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

async function waitFor(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) {
      return;
    }
    await sleep(1);
  }
  throw new Error('waitFor 超时：条件未满足');
}

beforeEach(() => {
  listenMock.mockReset();
});

describe('TauriFrontendGateway.observe', () => {
  it('a. 注册完成前的事件不投递，ready resolve 后正常投递，unlisten 后停止', async () => {
    let handler: EventHandler | null = null;
    let resolveRegistration!: (unlisten: () => void) => void;
    listenMock.mockImplementation(
      (_event, callback) =>
        new Promise<() => void>((resolve) => {
          handler = callback;
          resolveRegistration = resolve;
        }),
    );
    const gateway = createTauriGateway({
      observeRetryDelaysMs: [1],
      observeRebuildIntervalMs: 5,
    });
    const events: WorkspaceEvent[] = [];
    const handle = gateway.observe({ kind: 'workspace' }, (event) => events.push(event));

    // listen 已调用但注册未完成：事件不得投递
    expect(handler).not.toBeNull();
    (handler as unknown as EventHandler)(invalidatedMessage());
    expect(events).toHaveLength(0);

    // 注册完成 → ready resolve → 事件正常投递
    resolveRegistration(() => {});
    await handle.ready;
    (handler as unknown as EventHandler)(invalidatedMessage());
    expect(events).toEqual([{ kind: 'assetsInvalidated' }]);

    handle.unlisten();
    (handler as unknown as EventHandler)(invalidatedMessage());
    expect(events).toHaveLength(1);
  });

  it('b. listen 首次拒绝→重试成功→ready resolve 并补发 assetsInvalidated', async () => {
    const unlistenFn = vi.fn();
    listenMock
      .mockRejectedValueOnce(new Error('synthetic listen failure'))
      .mockResolvedValueOnce(unlistenFn);
    const gateway = createTauriGateway({
      observeRetryDelaysMs: [1, 2],
      observeRebuildIntervalMs: 1000,
    });
    const events: WorkspaceEvent[] = [];
    const handle = gateway.observe({ kind: 'workspace' }, (event) => events.push(event));

    await handle.ready;
    expect(listenMock).toHaveBeenCalledTimes(2);
    // 失败窗口内的事件可能已丢失：注册成功后补发一次失效，强制重读对账
    expect(events).toEqual([{ kind: 'assetsInvalidated' }]);

    handle.unlisten();
    expect(unlistenFn).toHaveBeenCalledTimes(1);
  });

  it('c. 持续拒绝→ready 仍 resolve（降级），后台重建成功后补发，unlisten 后重建停止', async () => {
    listenMock.mockRejectedValue(new Error('synthetic listen failure'));
    const gateway = createTauriGateway({
      observeRetryDelaysMs: [1, 2],
      observeRebuildIntervalMs: 5,
    });
    const events: WorkspaceEvent[] = [];
    const handle = gateway.observe({ kind: 'workspace' }, (event) => events.push(event));

    // 1 + 2 次重试全部失败后进入降级：ready 照常 resolve（初始 read 不依赖事件通道）
    await handle.ready;
    expect(listenMock).toHaveBeenCalledTimes(3);
    expect(events).toHaveLength(0);

    // 低频后台重建持续进行
    await waitFor(() => listenMock.mock.calls.length > 3);

    // 重建成功 → 补发 assetsInvalidated 强制重读对账
    listenMock.mockResolvedValue(() => {});
    await waitFor(() => events.length === 1);
    expect(events).toEqual([{ kind: 'assetsInvalidated' }]);

    // unlisten 后重建停止，不再发起 listen
    handle.unlisten();
    const callsAtStop = listenMock.mock.calls.length;
    await sleep(15);
    expect(listenMock.mock.calls.length).toBe(callsAtStop);
  });

  it('d. pending 期间 unlisten：迟到的注册被注销，事件不投递，无悬挂拒绝', async () => {
    let resolveRegistration!: (unlisten: () => void) => void;
    listenMock.mockImplementation(
      () =>
        new Promise<() => void>((resolve) => {
          resolveRegistration = resolve;
        }),
    );
    const gateway = createTauriGateway({
      observeRetryDelaysMs: [1],
      observeRebuildIntervalMs: 5,
    });
    const events: WorkspaceEvent[] = [];
    const handle = gateway.observe({ kind: 'workspace' }, (event) => events.push(event));

    handle.unlisten();
    const lateUnlisten = vi.fn();
    resolveRegistration(lateUnlisten);
    // unlisten 已 settle ready；迟到的注册成功只触发注销
    await handle.ready;
    await sleep(5);
    expect(lateUnlisten).toHaveBeenCalledTimes(1);
    expect(events).toHaveLength(0);
  });
});
