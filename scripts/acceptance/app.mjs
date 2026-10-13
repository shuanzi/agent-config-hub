/* global console, process */
import fs from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
import { spawnSync } from 'node:child_process';
import { REPO_ROOT, runStep } from '../orchestrator/lib.mjs';
const { values } = parseArgs({ options: { fresh: { type: 'boolean', default: false }, 'no-build': { type: 'boolean', default: false }, home: { type: 'string' } } });
const root = path.join(REPO_ROOT, '.artifacts/acceptance');
const home = path.resolve(values.home ?? path.join(root, values.fresh ? `home-${Date.now()}` : 'home'));
const target = path.join(root, 'target');
const frontend = path.join(root, 'frontend');
const binary = path.join(target, 'debug/agent-config-manager');
const appBundle = path.join(target, 'debug/bundle/macos/Agent Config Manager UI Acceptance.app');
const launchBinary = process.platform === 'darwin'
  ? path.join(appBundle, 'Contents/MacOS/agent-config-manager')
  : binary;
function seed(relative, content) {
  const destination = path.join(home, relative);
  fs.mkdirSync(path.dirname(destination), { recursive: true });
  try { fs.writeFileSync(destination, content, { flag: 'wx' }); } catch (error) { if (error.code !== 'EEXIST') throw error; }
}
const marker = path.join(home, '.acceptance-initialized');
if (!fs.existsSync(marker)) {
  for (const name of ['code-review', 'frontend-design']) seed(`.claude/skills/${name}/SKILL.md`, `---\nname: ${name}\ndescription: Polished UI 本地验收 Skill\n---\n# ${name}\n检查正确性、回归与遗漏测试。\n`);
  seed('.agents/skills/shared-helper/SKILL.md', '---\nname: shared-helper\ndescription: 共享目录接管验收\n---\n只执行用户要求的任务。\n');
  seed('.codex/AGENTS.md', '# 协作约定\n使用中文，先说明结论。\n');
  seed('.config/opencode/AGENTS.md', '# 协作约定\n使用中文，先说明结论。\n');
  seed('.claude/CLAUDE.md', '验收保护文件：不应被 AGENTS.md 保存或目录覆盖修改。\n');
  seed('.codex/agents/repo-reviewer.toml', 'name = "repo-reviewer"\ndescription = "审查仓库变更"\ndeveloper_instructions = "检查正确性、回归与遗漏测试。"\nsandbox_mode = "read-only"\n');
  seed('.claude/agents/security-reviewer.md', '---\nname: security-reviewer\ndescription: 检查明确要求的安全问题\n---\n先阅读，再报告。\n');
  seed('.config/opencode/agents/docs-writer.md', '---\ndescription: 文档审阅\nmode: subagent\n---\n保持文档与实现一致。\n');
  for (const name of ['visual-alpha', 'visual-beta']) seed(`projects/${name}/AGENTS.md`, `# ${name}\n项目约定保持隔离。\n`);
  seed('projects/visual-alpha/.agents/skills/project-conventions/SKILL.md', '---\nname: project-conventions\ndescription: 项目约定\n---\n使用中文交流。\n');
  seed('fixtures/acceptance-skill/SKILL.md', '---\nname: acceptance-skill\ndescription: ZIP 安装验收\n---\n安装仅使用显式选择的位置。\n');
  const zip = spawnSync('/usr/bin/zip', ['-qr', 'acceptance-skill.zip', 'acceptance-skill'], { cwd: path.join(home, 'fixtures'), encoding: 'utf8' });
  if (zip.status !== 0) throw new Error(`生成 ZIP 失败：${zip.stderr}`);
  seed('.acceptance-initialized', new Date().toISOString());
}
console.log(`\n隔离桌面验收\nACM_HOME=${home}\n项目目录：${path.join(home, 'projects')}\nZIP：${path.join(home, 'fixtures/acceptance-skill.zip')}\n重复启动保留数据；--fresh 另建目录。退出后可使用 --home 指定本次目录。\n`);
if (!values['no-build']) {
  for (const args of [
    ['npm', 'run', 'build:frontend', '--', '--outDir', frontend],
    ['npm', 'exec', '--', 'tauri', 'build', '--debug', ...(process.platform === 'darwin' ? ['--bundles', 'app'] : ['--no-bundle']), '--config', JSON.stringify({ productName: 'Agent Config Manager UI Acceptance', identifier: 'com.agentconfigmanager.acceptance', build: { frontendDist: frontend }, bundle: { active: process.platform === 'darwin' }, app: { windows: [{ label: 'main', title: 'Agent Config Manager · 隔离验收', width: 1280, height: 800 }] } })],
  ]) {
    const result = await runStep({ cmd: 'corepack', args, env: { CARGO_TARGET_DIR: target }, timeoutMs: 1_800_000 });
    if (result.exitCode !== 0) process.exit(result.exitCode);
  }
}
if (!fs.existsSync(launchBinary)) throw new Error('验收应用尚未构建，请先运行 npm run accept:app。');
if (process.platform === 'darwin') {
  // Keep the sandbox when macOS reopens the app without the terminal environment.
  const plistPath = path.join(appBundle, 'Contents/Info.plist');
  const plist = spawnSync('/usr/bin/plutil', ['-replace', 'LSEnvironment', '-json', JSON.stringify({ ACM_HOME: home }), plistPath], { encoding: 'utf8' });
  if (plist.status !== 0) throw new Error(`写入验收应用隔离环境失败：${plist.stderr}`);
}
const result = await runStep({ cmd: launchBinary, args: [], env: { ACM_HOME: home }, timeoutMs: 0 });
process.exit(result.exitCode);
