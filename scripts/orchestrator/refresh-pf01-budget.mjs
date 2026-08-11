/* global console */
/**
 * 方案 A 的一次性、可重算 budget provenance migration。
 * 从 versioned v2 budget 指向的 immutable baseline Git tree 重建 build-input digest，
 * 再由 PF-01 预算生成器写出 Prettier-compatible v3 JSON；不读取/改写历史 artifacts。
 */
import fs from 'node:fs';
import path from 'node:path';
import { REPO_ROOT } from './lib.mjs';
import { collectPf01L3HarnessBuildInputsFromGit } from './pf01-build-inputs.mjs';
import { formatPf01BudgetJson, migratePf01BudgetV2 } from './pf01-budget.mjs';

const budgetPath = path.join(REPO_ROOT, 'performance/budgets/pf-01.budgets.json');
const budget = JSON.parse(fs.readFileSync(budgetPath, 'utf8'));
const baselineBuildInputs = collectPf01L3HarnessBuildInputsFromGit({
  commit: budget?.baselineProvenance?.commit,
});
const migrated = migratePf01BudgetV2({ budget, baselineBuildInputs });
fs.writeFileSync(budgetPath, await formatPf01BudgetJson(migrated), 'utf8');
console.log(`PF-01 budget migrated: ${baselineBuildInputs.digest}`);
