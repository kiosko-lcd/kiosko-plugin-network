import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHttp } from '@kiosko/sdk';
import { fixture, fixtureText } from '../fixtures.ts';
import { adguard, parseAdguard } from './adguard.ts';
import { forgetPiholeSessions, parseV5, parseV6, pihole, type PiholeV6Summary } from './pihole.ts';
import { baseUrl } from './provider.ts';

const NOW = Date.parse('2026-11-26T12:00:00Z');

/** A fetch that answers from a table of "METHOD path" → [status, body], and notes what it was asked. */
function fakeFetch(routes: Record<string, [number, string]>, seen: { url: string; init?: RequestInit }[] = []): typeof fetch {
  return (async (url: string, init?: RequestInit) => {
    seen.push({ url, ...(init ? { init } : {}) });
    const u = new URL(url);
    const key = `${init?.method ?? 'GET'} ${u.pathname}`;
    const [status, body] = routes[key] ?? [404, 'not found'];
    return new Response(body, { status, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
}

test('baseUrl: the admin page address, with or without the scheme', () => {
  assert.equal(baseUrl('http://pi.hole/admin/'), 'http://pi.hole');
  assert.equal(baseUrl('192.168.1.2:8080'), 'http://192.168.1.2:8080');
  assert.equal(baseUrl('https://dns.example.com/'), 'https://dns.example.com');
});

test('Pi-hole v6: summary and blocking status', () => {
  const d = parseV6(fixture('pihole-v6-summary.json') as PiholeV6Summary, fixture('pihole-v6-blocking.json') as { blocking: string }, NOW);
  assert.deepEqual([d.queries, d.blocked, d.percent, d.enabled, d.domains, d.period, d.version], [29160, 8139, 27.9, true, 167804, '24h', 'v6']);
  assert.throws(() => parseV6({}, null, NOW));
});

test('Pi-hole v5: summaryRaw, and [] for a wrong token', () => {
  const d = parseV5(fixture('pihole-v5-summary.json') as never, NOW);
  assert.deepEqual([d.queries, d.blocked, d.percent, d.enabled, d.domains, d.period, d.version], [18426, 2913, 15.8, true, 121512, 'today', 'v5']);
  assert.throws(() => parseV5(fixture('pihole-v5-unauthorized.json') as never, NOW), /token/);
});

test('Pi-hole v6 over HTTP: one login, the session reused, sent as X-FTL-SID', async () => {
  forgetPiholeSessions();
  const seen: { url: string; init?: RequestInit }[] = [];
  const http = createHttp({
    fetch: fakeFetch(
      {
        'POST /api/auth': [200, fixtureText('pihole-v6-auth.json')],
        'GET /api/stats/summary': [200, fixtureText('pihole-v6-summary.json')],
        'GET /api/dns/blocking': [200, fixtureText('pihole-v6-blocking.json')],
      },
      seen,
    ),
  });
  const o = { url: 'http://pi.hole/admin', password: 'app-pass', user: '' };
  const a = await pihole.read(o, { http, now: NOW });
  const b = await pihole.read(o, { http, now: NOW + 60_000 });
  assert.equal(a.blocked, 8139);
  assert.equal(b.blocked, 8139);
  assert.equal(seen.filter((s) => s.url.endsWith('/api/auth')).length, 1);
  const summary = seen.find((s) => s.url.endsWith('/api/stats/summary'))!;
  assert.equal((summary.init!.headers as Record<string, string>)['X-FTL-SID'], 'vFA+EP4MQ5JJvJg+3Q2Jnw=');
});

test('Pi-hole v6: a wrong password says so', async () => {
  forgetPiholeSessions();
  const http = createHttp({ fetch: fakeFetch({ 'POST /api/auth': [401, fixtureText('pihole-v6-auth-wrong.json')] }) });
  await assert.rejects(pihole.read({ url: 'http://pi.hole', password: 'x', user: '' }, { http, now: NOW }), /password/);
});

test('Pi-hole v5 over HTTP: no /api, so the old api.php', async () => {
  forgetPiholeSessions();
  const seen: { url: string }[] = [];
  const http = createHttp({ fetch: fakeFetch({ 'GET /admin/api.php': [200, fixtureText('pihole-v5-summary.json')] }, seen) });
  const d = await pihole.read({ url: 'http://192.168.1.2', password: 'tok&en', user: '' }, { http, now: NOW });
  assert.equal(d.version, 'v5');
  assert.ok(seen.some((s) => s.url === 'http://192.168.1.2/admin/api.php?summaryRaw&auth=tok%26en'));
});

test('AdGuard Home: stats and status, Basic auth', async () => {
  const d = parseAdguard(fixture('adguard-stats.json') as never, fixture('adguard-status.json') as never, NOW);
  assert.deepEqual([d.queries, d.blocked, d.percent, d.enabled, d.version, d.period], [15402, 2193, 14.2, true, 'v0.107.57', '24h']);
  const seen: { url: string; init?: RequestInit }[] = [];
  const http = createHttp({ fetch: fakeFetch({ 'GET /control/stats': [200, fixtureText('adguard-stats.json')], 'GET /control/status': [200, fixtureText('adguard-status.json')] }, seen) });
  const r = await adguard.read({ url: 'http://192.168.1.2:3000', user: 'admin', password: 'secret' }, { http, now: NOW });
  assert.equal(r.blocked, 2193);
  assert.equal((seen[0]!.init!.headers as Record<string, string>).Authorization, `Basic ${Buffer.from('admin:secret').toString('base64')}`);
});
