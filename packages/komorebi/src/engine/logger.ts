import { createSatori } from "@nisoku/satori";
import type { KomorebiLogger } from "./adapters";

const satori = createSatori({
  logLevel: "debug",
  rateLimiting: {
    enabled: true,
    maxEventsPerSecond: 100,
  },
});

export function createKomorebiLogger(scope: string): KomorebiLogger {
  const logger = satori.createLogger(scope);
  return {
    debug: (message, context) =>
      logger.debug(message, context ? { state: context } : undefined),
    warn: (message, context) =>
      logger.warn(message, context ? { state: context } : undefined),
    error: (message, context) =>
      logger.error(message, context ? { state: context } : undefined),
  };
}
