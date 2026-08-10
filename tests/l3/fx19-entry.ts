/**
 * FE-07R L3 bare entry：不挂载 UI，只通过 production Tauri gateway 读取 FX-19。
 *
 * 路径为 createTauriGateway().read → frontend_gateway_read → GatewayCore →
 * AdapterRegistry/ProjectApplicabilityResolver → ACM_FX19_ROOT/fixture.json。
 */
import { createTauriGateway } from '../../src/gateway/tauri';
import type { ProjectApplicabilityQuery } from '../../src/contract/types';

declare global {
  interface Window {
    __runFx19ActualRead?: () => Promise<{ passed: string[]; error: string | null }>;
  }
}

function project(projectId: string): ProjectApplicabilityQuery {
  return { kind: 'projectApplicability', view: { kind: 'project', projectId } };
}

window.__runFx19ActualRead = async () => {
  try {
    const gateway = createTauriGateway();
    const [all, global, sameA, resolved, provenanceDrift, unknown, blocked, stale] =
      await Promise.all([
        gateway.read({ kind: 'projectApplicability', view: { kind: 'all' } }),
        gateway.read({ kind: 'projectApplicability', view: { kind: 'global' } }),
        gateway.read(project('project-same-a')),
        gateway.read(project('project-same-b')),
        gateway.read(project('project-provenance-drift')),
        gateway.read(project('project-unknown')),
        gateway.read(project('project-blocked')),
        gateway.read(project('project-stale')),
      ]);
    if (
      all.kind !== 'readSucceeded' ||
      global.kind !== 'readSucceeded' ||
      sameA.kind !== 'readSucceeded' ||
      resolved.kind !== 'readSucceeded' ||
      provenanceDrift.kind !== 'readSucceeded' ||
      unknown.kind !== 'readSucceeded' ||
      blocked.kind !== 'readSucceeded' ||
      stale.kind !== 'readSucceeded'
    ) {
      return { passed: [], error: 'FX-19 gateway read 未返回完整成功 snapshot' };
    }
    const nonResolved = [provenanceDrift, unknown, blocked, stale];
    const expectedFindings = [
      ['project-provenance-drift', 'stale', 'EXTERNAL_CHANGE'],
      ['project-unknown', 'unknown', 'UNKNOWN_AGENT_VERSION'],
      ['project-blocked', 'blocked', 'PERMISSION_DENIED'],
      ['project-stale', 'stale', 'EXTERNAL_CHANGE'],
    ];
    const hasStableFindings = (findings: typeof all.snapshot.findings) =>
      JSON.stringify(
        findings.map((finding) => [
          finding.context.projectId,
          finding.context.resolution,
          finding.context.reasonCode,
        ]),
      ) === JSON.stringify(expectedFindings);
    if (
      all.snapshot.findings.length !== 4 ||
      global.snapshot.findings.length !== 4 ||
      !hasStableFindings(all.snapshot.findings) ||
      !hasStableFindings(global.snapshot.findings)
    ) {
      return {
        passed: [],
        error: 'all/global 未保留 provenance drift 与三类 fail-closed findings',
      };
    }
    if (
      !resolved.snapshot.segments.some((segment) => segment.kind === 'globalApplicable') ||
      resolved.snapshot.segments.find((segment) => segment.kind === 'globalApplicable')?.assets[0]
        ?.asset.nativeOwnership.kind !== 'global'
    ) {
      return { passed: [], error: 'resolved 项目未保留 global native ownership 投影' };
    }
    if (
      nonResolved.some((result) =>
        result.snapshot.segments.some((segment) => segment.kind === 'globalApplicable'),
      )
    ) {
      return {
        passed: [],
        error: 'provenance drift/unknown/blocked/stale 错误进入 project global projection',
      };
    }
    if (
      sameA.snapshot.segments[0]?.projectId !== 'project-same-a' ||
      resolved.snapshot.segments[0]?.projectId !== 'project-same-b' ||
      sameA.snapshot.segments[0]?.id === resolved.snapshot.segments[0]?.id
    ) {
      return { passed: [], error: '同名项目未以 opaque projectId 绑定各自 snapshot' };
    }
    const active = all.snapshot.effectiveContexts.find(
      (context) => context.projectId === 'project-same-a',
    );
    const builtIn = all.snapshot.effectiveContexts.find(
      (context) => context.projectId === 'project-same-b',
    );
    if (
      active?.adapter.source.kind !== 'activePackage' ||
      active.adapter.version !== '2.1.0' ||
      active.rule.identity !== 'claude-skill-rule' ||
      active.rule.version !== '2.1.0' ||
      builtIn?.adapter.source.kind !== 'builtIn' ||
      builtIn.adapter.version !== '1.0.0' ||
      builtIn.rule.identity !== 'claude-skill-rule' ||
      builtIn.rule.version !== '1.0.0'
    ) {
      return { passed: [], error: 'Adapter/rule provenance 或 revision 不符合 FX-19' };
    }
    return {
      passed: [
        'all/global findings',
        'resolved global ownership',
        'bound provenance drift',
        'fail-closed project exclusion',
        'opaque identity and provenance',
      ],
      error: null,
    };
  } catch {
    return { passed: [], error: 'FX-19 bare Tauri read 抛出 transport/contract 异常' };
  }
};
