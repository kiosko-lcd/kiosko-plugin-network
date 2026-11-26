/**
 * Targets as the user writes them, one per line of the option:
 *
 *   gateway              the default gateway (the router), found per system
 *   1.1.1.1              ping (ICMP); a TCP connection to :443 if ping can't be used
 *   example.com:443      a TCP connection to that port, always
 *   NAS=192.168.1.10     the same, with the name to show
 *   [2606:4700::1111]    IPv6 (brackets needed only with a port)
 */
export interface TargetSpec {
  spec: string;
  /** The name written before `=`, or ''. */
  name: string;
  /** `gateway` for the router until its address is known. */
  host: string;
  /** Given in the spec: TCP only, to that port. */
  port?: number;
  gateway: boolean;
}

/** Public resolvers people use as targets, by the name they're known by. */
export const KNOWN: Record<string, string> = {
  '1.1.1.1': 'Cloudflare',
  '1.0.0.1': 'Cloudflare',
  '2606:4700:4700::1111': 'Cloudflare',
  '8.8.8.8': 'Google',
  '8.8.4.4': 'Google',
  '2001:4860:4860::8888': 'Google',
  '9.9.9.9': 'Quad9',
  '149.112.112.112': 'Quad9',
  '208.67.222.222': 'OpenDNS',
  '94.140.14.14': 'AdGuard DNS',
  '223.5.5.5': 'AliDNS',
  '119.29.29.29': 'DNSPod',
  '114.114.114.114': '114DNS',
};

export const DEFAULT_TARGETS = ['gateway', '1.1.1.1', '8.8.8.8'];

export function parseTarget(raw: string): TargetSpec | null {
  const spec = raw.trim();
  if (!spec) return null;
  let name = '';
  let rest = spec;
  const eq = spec.indexOf('=');
  if (eq > 0) {
    name = spec.slice(0, eq).trim();
    rest = spec.slice(eq + 1).trim();
  }
  if (/^(gateway|router)$/i.test(rest)) return { spec, name, host: 'gateway', gateway: true };
  rest = rest.replace(/^[a-z]+:\/\//i, '').replace(/\/.*$/, '');
  let host = rest;
  let port: number | undefined;
  const v6 = /^\[([^\]]+)\](?::(\d+))?$/.exec(rest);
  if (v6) {
    host = v6[1]!;
    if (v6[2]) port = Number(v6[2]);
  } else if ((rest.match(/:/g) ?? []).length === 1) {
    const [h, p] = rest.split(':');
    host = h!;
    port = Number(p);
  }
  if (!host || !/^[\w.:%-]+$/.test(host)) return null;
  if (port !== undefined && !(Number.isInteger(port) && port > 0 && port < 65536)) return null;
  return { spec, name, host, ...(port !== undefined ? { port } : {}), gateway: false };
}

export function parseTargets(list: readonly string[]): TargetSpec[] {
  const seen = new Set<string>();
  const out: TargetSpec[] = [];
  for (const raw of list) {
    const t = parseTarget(raw);
    if (!t || seen.has(`${t.host}:${t.port ?? ''}`)) continue;
    seen.add(`${t.host}:${t.port ?? ''}`);
    out.push(t);
  }
  return out.slice(0, 8);
}
