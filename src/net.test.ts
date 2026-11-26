import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttp } from '@kiosko/sdk';
import { lookupPublicIp, parseTrace } from './publicip.ts';
import { coloOf, FIRST_DELAY_MS, mbps, RETRY_MS, runSpeedTest, serverMs, speedDue, speedNextAt } from './speedtest.ts';

const TRACE = 'fl=1383f24\nh=1.1.1.1\nip=203.0.113.7\nts=1795659205.000\nvisit_scheme=https\nuag=Kiosko\ncolo=MAD\nsliver=none\nhttp=http/2\nloc=ES\ntls=TLSv1.3\nsni=off\nwarp=off\ngateway=off\n';

test('Cloudflare trace: the address and the country', () => {
  assert.deepEqual(parseTrace(TRACE), { ip: '203.0.113.7', country: 'ES' });
  assert.equal(parseTrace('<html>'), null);
});

test('public IP: Cloudflare only by default; the others only with "any"', async () => {
  const asked: string[] = [];
  const f = (async (url: string) => {
    asked.push(new URL(url).host);
    if (url.includes('1.1.1.1')) return new Response('down', { status: 500 });
    return new Response('203.0.113.9\n', { status: 200 });
  }) as typeof fetch;
  await assert.rejects(lookupPublicIp(createHttp({ fetch: f }), 'cloudflare'));
  assert.deepEqual(asked, ['1.1.1.1']);
  asked.length = 0;
  assert.deepEqual(await lookupPublicIp(createHttp({ fetch: f }), 'any'), { ip: '203.0.113.9', via: 'ipify' });
  assert.deepEqual(asked, ['1.1.1.1', 'api.ipify.org']);
  await assert.rejects(lookupPublicIp(createHttp({ fetch: f }), 'off'));
});

test('server timing and data centre from the headers', () => {
  assert.equal(serverMs(new Headers({ 'server-timing': 'cfSpeedEdge;dur=3, cfSpeedWorker;dur=13, cfL4;desc="?rtt=14323";dur=99' })), 16);
  assert.equal(serverMs(new Headers()), 0);
  assert.equal(coloOf(new Headers({ 'cf-ray': '8f1d2c3b4a5e6f70-MAD' })), 'MAD');
  assert.equal(coloOf(new Headers({ 'cf-meta-colo': 'FRA' })), 'FRA');
});

test('mbps', () => {
  assert.equal(mbps(12_500_000, 1000), 100);
});

test('speed test: latency, download and upload, from a fake server and a fake clock', async () => {
  let t = 0;
  let warm = 0;
  const clock = () => t;
  const f = (async (url: string, init?: RequestInit) => {
    if (url.endsWith('bytes=0')) {
      // 20 ms on the wire, 13 at the server; the first 100 more (the TLS handshake).
      t += 33 + (warm++ === 0 ? 100 : 0);
      return new Response('', { headers: { 'cf-ray': '8f1d2c3b4a5e6f70-MAD', 'server-timing': 'cfSpeedEdge;dur=3, cfSpeedWorker;dur=10, cfL4;desc="?proto=TCP&rtt=14323"' } });
    }
    if (url.includes('__down')) {
      t += 20;
      const n = Number(new URL(url).searchParams.get('bytes'));
      // 10 chunks, 100 ms apart after the first: n bytes in 900 ms.
      let i = 0;
      const body = new ReadableStream<Uint8Array>({
        pull(c) {
          if (i === 10) return c.close();
          if (i > 0) t += 100;
          i++;
          c.enqueue(new Uint8Array(n / 10));
        },
      }, { highWaterMark: 0 });
      return new Response(body);
    }
    assert.equal(init?.method, 'POST');
    assert.equal((init!.body as Uint8Array).byteLength, 5_000_000);
    t += 20 + 1000;
    return new Response('');
  }) as typeof fetch;
  const r = await runSpeedTest({ downMb: 10, upMb: 5 }, { fetch: f, now: () => 1234, clock });
  assert.equal(r.latency, 20);
  assert.equal(r.down, Math.round(mbps(10_000_000, 900) * 10) / 10);
  assert.equal(r.up, 40);
  assert.equal(r.mb, 15);
  assert.equal(r.colo, 'MAD');
  assert.equal(r.at, 1234);
});

const H = 3_600_000;

test('scheduler: a speed test never runs when off, offline, early after a start or before its interval', () => {
  const start = 1_000_000_000;
  const off = { everyMs: null, startedAt: start, lastAt: null, lastTryAt: null, online: true };
  for (let now = start; now < start + 30 * 24 * H; now += 10 * 60_000) assert.equal(speedDue(off, now), false);
  assert.equal(speedNextAt(off), null);
  const on = { everyMs: 6 * H, startedAt: start, lastAt: null, lastTryAt: null, online: true };
  assert.equal(speedDue(on, start + 60_000), false, 'not in its first minutes');
  assert.equal(speedDue(on, start + FIRST_DELAY_MS), true);
  assert.equal(speedDue({ ...on, online: false }, start + FIRST_DELAY_MS), false, 'never offline');
  const after = { ...on, lastAt: start + FIRST_DELAY_MS, lastTryAt: start + FIRST_DELAY_MS };
  assert.equal(speedDue(after, start + FIRST_DELAY_MS + 5 * H), false);
  assert.equal(speedDue(after, start + FIRST_DELAY_MS + 6 * H), true);
  // A failed attempt waits half an hour.
  const failed = { ...on, lastTryAt: start + FIRST_DELAY_MS };
  assert.equal(speedDue(failed, start + FIRST_DELAY_MS + RETRY_MS - 1), false);
  assert.equal(speedDue(failed, start + FIRST_DELAY_MS + RETRY_MS), true);
});
