/**
 * F01-T9: starts the mock in a child process, measures the time for a full fleet snapshot to
 * reach a local client, then the mock's CPU while it streams deltas at the default rate.
 * Usage: pnpm perf:mock [vehicles=100000] [seconds=20]
 */
import { spawn } from 'node:child_process';
import { statsSchema, type Stats } from '@shared/contract/index.ts';
import WebSocket from 'ws';

const vehicles = Number(process.argv[2] ?? 100_000);
const seconds = Number(process.argv[3] ?? 20);
const port = 4600 + Math.floor(Math.random() * 300);
const base = `http://127.0.0.1:${port}`;
const SNAPSHOT_BUDGET_MS = 2000;
const CPU_BUDGET = 1;

const child = spawn(
  'node_modules/.bin/tsx',
  ['--tsconfig', 'tsconfig.node.json', 'mock-server/index.ts'],
  {
    env: {
      ...process.env,
      MOCK_PORT: String(port),
      MOCK_VEHICLES: String(vehicles),
      MOCK_LOG_LEVEL: 'warn',
    },
    stdio: ['ignore', 'inherit', 'inherit'],
  },
);
const killChild = () => child.kill('SIGTERM');
process.on('exit', killChild);

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const stats = async (): Promise<Stats> =>
  statsSchema.parse(await (await fetch(`${base}/api/dev/stats`)).json());

async function waitForHealth(timeoutMs = 60_000) {
  const until = Date.now() + timeoutMs;
  while (Date.now() < until) {
    try {
      if ((await fetch(`${base}/api/health`)).ok) return;
    } catch {
      /* not up yet */
    }
    await sleep(200);
  }
  throw new Error('mock server did not start');
}

async function main() {
  const bootStart = Date.now();
  await waitForHealth();
  const bootMs = Date.now() - bootStart;
  const login = await fetch(`${base}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: 'superadmin@fms.local', password: 'Admin@123' }),
  });
  const cookie = login.headers.getSetCookie()[0]!.split(';')[0]!;

  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws/live`, { headers: { cookie } });
  await new Promise((resolve, reject) => {
    ws.once('open', resolve);
    ws.once('error', reject);
  });

  let snapshotRows = 0;
  let snapshotBytes = 0;
  let deltaRows = 0;
  let snapshotMs = -1;
  const subscribedAt = performance.now();
  const snapshotDone = new Promise<void>((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error('snapshot timeout')), 120_000);
    ws.on('message', (raw: Buffer) => {
      const msg = JSON.parse(raw.toString()) as {
        type: string;
        rows?: unknown[];
        chunk?: number;
        chunks?: number;
      };
      if (msg.type === 'snapshot') {
        snapshotRows += msg.rows!.length;
        snapshotBytes += raw.length;
        if (msg.chunk === msg.chunks! - 1) {
          snapshotMs = performance.now() - subscribedAt;
          clearTimeout(timer);
          resolve();
        }
      } else if (msg.type === 'delta') deltaRows += msg.rows!.length;
    });
  });
  ws.send(
    JSON.stringify({
      type: 'subscribe',
      id: 'perf',
      topic: 'combinfo',
      scope: { kind: 'fleet', fleetIds: ['f0'] },
    }),
  );
  await snapshotDone;

  await sleep(1000);
  const s1 = await stats();
  const d1 = deltaRows;
  await sleep(seconds * 1000);
  const s2 = await stats();
  const cpu =
    (s2.cpuUserMs + s2.cpuSystemMs - s1.cpuUserMs - s1.cpuSystemMs) / (s2.uptimeMs - s1.uptimeMs);
  const deltaRate = ((deltaRows - d1) / (s2.uptimeMs - s1.uptimeMs)) * 1000;
  ws.close();

  const ok = snapshotMs <= SNAPSHOT_BUDGET_MS && cpu < CPU_BUDGET && snapshotRows === vehicles;
  console.table({
    vehicles,
    'boot to healthy (ms)': bootMs,
    'snapshot rows': snapshotRows,
    'snapshot size (MB)': +(snapshotBytes / 1e6).toFixed(1),
    'snapshot to client (ms)': Math.round(snapshotMs),
    'mock CPU (cores, steady state)': +cpu.toFixed(3),
    'delta rows / s': Math.round(deltaRate),
    'mock RSS (MB)': Math.round(s2.rssBytes / 1e6),
    'mock heap used (MB)': Math.round(s2.heapUsedBytes / 1e6),
    'measured window (s)': seconds,
  });
  const verdict = vehicles > 100_000 ? 'INFO (budgets apply at 1 lakh)' : ok ? 'PASS' : 'FAIL';
  console.log(
    `F01-T9 ${verdict}: snapshot ${Math.round(snapshotMs)} ms (budget ${SNAPSHOT_BUDGET_MS}), CPU ${cpu.toFixed(3)} cores (budget < ${CPU_BUDGET})`,
  );
  return ok || vehicles > 100_000;
}

main()
  .then((ok) => {
    killChild();
    process.exit(ok ? 0 : 1);
  })
  .catch((err: unknown) => {
    console.error(err);
    killChild();
    process.exit(1);
  });
