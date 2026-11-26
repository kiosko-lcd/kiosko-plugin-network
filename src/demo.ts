/**
 * Sample data for the gallery, the editor and the tests: ten minutes of a
 * good evening at home on Wi-Fi (the router at 1-3 ms, Cloudflare at 9,
 * Google at 14, with a short burst of jitter and two lost probes), a public
 * IP from the documentation range that changed this morning, a speed test
 * of two hours ago and a Pi-hole. Deterministic: the same `now` paints the
 * same picture.
 */
import { summarize, statusOf } from './stats.ts';
import type { NetData, Sample, TargetData, Thresholds } from './types.ts';

const T: Thresholds = { latencyWarnMs: 80, latencyBadMs: 200, lossWarnPct: 2, lossAlertPct: 20 };
const INTERVAL = 5000;
const HISTORY = 10 * 60_000;
const WINDOW = 60_000;

/** A small seeded generator, so the demo doesn't move between paints. */
function rng(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function series(now: number, base: number, spread: number, seed: number, opts: { burstAt?: number; burst?: number; lost?: number[] } = {}): Sample[] {
  const r = rng(seed);
  const out: Sample[] = [];
  const end = Math.floor(now / INTERVAL) * INTERVAL;
  const n = HISTORY / INTERVAL;
  for (let i = n - 1; i >= 0; i--) {
    const at = end - i * INTERVAL;
    const k = n - 1 - i;
    const burst = opts.burstAt !== undefined && Math.abs(k - opts.burstAt) < 6 ? (opts.burst ?? 0) * (1 - Math.abs(k - opts.burstAt) / 6) : 0;
    const rtts: number[] = [];
    for (let j = 0; j < 3; j++) {
      if (opts.lost?.includes(k * 3 + j)) continue;
      rtts.push(Math.round((base + r() * spread + burst * (0.5 + r())) * 100) / 100);
    }
    out.push({ at, rtts, sent: 3 });
  }
  return out;
}

function target(spec: string, label: string, host: string, gateway: boolean, samples: Sample[], now: number): TargetData {
  return { spec, label, host, gateway, method: 'icmp', ...summarize(samples, now, WINDOW), samples };
}

export function demoData(now: number): NetData {
  const targets = [
    target('gateway', '', '192.168.1.1', true, series(now, 1.2, 1.6, 1, { burstAt: 70, burst: 6 }), now),
    target('1.1.1.1', 'Cloudflare', '1.1.1.1', false, series(now, 8.6, 1.4, 2, { burstAt: 70, burst: 38, lost: [212, 213] }), now),
    target('8.8.8.8', 'Google', '8.8.8.8', false, series(now, 13.5, 2.2, 3, { burstAt: 71, burst: 44 }), now),
  ];
  return {
    at: now,
    status: statusOf(targets, T),
    targets,
    gateway: { ip: '192.168.1.1', iface: 'wlan0', wifi: true },
    wifi: { iface: 'wlan0', ssid: 'HomeNet', signalDbm: -58, signalPct: 84, freqMhz: 5500, channel: 100, band: '5', widthMhz: 80, rxMbps: 866.7, txMbps: 780, primary: true },
    publicIp: { ip: '203.0.113.42', via: 'cloudflare', country: 'ES', checkedAt: now - 4 * 60_000, previous: '203.0.113.7', changedAt: now - 3 * 3_600_000 - 12 * 60_000 },
    speed: { enabled: true, everyMs: 6 * 3_600_000, last: { at: now - 2 * 3_600_000 - 5 * 60_000, down: 541.3, up: 48.2, latency: 11.4, mb: 15, server: 'speed.cloudflare.com', colo: 'MAD' }, nextAt: now + 3 * 3_600_000 + 55 * 60_000, running: false },
    blocker: { provider: 'pihole', name: 'Pi-hole', version: 'v6', queries: 29160, blocked: 8139, percent: 27.9, enabled: true, domains: 167804, period: '24h', at: now - 30_000 },
    episodes: { downSince: null, lossSince: null, lossNow: 0 },
    thresholds: T,
    alerts: { enabled: true, offlineAfterMs: 30_000, lossForMs: 60_000, ipChange: false },
    intervalMs: INTERVAL,
    windowMs: WINDOW,
    historyMs: HISTORY,
    demo: true,
  };
}
