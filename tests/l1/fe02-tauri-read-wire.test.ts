/**
 * FE-02 / FX-03 的 L1 wire fail-closed 测试。
 *
 * 证据边界：仅替换 Tauri `invoke` 的 public transport seam；不启动 WebView，
 * 不访问磁盘，也不把 Hook 内容交给任何执行器。它验证错误 wire payload 不会被
 * 强制类型断言伪装成可读内容。
 */
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import { invoke } from '@tauri-apps/api/core';
import { createTauriGateway } from '../../src/gateway/tauri';
import { GATEWAY_WIRE_VERSION } from '../../src/gateway/wire/gateway-wire';

vi.mock('@tauri-apps/api/core', () => ({ invoke: vi.fn() }));
vi.mock('@tauri-apps/api/event', () => ({ listen: vi.fn() }));

type InvokeFn = (
  command: string,
  arguments_: { request: { requestId: string } },
) => Promise<unknown>;

const invokeMock = invoke as unknown as Mock<InvokeFn>;

const FX03_HOOK = {
  assetId: 'asset-fx03-hook-on-save',
  assetType: 'hook' as const,
  nativeUnitRef: 'nunit-fx03-hook-on-save',
  adapterIdentity: 'fixture-hook@synthetic',
  nativeOwnership: { kind: 'global' as const },
};

const FX02_SKILL = {
  assetId: 'asset-fx02-multifile-skill-mixed',
  assetType: 'skill' as const,
  nativeUnitRef: 'nunit-fx02-multifile-skill-mixed',
  adapterIdentity: 'claude-code@fixture',
  nativeOwnership: { kind: 'global' as const },
};

function replyWith(payload: unknown): void {
  invokeMock.mockImplementation(async (_command, arguments_) => ({
    wireVersion: GATEWAY_WIRE_VERSION,
    requestId: arguments_.request.requestId,
    payload,
  }));
}

function validSkillDetailSnapshot(): Record<string, unknown> {
  const sourceContext = {
    agent: 'claude-code',
    scope: 'global',
    sourceTierLabel: 'FX-02 synthetic source',
    precedence: 0,
  };
  const primaryFile = {
    fileId: 'file-fx02-skill-primary',
    name: 'SKILL.md',
    relativePath: 'SKILL.md',
    fileKind: 'text',
    isPrimary: true,
    canPreview: { kind: 'allowed' },
    canEdit: { kind: 'disabled', reasonCode: 'READ_ONLY_POLICY' },
    hasDraftChanges: false,
  };
  const agentTargetStates = [
    ['claude-code', 'present', 'enabled'],
    ['codex', 'absent', 'notApplicable'],
    ['gemini-cli', 'absent', 'notApplicable'],
    ['opencode', 'absent', 'notApplicable'],
  ].map(([agent, presence, activation]) => ({
    agent,
    presence,
    activation,
    applicability: 'resolved',
    enableAvailability: { kind: 'allowed' },
    disableAvailability: { kind: 'allowed' },
  }));
  return {
    kind: 'assetDetail',
    detail: {
      asset: FX02_SKILL,
      displayName: 'FX-02 multifile Skill',
      nativeUnitKind: 'singleFile',
      revision: 'rev-fx02-detail',
      compatibility: 'recognizedReadOnly',
      capabilities: {
        edit: { kind: 'disabled', reasonCode: 'READ_ONLY_POLICY' },
        convert: { kind: 'disabled', reasonCode: 'READ_ONLY_POLICY' },
        export: { kind: 'disabled', reasonCode: 'READ_ONLY_POLICY' },
        delete: { kind: 'disabled', reasonCode: 'READ_ONLY_POLICY' },
      },
      effectiveContexts: [sourceContext],
      primaryFile,
      readSurface: {
        kind: 'skill',
        agentTargetStates,
        sourceReadAvailability: { kind: 'allowed' },
      },
    },
    inspector: {
      agents: ['claude-code'],
      scope: 'global',
      effectiveContexts: [sourceContext],
      sourceAnchor: { kind: 'globalRoot', label: 'FX-02 synthetic root' },
      pathDisplay: 'FX-02/native-root/skills/multifile-skill-mixed/SKILL.md',
      compatibility: 'recognizedReadOnly',
      overrides: [],
    },
    revision: 'rev-fx02-detail',
  };
}

function validNativeSourceSnapshot(fileId = 'file-fx02-source'): Record<string, unknown> {
  return {
    kind: 'nativeFile',
    file: {
      fileId,
      name: 'usage.md',
      relativePath: 'references/usage.md',
      fileKind: 'text',
      isPrimary: false,
      canPreview: { kind: 'allowed' },
      canEdit: { kind: 'disabled', reasonCode: 'READ_ONLY_POLICY' },
      hasDraftChanges: false,
    },
    revision: 'rev-fx02-source',
    assetRevision: 'rev-fx02-skill',
    content: {
      kind: 'source',
      maskedText: 'TOKEN=••••••••',
      sensitiveSegments: [
        {
          segmentId: 'seg-fx02-source-token',
          fileId,
          revision: 'rev-fx02-source',
          displayState: 'masked',
        },
      ],
    },
    structuredView: { kind: 'disabled', reasonCode: 'READ_ONLY_POLICY' },
  };
}

function validNonTextSnapshot(): Record<string, unknown> {
  return {
    kind: 'nativeFile',
    file: {
      fileId: 'file-fx02-opaque',
      name: 'opaque.bin',
      relativePath: 'assets/opaque.bin',
      fileKind: 'nonText',
      isPrimary: false,
      canPreview: { kind: 'disabled', reasonCode: 'NON_TEXT_UNPREVIEWABLE' },
      canEdit: { kind: 'disabled', reasonCode: 'READ_ONLY_POLICY' },
      hasDraftChanges: false,
    },
    revision: 'rev-fx02-bin',
    assetRevision: 'rev-fx02-skill',
    content: {
      kind: 'nonTextMetadata',
      fileKindLabel: 'binary',
      sizeBytes: 3,
      pathDisplay: 'assets/opaque.bin',
      reasonCode: 'NON_TEXT_UNPREVIEWABLE',
      reason: '非文本文件仅提供元数据。',
    },
    structuredView: { kind: 'disabled', reasonCode: 'READ_ONLY_POLICY' },
  };
}

beforeEach(() => {
  invokeMock.mockReset();
});

describe('FE-02 Tauri read wire', () => {
  it('接受完整遮蔽的 Skill asset-detail wire snapshot', async () => {
    replyWith({ kind: 'readSucceeded', snapshot: validSkillDetailSnapshot() });

    const result = await createTauriGateway().read({ kind: 'assetDetail', asset: FX02_SKILL });

    expect(result).toMatchObject({
      kind: 'readSucceeded',
      snapshot: {
        kind: 'assetDetail',
        detail: { asset: FX02_SKILL, displayName: 'FX-02 multifile Skill' },
        inspector: { pathDisplay: 'FX-02/native-root/skills/multifile-skill-mixed/SKILL.md' },
      },
    });
  });

  it('拒绝未遮蔽的 Hook source payload，而不是把它强转为可读 NativeFile', async () => {
    // 分段构造，避免把测试自身变成未遮蔽占位值的静态输入。
    const unmasked = ['SYNTHETIC-SECRET', 'hook-token-0001'].join('-');
    replyWith({
      kind: 'readSucceeded',
      snapshot: {
        kind: 'nativeFile',
        file: {
          fileId: 'file-fx03-hook',
          name: 'hook.sh',
          relativePath: 'hook.sh',
          fileKind: 'text',
          isPrimary: true,
          canPreview: { kind: 'allowed' },
          canEdit: { kind: 'disabled', reasonCode: 'EXECUTABLE_CONTENT_RISK' },
          hasDraftChanges: false,
        },
        revision: 'rev-fx03-hook',
        assetRevision: 'rev-fx03-hook',
        content: {
          kind: 'source',
          maskedText: `token=${unmasked}`,
          sensitiveSegments: [],
        },
        structuredView: { kind: 'disabled', reasonCode: 'EXECUTABLE_CONTENT_RISK' },
      },
    });

    const result = await createTauriGateway().read({
      kind: 'nativeFile',
      asset: FX03_HOOK,
      fileId: 'file-fx03-hook',
    });

    expect(result).toMatchObject({
      kind: 'readFailed',
      reasonCode: 'GATEWAY_UNAVAILABLE',
      recoveryAction: { kind: 'retryRead' },
    });
    expect(JSON.stringify(result)).not.toContain(unmasked);
  });

  it('接受完整遮蔽的 source 与 non-text native-file wire snapshot', async () => {
    replyWith({ kind: 'readSucceeded', snapshot: validNativeSourceSnapshot() });
    const source = await createTauriGateway().read({
      kind: 'nativeFile',
      asset: FX02_SKILL,
      fileId: 'file-fx02-source',
    });
    expect(source).toMatchObject({
      kind: 'readSucceeded',
      snapshot: { kind: 'nativeFile', file: { fileId: 'file-fx02-source' } },
    });

    replyWith({ kind: 'readSucceeded', snapshot: validNonTextSnapshot() });
    const nonText = await createTauriGateway().read({
      kind: 'nativeFile',
      asset: FX02_SKILL,
      fileId: 'file-fx02-opaque',
    });
    expect(nonText).toMatchObject({
      kind: 'readSucceeded',
      snapshot: {
        kind: 'nativeFile',
        file: { fileId: 'file-fx02-opaque' },
        content: { kind: 'nonTextMetadata', reasonCode: 'NON_TEXT_UNPREVIEWABLE' },
      },
    });
  });

  it('拒绝 malformed non-text fallback，保留稳定 failure 而不把未知 reasonCode 暴露给 session', async () => {
    const snapshot = validNonTextSnapshot();
    (snapshot.content as Record<string, unknown>).reasonCode = 'INVENTED_REASON';
    replyWith({ kind: 'readSucceeded', snapshot });

    const result = await createTauriGateway().read({
      kind: 'nativeFile',
      asset: FX02_SKILL,
      fileId: 'file-fx02-opaque',
    });

    expect(result).toMatchObject({
      kind: 'readFailed',
      reasonCode: 'GATEWAY_UNAVAILABLE',
      recoveryAction: { kind: 'retryRead' },
    });
    expect(JSON.stringify(result)).not.toContain('INVENTED_REASON');
  });

  it.each([
    [
      'fileId',
      (snapshot: Record<string, unknown>, secret: string) => {
        (snapshot.file as Record<string, unknown>).fileId = secret;
        (
          (snapshot.content as Record<string, unknown>).sensitiveSegments as Array<
            Record<string, unknown>
          >
        )[0].fileId = secret;
        return secret;
      },
    ],
    [
      'name',
      (snapshot: Record<string, unknown>, secret: string) => {
        (snapshot.file as Record<string, unknown>).name = secret;
        return 'file-fx02-source';
      },
    ],
    [
      'relativePath',
      (snapshot: Record<string, unknown>, secret: string) => {
        (snapshot.file as Record<string, unknown>).relativePath = `references/${secret}.md`;
        return 'file-fx02-source';
      },
    ],
    [
      'segmentId',
      (snapshot: Record<string, unknown>, secret: string) => {
        (
          (snapshot.content as Record<string, unknown>).sensitiveSegments as Array<
            Record<string, unknown>
          >
        )[0].segmentId = secret;
        return 'file-fx02-source';
      },
    ],
  ])(
    '拒绝含敏感 %s 的 nested native-file，而不是把任一字符串带入 session',
    async (_field, mutate) => {
      const secret = ['SYNTHETIC-SECRET', 'native-file-identity'].join('-');
      const snapshot = validNativeSourceSnapshot();
      const requestFileId = mutate(snapshot, secret);
      replyWith({ kind: 'readSucceeded', snapshot });

      const result = await createTauriGateway().read({
        kind: 'nativeFile',
        asset: FX02_SKILL,
        fileId: requestFileId,
      });

      expect(result).toMatchObject({
        kind: 'readFailed',
        reasonCode: 'GATEWAY_UNAVAILABLE',
        recoveryAction: { kind: 'retryRead' },
      });
      expect(JSON.stringify(result)).not.toContain(secret);
    },
  );

  it('拒绝 revision 不匹配的 sensitive segment，而不是把过期遮蔽状态带入 session', async () => {
    const snapshot = validNativeSourceSnapshot();
    (
      (snapshot.content as Record<string, unknown>).sensitiveSegments as Array<
        Record<string, unknown>
      >
    )[0].revision = 'rev-fx02-stale-segment';
    replyWith({ kind: 'readSucceeded', snapshot });

    const result = await createTauriGateway().read({
      kind: 'nativeFile',
      asset: FX02_SKILL,
      fileId: 'file-fx02-source',
    });

    expect(result).toMatchObject({
      kind: 'readFailed',
      reasonCode: 'GATEWAY_UNAVAILABLE',
      recoveryAction: { kind: 'retryRead' },
    });
  });

  it('拒绝未遮蔽的 type-specific detail display/path/source 字段，而不是将其嵌套进详情', async () => {
    const unmasked = ['SYNTHETIC-SECRET', 'detail-token-0001'].join('-');
    const snapshot = validSkillDetailSnapshot();
    const detail = snapshot.detail as Record<string, unknown>;
    const inspector = snapshot.inspector as Record<string, unknown>;
    detail.displayName = `Skill ${unmasked}`;
    (detail.effectiveContexts as Array<Record<string, unknown>>)[0].sourceTierLabel = unmasked;
    inspector.pathDisplay = `/synthetic/${unmasked}`;
    (inspector.sourceAnchor as Record<string, unknown>).label = unmasked;
    replyWith({ kind: 'readSucceeded', snapshot });

    const result = await createTauriGateway().read({ kind: 'assetDetail', asset: FX02_SKILL });

    expect(result).toMatchObject({
      kind: 'readFailed',
      reasonCode: 'GATEWAY_UNAVAILABLE',
      recoveryAction: { kind: 'retryRead' },
    });
    expect(JSON.stringify(result)).not.toContain(unmasked);
  });

  it('拒绝 malformed nested detail effectiveContext，而不是以 unsafe cast 传入 session', async () => {
    const snapshot = validSkillDetailSnapshot();
    (
      (snapshot.detail as Record<string, unknown>).effectiveContexts as Array<
        Record<string, unknown>
      >
    )[0] = {
      agent: 'invented-agent',
      scope: 'global',
      sourceTierLabel: 'FX-02 synthetic source',
      precedence: 0,
    };
    replyWith({ kind: 'readSucceeded', snapshot });

    const result = await createTauriGateway().read({ kind: 'assetDetail', asset: FX02_SKILL });

    expect(result).toMatchObject({
      kind: 'readFailed',
      reasonCode: 'GATEWAY_UNAVAILABLE',
      recoveryAction: { kind: 'retryRead' },
    });
  });

  it('拒绝带敏感 tree-node identity 的 multi-file detail，而不是把路径树交给 UI', async () => {
    const secret = ['SYNTHETIC-SECRET', 'tree-node'].join('-');
    const snapshot = validSkillDetailSnapshot();
    const detail = snapshot.detail as Record<string, unknown>;
    detail.nativeUnitKind = 'multiFileDirectory';
    detail.fileTreeRoot = {
      name: secret,
      children: [{ name: 'SKILL.md', file: detail.primaryFile }],
    };
    replyWith({ kind: 'readSucceeded', snapshot });

    const result = await createTauriGateway().read({ kind: 'assetDetail', asset: FX02_SKILL });

    expect(result).toMatchObject({
      kind: 'readFailed',
      reasonCode: 'GATEWAY_UNAVAILABLE',
      recoveryAction: { kind: 'retryRead' },
    });
    expect(JSON.stringify(result)).not.toContain(secret);
  });
});
