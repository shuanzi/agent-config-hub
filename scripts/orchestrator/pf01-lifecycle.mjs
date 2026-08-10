/**
 * PF-01 L3 harness 的正常退出认证。
 *
 * 该模块只消费 test-harness 写入的临时 lifecycle 文件，以及在同一临时 sandbox
 * 内发布的退出请求 marker；不引入 IPC、窗口权限或 production bundle 行为。
 */
import { readFileSync, renameSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';

export const PF01_EXIT_REQUEST_FILENAME = 'pf01-harness-exit-request.json';
export const PF01_EXIT_FAILURE_FILENAME = 'pf01-harness-exit-failure.json';

function lifecycleFailure(message) {
  return new Error(`PF-01 harness lifecycle ${message}`);
}

function validPositiveInteger(value) {
  return Number.isSafeInteger(value) && value > 0;
}

function validHarnessIdentity(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    validPositiveInteger(value.pid) &&
    value.binary === 'agent-config-manager' &&
    value.role === 'test-harness' &&
    typeof value.normalExit === 'boolean'
  );
}

function validHarnessReference(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    validPositiveInteger(value.pid) &&
    value.binary === 'agent-config-manager' &&
    value.role === 'test-harness'
  );
}

function sameHarnessIdentity(left, right) {
  return left.pid === right.pid && left.binary === right.binary && left.role === right.role;
}

function sleep(milliseconds) {
  return new Promise((resolve) => globalThis.setTimeout(resolve, milliseconds));
}

function requiredLifecyclePath(lifecyclePath) {
  if (typeof lifecyclePath !== 'string' || lifecyclePath.length === 0) {
    throw lifecycleFailure('path missing');
  }
  return lifecyclePath;
}

function markerPath(lifecyclePath, filename) {
  return join(dirname(requiredLifecyclePath(lifecyclePath)), filename);
}

function writeAtomically(pathname, payload) {
  const temporary = `${pathname}.${globalThis.process.pid}.${Date.now()}.tmp`;
  writeFileSync(temporary, `${JSON.stringify(payload)}\n`, 'utf8');
  renameSync(temporary, pathname);
}

function readOptionalJson(pathname, missingValue, invalidMessage) {
  let raw;
  try {
    raw = readFileSync(pathname, 'utf8');
  } catch (error) {
    if (error !== null && typeof error === 'object' && error.code === 'ENOENT') return missingValue;
    throw lifecycleFailure('read failed');
  }
  try {
    return JSON.parse(raw);
  } catch {
    throw lifecycleFailure(invalidMessage);
  }
}

function validExitRequest(value) {
  return (
    validHarnessReference(value) &&
    value.schemaVersion === 1 &&
    value.kind === 'pf01-harness-exit-request' &&
    Object.keys(value).length === 5
  );
}

function validExitFailure(value) {
  return (
    value !== null &&
    typeof value === 'object' &&
    value.schemaVersion === 1 &&
    value.kind === 'pf01-harness-exit-failure' &&
    value.reason === 'normal-exit-not-established' &&
    Object.keys(value).length === 3
  );
}

export function lifecycleExitRequestPath(lifecyclePath) {
  return markerPath(lifecyclePath, PF01_EXIT_REQUEST_FILENAME);
}

export function lifecycleExitFailurePath(lifecyclePath) {
  return markerPath(lifecyclePath, PF01_EXIT_FAILURE_FILENAME);
}

/** 退出请求只能引用当前认证的 test-harness 身份。 */
export function exitRequestMatchesHarness(request, harness) {
  return validExitRequest(request) && validHarnessReference(harness) && sameHarnessIdentity(request, harness);
}

export function writeHarnessExitRequest({ lifecyclePath, harness }) {
  if (!validHarnessReference(harness)) throw lifecycleFailure('exit request identity invalid');
  writeAtomically(lifecycleExitRequestPath(lifecyclePath), {
    schemaVersion: 1,
    kind: 'pf01-harness-exit-request',
    pid: harness.pid,
    binary: harness.binary,
    role: harness.role,
  });
}

/** 缺失 marker 正常；存在但畸形或越权身份一律 fail-closed。 */
export function readHarnessExitRequest(lifecyclePath) {
  const request = readOptionalJson(lifecycleExitRequestPath(lifecyclePath), null, 'exit request invalid');
  if (request === null) return null;
  if (!validExitRequest(request)) throw lifecycleFailure('exit request invalid');
  return request;
}

/** afterSession 的失败以原子 marker 交给 onComplete，使被吞的 hook 错误仍令 WDIO 失败。 */
export function writeHarnessExitFailure(lifecyclePath) {
  writeAtomically(lifecycleExitFailurePath(lifecyclePath), {
    schemaVersion: 1,
    kind: 'pf01-harness-exit-failure',
    reason: 'normal-exit-not-established',
  });
}

export function readHarnessExitFailure(lifecyclePath) {
  const failure = readOptionalJson(lifecycleExitFailurePath(lifecyclePath), null, 'exit failure invalid');
  if (failure === null) return null;
  if (!validExitFailure(failure)) throw lifecycleFailure('exit failure invalid');
  return failure;
}

/** 原子 lifecycle 文件暂不存在时返回 null；畸形或越权身份一律 fail-closed。 */
export function readHarnessLifecycle(lifecyclePath) {
  const parsed = readOptionalJson(lifecyclePath, null, 'payload invalid');
  if (parsed === null) return null;
  if (!validHarnessIdentity(parsed)) throw lifecycleFailure('identity invalid');
  return {
    pid: parsed.pid,
    binary: parsed.binary,
    role: parsed.role,
    normalExit: parsed.normalExit,
  };
}

/**
 * 有界等待 harness lifecycle 的指定状态。调用方可传入启动时的身份，确保关闭后
 * 获得的是同一个 harness 的 normalExit attestation，而不是别的进程写入。
 */
export async function waitForHarnessLifecycleState({
  lifecyclePath,
  expectedNormalExit,
  expectedHarness,
  timeoutMs = 5000,
  pollIntervalMs = 25,
}) {
  requiredLifecyclePath(lifecyclePath);
  if (typeof expectedNormalExit !== 'boolean') throw lifecycleFailure('expected state invalid');
  if (expectedHarness !== undefined && !validHarnessIdentity({ ...expectedHarness, normalExit: false })) {
    throw lifecycleFailure('expected identity invalid');
  }
  if (!Number.isSafeInteger(timeoutMs) || timeoutMs < 0 || !Number.isSafeInteger(pollIntervalMs) || pollIntervalMs <= 0) {
    throw lifecycleFailure('wait bounds invalid');
  }

  const deadline = Date.now() + timeoutMs;
  while (Date.now() <= deadline) {
    const lifecycle = readHarnessLifecycle(lifecyclePath);
    if (lifecycle !== null) {
      if (expectedHarness !== undefined && !sameHarnessIdentity(lifecycle, expectedHarness)) {
        throw lifecycleFailure('identity mismatch');
      }
      if (lifecycle.normalExit === expectedNormalExit) return lifecycle;
    }
    if (Date.now() >= deadline) break;
    await sleep(pollIntervalMs);
  }

  throw lifecycleFailure('state timeout');
}
