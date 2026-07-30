/**
 * PF-01 catalog-browse 合成目录生成器（FE-01 性能 fixture）。
 *
 * 事实来源：performance/descriptors/pf-01.catalog-browse.json。按 descriptor
 * seed（20260727）以 mulberry32 PRNG 确定性生成：同一 seed + profile 两次
 * 生成逐项相等。只产生合成名称、合成展示路径与不可执行占位文本；约 1/6
 * 资产的源码含占位敏感值，遮蔽发生在 gateway 边界（mock 调用
 * fixtures/sensitive-masking.ts），本模块输出的 rawSource 不离开 gateway。
 */
import type {
  AgentId,
  Anomaly,
  AssetDetail,
  AssetListFilters,
  AssetListQuery,
  AssetScope,
  AssetStatusFilter,
  AssetSummary,
  AssetType,
  InspectorData,
  SensitiveSegmentRef,
} from '../contract/types';

/** descriptor seed（与 performance/descriptors/pf-01.catalog-browse.json 的 seed 一致） */
export const PF01_SEED = 20260727;

export type PerfProfile = 'representative' | 'stress';

export const PF01_PROFILE_SIZES: Record<PerfProfile, number> = {
  representative: 120,
  stress: 2000,
};

/** 一条合成资产记录：摘要 + 详情 + 检查器 + 原始源码（gateway 内部） */
export interface PerfAssetRecord {
  summary: AssetSummary;
  detail: AssetDetail;
  inspector: InspectorData;
  statuses: AssetStatusFilter[];
  rawSource: string;
  sensitiveSegments: Array<Pick<SensitiveSegmentRef, 'segmentId' | 'fileId'>>;
}

export interface PerfCatalog {
  profile: PerfProfile;
  assets: PerfAssetRecord[];
}

const ASSET_TYPES: AssetType[] = ['skill', 'longTermInstruction', 'subagent', 'hook'];
const AGENTS: AgentId[] = ['claude-code', 'codex', 'gemini-cli', 'opencode'];

const STATUS_COMBINATIONS: Array<{
  compatibility: AssetDetail['compatibility'];
  statuses: AssetStatusFilter[];
}> = [
  { compatibility: 'verifiedWritable', statuses: ['editable', 'normal'] },
  { compatibility: 'verifiedWritable', statuses: ['editable', 'overridden'] },
  { compatibility: 'recognizedReadOnly', statuses: ['readOnly', 'normal'] },
  { compatibility: 'recognizedReadOnly', statuses: ['readOnly', 'conflict'] },
  { compatibility: 'incompatibleBlocked', statuses: ['incompatible', 'drift'] },
];

const SUMMARY_WORDS = [
  'deterministic',
  'synthetic',
  'catalog',
  'browse',
  'workspace',
  'fixture',
  'read-only',
  'gateway',
  'session',
  'tracing',
];

/** mulberry32：小而确定的 PRNG，足以驱动合成形状 */
function mulberry32(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rand: () => number, items: readonly T[]): T {
  return items[Math.floor(rand() * items.length)];
}

function pad4(index: number): string {
  return String(index).padStart(4, '0');
}

function buildSummaryText(rand: () => number): string {
  const target = 24 + Math.floor(rand() * (140 - 24 + 1));
  const words: string[] = [];
  let length = 0;
  while (length < target) {
    const word = pick(rand, SUMMARY_WORDS);
    words.push(word);
    length += word.length + 1;
  }
  return words.join(' ').slice(0, target);
}

function buildRawSource(
  rand: () => number,
  name: string,
  assetType: AssetType,
  index: number,
): string {
  const lineCount = 30 + Math.floor(rand() * (120 - 30 + 1));
  const lines: string[] = [
    `# ${name}`,
    '',
    `合成 ${assetType} 源码（PF-01，不可执行占位文本）。`,
    '',
    buildSummaryText(rand),
    '',
  ];
  // 约 1/6 资产携带占位敏感值；占位标记分段拼接，避免字面值进入源文件
  if (index % 6 === 0) {
    const placeholder = ['SYNTHETIC-SECRET', `pf01-${pad4(index)}`].join('-');
    lines.push(`api_key = "${placeholder}"`, '');
  }
  while (lines.length < lineCount) {
    lines.push(`- ${pick(rand, SUMMARY_WORDS)} ${pick(rand, SUMMARY_WORDS)} ${pad4(lines.length)}`);
  }
  return lines.join('\n');
}

function buildAgents(rand: () => number, index: number): AgentId[] {
  const count = 1 + Math.floor(rand() * AGENTS.length);
  const rotated = AGENTS.slice(index % AGENTS.length).concat(
    AGENTS.slice(0, index % AGENTS.length),
  );
  return rotated.slice(0, count).sort();
}

function buildAnomalies(statuses: AssetStatusFilter[]): Anomaly[] {
  const anomalies: Anomaly[] = [];
  if (statuses.includes('readOnly')) {
    anomalies.push({ kind: 'readOnly', reasonCode: 'READ_ONLY_POLICY', message: '合成只读策略' });
  }
  if (statuses.includes('incompatible')) {
    anomalies.push({
      kind: 'incompatible',
      reasonCode: 'INCOMPATIBLE_STRUCTURE',
      message: '合成不兼容结构',
    });
  }
  if (statuses.includes('conflict')) {
    anomalies.push({ kind: 'conflict', reasonCode: 'MERGE_CONFLICT', message: '合成冲突标记' });
  }
  if (statuses.includes('drift')) {
    anomalies.push({ kind: 'drift', reasonCode: 'EXTERNAL_CHANGE', message: '合成漂移标记' });
  }
  return anomalies;
}

/** 按 descriptor 规则确定性生成整个目录 */
export function buildPerfCatalog(profile: PerfProfile): PerfCatalog {
  const rand = mulberry32(PF01_SEED + (profile === 'stress' ? 1 : 0));
  const total = PF01_PROFILE_SIZES[profile];
  const assets: PerfAssetRecord[] = [];

  for (let index = 0; index < total; index += 1) {
    const assetType = ASSET_TYPES[index % ASSET_TYPES.length];
    const name = `pf01-${assetType}-${pad4(index)}`;
    const scope: AssetScope = rand() < 0.5 ? 'global' : 'project';
    const agents = buildAgents(rand, index);
    const combination = STATUS_COMBINATIONS[index % STATUS_COMBINATIONS.length];
    const projectName = `pf01-project-${pad4(index % 8)}`;
    const assetId = `asset-pf01-${pad4(index)}`;
    const fileId = `file-pf01-${pad4(index)}`;
    const revision = `rev-pf01-${pad4(index)}`;
    const readOnly =
      combination.statuses.includes('readOnly') || combination.statuses.includes('incompatible');

    const summary: AssetSummary = {
      asset: {
        assetId,
        assetType,
        nativeUnitRef: `nunit-pf01-${pad4(index)}`,
        adapterIdentity: `${agents[0]}@pf01`,
      },
      displayName: name,
      anomalies: buildAnomalies(combination.statuses),
      agents,
      scope,
      contextHint:
        scope === 'project'
          ? { kind: 'project', projectName }
          : { kind: 'path', pathHint: `~/…/pf01/${assetType}/${name}` },
      sourceTier:
        scope === 'project'
          ? { id: 'project-root', label: 'Project root (synthetic)' }
          : { id: 'user-global-root', label: 'User global root (synthetic)' },
      availability: combination.statuses.includes('incompatible')
        ? { kind: 'disabled', reasonCode: 'INCOMPATIBLE_STRUCTURE' }
        : { kind: 'allowed' },
    };

    const detail: AssetDetail = {
      asset: summary.asset,
      displayName: name,
      nativeUnitKind: 'singleFile',
      revision,
      compatibility: combination.compatibility,
      capabilities: {
        edit: readOnly ? { kind: 'disabled', reasonCode: 'READ_ONLY_POLICY' } : { kind: 'allowed' },
        convert: { kind: 'allowed' },
        export: { kind: 'allowed' },
        delete: readOnly
          ? { kind: 'disabled', reasonCode: 'READ_ONLY_POLICY' }
          : { kind: 'allowed' },
      },
      effectiveContexts: agents.map((agent, precedence) => ({
        agent,
        scope,
        sourceTierLabel:
          scope === 'project' ? 'Project root (synthetic)' : 'User global root (synthetic)',
        precedence,
      })),
      primaryFile: {
        fileId,
        name: `${name}.md`,
        relativePath: `${name}.md`,
        fileKind: 'text',
        isPrimary: true,
        canPreview: { kind: 'allowed' },
        canEdit: readOnly
          ? { kind: 'disabled', reasonCode: 'READ_ONLY_POLICY' }
          : { kind: 'allowed' },
        hasDraftChanges: false,
      },
    };

    const inspector: InspectorData = {
      agents,
      scope,
      effectiveContexts: detail.effectiveContexts,
      sourceAnchor: scope === 'project' ? { kind: 'project', projectName } : { kind: 'userHome' },
      pathDisplay:
        scope === 'project'
          ? `pf01-project/…/${assetType}/${name}.md`
          : `~/…/pf01/${assetType}/${name}.md`,
      compatibility: combination.compatibility,
      overrides: [],
    };

    assets.push({
      summary,
      detail,
      inspector,
      statuses: combination.statuses,
      rawSource: buildRawSource(rand, name, assetType, index),
      sensitiveSegments: index % 6 === 0 ? [{ segmentId: `seg-pf01-${pad4(index)}`, fileId }] : [],
    });
  }

  return { profile, assets };
}

/** 列表查询匹配（与 FX-01 mock 同一语义：scope/搜索词/筛选共同约束） */
export function matchesPerfListQuery(record: PerfAssetRecord, query: AssetListQuery): boolean {
  const { summary, statuses } = record;
  if (
    query.scope.kind === 'currentAssetType' &&
    query.scope.assetType !== summary.asset.assetType
  ) {
    return false;
  }
  const searchText = query.searchText?.trim().toLowerCase();
  if (searchText && !summary.displayName.toLowerCase().includes(searchText)) {
    return false;
  }
  const filters: AssetListFilters | undefined = query.filters;
  if (filters?.agents && filters.agents.length > 0) {
    if (!filters.agents.some((agent) => summary.agents.includes(agent))) return false;
  }
  if (filters?.projects && filters.projects.length > 0) {
    if (
      summary.contextHint.kind !== 'project' ||
      !filters.projects.includes(summary.contextHint.projectName)
    ) {
      return false;
    }
  }
  if (filters?.scopes && filters.scopes.length > 0) {
    if (!filters.scopes.includes(summary.scope)) return false;
  }
  if (filters?.sources && filters.sources.length > 0) {
    if (!filters.sources.includes(summary.sourceTier.id)) return false;
  }
  if (filters?.statuses && filters.statuses.length > 0) {
    if (!filters.statuses.some((status) => statuses.includes(status))) return false;
  }
  return true;
}
