import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import { describe, expect, it } from 'vitest';

// prettier-ignore
// @ts-expect-error runtime freezer module is a plain Node ESM module.
import { PF01_BASELINE_ARTIFACTS, validatePf01FrozenBaselineBinding } from '../../scripts/orchestrator/pf01-baseline-freeze.mjs';

const run = '.artifacts/performance/PF-01/20260812T033832054Z-p69961-000';

function refreshSelfDigest(binding: Record<string, unknown>) {
  const canonical = structuredClone(binding) as { digest: { value: string } };
  canonical.digest.value = '';
  (binding.digest as { value: string }).value = createHash('sha256')
    .update(`${JSON.stringify(canonical, null, 2)}\n`)
    .digest('hex');
}

function validateActualBinding(binding: Record<string, unknown>) {
  const budget = execFileSync(
    'git',
    ['show', '9c91e042c39023d7a30fcc04fbd1d0e36985fdbf:performance/budgets/pf-01.budgets.json'],
    { encoding: 'utf8' },
  );
  const samples = JSON.parse(fs.readFileSync(`${run}/samples.json`, 'utf8'));
  const l3Samples = JSON.parse(fs.readFileSync(`${run}/l3-samples.json`, 'utf8'));
  const resources = JSON.parse(fs.readFileSync(`${run}/l3-resource-runs.json`, 'utf8'));
  const artifactSha256 = Object.fromEntries(
    PF01_BASELINE_ARTIFACTS.map((file: string) => [
      file,
      createHash('sha256')
        .update(fs.readFileSync(`${run}/${file}`))
        .digest('hex'),
    ]),
  );
  return validatePf01FrozenBaselineBinding({
    binding,
    budgetText: budget,
    l2Samples: samples,
    l3Samples,
    resourceRuns: resources,
    artifactSha256,
  });
}

describe('PF-01 immutable frozen baseline binding', () => {
  it('直接从 committed budget、freeze 和 raw artifacts 重算 7 SHA、样本、RSS/normalExit 与 buildEnvironment', () => {
    const binding = JSON.parse(fs.readFileSync('performance/budgets/pf-01.freeze.json', 'utf8'));
    expect(validateActualBinding(binding)).toEqual({ valid: true, violations: [] });
    expect(Object.keys(binding.baseline.artifactSha256)).toHaveLength(7);
  });

  it('即使重算 binding self-digest，也拒绝 measurementContract.buildEnvironment 漂移', () => {
    const binding = JSON.parse(fs.readFileSync('performance/budgets/pf-01.freeze.json', 'utf8'));
    binding.baseline.measurementContract.buildEnvironment.overrides = ['VITE_UNAUTHORIZED'];
    refreshSelfDigest(binding);
    expect(validateActualBinding(binding)).toMatchObject({ valid: false });
  });

  it('拒绝 contract nested 的 missing、extra 与 artifact/build/measurement/fixture/runtime/toolchain drift', () => {
    const source = JSON.parse(fs.readFileSync('performance/budgets/pf-01.freeze.json', 'utf8'));
    const baselineIdentity = [
      ['runId', 'forged-run'],
      ['run', '.artifacts/performance/PF-01/forged-run'],
      ['commit', '0'.repeat(40)],
      ['descriptorDigest', '0'.repeat(64)],
      ['worktreeDirty', true],
    ] as const;
    const mutations: Array<[string, (binding: typeof source) => void]> = [
      ...baselineIdentity.flatMap(
        ([field, drift]) =>
          [
            [
              `baseline ${field} missing`,
              (binding: typeof source) => delete binding.baseline[field],
            ],
            [
              `baseline ${field} drift`,
              (binding: typeof source) => (binding.baseline[field] = drift),
            ],
          ] as Array<[string, (binding: typeof source) => void]>,
      ),
      ['baseline identity extra', (binding: typeof source) => (binding.baseline.extra = true)],
      [
        'descriptor missing',
        (binding: typeof source) => delete binding.baseline.measurementContract.descriptorPath,
      ],
      [
        'artifact extra',
        (binding: typeof source) => (binding.baseline.measurementContract.artifact.extra = true),
      ],
      [
        'artifact hash drift',
        (binding: typeof source) =>
          (binding.baseline.measurementContract.artifact.actualBinarySha256 = '0'.repeat(64)),
      ],
      [
        'build schema drift',
        (binding: typeof source) =>
          (binding.baseline.measurementContract.buildInputs.schemaVersion = 99),
      ],
      [
        'measurement digest drift',
        (binding: typeof source) =>
          (binding.baseline.measurementContract.measurementInputs.digest = '0'.repeat(64)),
      ],
      [
        'fixture extra',
        (binding: typeof source) => (binding.baseline.measurementContract.fixture.extra = true),
      ],
      [
        'runner missing',
        (binding: typeof source) => delete binding.baseline.measurementContract.runner.node,
      ],
      [
        'toolchain extra',
        (binding: typeof source) =>
          (binding.baseline.measurementContract.toolchain.extra = 'forbidden'),
      ],
      [
        'raw timing extra metric',
        (binding: typeof source) => (binding.baseline.rawTiming['pf01.untrusted'] = []),
      ],
      [
        'raw timing sample drift',
        (binding: typeof source) =>
          binding.baseline.rawTiming['pf01.startup.first_list_visible'].push(0),
      ],
      ['resource extra', (binding: typeof source) => (binding.baseline.resource.extra = true)],
    ];
    for (const [label, mutate] of mutations) {
      const binding = structuredClone(source);
      mutate(binding);
      refreshSelfDigest(binding);
      expect(validateActualBinding(binding), label).toMatchObject({ valid: false });
    }
  });
});
