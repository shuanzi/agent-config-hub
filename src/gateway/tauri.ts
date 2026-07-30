/**
 * TauriFrontendGateway — 生产 FrontendGateway adapter（ARC-02b/ARC-02c）。
 *
 * 唯一依赖 Tauri frontend package 的模块。职责：
 * - read：构造 wire envelope（requestId 仅用于脱敏关联），invoke 唯一 verb
 *   command `frontend_gateway_read`，核对 envelope / wireVersion / requestId /
 *   顶层 payload tag 后转 contract 类型；任何不匹配或异常归一化为
 *   `ReadFailed(GATEWAY_UNAVAILABLE, retryRead)`，异常字符串不出本模块；
 * - observe：监听唯一 invalidation event `acm://workspace-invalidation`，
 *   核对 wireVersion 后按封闭 Subscription 过滤转发。listen 注册有界重试
 *   （递增延迟），期间 ready 保持 pending 且注册完成前的事件不投递；全部
 *   失败后进入降级（ready 照常 resolve，事件通道本就允许丢失），并以低频
 *   后台重建，重建成功后向 listener 补发一次 assetsInvalidated 强制重读
 *   对账；unlisten 后注销监听并停止重建。
 *
 * wire 类型只来自 src/gateway/wire/gateway-wire.ts（Rust export-wire 生成的
 * 受管产物）；contract 类型只来自 src/contract。UI 其余部分零改动。
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { FrontendGateway, ObserveHandle } from '../contract/gateway';
import type {
  AssetType,
  IndexStatus,
  Query,
  ReadResult,
  ReasonCode,
  SnapshotFor,
  Subscription,
  WorkspaceEvent,
} from '../contract/types';
import {
  GATEWAY_WIRE_VERSION,
  type ReadRequestEnvelope,
  type ReadRequestPayload,
  type WorkspaceEventEnvelope,
} from './wire/gateway-wire';

const INVALIDATION_EVENT = 'acm://workspace-invalidation';

/** observe 时序配置（默认值面向生产；测试可注入极小延迟以保持确定性） */
export interface TauriGatewayOptions {
  /** listen 注册失败后的重试延迟（递增）；重试次数 = 数组长度（共 1+length 次尝试） */
  observeRetryDelaysMs?: readonly number[];
  /** 降级后后台重建间隔 */
  observeRebuildIntervalMs?: number;
}

const DEFAULT_RETRY_DELAYS_MS: readonly number[] = [100, 300];
const DEFAULT_REBUILD_INTERVAL_MS = 2000;

/** ARC-02c：统一归一化结果（固定文案，不含异常字符串）。 */
function gatewayUnavailable<T>(): ReadResult<T> {
  return {
    kind: 'readFailed',
    reasonCode: 'GATEWAY_UNAVAILABLE',
    message: '本地 gateway 暂时不可用，请重试。',
    recoveryAction: { kind: 'retryRead' },
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * 核对 response envelope 与顶层 payload tag，并把 snapshot 与 query 的封闭
 * 对应关系再验证一遍。任何不匹配返回 null（由调用方归一化）。
 */
function normalizeResponse<Q extends Query>(
  raw: unknown,
  requestId: string,
  queryKind: Q['kind'],
): ReadResult<SnapshotFor<Q>> | null {
  if (!isRecord(raw)) {
    return null;
  }
  if (raw.wireVersion !== GATEWAY_WIRE_VERSION || raw.requestId !== requestId) {
    return null;
  }
  const payload = raw.payload;
  if (!isRecord(payload)) {
    return null;
  }
  if (payload.kind === 'readSucceeded') {
    const snapshot = payload.snapshot;
    if (!isRecord(snapshot) || snapshot.kind !== queryKind) {
      return null;
    }
    return { kind: 'readSucceeded', snapshot: snapshot as unknown as SnapshotFor<Q> };
  }
  if (payload.kind === 'readFailed') {
    if (typeof payload.reasonCode !== 'string' || typeof payload.message !== 'string') {
      return null;
    }
    const recovery = payload.recoveryAction;
    if (recovery !== undefined && (!isRecord(recovery) || recovery.kind !== 'retryRead')) {
      return null;
    }
    return {
      kind: 'readFailed',
      reasonCode: payload.reasonCode as ReasonCode,
      message: payload.message,
      // 如实透传 core 声明的恢复动作；未声明时不发明
      ...(recovery !== undefined ? { recoveryAction: { kind: 'retryRead' as const } } : {}),
    };
  }
  return null;
}

/** 核对 event envelope 的 wireVersion 与封闭 tag；不匹配返回 null。 */
function normalizeEvent(raw: unknown): WorkspaceEvent | null {
  if (!isRecord(raw) || raw.wireVersion !== GATEWAY_WIRE_VERSION) {
    return null;
  }
  const event = raw.event;
  if (!isRecord(event)) {
    return null;
  }
  switch (event.kind) {
    case 'assetsInvalidated': {
      const assetType = event.assetType;
      if (assetType !== undefined && typeof assetType !== 'string') {
        return null;
      }
      return assetType === undefined
        ? { kind: 'assetsInvalidated' }
        : { kind: 'assetsInvalidated', assetType: assetType as AssetType };
    }
    case 'assetDriftDetected':
      return typeof event.assetId === 'string'
        ? { kind: 'assetDriftDetected', assetId: event.assetId }
        : null;
    case 'indexStatusChanged':
      return typeof event.indexStatus === 'string'
        ? {
            kind: 'indexStatusChanged',
            indexStatus: event.indexStatus as IndexStatus,
          }
        : null;
    case 'compatibilityChanged':
      return typeof event.assetId === 'string'
        ? { kind: 'compatibilityChanged', assetId: event.assetId }
        : null;
    default:
      return null;
  }
}

export function createTauriGateway(options: TauriGatewayOptions = {}): FrontendGateway {
  const retryDelaysMs = options.observeRetryDelaysMs ?? DEFAULT_RETRY_DELAYS_MS;
  const rebuildIntervalMs = options.observeRebuildIntervalMs ?? DEFAULT_REBUILD_INTERVAL_MS;
  return {
    async read<Q extends Query>(query: Q): Promise<ReadResult<SnapshotFor<Q>>> {
      const requestId = crypto.randomUUID();
      try {
        // contract Query 与 wire ReadRequestPayload 结构一一对应（同一封闭
        // tag 集合由 Rust wire DTO 事实源保证）。
        const envelope: ReadRequestEnvelope = {
          wireVersion: GATEWAY_WIRE_VERSION,
          requestId,
          payload: query as ReadRequestPayload,
        };
        const raw: unknown = await invoke('frontend_gateway_read', { request: envelope });
        return normalizeResponse(raw, requestId, query.kind) ?? gatewayUnavailable();
      } catch {
        // transport/协议异常一律归一化，不把异常字符串传给 UI。
        return gatewayUnavailable();
      }
    },

    observe(subscription: Subscription, listener: (event: WorkspaceEvent) => void): ObserveHandle {
      let disposed = false;
      /** 首次注册成功后才投递事件（注册完成前到达的事件一律丢弃） */
      let registered = false;
      let unlistenFn: UnlistenFn | null = null;
      let failedAttempts = 0;
      let rebuildTimer: ReturnType<typeof setInterval> | null = null;
      let resolveReady!: () => void;
      // ready 只 resolve、永不 reject：降级时同样 resolve（事件允许丢失，
      // 初始 read 不依赖事件通道），消费方无需 rejection 处理。
      const ready = new Promise<void>((resolve) => {
        resolveReady = resolve;
      });

      const stopRebuild = (): void => {
        if (rebuildTimer !== null) {
          clearInterval(rebuildTimer);
          rebuildTimer = null;
        }
      };

      const onRegistered = (fn: UnlistenFn): void => {
        resolveReady();
        if (disposed || registered) {
          // 注册完成前已 unlisten，或与并发成功的重建重复：立即注销
          fn();
          return;
        }
        unlistenFn = fn;
        registered = true;
        stopRebuild();
        if (failedAttempts > 0) {
          // 注册曾失败：失败窗口内的事件可能已丢失，补发一次失效强制重读
          // 对账（失效语义，不携带事实）。
          listener({ kind: 'assetsInvalidated' });
        }
      };

      const onRegisterFailed = (attempt: number): void => {
        if (disposed || registered) {
          return;
        }
        failedAttempts += 1;
        if (attempt < retryDelaysMs.length) {
          // 有界重试（递增延迟），期间 ready 保持 pending
          setTimeout(() => {
            attemptListen(attempt + 1);
          }, retryDelaysMs[attempt]);
          return;
        }
        // 全部失败：进入降级——ready 照常 resolve，低频后台重建直到成功或 unlisten
        resolveReady();
        if (rebuildTimer === null) {
          rebuildTimer = setInterval(() => {
            attemptListen(attempt);
          }, rebuildIntervalMs);
        }
      };

      const attemptListen = (attempt: number): void => {
        if (disposed || registered) {
          return;
        }
        const pending = listen<WorkspaceEventEnvelope>(INVALIDATION_EVENT, (message) => {
          if (!registered || disposed) {
            return;
          }
          const event = normalizeEvent(message.payload);
          if (event === null) {
            return;
          }
          if (
            subscription.assetType !== undefined &&
            event.kind === 'assetsInvalidated' &&
            event.assetType !== undefined &&
            event.assetType !== subscription.assetType
          ) {
            return;
          }
          listener(event);
        });
        // rejection 在此被处理，不产生未捕获拒绝
        void pending.then(onRegistered, () => {
          onRegisterFailed(attempt);
        });
      };

      attemptListen(0);

      return {
        ready,
        unlisten: () => {
          disposed = true;
          registered = false;
          stopRebuild();
          unlistenFn?.();
          // dispose 后 ready 不再有任何意义；settle 以免消费方悬挂
          resolveReady();
        },
      };
    },
  };
}
