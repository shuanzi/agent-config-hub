/**
 * PF-02/PF-03 的确定性只读合成 bundle。
 *
 * 此模块不读取磁盘、不创建 Hook 或 write intent。构建过程中的原始占位值仅在
 * 函数局部存在，返回的完整 bundle 已默认遮蔽；descriptor 的 profile digest
 * 也只覆盖该安全 bundle。
 */
import { maskSyntheticSecrets } from '../../fixtures/sensitive-masking';
import type {
  AssetDetail,
  AssetDetailSnapshot,
  AssetRef,
  AssetSummary,
  FileTreeNode,
  InspectorData,
  NativeFileRef,
  NativeFileSnapshot,
  SensitiveSegmentRef,
} from '../contract/types';
import type { ReadOnlyAssetRef, WorkbenchActualReadSnapshot } from '../workbench/read-only-model';

export type PfReadProfile = 'representative' | 'stress';
export type PfReadDescriptorId = 'PF-02' | 'PF-03';

export interface PfReadFixtureBundle {
  schemaVersion: 1;
  descriptorId: PfReadDescriptorId;
  profile: PfReadProfile;
  seed: number;
  shape: Record<string, number | string>;
  workbench: WorkbenchActualReadSnapshot;
  detail: AssetDetailSnapshot;
  files: NativeFileSnapshot[];
}

/** digest 只接受完整 public bundle 的闭合字段；调用方不必依赖内部具体 snapshot 类型。 */
export interface PfReadFixtureDigestInput {
  schemaVersion: 1;
  descriptorId: PfReadDescriptorId;
  profile: PfReadProfile;
  seed: number;
  shape: Record<string, number | string>;
  workbench: unknown;
  detail: unknown;
  files: unknown;
}

const PF02_SEED = 2026081402;
const PF03_SEED = 2026081403;
const SYNTHETIC_SECRET_MARKER = ['SYNTHETIC', 'SECRET'].join('-');

const PF02_SHAPES = {
  representative: {
    textBytes: 262144,
    lineCount: 4096,
    longestLineBytes: 512,
    unknownFieldCount: 8,
    commentCount: 128,
    maskedSensitiveSegmentCount: 16,
  },
  stress: {
    textBytes: 1048576,
    lineCount: 16384,
    longestLineBytes: 2048,
    unknownFieldCount: 32,
    commentCount: 512,
    maskedSensitiveSegmentCount: 64,
  },
} as const;

const PF03_SHAPES = {
  representative: {
    fileCount: 64,
    maxDirectoryDepth: 4,
    textFileCount: 48,
    nonTextFileCount: 16,
    totalBytes: 524288,
    activePath: 'nested/secondary/readme.md',
    dirtyFileCount: 0,
  },
  stress: {
    fileCount: 256,
    maxDirectoryDepth: 6,
    textFileCount: 192,
    nonTextFileCount: 64,
    totalBytes: 2097152,
    activePath: 'deep/nested/secondary/readme.md',
    dirtyFileCount: 0,
  },
} as const;

const readonly = { kind: 'disabled' as const, reasonCode: 'READ_ONLY_POLICY' as const };
const textEncoder = new TextEncoder();

function utf8Length(value: string): number {
  return textEncoder.encode(value).length;
}

function assetRef(id: PfReadDescriptorId, profile: PfReadProfile): AssetRef {
  return {
    assetId: `asset-${id.toLowerCase()}-${profile}`,
    assetType: 'skill',
    nativeUnitRef: `native-${id.toLowerCase()}-${profile}`,
    adapterIdentity: 'claude-code@synthetic-readonly',
    nativeOwnership: { kind: 'global' },
  };
}

function readOnlyAssetRef(asset: AssetRef): ReadOnlyAssetRef {
  return {
    assetId: asset.assetId,
    assetType: 'skill',
    nativeUnitRef: asset.nativeUnitRef,
    adapterIdentity: asset.adapterIdentity,
    nativeOwnership: asset.nativeOwnership,
  };
}

function nativeFile(
  fileId: string,
  relativePath: string,
  fileKind: NativeFileRef['fileKind'],
  isPrimary: boolean,
): NativeFileRef {
  return {
    fileId,
    name: relativePath.split('/').at(-1) ?? relativePath,
    relativePath,
    fileKind,
    isPrimary,
    canPreview:
      fileKind === 'text'
        ? { kind: 'allowed' }
        : { kind: 'disabled', reasonCode: 'NON_TEXT_UNPREVIEWABLE' },
    canEdit: readonly,
    hasDraftChanges: false,
  };
}

function detailAndWorkbench(
  id: PfReadDescriptorId,
  profile: PfReadProfile,
  displayName: string,
  revision: string,
  primaryFile: NativeFileRef,
  fileTreeRoot: FileTreeNode,
): Pick<PfReadFixtureBundle, 'workbench' | 'detail'> {
  const asset = assetRef(id, profile);
  const summary: AssetSummary = {
    asset,
    displayName,
    anomalies: [
      { kind: 'readOnly', reasonCode: 'READ_ONLY_POLICY', message: '合成只读性能 fixture' },
    ],
    agents: ['claude-code'],
    scope: 'global',
    contextHint: { kind: 'path', pathHint: `synthetic/${id.toLowerCase()}/${profile}` },
    sourceTier: { id: `source-${id.toLowerCase()}`, label: 'Synthetic readonly root' },
    availability: readonly,
  };
  const agentTargetStates = [
    {
      agent: 'claude-code' as const,
      presence: 'present' as const,
      activation: 'enabled' as const,
      applicability: 'resolved' as const,
      enableAvailability: readonly,
      disableAvailability: readonly,
    },
  ];
  const detail: AssetDetail = {
    asset,
    displayName,
    nativeUnitKind: 'multiFileDirectory',
    revision,
    compatibility: 'recognizedReadOnly',
    capabilities: { edit: readonly, convert: readonly, export: readonly, delete: readonly },
    effectiveContexts: [
      {
        agent: 'claude-code',
        scope: 'global',
        sourceTierLabel: 'Synthetic readonly root',
        precedence: 0,
      },
    ],
    primaryFile,
    fileTreeRoot,
    readSurface: {
      kind: 'skill',
      agentTargetStates,
      sourceReadAvailability: { kind: 'allowed' },
    },
  };
  const inspector: InspectorData = {
    agents: ['claude-code'],
    scope: 'global',
    effectiveContexts: detail.effectiveContexts,
    sourceAnchor: { kind: 'globalRoot', label: 'Synthetic readonly root' },
    pathDisplay: `synthetic/${id.toLowerCase()}/${profile}`,
    compatibility: 'recognizedReadOnly',
    overrides: [],
  };
  const row = {
    assetRef: readOnlyAssetRef(asset),
    assetId: asset.assetId,
    displayName: summary.displayName,
    sortBaseName: summary.displayName,
    authoritativeInputOrder: 0,
    nativeOwnership: asset.nativeOwnership,
    agents: summary.agents,
    sourceTierId: summary.sourceTier.id,
    sourceTierLabel: summary.sourceTier.label,
    redactedSummary: 'Synthetic readonly performance fixture',
    ownershipHint: 'Synthetic readonly root',
    statuses: ['readOnly', 'normal'] as const,
    skillTargetStates: agentTargetStates,
  };
  return {
    workbench: {
      kind: 'workbench',
      query: { kind: 'workbench', assetType: 'skill', viewContext: { kind: 'all' } },
      authoritativeReadRevision: revision,
      segments: [
        {
          id: `segment-${id.toLowerCase()}`,
          source: 'globalApplicable',
          displayLabel: 'Global',
          rows: [row],
        },
      ],
      effectiveContexts: [],
      findings: [],
      aggregateTotal: 1,
      indexStatus: 'fresh',
      readAt: '2026-08-14T00:00:00.000Z',
    },
    detail: { kind: 'assetDetail', detail, inspector, revision },
  };
}

function sourceSnapshot(
  file: NativeFileRef,
  revision: string,
  maskedText: string,
  sensitiveSegmentCount: number,
): NativeFileSnapshot {
  const sensitiveSegments: SensitiveSegmentRef[] = Array.from(
    { length: sensitiveSegmentCount },
    (_, index) => ({
      segmentId: `segment-${file.fileId}-${String(index).padStart(3, '0')}`,
      fileId: file.fileId,
      revision,
      displayState: 'masked',
    }),
  );
  return {
    kind: 'nativeFile',
    file,
    revision,
    assetRevision: revision,
    content: { kind: 'source', maskedText, sensitiveSegments },
    structuredView: readonly,
  };
}

function nonTextSnapshot(
  file: NativeFileRef,
  revision: string,
  sizeBytes: number,
): NativeFileSnapshot {
  return {
    kind: 'nativeFile',
    file,
    revision,
    assetRevision: revision,
    content: {
      kind: 'nonTextMetadata',
      fileKindLabel: 'binary synthetic metadata',
      sizeBytes,
      pathDisplay: file.relativePath,
      reasonCode: 'NON_TEXT_UNPREVIEWABLE',
      reason: '非文本合成文件仅提供元数据。',
    },
    structuredView: readonly,
  };
}

function fitLinesToByteLength(lines: string[], bytes: number, maxLineBytes?: number): string {
  let actual = utf8Length(lines.join('\n'));
  if (actual > bytes) throw new Error('synthetic source prefix exceeds descriptor bytes');
  let remaining = bytes - actual;
  for (let index = 1; index < lines.length && remaining > 0; index += 1) {
    const capacity = (maxLineBytes ?? bytes) - utf8Length(lines[index] ?? '');
    const addition = Math.min(capacity, remaining);
    lines[index] = `${lines[index] ?? ''}${'x'.repeat(addition)}`;
    remaining -= addition;
  }
  if (remaining !== 0) throw new Error('synthetic source cannot satisfy descriptor bytes');
  actual = utf8Length(lines.join('\n'));
  if (actual !== bytes) throw new Error('synthetic source byte count drift');
  return lines.join('\n');
}

function maskAndRestoreByteLength(source: string, bytes: number, maxLineBytes?: number): string {
  const lines = maskSyntheticSecrets(source).split('\n');
  return fitLinesToByteLength(lines, bytes, maxLineBytes);
}

function buildPf02Source(shape: (typeof PF02_SHAPES)[PfReadProfile]): string {
  const lines = Array.from({ length: shape.lineCount }, () => '');
  lines[0] = 'x'.repeat(shape.longestLineBytes);
  let line = 1;
  for (let index = 0; index < shape.commentCount; index += 1) {
    lines[line] = `# comment ${String(index).padStart(4, '0')}`;
    line += 1;
  }
  for (let index = 0; index < shape.unknownFieldCount; index += 1) {
    lines[line] = `unknown_field_${String(index).padStart(3, '0')} = preserved`;
    line += 1;
  }
  for (let index = 0; index < shape.maskedSensitiveSegmentCount; index += 1) {
    lines[line] = `token = "${SYNTHETIC_SECRET_MARKER}-pf02-${String(index).padStart(3, '0')}"`;
    line += 1;
  }
  return maskAndRestoreByteLength(
    fitLinesToByteLength(lines, shape.textBytes, shape.longestLineBytes),
    shape.textBytes,
    shape.longestLineBytes,
  );
}

function buildTree(files: NativeFileRef[], rootName: string): FileTreeNode {
  const root: FileTreeNode = { name: rootName, children: [] };
  for (const file of files) {
    const parts = file.relativePath.split('/');
    let node = root;
    for (const [index, part] of parts.entries()) {
      const leaf = index === parts.length - 1;
      if (leaf) {
        node.children?.push({ name: part, file });
        continue;
      }
      let child = node.children?.find(
        (candidate) => candidate.name === part && candidate.file === undefined,
      );
      if (child === undefined) {
        child = { name: part, children: [] };
        node.children?.push(child);
      }
      node = child;
    }
  }
  return root;
}

/** PF-02：大只读源码、注释/unknown 保真与默认敏感遮蔽的安全 bundle。 */
export function buildPf02SourceLargeFixture(profile: PfReadProfile): PfReadFixtureBundle {
  const shape = { ...PF02_SHAPES[profile] };
  const revision = `rev-pf02-${profile}`;
  const primary = nativeFile(`file-pf02-${profile}-source`, 'SKILL.md', 'text', true);
  const secondary = nativeFile(
    `file-pf02-${profile}-switch`,
    'references/readonly-switch.md',
    'text',
    false,
  );
  const files = [
    sourceSnapshot(primary, revision, buildPf02Source(shape), shape.maskedSensitiveSegmentCount),
    sourceSnapshot(secondary, revision, 'PF-02 readonly switch target.\n', 0),
  ];
  const facts = detailAndWorkbench(
    'PF-02',
    profile,
    `PF-02 source-large ${profile}`,
    revision,
    primary,
    buildTree([primary, secondary], 'PF-02 synthetic source root'),
  );
  return {
    schemaVersion: 1,
    descriptorId: 'PF-02',
    profile,
    seed: PF02_SEED,
    shape,
    ...facts,
    files,
  };
}

function nestedPath(prefix: string, index: number, maxDepth: number, extension: string): string {
  const depth = maxDepth === 1 ? 1 : 1 + (index % maxDepth);
  const directories = Array.from({ length: depth }, (_, segment) => `${prefix}-${segment + 1}`);
  return [...directories, `${prefix}-${String(index).padStart(4, '0')}.${extension}`].join('/');
}

function evenlyAllocatedBytes(totalBytes: number, count: number): number[] {
  const base = Math.floor(totalBytes / count);
  const remainder = totalBytes % count;
  return Array.from({ length: count }, (_, index) => base + (index < remainder ? 1 : 0));
}

function buildPf03Text(bytes: number, index: number): string {
  const raw = fitLinesToByteLength(
    [
      `# PF-03 synthetic text ${String(index).padStart(4, '0')}`,
      `secret = "${SYNTHETIC_SECRET_MARKER}-pf03-${String(index).padStart(4, '0')}"`,
      '# preserved comment',
      'unknown_field = preserved',
    ],
    bytes,
  );
  return maskAndRestoreByteLength(raw, bytes);
}

/** PF-03：精确文件数/目录深度/文本比例的安全多文件只读 bundle。 */
export function buildPf03MultifileFixture(profile: PfReadProfile): PfReadFixtureBundle {
  const shape = { ...PF03_SHAPES[profile] };
  const revision = `rev-pf03-${profile}`;
  const fileRefs: NativeFileRef[] = [
    nativeFile(`file-pf03-${profile}-0000`, 'SKILL.md', 'text', true),
    nativeFile(`file-pf03-${profile}-0001`, shape.activePath, 'text', false),
  ];
  for (let index = 2; index < shape.textFileCount; index += 1) {
    fileRefs.push(
      nativeFile(
        `file-pf03-${profile}-${String(index).padStart(4, '0')}`,
        nestedPath('text', index, shape.maxDirectoryDepth, 'md'),
        'text',
        false,
      ),
    );
  }
  for (let index = 0; index < shape.nonTextFileCount; index += 1) {
    const number = shape.textFileCount + index;
    fileRefs.push(
      nativeFile(
        `file-pf03-${profile}-${String(number).padStart(4, '0')}`,
        nestedPath('binary', index, shape.maxDirectoryDepth, 'bin'),
        'nonText',
        false,
      ),
    );
  }
  const allocatedBytes = evenlyAllocatedBytes(shape.totalBytes, shape.fileCount);
  const files = fileRefs.map((file, index) =>
    file.fileKind === 'text'
      ? sourceSnapshot(file, revision, buildPf03Text(allocatedBytes[index] ?? 0, index), 1)
      : nonTextSnapshot(file, revision, allocatedBytes[index] ?? 0),
  );
  const facts = detailAndWorkbench(
    'PF-03',
    profile,
    `PF-03 multifile-workbench ${profile}`,
    revision,
    fileRefs[0] as NativeFileRef,
    buildTree(fileRefs, 'PF-03 synthetic multi-file root'),
  );
  return {
    schemaVersion: 1,
    descriptorId: 'PF-03',
    profile,
    seed: PF03_SEED,
    shape,
    ...facts,
    files,
  };
}

/**
 * 完整 public-safe bundle 的稳定 SHA-256。canonical JSON 固定为
 * `JSON.stringify(bundle, null, 2)` 的 UTF-8 字节；bundle 不内嵌 digest，避免循环。
 */
export function pfReadFixtureDigest(bundle: PfReadFixtureDigestInput): string {
  return sha256Hex(JSON.stringify(bundle, null, 2));
}

// 小型同步 SHA-256 实现：浏览器 fixture builder 无 Node crypto 依赖，且 descriptor
// profile digest 可在 Vitest/浏览器中对同一完整 bundle 得到相同值。
function sha256Hex(input: string): string {
  const bytes = [...textEncoder.encode(input)];
  const bitLength = bytes.length * 8;
  bytes.push(0x80);
  while ((bytes.length + 8) % 64 !== 0) bytes.push(0);
  for (let index = 7; index >= 0; index -= 1) {
    bytes.push(Math.floor(bitLength / 2 ** (index * 8)) & 0xff);
  }
  const hash = [
    0x6a09e667, 0xbb67ae85, 0x3c6ef372, 0xa54ff53a, 0x510e527f, 0x9b05688c, 0x1f83d9ab, 0x5be0cd19,
  ];
  const constants = [
    0x428a2f98, 0x71374491, 0xb5c0fbcf, 0xe9b5dba5, 0x3956c25b, 0x59f111f1, 0x923f82a4, 0xab1c5ed5,
    0xd807aa98, 0x12835b01, 0x243185be, 0x550c7dc3, 0x72be5d74, 0x80deb1fe, 0x9bdc06a7, 0xc19bf174,
    0xe49b69c1, 0xefbe4786, 0x0fc19dc6, 0x240ca1cc, 0x2de92c6f, 0x4a7484aa, 0x5cb0a9dc, 0x76f988da,
    0x983e5152, 0xa831c66d, 0xb00327c8, 0xbf597fc7, 0xc6e00bf3, 0xd5a79147, 0x06ca6351, 0x14292967,
    0x27b70a85, 0x2e1b2138, 0x4d2c6dfc, 0x53380d13, 0x650a7354, 0x766a0abb, 0x81c2c92e, 0x92722c85,
    0xa2bfe8a1, 0xa81a664b, 0xc24b8b70, 0xc76c51a3, 0xd192e819, 0xd6990624, 0xf40e3585, 0x106aa070,
    0x19a4c116, 0x1e376c08, 0x2748774c, 0x34b0bcb5, 0x391c0cb3, 0x4ed8aa4a, 0x5b9cca4f, 0x682e6ff3,
    0x748f82ee, 0x78a5636f, 0x84c87814, 0x8cc70208, 0x90befffa, 0xa4506ceb, 0xbef9a3f7, 0xc67178f2,
  ];
  const rotateRight = (value: number, bits: number) => (value >>> bits) | (value << (32 - bits));
  for (let offset = 0; offset < bytes.length; offset += 64) {
    const words = Array.from({ length: 64 }, () => 0);
    for (let index = 0; index < 16; index += 1) {
      const start = offset + index * 4;
      words[index] =
        ((bytes[start] ?? 0) << 24) |
        ((bytes[start + 1] ?? 0) << 16) |
        ((bytes[start + 2] ?? 0) << 8) |
        (bytes[start + 3] ?? 0);
    }
    for (let index = 16; index < 64; index += 1) {
      const low =
        rotateRight(words[index - 15] ?? 0, 7) ^
        rotateRight(words[index - 15] ?? 0, 18) ^
        ((words[index - 15] ?? 0) >>> 3);
      const high =
        rotateRight(words[index - 2] ?? 0, 17) ^
        rotateRight(words[index - 2] ?? 0, 19) ^
        ((words[index - 2] ?? 0) >>> 10);
      words[index] = ((words[index - 16] ?? 0) + low + (words[index - 7] ?? 0) + high) | 0;
    }
    let [a, b, c, d, e, f, g, h] = hash;
    for (let index = 0; index < 64; index += 1) {
      const sigma1 = rotateRight(e, 6) ^ rotateRight(e, 11) ^ rotateRight(e, 25);
      const choose = (e & f) ^ (~e & g);
      const temp1 = (h + sigma1 + choose + (constants[index] ?? 0) + (words[index] ?? 0)) | 0;
      const sigma0 = rotateRight(a, 2) ^ rotateRight(a, 13) ^ rotateRight(a, 22);
      const majority = (a & b) ^ (a & c) ^ (b & c);
      const temp2 = (sigma0 + majority) | 0;
      h = g;
      g = f;
      f = e;
      e = (d + temp1) | 0;
      d = c;
      c = b;
      b = a;
      a = (temp1 + temp2) | 0;
    }
    hash[0] = (hash[0] + a) | 0;
    hash[1] = (hash[1] + b) | 0;
    hash[2] = (hash[2] + c) | 0;
    hash[3] = (hash[3] + d) | 0;
    hash[4] = (hash[4] + e) | 0;
    hash[5] = (hash[5] + f) | 0;
    hash[6] = (hash[6] + g) | 0;
    hash[7] = (hash[7] + h) | 0;
  }
  return hash.map((value) => (value >>> 0).toString(16).padStart(8, '0')).join('');
}
