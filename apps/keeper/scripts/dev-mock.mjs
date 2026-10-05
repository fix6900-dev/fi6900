// Local keeper in MOCK_MODE (no RPC, no keypairs) for frontend work: `node apps/keeper/scripts/dev-mock.mjs`.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('..', import.meta.url));
const env = { ...process.env, MOCK_MODE: 'true', PORT: process.env.PORT ?? '8787', ADMIN_TOKEN: process.env.ADMIN_TOKEN ?? 'mock-admin', LOG_LEVEL: process.env.LOG_LEVEL ?? 'info' };
const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['tsx', 'src/index.ts'], { stdio: 'inherit', env, cwd, shell: process.platform === 'win32' });
child.on('exit', (code) => process.exit(code ?? 0));
