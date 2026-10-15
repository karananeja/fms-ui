import { fileURLToPath } from 'node:url';

export interface MockConfig {
  port: number;
  seed: number;
  vehicles: number;
  vehicleIntervalMs: number;
  batchMs: number;
  snapshotChunk: number;
  dev: boolean;
  /** SQLite file (`MOCK_DB`), or `:memory:` (vitest/e2e). D-119. */
  dbPath: string;
}

export const MAX_VEHICLES = 1_000_000;
export const DEFAULT_DB_PATH = fileURLToPath(new URL('./data/fms.db', import.meta.url));

const int = (value: string | undefined, fallback: number, min: number, max: number) => {
  const n = value === undefined || value === '' ? fallback : Number(value);
  if (!Number.isInteger(n) || n < min || n > max) {
    throw new Error(`Invalid mock config value "${value}" (expected integer ${min}..${max})`);
  }
  return n;
};

export function loadConfig(env: NodeJS.ProcessEnv = process.env): MockConfig {
  return {
    port: int(env.MOCK_PORT, 4000, 0, 65535),
    seed: int(env.MOCK_SEED, 42, 0, 2 ** 31 - 1),
    vehicles: int(env.MOCK_VEHICLES, 100_000, 0, MAX_VEHICLES),
    vehicleIntervalMs: int(env.MOCK_VEHICLE_INTERVAL_MS, 10_000, 100, 3_600_000),
    batchMs: int(env.MOCK_BATCH_MS, 500, 10, 60_000),
    snapshotChunk: int(env.MOCK_SNAPSHOT_CHUNK, 5000, 1, 100_000),
    dev: env.NODE_ENV !== 'production',
    // vitest never touches the dev database, even when a test calls `buildServer()` directly.
    dbPath: env.MOCK_DB || (env.VITEST ? ':memory:' : DEFAULT_DB_PATH),
  };
}
