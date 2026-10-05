// Next dev against a LOCAL keeper with the devnet burner wallet enabled: `node apps/web-v2/scripts/dev-local.mjs`.
// Shell env wins over .env.local in Next, so this points the site at http://localhost:8787 without editing env files.
import { spawn } from 'node:child_process';
import { fileURLToPath } from 'node:url';
const cwd = fileURLToPath(new URL('..', import.meta.url));
const env = { ...process.env, NODE_OPTIONS: process.env.NODE_OPTIONS ?? '--max-old-space-size=6144', NEXT_PUBLIC_API_URL: process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:8787', NEXT_PUBLIC_CLUSTER: process.env.NEXT_PUBLIC_CLUSTER ?? 'devnet', NEXT_PUBLIC_RPC_URL: process.env.NEXT_PUBLIC_RPC_URL ?? 'https://api.devnet.solana.com' };
const child = spawn(process.platform === 'win32' ? 'npx.cmd' : 'npx', ['next', 'dev', '-p', process.env.PORT ?? '3100'], { stdio: 'inherit', env, cwd, shell: process.platform === 'win32' });
child.on('exit', (code) => process.exit(code ?? 0));
