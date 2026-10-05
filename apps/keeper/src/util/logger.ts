import pino, { type Logger } from 'pino';

const level = process.env.LOG_LEVEL ?? 'info';
const pretty =
  process.env.LOG_PRETTY === 'true' || (process.stdout.isTTY && process.env.NODE_ENV !== 'production');

export const logger: Logger = pino(
  pretty
    ? {
        level,
        transport: {
          target: 'pino-pretty',
          options: { colorize: true, translateTime: 'SYS:HH:MM:ss.l', ignore: 'pid,hostname' },
        },
      }
    : { level },
);

export function childLogger(name: string, bindings: Record<string, unknown> = {}): Logger {
  return logger.child({ mod: name, ...bindings });
}
