/**
 * AdGuard Home: `GET /control/stats` and `/control/status`, with the user
 * and password of its web interface (HTTP Basic). Its counts cover its
 * statistics period (24 hours by default): what it filtered, plus what Safe
 * Browsing, parental control and safe search replaced.
 */
import { L } from '../i18n.ts';
import type { BlockerData } from '../types.ts';
import { baseUrl, pct, type BlockerProvider } from './provider.ts';

export interface AdguardStats {
  time_units?: string;
  num_dns_queries?: number;
  num_blocked_filtering?: number;
  num_replaced_safebrowsing?: number;
  num_replaced_parental?: number;
  num_replaced_safesearch?: number;
}

export interface AdguardStatus {
  protection_enabled?: boolean;
  version?: string;
}

export function parseAdguard(stats: AdguardStats, status: AdguardStatus | null, now: number): BlockerData {
  if (typeof stats.num_dns_queries !== 'number') throw new Error('not AdGuard Home statistics');
  const blocked = (stats.num_blocked_filtering ?? 0) + (stats.num_replaced_safebrowsing ?? 0) + (stats.num_replaced_parental ?? 0) + (stats.num_replaced_safesearch ?? 0);
  return {
    provider: 'adguard',
    name: 'AdGuard Home',
    ...(status?.version ? { version: status.version } : {}),
    queries: stats.num_dns_queries,
    blocked,
    percent: pct(blocked, stats.num_dns_queries),
    enabled: typeof status?.protection_enabled === 'boolean' ? status.protection_enabled : null,
    period: stats.time_units === 'days' ? 'days' : '24h',
    at: now,
  };
}

export const adguard: BlockerProvider = {
  id: 'adguard',
  name: 'AdGuard Home',
  label: L('AdGuard Home', 'AdGuard Home', 'AdGuard Home', 'AdGuard Home', 'AdGuard Home'),
  async read(o, { http, now, signal }) {
    const base = baseUrl(o.url);
    const headers: Record<string, string> = o.user || o.password ? { Authorization: `Basic ${Buffer.from(`${o.user}:${o.password}`).toString('base64')}` } : {};
    const sig = signal ? { signal } : {};
    const stats = (await http.json<AdguardStats>(`${base}/control/stats`, { headers, noCache: true, ...sig })).data;
    let status: AdguardStatus | null = null;
    try {
      status = (await http.json<AdguardStatus>(`${base}/control/status`, { headers, noCache: true, ...sig })).data;
    } catch {
      /* the counts are enough */
    }
    return parseAdguard(stats, status, now);
  },
};
