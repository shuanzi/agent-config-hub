import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';

const importRuntimeModule = (modulePath: string) => import(modulePath);

const { createAbortSignalTracker, signalExitCode } = (await importRuntimeModule(
  '../../scripts/orchestrator/verify-ticket-execution.mjs',
)) as {
  createAbortSignalTracker: (target: EventEmitter) => {
    received: () => string | null;
    dispose: () => void;
  };
  signalExitCode: (signal: string) => number;
};

describe('verify:ticket signal/abort 语义', () => {
  it('未收到信号时 tracker 保持 null', () => {
    const target = new EventEmitter();
    const tracker = createAbortSignalTracker(target);
    expect(tracker.received()).toBeNull();
    tracker.dispose();
  });

  it('记录首个到达的 SIGTERM/SIGINT 并在 dispose 后停止跟踪', () => {
    const target = new EventEmitter();
    const tracker = createAbortSignalTracker(target);
    target.emit('SIGTERM');
    expect(tracker.received()).toBe('SIGTERM');
    // 首个信号决定 aborted 语义，后续信号不覆盖
    target.emit('SIGINT');
    expect(tracker.received()).toBe('SIGTERM');
    tracker.dispose();

    const second = createAbortSignalTracker(target);
    target.emit('SIGINT');
    expect(second.received()).toBe('SIGINT');
    second.dispose();

    const third = createAbortSignalTracker(target);
    tracker.dispose();
    target.emit('SIGTERM');
    expect(third.received()).toBe('SIGTERM');
    third.dispose();
  });

  it('aborted 退出码遵循 128 + signo，不再硬编码 143', () => {
    expect(signalExitCode('SIGINT')).toBe(130);
    expect(signalExitCode('SIGTERM')).toBe(143);
    expect(signalExitCode('SIGKILL')).toBe(137);
    expect(signalExitCode('SIGHUP')).toBe(129);
  });
});
