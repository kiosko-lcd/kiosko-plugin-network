/**
 * The monitor behind the `network/connection` source: one per data folder.
 * Every read it probes each target once (a few packets), keeps the samples
 * of the last minutes, works out the episodes the alerts come from, and
 * starts what runs rarely (public IP, DNS blocker, speed test) without
 * waiting for it: the next read shows its result.
 *
 * Everything it touches comes in `deps`, and time is the read's `now`, so the
 * tests drive it with a fake clock and fake commands.
 */
import type { HttpClient } from '@kiosko/sdk';
import { BLOCKERS, type BlockerId } from './blockers/index.ts';
import { findGateway, type Route } from './gateway.ts';
import { icmpProbe, PingUnusable, tcpProbe, type Connect, type ProbeResult, type Run } from './ping.ts';
import { lookupPublicIp, type PublicIpMode } from './publicip.ts';
import { runSpeedTest, speedDue, speedNextAt } from './speedtest.ts';
import { internetOf, loss, statusOf, summarize, within } from './stats.ts';
import { parseTargets, KNOWN, type TargetSpec } from './targets.ts';
import type { AlertSettings, BlockerData, Episodes, GatewayData, Method, NetData, PublicIpData, Sample, SpeedResult, TargetData, Thresholds, WifiData } from './types.ts';
import { readWifi } from './wifi.ts';

export interface MonitorOptions {
  targets: string[];
  method: 'auto' | 'icmp' | 'tcp';
  probes: number;
  probeTimeoutMs: number;
  windowMs: number;
  historyMs: number;
  publicIp: PublicIpMode;
  wifi: boolean;
  speedTest: 'off' | '6h' | '12h' | '24h';
  speedTestMb: number;
  blocker: 'off' | BlockerId;
  blockerUrl: string;
  blockerPassword: string;
  blockerUser: string;
  latencyWarnMs: number;
  latencyBadMs: number;
  lossWarnPct: number;
  lossAlertPct: number;
  alerts: boolean;
  offlineAfterMs: number;
  lossForMs: number;
  alertIpChange: boolean;
}

/** What survives a restart: the public IP (to tell when it changes) and the last speed test (so a restart isn't a test). */
export interface Saved {
  publicIp?: PublicIpData;
  speed?: SpeedResult;
  speedTryAt?: number;
}

export interface StateStore {
  load(): Promise<Saved>;
  save(s: Saved): Promise<void>;
}

export interface MonitorDeps {
  run: Run;
  connect: Connect;
  os: NodeJS.Platform;
  http: HttpClient;
  fetch: typeof fetch;
  store: StateStore;
  log?: (m: string) => void;
  agent?: string;
}

export const PUBLIC_IP_EVERY_MS = 15 * 60_000;
export const PUBLIC_IP_RETRY_MS = 2 * 60_000;
export const BLOCKER_EVERY_MS = 60_000;
export const WIFI_EVERY_MS = 30_000;
export const GATEWAY_EVERY_MS = 60_000;
/** How long `ping` is left alone after it couldn't be used, before trying it again. */
export const PING_RETRY_MS = 10 * 60_000;
const SPEED_EVERY: Record<MonitorOptions['speedTest'], number | null> = { off: null, '6h': 6 * 3_600_000, '12h': 12 * 3_600_000, '24h': 24 * 3_600_000 };

interface TargetState {
  samples: Sample[];
  method: Method;
  error?: string;
}

const TCP_PORT = 443;
const GATEWAY_TCP_PORT = 80;

export class Monitor {
  private targets = new Map<string, TargetState>();
  private route: Route | null = null;
  private routeAt = -Infinity;
  private wifi: WifiData | null = null;
  private wifiAt = -Infinity;
  private pingBlockedUntil = -Infinity;
  private episodes: Episodes = { downSince: null, lossSince: null, lossNow: null };
  private lastSampleAt: number | null = null;
  private lossFrom = -Infinity;
  private firstSampleAt: number | null = null;
  private saved: Saved | null = null;
  private ipAt = -Infinity;
  private ipDueSoon = false;
  private blocker: BlockerData | null = null;
  private blockerAt = -Infinity;
  private blockerKey = '';
  private speedRunning = false;
  private speedError: string | undefined;
  private inflight = new Set<Promise<unknown>>();
  readonly startedAt: number;
  private deps: MonitorDeps;

  constructor(deps: MonitorDeps, startedAt: number) {
    this.deps = deps;
    this.startedAt = startedAt;
  }

  /** Waits for the background tasks started so far (tests). */
  async idle(): Promise<void> {
    while (this.inflight.size) await Promise.allSettled([...this.inflight]);
  }

  private background(p: Promise<unknown>): void {
    const q = p.catch(() => {}).finally(() => this.inflight.delete(q));
    this.inflight.add(q);
  }

  private async savedState(): Promise<Saved> {
    if (!this.saved) {
      try {
        this.saved = await this.deps.store.load();
      } catch {
        this.saved = {};
      }
    }
    return this.saved;
  }

  private persist(): void {
    if (this.saved) this.background(this.deps.store.save(this.saved));
  }

  private async probe(t: TargetSpec, host: string, st: TargetState, o: MonitorOptions, now: number, signal?: AbortSignal): Promise<ProbeResult> {
    const tcpPort = t.port ?? (t.gateway ? GATEWAY_TCP_PORT : TCP_PORT);
    const useTcp = t.port !== undefined || o.method === 'tcp' || (o.method === 'auto' && now < this.pingBlockedUntil);
    if (!useTcp) {
      try {
        st.method = 'icmp';
        return await icmpProbe(this.deps.run, this.deps.os, host, o.probes, o.probeTimeoutMs, signal);
      } catch (err) {
        if (!(err instanceof PingUnusable)) throw err;
        if (o.method === 'icmp') return { rtts: [], sent: o.probes, error: 'ping unusable' };
        if (this.pingBlockedUntil < now) this.deps.log?.(`network: ping can't be used (${err.message}); timing TCP connections instead`);
        this.pingBlockedUntil = now + PING_RETRY_MS;
      }
    }
    st.method = 'tcp';
    return tcpProbe(this.deps.connect, host, tcpPort, o.probes, o.probeTimeoutMs, signal);
  }

  /** One read: probes, history, episodes, and the rare tasks if due. */
  async sample(o: MonitorOptions, now: number, signal?: AbortSignal): Promise<NetData> {
    const saved = await this.savedState();
    const specs = parseTargets(o.targets);
    const timeoutMs = Math.max(1000, o.probeTimeoutMs * 2);

    // A pause (the machine slept, the source stopped): what came before doesn't run on into now.
    const gap = this.lastSampleAt !== null && now - this.lastSampleAt > Math.max(60_000, 3 * o.windowMs);
    if (gap) {
      this.episodes = { downSince: null, lossSince: null, lossNow: null };
      this.firstSampleAt = null;
    }

    const prevRoute = this.route?.ip ?? null;
    if (specs.some((s) => s.gateway) || o.wifi) {
      if (now - this.routeAt >= GATEWAY_EVERY_MS || !this.route) {
        this.route = await findGateway(this.deps.run, this.deps.os, { timeoutMs, ...(signal ? { signal } : {}) });
        this.routeAt = now;
      }
    }
    if (prevRoute !== null && this.route && this.route.ip !== prevRoute) this.ipDueSoon = true;
    if (o.wifi && now - this.wifiAt >= WIFI_EVERY_MS) {
      this.wifi = await readWifi(this.deps.run, this.deps.os, { timeoutMs, ...(signal ? { signal } : {}), gatewayIface: this.route?.iface ?? null });
      this.wifiAt = now;
    }
    if (!o.wifi) this.wifi = null;

    // Probe every target at once.
    const keep = new Set(specs.map((s) => s.spec));
    for (const k of this.targets.keys()) if (!keep.has(k)) this.targets.delete(k);
    const results = await Promise.all(
      specs.map(async (t) => {
        let st = this.targets.get(t.spec);
        if (!st) this.targets.set(t.spec, (st = { samples: [], method: 'icmp' }));
        const host = t.gateway ? this.route?.ip : t.host;
        let r: ProbeResult;
        if (!host) r = { rtts: [], sent: o.probes, error: 'no gateway' };
        else {
          try {
            r = await this.probe(t, host, st, o, now, signal);
          } catch (err) {
            r = { rtts: [], sent: o.probes, error: err instanceof Error ? err.message : String(err) };
          }
        }
        st.samples.push({ at: now, rtts: r.rtts.map((v) => Math.round(v * 100) / 100), sent: r.sent });
        if (r.error) st.error = r.error;
        else delete st.error;
        // Old samples out.
        while (st.samples.length && st.samples[0]!.at <= now - o.historyMs) st.samples.shift();
        const tcpPort = t.port ?? (t.gateway ? GATEWAY_TCP_PORT : TCP_PORT);
        const td: TargetData = {
          spec: t.spec,
          label: t.name || (t.gateway ? '' : (KNOWN[t.host] ?? t.host)),
          host: host ?? '',
          ...(st.method === 'tcp' ? { port: tcpPort } : {}),
          gateway: t.gateway,
          method: st.method,
          ...summarize(st.samples, now, o.windowMs),
          ...(st.error ? { error: st.error } : {}),
          samples: st.samples.slice(),
        };
        return td;
      }),
    );
    this.firstSampleAt ??= now;
    this.lastSampleAt = now;

    // Episodes.
    const net = internetOf(results);
    const allLost = net.length > 0 && net.every((x) => (x.samples[x.samples.length - 1]?.rtts.length ?? 0) === 0);
    const downSince = this.episodes.downSince;
    if (allLost) this.episodes.downSince ??= now;
    else this.episodes.downSince = null;
    if (downSince !== null && !allLost) {
      this.ipDueSoon = true;
      // After a real outage, the loss counts from when it came back: the outage was its own alert.
      if (now - downSince >= o.offlineAfterMs) {
        this.lossFrom = now;
        this.episodes.lossSince = null;
      }
    }
    const from = Math.max(this.lossFrom, this.firstSampleAt ?? now);
    const lossWin = loss(net.flatMap((x) => within(x.samples, now, Math.min(o.lossForMs, now - from + 1))));
    // Only once the history covers the window (less one interval's slack).
    const covered = now - from >= o.lossForMs * 0.8;
    this.episodes.lossNow = lossWin;
    if (covered && !allLost && lossWin !== null && lossWin * 100 >= o.lossAlertPct) this.episodes.lossSince ??= now;
    else if (lossWin === null || lossWin * 100 < o.lossAlertPct / 2) this.episodes.lossSince = null;

    const thresholds: Thresholds = { latencyWarnMs: o.latencyWarnMs, latencyBadMs: Math.max(o.latencyBadMs, o.latencyWarnMs), lossWarnPct: o.lossWarnPct, lossAlertPct: o.lossAlertPct };
    const status = statusOf(results, thresholds);
    const online = !allLost && net.length > 0;

    // The rare tasks.
    if (o.publicIp !== 'off' && online) {
      const due = this.ipDueSoon || now - this.ipAt >= (saved.publicIp?.error ? PUBLIC_IP_RETRY_MS : PUBLIC_IP_EVERY_MS);
      if (due) {
        this.ipAt = now;
        this.ipDueSoon = false;
        this.background(this.checkPublicIp(o.publicIp, now));
      }
    }
    const bKey = `${o.blocker}|${o.blockerUrl}|${o.blockerUser}|${o.blockerPassword}`;
    if (bKey !== this.blockerKey) {
      this.blockerKey = bKey;
      this.blocker = null;
      this.blockerAt = -Infinity;
    }
    if (o.blocker !== 'off' && o.blockerUrl && now - this.blockerAt >= BLOCKER_EVERY_MS) {
      this.blockerAt = now;
      this.background(this.readBlocker(o, now));
    }
    const everyMs = SPEED_EVERY[o.speedTest];
    const plan = { everyMs, startedAt: this.startedAt, lastAt: saved.speed?.at ?? null, lastTryAt: saved.speedTryAt ?? null };
    if (!this.speedRunning && speedDue({ ...plan, online }, now)) this.background(this.speedTest(o, now));

    const gateway: GatewayData | null = this.route ? { ip: this.route.ip, iface: this.route.iface, wifi: this.wifi ? (this.wifi.primary ?? (this.deps.os === 'win32' ? null : false)) : this.deps.os === 'win32' ? null : false } : null;
    const alerts: AlertSettings = { enabled: o.alerts, offlineAfterMs: o.offlineAfterMs, lossForMs: o.lossForMs, ipChange: o.alertIpChange };
    return {
      at: now,
      status,
      targets: results,
      gateway,
      wifi: this.wifi,
      ...(o.publicIp === 'off' ? {} : { publicIp: saved.publicIp ?? null }),
      speed: { enabled: everyMs !== null, everyMs: everyMs ?? 0, last: saved.speed ?? null, nextAt: speedNextAt(plan), running: this.speedRunning, ...(this.speedError ? { error: this.speedError } : {}) },
      ...(o.blocker === 'off' || !o.blockerUrl ? {} : { blocker: this.blocker }),
      episodes: { ...this.episodes },
      thresholds,
      alerts,
      intervalMs: 0,
      windowMs: o.windowMs,
      historyMs: o.historyMs,
    };
  }

  private async checkPublicIp(mode: PublicIpMode, now: number): Promise<void> {
    const saved = await this.savedState();
    const prev = saved.publicIp;
    try {
      const r = await lookupPublicIp(this.deps.http, mode, AbortSignal.timeout(10_000));
      const changed = prev?.ip !== undefined && prev.ip !== r.ip;
      saved.publicIp = {
        ip: r.ip,
        via: r.via,
        ...(r.country ? { country: r.country } : {}),
        checkedAt: now,
        ...(changed ? { previous: prev!.ip, changedAt: now } : prev?.previous ? { previous: prev.previous, ...(prev.changedAt ? { changedAt: prev.changedAt } : {}) } : {}),
      };
      if (changed) this.deps.log?.('network: the public IP changed');
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      saved.publicIp = prev ? { ...prev, error: message } : { ip: '', via: '', checkedAt: now, error: message };
    }
    if (saved.publicIp && !saved.publicIp.error) delete saved.publicIp.error;
    this.persist();
  }

  private async readBlocker(o: MonitorOptions, now: number): Promise<void> {
    const p = BLOCKERS[o.blocker as BlockerId];
    if (!p) return;
    try {
      this.blocker = await p.read({ url: o.blockerUrl, password: o.blockerPassword, user: o.blockerUser }, { http: this.deps.http, now, signal: AbortSignal.timeout(10_000) });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.blocker = this.blocker ? { ...this.blocker, error: message } : { provider: p.id, name: p.name, queries: 0, blocked: 0, percent: 0, enabled: null, period: '24h', at: now, error: message };
    }
  }

  private async speedTest(o: MonitorOptions, now: number): Promise<void> {
    const saved = await this.savedState();
    this.speedRunning = true;
    saved.speedTryAt = now;
    this.persist();
    try {
      const downMb = o.speedTestMb;
      saved.speed = await runSpeedTest({ downMb, upMb: Math.max(1, Math.round(downMb / 2)) }, { fetch: this.deps.fetch, now: () => now, signal: AbortSignal.timeout(90_000), ...(this.deps.agent ? { agent: this.deps.agent } : {}) });
      this.speedError = undefined;
    } catch (err) {
      this.speedError = err instanceof Error ? err.message : String(err);
      this.deps.log?.(`network: speed test failed: ${this.speedError}`);
    } finally {
      this.speedRunning = false;
      this.persist();
    }
  }
}
