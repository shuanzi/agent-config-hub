/* global console, process */
import { createServer } from 'vite';
import { parseArgs } from 'node:util';
import { REPO_ROOT } from '../orchestrator/lib.mjs';
const { values } = parseArgs({ options: { port: { type: 'string', default: '1421' } } });
const server = await createServer({ root: REPO_ROOT, server: { host: '127.0.0.1', port: Number(values.port), strictPort: true, watch: { ignored: ['**/.artifacts/**', '**/src-tauri/target/**'] } } });
await server.listen();
console.log(`\n浏览器验收（模拟数据）：http://127.0.0.1:${values.port}/tests/acceptance/\n刷新恢复样例。真实文件验收：npm run accept:app\n`);
for (const signal of ['SIGINT', 'SIGTERM']) process.once(signal, async () => { await server.close(); process.exit(0); });
