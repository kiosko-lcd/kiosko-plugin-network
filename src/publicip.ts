/**
 * The public IP address, from services that need no key, asked rarely:
 *
 * - `cloudflare`: Cloudflare's trace page at https://1.1.1.1/cdn-cgi/trace,
 *   the same company as the default ping target 1.1.1.1, reached by address
 *   so it works even with DNS broken. It also says the country.
 * - `ipify` (https://api.ipify.org) and `icanhazip` (https://icanhazip.com),
 *   only with the `any` choice, when Cloudflare doesn't answer.
 */
import type { HttpClient } from '@kiosko/sdk';

export interface IpService {
  id: string;
  url: string;
  host: string;
  parse(body: string): { ip: string; country?: string } | null;
}

const IP = /^(?:\d{1,3}(?:\.\d{1,3}){3}|[0-9a-f:]{2,39})$/i;

export function parseTrace(body: string): { ip: string; country?: string } | null {
  const kv = Object.fromEntries(body.split(/\r?\n/).map((l) => l.split('=')).filter((p) => p.length >= 2).map(([k, ...v]) => [k!.trim(), v.join('=').trim()]));
  if (!kv.ip || !IP.test(kv.ip)) return null;
  return { ip: kv.ip, ...(kv.loc && /^[A-Z]{2}$/.test(kv.loc) && kv.loc !== 'XX' ? { country: kv.loc } : {}) };
}

const plain = (body: string) => {
  const ip = body.trim();
  return IP.test(ip) ? { ip } : null;
};

export const IP_SERVICES: IpService[] = [
  { id: 'cloudflare', url: 'https://1.1.1.1/cdn-cgi/trace', host: '1.1.1.1', parse: parseTrace },
  { id: 'ipify', url: 'https://api.ipify.org', host: 'api.ipify.org', parse: plain },
  { id: 'icanhazip', url: 'https://ipv4.icanhazip.com', host: 'ipv4.icanhazip.com', parse: plain },
];

export type PublicIpMode = 'cloudflare' | 'any' | 'off';

export const servicesFor = (mode: PublicIpMode): IpService[] => (mode === 'off' ? [] : mode === 'cloudflare' ? IP_SERVICES.slice(0, 1) : IP_SERVICES);

/** Asks the services in order; the first answer wins. Throws when none answers. */
export async function lookupPublicIp(http: HttpClient, mode: PublicIpMode, signal?: AbortSignal): Promise<{ ip: string; via: string; country?: string }> {
  let last: unknown = new Error('public IP lookup is off');
  for (const s of servicesFor(mode)) {
    try {
      const r = await http.text(s.url, { noCache: true, ...(signal ? { signal } : {}) });
      const v = s.parse(r.data);
      if (v) return { ...v, via: s.id };
      last = new Error(`${s.host}: no address in the answer`);
    } catch (err) {
      last = err;
    }
  }
  throw last;
}
