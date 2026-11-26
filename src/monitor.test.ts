import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttp, localize, validate } from '@kiosko/sdk';
import { sourceAlerts } from '@kiosko/sdk/testing';
import { fixtureText } from './fixtures.ts';
import { Monitor, type MonitorDeps, type Saved } from './monitor.ts';
import type { Connect, Run } from './ping.ts';
import { connectionSource, monitorOptions, sourceOptions } from './source.ts';
import type { NetData } from './types.ts';

const T0 = Date.parse('2026-11-26T18:00:00Z');
const S = 5000;

/** A fake network: who answers is a switch the test flips. */
function world(o: { os?: NodeJS.Platform; pingMissing?: boolean } = {}) {
  const state = { internet: true, router: true, publicIp: '203.0.113.7', pings: 0, tcp: 0, speedCalls: 0, ipCalls: 0 };
  const run: Run = async (cmd, args) => {
    if (cmd === 'ip') return { stdout: fixtureText('gateway-linux-ip.json'), stderr: '', code: 0 };
    if (cmd === 'iw') return { stdout: args.length === 1 ? fixtureText('wifi-linux-iw-dev.txt') : fixtureText('wifi-linux-iw-link.txt'), stderr: '', code: 0 };
    if (cmd === 'ping') {
      if (o.pingMissing) throw Object.assign(new Error('spawn ping ENOENT'), { code: 'ENOENT' });
      state.pings++;
      const host = args[args.length - 1]!;
      const up = host === '192.168.50.1' ? state.router : state.internet && state.router;
      return up ? { stdout: fixtureText(host === '192.168.50.1' ? 'ping-linux-gateway.txt' : 'ping-linux-ok.txt'), stderr: '', code: 0 } : { stdout: fixtureText('ping-linux-lost.txt'), stderr: '', code: 1 };
    }
    throw Object.assign(new Error(`${cmd} ENOENT`), { code: 'ENOENT' });
  };
  const connect: Connect = async () => {
    state.tcp++;
    return state.internet ? 12 : null;
  };
  const f = (async (url: string) => {
    if (url.includes('speed.cloudflare.com')) {
      state.speedCalls++;
      return new Response('');
    }
    state.ipCalls++;
    return new Response(`ip=${state.publicIp}\nloc=ES\n`);
  }) as typeof fetch;
  let saved: Saved = {};
  const deps: MonitorDeps = { run, connect, os: o.os ?? 'linux', http: createHttp({ fetch: f }), fetch: f, store: { load: async () => saved, save: async (s) => void (saved = JSON.parse(JSON.stringify(s))) } };
  return { state, deps, saved: () => saved };
}

const opts = (o: Record<string, unknown> = {}) => monitorOptions(validate(sourceOptions, o).value as Record<string, unknown>);

async function runFor(m: Monitor, o: ReturnType<typeof opts>, from: number, to: number, each?: (d: NetData, at: number) => void): Promise<NetData> {
  let d!: NetData;
  for (let at = from; at <= to; at += S) {
    d = await m.sample(o, at);
    await m.idle();
    each?.(d, at);
  }
  return d;
}

const alertsAt = (d: NetData, now: number) => sourceAlerts(connectionSource, { data: d, now });

test('a good connection: three targets with numbers, the router found, the Wi-Fi read, no alerts', async () => {
  const w = world();
  const m = new Monitor(w.deps, T0);
  const d = await runFor(m, opts(), T0, T0 + 60_000);
  assert.equal(d.status, 'ok');
  assert.deepEqual(d.targets.map((t) => [t.label, t.host, t.method]), [['', '192.168.50.1', 'icmp'], ['Cloudflare', '1.1.1.1', 'icmp'], ['Google', '8.8.8.8', 'icmp']]);
  assert.equal(d.targets[1]!.loss, 0);
  assert.ok(d.targets[1]!.jitter !== null && d.targets[1]!.jitter < 1);
  assert.equal(d.gateway?.ip, '192.168.50.1');
  assert.equal(d.wifi?.ssid, 'HomeNet');
  // The Wi-Fi isn't the default route here (cable is).
  assert.equal(d.wifi?.primary, false);
  assert.equal(d.publicIp?.ip, '203.0.113.7');
  assert.deepEqual(alertsAt(d, d.at), []);
});

test('offline: the alert comes after 30 s, not before; one id all along; gone when back', async () => {
  const w = world();
  const m = new Monitor(w.deps, T0);
  const o = opts();
  await runFor(m, o, T0, T0 + 60_000);
  w.state.internet = false;
  const cut = T0 + 65_000;
  const ids = new Set<string>();
  await runFor(m, o, cut, cut + 60_000, (d, at) => {
    const a = alertsAt(d, at);
    if (at - cut < 30_000) assert.deepEqual(a, [], `no alert ${at - cut} ms after the cut`);
    else {
      assert.equal(a.length, 1, `an alert ${at - cut} ms after the cut`);
      assert.equal(a[0]!.level, 'critical');
      ids.add(a[0]!.id);
      assert.equal(localize(a[0]!.title, 'es'), 'Sin conexión a internet');
      assert.match(localize(a[0]!.text, 'es'), /^El router responde: el problema está fuera · desde las \d\d:\d\d$/);
    }
    if (at > cut) assert.equal(d.status, 'local');
  });
  assert.equal(ids.size, 1);
  w.state.internet = true;
  const back = await m.sample(o, cut + 65_000);
  assert.deepEqual(alertsAt(back, back.at), []);
  assert.equal(back.episodes.downSince, null);
});

test('offline with the router down too: it says so', async () => {
  const w = world();
  const m = new Monitor(w.deps, T0);
  w.state.router = false;
  const d = await runFor(m, opts(), T0, T0 + 40_000);
  const a = alertsAt(d, d.at);
  assert.equal(localize(a[0]!.text, 'en').split(' · ')[0], 'The router does not answer either');
  assert.equal(d.status, 'offline');
});

test('alerts off: nothing, however long it is down', async () => {
  const w = world();
  w.state.internet = false;
  const m = new Monitor(w.deps, T0);
  const d = await runFor(m, opts({ alerts: false }), T0, T0 + 120_000);
  assert.deepEqual(alertsAt(d, d.at), []);
});

test('high loss: a warning once the window is over the threshold, ending under half of it', async () => {
  const w = world();
  const m = new Monitor(w.deps, T0);
  const o = opts({ lossAlertPct: 20, lossForMs: 30_000 });
  // Every third sample all lost: 33 % loss, never offline for long.
  let i = 0;
  let firstAt: number | null = null;
  const ids = new Set<string>();
  await runFor(m, o, T0, T0 + 120_000, (d, at) => {
    const a = alertsAt(d, at).filter((x) => x.id.startsWith('loss-'));
    if (a.length) {
      firstAt ??= at;
      ids.add(a[0]!.id);
      assert.equal(a[0]!.level, 'warn');
      assert.match(localize(a[0]!.text, 'en'), /^\d+% lost in the last 30 s$/);
    }
    w.state.internet = ++i % 3 !== 0;
  });
  assert.ok(firstAt !== null && firstAt - T0 >= 0.8 * 30_000, 'not before the window is covered');
  assert.equal(ids.size, 1);
  w.state.internet = true;
  const d = await runFor(m, o, T0 + 125_000, T0 + 170_000);
  assert.deepEqual(alertsAt(d, d.at).filter((x) => x.id.startsWith('loss-')), []);
});

test('no ping on this system: TCP connections instead, the same numbers', async () => {
  const w = world({ pingMissing: true });
  const m = new Monitor(w.deps, T0);
  const d = await runFor(m, opts(), T0, T0 + 20_000);
  assert.ok(d.targets.every((t) => t.method === 'tcp'));
  assert.deepEqual(d.targets.map((t) => t.port), [80, 443, 443]);
  assert.equal(d.targets[1]!.last, 12);
  assert.ok(w.state.tcp > 0);
});

test('public IP: asked every 15 min, the change noted (and kept across a restart)', async () => {
  const w = world();
  const m = new Monitor(w.deps, T0);
  const o = opts({ alertIpChange: true });
  await runFor(m, o, T0, T0 + 10 * 60_000);
  assert.equal(w.state.ipCalls, 1);
  w.state.publicIp = '203.0.113.99';
  const d = await runFor(m, o, T0 + 10 * 60_000 + S, T0 + 16 * 60_000);
  assert.equal(w.state.ipCalls, 2);
  const again = await m.sample(o, T0 + 16 * 60_000 + S);
  assert.equal(again.publicIp?.ip, '203.0.113.99');
  assert.equal(again.publicIp?.previous, '203.0.113.7');
  const a = alertsAt(again, again.at).find((x) => x.id.startsWith('ip-'));
  assert.equal(localize(a!.text, 'es'), '203.0.113.99 · antes 203.0.113.7');
  assert.ok(d);
  // A new monitor (a restart) reads it from the store.
  const m2 = new Monitor(w.deps, T0 + 20 * 60_000);
  assert.equal((await m2.sample(o, T0 + 20 * 60_000)).publicIp?.previous, '203.0.113.7');
  // Off: never asked.
  const w3 = world();
  const m3 = new Monitor(w3.deps, T0);
  const off = await runFor(m3, opts({ publicIp: 'off' }), T0, T0 + 40 * 60_000);
  assert.equal(w3.state.ipCalls, 0);
  assert.equal(off.publicIp, undefined);
});

test('the speed test never runs when off, over two days of samples', async () => {
  const w = world();
  const m = new Monitor(w.deps, T0);
  const o = opts();
  for (let at = T0; at < T0 + 48 * 3_600_000; at += 60_000) {
    const d = await m.sample(o, at);
    assert.equal(d.speed.enabled, false);
    assert.equal(d.speed.nextAt, null);
  }
  await m.idle();
  assert.equal(w.state.speedCalls, 0);
});

test('the speed test, when on, runs once in 6 h, and not again after a restart', async () => {
  const w = world();
  const m = new Monitor(w.deps, T0);
  const o = opts({ speedTest: '6h', speedTestMb: 2 });
  let tries = 0;
  let prevTry: number | undefined;
  for (let at = T0; at < T0 + 5 * 3_600_000; at += 60_000) {
    await m.sample(o, at);
    await m.idle();
    if (w.saved().speedTryAt !== prevTry) tries++, (prevTry = w.saved().speedTryAt);
  }
  // The fake server gives empty bodies, so each test fails and waits 30 min: never sooner.
  assert.ok(tries >= 1 && tries <= 10, String(tries));
  const calls = w.state.speedCalls;
  // A test that worked: then nothing for 6 h, even across a restart.
  w.deps.store.save({ ...w.saved(), speed: { at: T0 + 5 * 3_600_000, down: 100, up: 10, latency: 10, mb: 3, server: 'speed.cloudflare.com' } });
  const m2 = new Monitor(w.deps, T0 + 5 * 3_600_000);
  for (let at = T0 + 5 * 3_600_000; at < T0 + 10 * 3_600_000; at += 60_000) await m2.sample(o, at);
  await m2.idle();
  assert.equal(w.state.speedCalls, calls);
});

test('targets: named ones, host:port by TCP, a name that does not resolve', async () => {
  const w = world();
  const m = new Monitor(w.deps, T0);
  const d = await runFor(m, opts({ targets: ['NAS=192.168.50.10', 'web=example.com:8443'] }), T0, T0 + 10_000);
  assert.deepEqual(d.targets.map((t) => [t.label, t.method, t.port]), [['NAS', 'icmp', undefined], ['web', 'tcp', 8443]]);
});
