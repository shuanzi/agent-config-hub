import type { MockAsset } from './types';

export type B2SortDirection = 'asc' | 'desc';
export type B2PageSize = 20 | 50 | 100;

export interface B2ListControls {
  sortDirection: B2SortDirection;
  pageSize: B2PageSize;
  page: number;
}

export interface B2Page<T> {
  items: T[];
  page: number;
  pageSize: B2PageSize;
  totalItems: number;
  totalPages: number;
}

const nameCollator = new Intl.Collator('zh-CN', {
  numeric: true,
  sensitivity: 'base',
});

export function createB2ListControls(): B2ListControls {
  return { sortDirection: 'asc', pageSize: 20, page: 1 };
}

export function withB2Criteria(
  controls: B2ListControls,
  patch: Partial<Omit<B2ListControls, 'page'>>,
): B2ListControls {
  return { ...controls, ...patch, page: 1 };
}

export function sortB2ItemsByNameStable<T extends { name: string }>(
  items: readonly T[],
  direction: B2SortDirection,
): T[] {
  return items
    .map((item, index) => ({ item, index }))
    .sort((left, right) => {
      const compared = nameCollator.compare(left.item.name, right.item.name);
      if (compared === 0) return left.index - right.index;
      return direction === 'asc' ? compared : -compared;
    })
    .map(({ item }) => item);
}

export function paginateB2Items<T>(
  items: readonly T[],
  requestedPage: number,
  pageSize: B2PageSize,
): B2Page<T> {
  const totalItems = items.length;
  const totalPages = Math.max(1, Math.ceil(totalItems / pageSize));
  const page = Math.min(totalPages, Math.max(1, Math.trunc(requestedPage) || 1));
  const start = (page - 1) * pageSize;
  return {
    items: items.slice(start, start + pageSize),
    page,
    pageSize,
    totalItems,
    totalPages,
  };
}

export function searchB2Assets<
  T extends Pick<MockAsset, 'name' | 'type' | 'agent' | 'scope' | 'project' | 'description'>,
>(assets: readonly T[], query: string): T[] {
  const normalized = query.trim().toLocaleLowerCase();
  if (normalized.length === 0) return [...assets];
  return assets.filter((asset) =>
    `${asset.name} ${asset.type} ${asset.agent} ${asset.scope} ${asset.project} ${asset.description}`
      .toLocaleLowerCase()
      .includes(normalized),
  );
}

export type B2ChangeMode = 'edit' | 'create' | 'convert' | 'install';

export function changedB2FileNames(
  asset: Pick<MockAsset, 'files'>,
  drafts: Readonly<Record<string, string>>,
  mode: B2ChangeMode,
): string[] {
  if (mode !== 'edit') return asset.files.map((file) => file.name);
  return asset.files
    .filter((file) => {
      const draft = drafts[file.name];
      return draft !== undefined && draft !== file.content;
    })
    .map((file) => file.name);
}

export function countB2ChangedFiles(
  asset: Pick<MockAsset, 'files'>,
  drafts: Readonly<Record<string, string>>,
  mode: B2ChangeMode,
): number {
  return changedB2FileNames(asset, drafts, mode).length;
}

export function firstB2ChangedFileName(
  asset: Pick<MockAsset, 'files'>,
  drafts: Readonly<Record<string, string>>,
  mode: B2ChangeMode,
): string {
  return changedB2FileNames(asset, drafts, mode)[0] ?? asset.files[0]?.name ?? '';
}

export function applyB2DraftsToAssets<T extends MockAsset>(
  assets: readonly T[],
  assetId: string,
  drafts: Readonly<Record<string, string>>,
): T[] {
  return assets.map((asset) => {
    if (asset.id !== assetId) return asset;
    return {
      ...asset,
      files: asset.files.map((file) => {
        const content = drafts[file.name];
        return content === undefined ? file : { ...file, content, changed: false };
      }),
    } as T;
  });
}

/** selected Skill 的启用预览只修改本次 Mock 会话快照，阻断目标保持不可切换。 */
export function toggleB2SkillTargetEnabled<T extends MockAsset>(
  assets: readonly T[],
  assetId: string,
  agent: string,
): T[] {
  return assets.map((asset) => {
    if (asset.id !== assetId || asset.type !== 'Skills') return asset;
    return {
      ...asset,
      agentTargets: asset.agentTargets?.map((target) =>
        target.agent === agent && target.status !== 'blocked'
          ? { ...target, enabled: !(target.enabled ?? target.status === 'recognized') }
          : target,
      ),
    } as T;
  });
}

export function controlsEnabledFromSearch(search: string): boolean {
  return new URLSearchParams(search).get('controls') === '1';
}
