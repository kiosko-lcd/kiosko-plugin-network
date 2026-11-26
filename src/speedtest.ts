/**
 * The speed test: no program to install, only Cloudflare's speed test
 * endpoints (the ones speed.cloudflare.com itself uses):
 *
 * - latency: a few empty downloads (`__down?bytes=0`), the median time to the
 *   answer's headers less the time the server says it took (`Server-Timing`),
 *   after one to open the connection;
 * - download: one file of `downMb` (`__down?bytes=N`), timed from its first
 *   byte to its last;
 * - upload: `upMb` sent to `__up`, timed whole, less the latency.
 *
 * It moves `downMb + upMb` megabytes each time, which is why it is off by
 * default and, when on, runs every few hours at most (see `speedDue`).
 */
import { performance } from 'node:perf_hooks';
import type { SpeedResult } from './types.ts';

export const SPEED_HOST = 'speed.cloudflare.com';
const BASE = `https://${SPEED_HOST}`;

export interface SpeedDeps {
  fetch: typeof fetch;
  now: () => number;
  /** A monotonic clock in ms (performance.now). */
  clock?: () => number;
  signal?: AbortSignal;
  agent?: string;
}

/**
 * The time the server says it spent on the answer (`Server-Timing`'s
 * `dur=` values, less the `cfL4` one, which describes the connection), so
 * that what is left is the network's round trip.
 */
export function serverMs(h: Headers): number {
  const v = h.get('server-timing');
  if (!v) return 0;
  let total = 0;
  for (const part of v.split(',')) {
    if (/^\s*cfL4\b/i.test(part)) continue;
    const m = /;\s*dur=([\d.]+)/.exec(part);
    if (m) total += Number(m[1]);
  }
  return Number.isFinite(total) ? total : 0;
}

/** Cloudflare's data centre, from `cf-meta-colo` or the end of `cf-ray` (`8f1d…-MAD`). */
export function coloOf(h: Headers): string | undefined {
  const c = h.get('cf-meta-colo') ?? /-([A-Z]{3})$/.exec(h.get('cf-ray') ?? '')?.[1];
  return c || undefined;
}

/** Megabits per second from bytes and milliseconds. */
export const mbps = (bytes: number, ms: number): number => (ms > 0 ? (bytes * 8) / (ms * 1000) : 0);

export async function runSpeedTest(o: { downMb: number; upMb: number }, d: SpeedDeps): Promise<SpeedResult> {
  const clock = d.clock ?? (() => performance.now());
  const headers = { 'User-Agent': d.agent ?? 'Kiosko (+https://kioskolcd.dev)' };
  const sig = d.signal ? { signal: d.signal } : {};
  const lat: number[] = [];
  let colo: string | undefined;
  // The first opens the connection (TLS): a warm-up, not counted.
  for (let i = 0; i < 6; i++) {
    const t0 = clock();
    const r = await d.fetch(`${BASE}/__down?bytes=0`, { headers, ...sig });
    const ms = clock() - t0;
    colo ??= coloOf(r.headers);
    await r.arrayBuffer();
    if (i > 0) lat.push(Math.max(0.1, ms - serverMs(r.headers)));
  }
  lat.sort((a, b) => a - b);
  const latency = lat[lat.length >> 1]!;

  const downBytes = Math.round(o.downMb * 1_000_000);
  const r = await d.fetch(`${BASE}/__down?bytes=${downBytes}`, { headers, ...sig });
  if (!r.ok || !r.body) throw new Error(`HTTP ${r.status} from ${SPEED_HOST}`);
  let got = 0;
  let first = 0;
  const reader = r.body.getReader();
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (!first) first = clock();
    got += value.byteLength;
  }
  const downMs = clock() - first;

  const upBytes = Math.round(o.upMb * 1_000_000);
  const body = new Uint8Array(upBytes);
  const u0 = clock();
  const ur = await d.fetch(`${BASE}/__up`, { method: 'POST', headers: { ...headers, 'Content-Type': 'application/octet-stream' }, body, ...sig });
  await ur.arrayBuffer();
  if (!ur.ok) throw new Error(`HTTP ${ur.status} from ${SPEED_HOST}`);
  const upMs = Math.max(1, clock() - u0 - latency);

  const round = (v: number) => Math.round(v * 10) / 10;
  return {
    at: d.now(),
    down: round(mbps(got, downMs)),
    up: round(mbps(upBytes, upMs)),
    latency: round(latency),
    mb: round((got + upBytes) / 1_000_000),
    server: SPEED_HOST,
    ...(colo ? { colo } : {}),
  };
}

export interface SpeedPlan {
  /** `off`, or every how many hours. */
  everyMs: number | null;
  /** When the monitor started (a test never runs in its first minutes, so a restart isn't a test). */
  startedAt: number;
  lastAt: number | null;
  /** The last attempt, even if it failed (no retry for half an hour). */
  lastTryAt: number | null;
  online: boolean;
}

export const FIRST_DELAY_MS = 3 * 60_000;
export const RETRY_MS = 30 * 60_000;

/** When the next test is due (epoch ms), or null when off. */
export function speedNextAt(p: Omit<SpeedPlan, 'online'>): number | null {
  if (!p.everyMs) return null;
  const after = [p.startedAt + FIRST_DELAY_MS];
  if (p.lastAt !== null) after.push(p.lastAt + p.everyMs);
  if (p.lastTryAt !== null) after.push(p.lastTryAt + RETRY_MS);
  return Math.max(...after);
}

/** Whether to run a speed test now: never when off, never offline, never sooner than its interval. */
export function speedDue(p: SpeedPlan, now: number): boolean {
  const next = speedNextAt(p);
  return next !== null && p.online && now >= next;
}
