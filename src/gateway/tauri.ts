/**
 * TauriFrontendGateway — 生产 FrontendGateway adapter（ARC-02b/ARC-02c）。
 *
 * 唯一依赖 Tauri frontend package 的模块。职责：
 * - read：构造 wire envelope（requestId 仅用于脱敏关联），invoke 唯一 verb
 *   command `frontend_gateway_read`，核对 envelope / wireVersion / requestId /
 *   顶层 payload tag 后转 contract 类型；任何不匹配或异常归一化为
 *   `ReadFailed(GATEWAY_UNAVAILABLE, retryRead)`，异常字符串不出本模块；
 * - observe：监听唯一 invalidation event `acm://workspace-invalidation`，
 *   核对 wireVersion 后按封闭 Subscription 过滤转发；返回 unlisten。
 *
 * wire 类型只来自 src/gateway/wire/gateway-wire.ts（Rust export-wire 生成的
 * 受管产物）；contract 类型只来自 src/contract。UI 其余部分零改动。
 */
import { invoke } from '@tauri-apps/api/core';
import { listen, type UnlistenFn } from '@tauri-apps/api/event';
import type { FrontendGateway } from '../contract/gateway';
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

export function createTauriGateway(): FrontendGateway {
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

    observe(subscription: Subscription, listener: (event: WorkspaceEvent) => void): () => void {
      let disposed = false;
      let unlisten: UnlistenFn | null = null;
      // listen 注册在 observe 返回前已发起；harness/生产事件都在 listener
      // 建立后才可能到达（事件丢失/重复本就只造成额外 read）。
      const pending = listen<WorkspaceEventEnvelope>(INVALIDATION_EVENT, (message) => {
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
      void pending.then((fn) => {
        if (disposed) {
          fn();
        } else {
          unlisten = fn;
        }
      });
      return () => {
        disposed = true;
        unlisten?.();
      };
    },
  };
}
