/* global console, process */
/**
 * PF-02/PF-03 read-only performance runner。
 *
 * 本入口只消费 `performance/wdio.read.conf.ts` 产生的 raw `samples.json`，
 * 再写入同一 evidence 目录的 summary/proposed-budgets。首次完整 clean
 * baseline 只能返回 2，绝不创建或修改 `performance/budgets/**`。
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  ARTIFACTS_ROOT,
  REPO_ROOT,
  assertCurrentPfDescriptorDigest,
  capture,
  gitInfo,
  makeRunId,
  runStep,
  sanitizeText,
  scanEvidenceText,
  sha256File,
  writeJson,
} from './lib.mjs';
import {
  evaluateReadPfEvidence,
} from './pf-read-evidence.mjs';
import {
  collectPfReadMeasurementInputs,
  physicalPfReadRepoFile,
} from './pf-read-measurement-inputs.mjs';

const READ_CONFIG = Object.freeze({
  'PF-02': {
    descriptorPath: 'performance/descriptors/pf-02.source-large.json',
    budgetPath: (profile) => `performance/budgets/pf-02.${profile}.budgets.json`,
  },
  'PF-03': {
    descriptorPath: 'performance/descriptors/pf-03.multifile-workbench.json',
    budgetPath: (profile) => `performance/budgets/pf-03.${profile}.budgets.json`,
  },
});
const REQUIRED_BASELINE_ARTIFACTS = Object.freeze([
  'samples.json',
  'summary.json',
  'proposed-budgets.json',
]);

function isMainModule() {
  return process.argv[1] !== undefined && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url);
}

function relativeUnder(root, candidate) {
  const relative = path.relative(root, candidate);
  return relative !== '' && !relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative);
}

function physicalRegularFile(filePath, label) {
  const stat = fs.lstatSync(filePath);
  if (!stat.isFile() || stat.isSymbolicLink()) {
    throw new Error(`${label} 必须是物理 regular file`);
  }
  return filePath;
}

function repoFile(relativePath, label) {
  try {
    return physicalPfReadRepoFile(relativePath).absolute;
  } catch (error) {
    throw new Error(`${label}: ${error instanceof Error ? error.message : 'physical repo file 无效'}`);
  }
}

function parseArgs(argv) {
  const [descriptorId, ...flags] = argv;
  const config = READ_CONFIG[descriptorId];
  if (config === undefined) throw new Error(`未知 read PF: ${descriptorId ?? '(未提供)'}`);
  const profileFlags = flags.filter((flag) => flag.startsWith('--profile='));
  const outputFlags = flags.filter((flag) => flag.startsWith('--output-dir='));
  if (
    profileFlags.length > 1 ||
    outputFlags.length > 1 ||
    flags.some((flag) => !flag.startsWith('--profile=') && !flag.startsWith('--output-dir='))
  ) {
    throw new Error('PF read arguments 无效');
  }
  const profile = profileFlags[0]?.slice('--profile='.length) ?? 'representative';
  if (profile !== 'representative' && profile !== 'stress') throw new Error('PF read profile 无效');
  return { descriptorId, config, profile, outputDirFlag: outputFlags[0]?.slice('--output-dir='.length) };
}

function assertPhysicalDirectoryChain(root, target) {
  if (!relativeUnder(root, target) && path.resolve(root) !== path.resolve(target)) {
    throw new Error('physical path 越出 trusted root');
  }
  let current = path.resolve(root);
  const rootStat = fs.lstatSync(current);
  if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) {
    throw new Error('trusted root 必须是物理目录');
  }
  const relative = path.relative(current, target);
  for (const segment of relative.length === 0 ? [] : relative.split(path.sep)) {
    current = path.join(current, segment);
    const stat = fs.lstatSync(current);
    if (!stat.isDirectory() || stat.isSymbolicLink()) {
      throw new Error('path ancestry 必须全部为物理目录');
    }
  }
  const realRoot = fs.realpathSync(root);
  const realTarget = fs.realpathSync(target);
  if (!relativeUnder(realRoot, realTarget) && realRoot !== realTarget) {
    throw new Error('physical path realpath 越出 trusted root');
  }
}

/** Creates a fresh empty evidence leaf without following existing symlink ancestry. */
export function createNewPfReadOutputDirectory({ descriptorId, profile, outputDirFlag }) {
  const requested =
    outputDirFlag ?? path.join(ARTIFACTS_ROOT, 'performance', descriptorId, profile, makeRunId());
  const outputDir = path.resolve(requested);
  if (!relativeUnder(ARTIFACTS_ROOT, outputDir)) {
    throw new Error('PF read output directory 必须位于 .artifacts');
  }
  assertPhysicalDirectoryChain(REPO_ROOT, ARTIFACTS_ROOT);
  const relative = path.relative(ARTIFACTS_ROOT, outputDir);
  let current = ARTIFACTS_ROOT;
  const segments = relative.split(path.sep);
  for (const [index, segment] of segments.entries()) {
    const candidate = path.join(current, segment);
    const isLeaf = index === segments.length - 1;
    if (fs.existsSync(candidate)) {
      if (isLeaf) throw new Error('PF read output leaf 必须为本次新建目录');
      const stat = fs.lstatSync(candidate);
      if (!stat.isDirectory() || stat.isSymbolicLink()) {
        throw new Error('PF read output ancestry 必须全部为物理目录');
      }
    } else {
      fs.mkdirSync(candidate);
    }
    current = candidate;
  }
  assertPhysicalDirectoryChain(REPO_ROOT, outputDir);
  if (fs.readdirSync(outputDir).length !== 0) throw new Error('PF read output leaf 必须为空');
  return outputDir;
}

async function runtimeAttestation() {
  const [node, npm, swvers, release, arch, rustc, cargo] = await Promise.all([
    capture('node', ['--version']),
    capture('corepack', ['npm', '--version']),
    capture('sw_vers', ['-productVersion']),
    capture('uname', ['-r']),
    capture('uname', ['-m']),
    capture('rustc', ['--version']),
    capture('cargo', ['--version']),
  ]);
  if ([node, npm, swvers, release, arch, rustc, cargo].some((result) => result.exitCode !== 0)) {
    throw new Error('runner/toolchain attestation 无法采集');
  }
  return {
    runner: {
      node: node.stdout.trim(),
      npm: npm.stdout.trim(),
      platform: 'darwin',
      release: release.stdout.trim(),
      macosProductVersion: swvers.stdout.trim(),
      arch: arch.stdout.trim(),
    },
    toolchain: { rustc: rustc.stdout.trim(), cargo: cargo.stdout.trim() },
  };
}

/** Reread the immutable baseline artifacts through a physical, contained path. */
export function readPfReadBaselineArtifactDigests(
  budget,
  { repoRoot = REPO_ROOT, artifactsRoot = path.join(repoRoot, '.artifacts') } = {},
) {
  const run = budget?.baselineProvenance?.run;
  if (
    typeof run !== 'string' ||
    run.length === 0 ||
    run.includes('\0') ||
    run.includes('\\') ||
    run.startsWith('/') ||
    run.split('/').some((segment) => segment.length === 0 || segment === '.' || segment === '..')
  ) {
    throw new Error('budget baseline run 必须是规范 artifact-relative path');
  }
  const baselineRoot = path.resolve(repoRoot, run);
  if (!relativeUnder(artifactsRoot, baselineRoot)) {
    throw new Error('budget baseline run 必须位于 .artifacts');
  }
  assertPhysicalDirectoryChain(repoRoot, artifactsRoot);
  assertPhysicalDirectoryChain(artifactsRoot, baselineRoot);
  const artifacts = Object.fromEntries(
    REQUIRED_BASELINE_ARTIFACTS.map((name) => {
      const artifactPath = path.join(baselineRoot, name);
      physicalRegularFile(artifactPath, `budget baseline ${name}`);
      const realArtifactsRoot = fs.realpathSync(artifactsRoot);
      const realArtifact = fs.realpathSync(artifactPath);
      if (!relativeUnder(realArtifactsRoot, realArtifact)) {
        throw new Error(`budget baseline ${name} realpath 越出 .artifacts`);
      }
      const raw = fs.readFileSync(artifactPath, 'utf8');
      if (!scanEvidenceText(raw).clean) {
        throw new Error(`budget baseline ${name} 扫描命中敏感值或个人路径`);
      }
      return [name, { digest: sha256File(artifactPath), payload: JSON.parse(raw) }];
    }),
  );
  return {
    digests: Object.fromEntries(
      REQUIRED_BASELINE_ARTIFACTS.map((name) => [name, artifacts[name].digest]),
    ),
    evidence: {
      samplesPayload: artifacts['samples.json'].payload,
      summary: artifacts['summary.json'].payload,
      proposedBudgets: artifacts['proposed-budgets.json'].payload,
    },
  };
}

function readBudget({ config, profile }) {
  const budgetPath = path.resolve(REPO_ROOT, config.budgetPath(profile));
  if (!fs.existsSync(budgetPath)) return { budget: undefined, baselineArtifactDigests: undefined };
  repoFile(config.budgetPath(profile), 'versioned budget');
  const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
  if (budget?.path !== config.budgetPath(profile)) {
    throw new Error('versioned budget path 未绑定当前 PF/profile');
  }
  const baseline = readPfReadBaselineArtifactDigests(budget);
  return {
    budget,
    baselineArtifactDigests: baseline.digests,
    baselineEvidence: baseline.evidence,
  };
}

function writeEvidence(outputDir, name, payload) {
  assertPhysicalDirectoryChain(REPO_ROOT, outputDir);
  const destination = path.join(outputDir, name);
  if (fs.existsSync(destination)) throw new Error(`${name} 已存在，拒绝覆盖 evidence`);
  const serialized = sanitizeText(JSON.stringify(payload, null, 2));
  const scan = scanEvidenceText(serialized);
  if (!scan.clean) throw new Error(`${name} 扫描命中敏感占位值或个人路径`);
  writeJson(destination, JSON.parse(serialized));
}

function readFixtureAttestation({ outputDir, descriptorId, profile, expectedFixtureDigest }) {
  const attestationPath = path.join(outputDir, 'fixture-attestation.json');
  physicalRegularFile(attestationPath, 'PF read fixture attestation');
  const raw = fs.readFileSync(attestationPath, 'utf8');
  if (!scanEvidenceText(raw).clean) {
    throw new Error('fixture attestation 扫描命中敏感值或个人路径');
  }
  const attestation = JSON.parse(raw);
  const keys = Object.keys(attestation).sort();
  if (
    JSON.stringify(keys) !== JSON.stringify(['descriptorId', 'fixtureDigest', 'profile', 'schemaVersion']) ||
    attestation.schemaVersion !== 1 ||
    attestation.descriptorId !== descriptorId ||
    attestation.profile !== profile ||
    attestation.fixtureDigest !== expectedFixtureDigest ||
    typeof attestation.fixtureDigest !== 'string' ||
    !/^[0-9a-f]{64}$/i.test(attestation.fixtureDigest)
  ) {
    throw new Error('fixture attestation 未绑定当前 descriptor/profile/public bundle digest');
  }
  return attestation.fixtureDigest;
}

/** Executes one PF-02/PF-03 L2 read sampling run; callers own process exit. */
export async function runReadPf(argv = process.argv.slice(2)) {
  let parsed;
  try {
    parsed = parseArgs(argv);
  } catch (error) {
    console.error(`FAIL  ${error instanceof Error ? error.message : 'PF read arguments 无效'}`);
    return { exitCode: 1 };
  }
  if (process.env.PERF_OUTPUT_DIR !== undefined) {
    console.error('INCONCLUSIVE  拒绝 ambient PERF_OUTPUT_DIR；只能使用 --output-dir');
    return { exitCode: 2 };
  }

  let outputDir;
  let descriptor;
  let descriptorDigest;
  let inputs;
  let runtime;
  let startingGit;
  try {
    outputDir = createNewPfReadOutputDirectory({
      descriptorId: parsed.descriptorId,
      profile: parsed.profile,
      outputDirFlag: parsed.outputDirFlag,
    });
    ({ descriptor, digest: descriptorDigest } = assertCurrentPfDescriptorDigest(
      repoFile(parsed.config.descriptorPath, 'PF descriptor'),
    ));
    runtime = await runtimeAttestation();
    startingGit = await gitInfo();
  } catch (error) {
    console.error(`INCONCLUSIVE  PF read preflight 无法证明：${error instanceof Error ? error.message : 'unknown'}`);
    return { exitCode: 2 };
  }

  if (startingGit.worktreeDirty !== false) {
    console.error('INCONCLUSIVE  PF read baseline 必须从 clean worktree 开始');
    return { exitCode: 2 };
  }

  const wdio = await runStep({
    cmd: 'corepack',
    args: ['npm', 'exec', '--', 'wdio', 'run', 'performance/wdio.read.conf.ts'],
    timeoutMs: 1_800_000,
    env: {
      PF_READ_DESCRIPTOR_ID: parsed.descriptorId,
      PF_READ_PROFILE: parsed.profile,
      PF_READ_OUTPUT_DIR: outputDir,
    },
  });
  if (wdio.exitCode !== 0) {
    console.error(`FAIL  PF read L2 sampling exit ${wdio.exitCode}`);
    return { exitCode: 1 };
  }

  let samplesPayload;
  let fixtureDigest;
  let budget;
  let baselineArtifactDigests;
  let baselineEvidence;
  let endingGit;
  try {
    const samplesPath = path.join(outputDir, 'samples.json');
    physicalRegularFile(samplesPath, 'PF read samples');
    const rawSamples = fs.readFileSync(samplesPath, 'utf8');
    if (!scanEvidenceText(rawSamples).clean) throw new Error('raw samples 扫描命中敏感值或个人路径');
    samplesPayload = JSON.parse(rawSamples);
    fixtureDigest = readFixtureAttestation({
      outputDir,
      descriptorId: parsed.descriptorId,
      profile: parsed.profile,
      expectedFixtureDigest: descriptor.fixture?.profileDigests?.[parsed.profile],
    });
    const graphPath = path.join(outputDir, 'l2-dev-module-graph.json');
    physicalRegularFile(graphPath, 'PF read actual Vite ModuleGraph');
    if (!scanEvidenceText(fs.readFileSync(graphPath, 'utf8')).clean) {
      throw new Error('actual Vite ModuleGraph 扫描命中敏感值或个人路径');
    }
    inputs = collectPfReadMeasurementInputs({
      graphPath,
      descriptorPath: parsed.config.descriptorPath,
    });
    ({ budget, baselineArtifactDigests, baselineEvidence } = readBudget({
      config: parsed.config,
      profile: parsed.profile,
    }));
    endingGit = await gitInfo();
  } catch (error) {
    console.error(`INCONCLUSIVE  PF read evidence 无法证明：${error instanceof Error ? error.message : 'unknown'}`);
    return { exitCode: 2 };
  }

  const result = evaluateReadPfEvidence({
    descriptor,
    descriptorDigest,
    profile: parsed.profile,
    fixtureDigest,
    samplesPayload,
    runIdentity: { start: startingGit, end: endingGit },
    runtime,
    measurementInputs: inputs,
    budget,
    baselineArtifactDigests,
    baselineEvidence,
  });
  try {
    writeEvidence(outputDir, 'summary.json', result.summary);
    writeEvidence(outputDir, 'proposed-budgets.json', result.proposedBudgets);
  } catch (error) {
    console.error(`FAIL  PF read evidence 写入失败：${error instanceof Error ? error.message : 'unknown'}`);
    return { exitCode: 1 };
  }

  console.log(`PF read ${parsed.descriptorId}/${parsed.profile}: ${result.summary.status}`);
  console.log(`evidence: ${sanitizeText(outputDir)}`);
  return { exitCode: result.exitCode };
}

if (isMainModule()) {
  const result = await runReadPf();
  process.exit(result.exitCode);
}
