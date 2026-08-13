/* global console, process */
import { writeFe01Pf01AutomaticPassRecord } from './fe01-pf01-automatic-pass.mjs';

function parseArguments(args) {
  if (args.length !== 1 || !args[0].startsWith('--comparison-run=')) {
    throw new Error('usage: generate-fe01-pf01-automatic-pass.mjs --comparison-run=<runId>');
  }
  const comparisonRun = args[0].slice('--comparison-run='.length);
  if (!/^\d{8}T\d{9}Z-p\d+-\d{3}$/.test(comparisonRun)) {
    throw new Error('automatic-pass comparison runId invalid');
  }
  return comparisonRun;
}

async function main() {
  try {
    const comparisonRun = parseArguments(process.argv.slice(2));
    const result = await writeFe01Pf01AutomaticPassRecord({ comparisonRun });
    console.log(`automatic-pass record written: ${result.recordPath} (${result.recordSha256})`);
  } catch (error) {
    console.error(`INCONCLUSIVE automatic-pass record generation: ${error.message}`);
    process.exitCode = 2;
  }
}

await main();
