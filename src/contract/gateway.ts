/**
 * FrontendGateway — UI 与整机能力之间的唯一规范 seam（契约 §6.1）。
 *
 * FE-01 只建立 read / observe：React UI 与 WorkspaceSession 只允许调用 read；
 * 本票据不得调用 prepare、apply 或 SensitiveRevealQuery（票据验收项）。
 * prepare / apply 将由 FE-04 在本接口上扩展，mock 与真实 adapter 必须继续
 * 复用同一行为契约（tests/contract/frontend-gateway-contract.ts）。
 */
import type { Query, ReadResult, SnapshotFor, Subscription, WorkspaceEvent } from './types';

export interface FrontendGateway {
  /** 只读；成功返回本次事实及 revision，失败返回稳定原因与恢复动作 */
  read<Q extends Query>(query: Q): Promise<ReadResult<SnapshotFor<Q>>>;

  /**
   * 订阅失效事件。返回解除订阅函数。
   * 事件只通知“失效或进度已更新”，消费方随后通过 read 取得可读事实。
   * adapter 必须先建立 listener，再允许调用方执行初始 read（由 WorkspaceSession 保证顺序）。
   */
  observe(subscription: Subscription, listener: (event: WorkspaceEvent) => void): () => void;
}
