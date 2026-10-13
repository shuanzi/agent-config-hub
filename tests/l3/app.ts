// Only the harness initializes WebDriver. The production entry and every command stay real.
import { init } from '@wdio/tauri-plugin';
await init();
await import('../../src/main');
