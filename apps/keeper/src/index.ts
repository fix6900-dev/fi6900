/** `keeper run` entry: API server + scheduler (live) or API server + mock ticker (MOCK_MODE). */
import { createApp, startServer } from './api/server.js';
import { loadEnv } from './config/env.js';
import { MockProvider } from './mock/provider.js';
import { EventBus } from './util/events.js';
import { logger } from './util/logger.js';
import { createLiveContext, registerJobs } from './app.js';

export async function main(): Promise<() => Promise<void>> {
  const env = loadEnv();
  if (env.MOCK_MODE) {
    const events = new EventBus();
    const provider = new MockProvider(events);
    provider.start();
    const server = startServer(createApp({ provider, events, corsOrigin: env.CORS_ORIGIN }), env.PORT);
    logger.info({ port: env.PORT }, 'keeper running in MOCK_MODE (no chain access)');
    return async () => {
      provider.stop();
      server.close();
    };
  }

  const ctx = await createLiveContext();
  registerJobs(ctx);
  const server = startServer(createApp({ provider: ctx.provider, events: ctx.events, corsOrigin: env.CORS_ORIGIN, adminToken: env.ADMIN_TOKEN }), env.PORT);
  ctx.scheduler.start();
  logger.info({ port: env.PORT, dryRun: env.DRY_RUN }, env.DRY_RUN ? 'keeper running (DRY_RUN: nothing is sent on-chain)' : 'keeper running LIVE');
  return async () => {
    ctx.scheduler.stop();
    server.close();
    ctx.close();
  };
}

const isEntry = process.argv[1] && /index\.(ts|js)$/.test(process.argv[1]);
if (isEntry) {
  main()
    .then((stop) => {
      const shutdown = (sig: string): void => {
        logger.info({ sig }, 'shutting down');
        void stop().finally(() => process.exit(0));
      };
      process.on('SIGINT', () => shutdown('SIGINT'));
      process.on('SIGTERM', () => shutdown('SIGTERM'));
    })
    .catch((err: Error) => {
      logger.fatal({ err: err.message, stack: err.stack }, 'keeper failed to start');
      process.exit(1);
    });
}
