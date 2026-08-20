import type { FrontendGateway, ObserveHandle } from '../../../src/contract/gateway';
import type * as Contract from '../../../src/contract/types';
import type * as Model from '../../../src/workbench/read-only-model';

const allowed = () => ({ kind: 'allowed' as const });
const disabled = () => ({
  kind: 'disabled' as const,
  reasonCode: 'UNSUPPORTED_CAPABILITY' as const,
});

export function asset(
  id: string,
  assetType: Model.MvpAssetType,
  unit: string,
): Model.ReadOnlyAssetRef {
  return {
    assetId: id,
    assetType,
    nativeUnitRef: unit,
    adapterIdentity: 'fixture@synthetic',
    nativeOwnership: { kind: 'global' },
  };
}

export function file(id: string, name: string, isPrimary = true): Contract.NativeFileRef {
  return {
    fileId: id,
    name,
    relativePath: name,
    fileKind: 'text',
    isPrimary,
    canPreview: allowed(),
    canEdit: allowed(),
    hasDraftChanges: false,
  };
}

export function row(assetRef: Model.ReadOnlyAssetRef, displayName: string): Model.ReadOnlyRow {
  return {
    assetRef,
    assetId: assetRef.assetId,
    displayName,
    sortBaseName: displayName,
    authoritativeInputOrder: 0,
    nativeOwnership: assetRef.nativeOwnership,
    statuses: ['editable', 'normal'],
  };
}

export function detail(
  asset: Model.ReadOnlyAssetRef,
  file: Contract.NativeFileRef,
  displayName: string,
  revision: string,
  readSurface: Contract.AssetReadSurface,
  options: {
    nativeUnitKind?: Contract.NativeUnitKind;
    fileTreeRoot?: Contract.FileTreeNode;
    pathDisplay?: string;
  } = {},
): Contract.AssetDetailSnapshot {
  return {
    kind: 'assetDetail',
    revision,
    detail: {
      asset,
      displayName,
      nativeUnitKind: options.nativeUnitKind ?? 'singleFile',
      revision,
      compatibility: 'verifiedWritable',
      capabilities: {
        edit: allowed(),
        convert: disabled(),
        export: disabled(),
        delete: disabled(),
      },
      effectiveContexts: [],
      primaryFile: file,
      ...(options.fileTreeRoot === undefined ? {} : { fileTreeRoot: options.fileTreeRoot }),
      readSurface,
    },
    inspector: {
      agents: [],
      scope: 'global',
      effectiveContexts: [],
      sourceAnchor: { kind: 'globalRoot', label: 'synthetic root' },
      pathDisplay: options.pathDisplay ?? `synthetic/${file.relativePath}`,
      compatibility: 'verifiedWritable',
      overrides: [],
    },
  };
}

export function source(
  file: Contract.NativeFileRef,
  revision: string,
  assetRevision: string,
  maskedText: string,
  extras: Pick<Contract.MaskedSourceContent, 'maskedParts' | 'sensitiveSegments'> = {
    sensitiveSegments: [],
  },
): Contract.NativeFileSnapshot {
  return {
    kind: 'nativeFile',
    file,
    revision,
    assetRevision,
    content: {
      kind: 'source',
      maskedText,
      sensitiveSegments: extras.sensitiveSegments ?? [],
      ...(extras.maskedParts === undefined ? {} : { maskedParts: extras.maskedParts }),
    },
    structuredView: allowed(),
  };
}

export function workbench(
  query: Extract<Contract.Query, { kind: 'workbench' }>,
  row: Model.ReadOnlyRow,
  revision: string,
): Model.WorkbenchActualReadSnapshot {
  return {
    kind: 'workbench',
    query,
    authoritativeReadRevision: revision,
    segments: [{ id: 'global', source: 'globalApplicable', displayLabel: 'Global', rows: [row] }],
    effectiveContexts: [],
    findings: [],
    aggregateTotal: 1,
    indexStatus: 'fresh',
    readAt: '2026-08-20T00:00:00.000Z',
  };
}

export class ReadOnlyGateway implements FrontendGateway {
  readonly methods: Array<'read' | 'observe'> = [];
  readonly queries: Contract.Query[] = [];

  constructor(private readonly snapshotFor: (query: Contract.Query) => unknown | undefined) {}

  read<Q extends Contract.Query>(query: Q): Promise<Contract.ReadResult<Contract.SnapshotFor<Q>>> {
    this.methods.push('read');
    this.queries.push(query);
    const snapshot = this.snapshotFor(query);
    return Promise.resolve(
      snapshot === undefined
        ? { kind: 'readFailed', reasonCode: 'READ_FAILED', message: 'unexpected synthetic query' }
        : { kind: 'readSucceeded', snapshot },
    ) as Promise<Contract.ReadResult<Contract.SnapshotFor<Q>>>;
  }

  observe(
    _subscription: Contract.Subscription,
    _listener: (event: Contract.WorkspaceEvent) => void,
  ): ObserveHandle {
    this.methods.push('observe');
    return { ready: Promise.resolve(), unlisten: () => undefined };
  }
}

export async function waitForSession(predicate: () => boolean): Promise<void> {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (predicate()) return;
    await new Promise((resolve) => setTimeout(resolve, 1));
  }
  throw new Error('FE-03 session did not settle');
}
