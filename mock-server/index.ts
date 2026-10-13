import { existsSync } from 'node:fs';
import { buildServer } from './build-server.ts';

if (existsSync('.env')) process.loadEnvFile('.env');

const started = performance.now();
const app = buildServer({ logLevel: process.env.MOCK_LOG_LEVEL ?? 'info' });
const { port, vehicles, seed } = app.mock.config;
await app.listen({ port, host: '127.0.0.1' });
app.log.info(
  `mock server on http://localhost:${port} · ${vehicles} vehicles (seed ${seed}) ready in ${Math.round(performance.now() - started)} ms`,
);
