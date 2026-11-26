/**
 * Pi-hole, v6 and v5:
 *
 * - v6 (2025 on): `POST /api/auth {password}` gives a session id, sent as
 *   `X-FTL-SID` to `GET /api/stats/summary` (the last 24 hours) and
 *   `GET /api/dns/blocking`. The session is kept and reused until it
 *   expires (Pi-hole allows only a few at a time), and asked for again on a 401.
 *   Without a password set in Pi-hole, no session is needed.
 * - v5: `GET /admin/api.php?summaryRaw&auth=<token>` (counts since midnight).
 *   An answer of `[]` means the token was wrong.
 */
import { HttpError } from '@kiosko/sdk';
import { L } from '../i18n.ts';
import type { BlockerData } from '../types.ts';
import { baseUrl, pct, type BlockerProvider } from './provider.ts';

export interface PiholeV6Summary {
  queries?: { total?: number; blocked?: number; percent_blocked?: number };
  gravity?: { domains_being_blocked?: number };
}

export interface PiholeV5Summary {
  domains_being_blocked?: number | string;
  dns_queries_today?: number | string;
  ads_blocked_today?: number | string;
  ads_percentage_today?: number | string;
  status?: string;
}

const n = (v: unknown): number => {
  const x = typeof v === 'string' ? Number(v.replace(/,/g, '')) : Number(v);
  return Number.isFinite(x) ? x : 0;
};

export function parseV6(summary: PiholeV6Summary, blocking: { blocking?: string } | null, now: number): BlockerData {
  const q = summary.queries ?? {};
  if (typeof q.total !== 'number') throw new Error('not a Pi-hole v6 summary');
  const total = n(q.total);
  const blocked = n(q.blocked);
  const b = blocking?.blocking;
  return {
    provider: 'pihole',
    name: 'Pi-hole',
    version: 'v6',
    queries: total,
    blocked,
    percent: typeof q.percent_blocked === 'number' ? Math.round(q.percent_blocked * 10) / 10 : pct(blocked, total),
    enabled: b === 'enabled' ? true : b === 'disabled' ? false : null,
    ...(summary.gravity?.domains_being_blocked !== undefined ? { domains: n(summary.gravity.domains_being_blocked) } : {}),
    period: '24h',
    at: now,
  };
}

export function parseV5(s: PiholeV5Summary | unknown[], now: number): BlockerData {
  if (Array.isArray(s) || typeof s !== 'object' || s === null || (s as PiholeV5Summary).dns_queries_today === undefined) throw new Error('Pi-hole refused the API token');
  const v = s as PiholeV5Summary;
  return {
    provider: 'pihole',
    name: 'Pi-hole',
    version: 'v5',
    queries: n(v.dns_queries_today),
    blocked: n(v.ads_blocked_today),
    percent: Math.round(n(v.ads_percentage_today) * 10) / 10,
    enabled: v.status === 'enabled' ? true : v.status === 'disabled' ? false : null,
    ...(v.domains_being_blocked !== undefined ? { domains: n(v.domains_being_blocked) } : {}),
    period: 'today',
    at: now,
  };
}

/** Sessions by Pi-hole address and password, kept between reads. */
const sessions = new Map<string, { sid: string | null; until: number }>();

export const pihole: BlockerProvider = {
  id: 'pihole',
  name: 'Pi-hole',
  label: L('Pi-hole', 'Pi-hole', 'Pi-hole', 'Pi-hole', 'Pi-hole'),
  async read(o, { http, now, signal }) {
    const base = baseUrl(o.url);
    const sig = signal ? { signal } : {};
    const key = `${base}|${o.password}`;
    const auth = async (): Promise<string | null> => {
      const r = await http.json<{ session?: { valid?: boolean; sid?: string | null; validity?: number } }>(`${base}/api/auth`, { method: 'POST', body: JSON.stringify({ password: o.password }), headers: { 'Content-Type': 'application/json' }, noCache: true, ...sig });
      const s = r.data.session;
      if (!s?.valid) throw new Error('Pi-hole refused the password');
      sessions.set(key, { sid: s.sid ?? null, until: now + Math.max(60, (s.validity ?? 300) - 30) * 1000 });
      return s.sid ?? null;
    };
    const get = <T>(path: string, sid: string | null) => http.json<T>(`${base}${path}`, { noCache: true, headers: sid ? { 'X-FTL-SID': sid } : {}, ...sig });
    let sid: string | null;
    try {
      const kept = sessions.get(key);
      sid = kept && kept.until > now ? kept.sid : await auth();
    } catch (err) {
      // No /api: a Pi-hole v5.
      if (err instanceof HttpError && (err.status === 404 || err.status === 405)) {
        const r = await http.json<PiholeV5Summary>(`${base}/admin/api.php?summaryRaw&auth=${encodeURIComponent(o.password)}`, { noCache: true, ...sig });
        return parseV5(r.data, now);
      }
      if (err instanceof HttpError && err.status === 401) throw new Error('Pi-hole refused the password');
      throw err;
    }
    let summary: PiholeV6Summary;
    try {
      summary = (await get<PiholeV6Summary>('/api/stats/summary', sid)).data;
    } catch (err) {
      if (!(err instanceof HttpError && err.status === 401)) throw err;
      sessions.delete(key);
      sid = await auth();
      summary = (await get<PiholeV6Summary>('/api/stats/summary', sid)).data;
    }
    let blocking: { blocking?: string } | null = null;
    try {
      blocking = (await get<{ blocking?: string }>('/api/dns/blocking', sid)).data;
    } catch {
      /* the counts are enough */
    }
    return parseV6(summary, blocking, now);
  },
};

/** For the tests. */
export const forgetPiholeSessions = (): void => sessions.clear();
