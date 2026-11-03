import { spawn } from 'node:child_process';
import { createInterface } from 'node:readline';
import type { CodexProjectLaunchPlan } from '../../src/types';

/** Offline metadata read: no inference, account access or user config writes. */
export async function codexSkillEnabled(
  plan: CodexProjectLaunchPlan,
  name: string,
): Promise<boolean> {
  if (!plan.executablePath) throw new Error(plan.reason ?? 'Codex CLI unavailable');
  const child = spawn(plan.executablePath, [...plan.args, 'app-server', '--stdio'], {
    cwd: plan.projectRoot,
    env: { ...process.env, CODEX_HOME: plan.codexHome },
    stdio: ['pipe', 'pipe', 'ignore'],
  });
  const lines = createInterface({ input: child.stdout });
  return new Promise<boolean>((resolve, reject) => {
    const finish = (error?: Error, enabled?: boolean) => {
      clearTimeout(timer);
      lines.close();
      child.kill();
      if (error) reject(error);
      else resolve(enabled!);
    };
    const timer = setTimeout(() => finish(new Error('Codex skills/list timed out')), 15000);
    child.once('error', (error) => finish(error));
    child.once('exit', () => {
      clearTimeout(timer);
      reject(new Error('Codex probe exited before readback'));
    });
    const send = (value: unknown) => child.stdin.write(`${JSON.stringify(value)}\n`);
    lines.on('line', (line) => {
      let message: {
        id?: number;
        error?: unknown;
        result?: { data: { skills: { name: string; enabled: boolean }[] }[] };
      };
      try {
        message = JSON.parse(line);
      } catch {
        return;
      }
      if (message.error) {
        finish(new Error('Codex rejected the generated configuration'));
        return;
      }
      if (message.id === 1) {
        send({ method: 'initialized', params: {} });
        send({
          id: 2,
          method: 'skills/list',
          params: { cwds: [plan.projectRoot], forceReload: true },
        });
      } else if (message.id === 2) {
        const skill = message.result?.data
          .flatMap((entry) => entry.skills)
          .find((entry) => entry.name === name);
        if (!skill) finish(new Error(`Codex did not discover isolated Skill ${name}`));
        else finish(undefined, skill.enabled);
      }
    });
    send({
      id: 1,
      method: 'initialize',
      params: { clientInfo: { name: 'acm_project_exclusion_acceptance', version: '0.1' } },
    });
  });
}
