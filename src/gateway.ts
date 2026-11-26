/**
 * The default gateway (the router), per system:
 *
 * - Linux: `ip -j route show default` (JSON), else its text form, else
 *   /proc/net/route, which needs no program at all.
 * - macOS: `route -n get default`.
 * - Windows: `route print -4 0.0.0.0` (its rows read the same in every
 *   language), else PowerShell's `Get-NetRoute`.
 *
 * With several default routes (cable and Wi-Fi), the one with the lowest
 * metric: the one the system uses.
 */
import { readFile } from 'node:fs/promises';
import type { Run } from './ping.ts';

export interface Route {
  ip: string;
  iface: string | null;
  metric: number;
}

const IPV4 = /^\d{1,3}(?:\.\d{1,3}){3}$/;
const best = (routes: Route[]): Route | null => routes.filter((r) => r.ip && r.ip !== '0.0.0.0').sort((a, b) => a.metric - b.metric)[0] ?? null;

export function parseIpJson(text: string): Route | null {
  try {
    const list = JSON.parse(text) as { dst?: string; gateway?: string; dev?: string; metric?: number }[];
    return best(list.filter((r) => r.dst === 'default' && r.gateway).map((r) => ({ ip: r.gateway!, iface: r.dev ?? null, metric: r.metric ?? 0 })));
  } catch {
    return null;
  }
}

export function parseIpText(text: string): Route | null {
  const routes: Route[] = [];
  for (const line of text.split(/\r?\n/)) {
    const m = /^default\s+via\s+(\S+)(?:.*?\bdev\s+(\S+))?/.exec(line.trim());
    if (m) routes.push({ ip: m[1]!, iface: m[2] ?? null, metric: Number(/\bmetric\s+(\d+)/.exec(line)?.[1] ?? 0) });
  }
  return best(routes);
}

/** /proc/net/route: addresses in little-endian hex. */
export function parseProcRoute(text: string): Route | null {
  const routes: Route[] = [];
  for (const line of text.split(/\r?\n/).slice(1)) {
    const f = line.trim().split(/\s+/);
    if (f.length < 8 || f[1] !== '00000000' || f[7] !== '00000000') continue;
    const hex = f[2]!;
    if (!/^[0-9A-F]{8}$/i.test(hex) || hex === '00000000') continue;
    const ip = [3, 2, 1, 0].map((i) => parseInt(hex.slice(i * 2, i * 2 + 2), 16)).join('.');
    routes.push({ ip, iface: f[0]!, metric: Number(f[6]) || 0 });
  }
  return best(routes);
}

export function parseMacRoute(text: string): Route | null {
  const ip = /^\s*gateway:\s*(\S+)/m.exec(text)?.[1];
  if (!ip) return null;
  return { ip, iface: /^\s*interface:\s*(\S+)/m.exec(text)?.[1] ?? null, metric: 0 };
}

/** `route print`: the rows `0.0.0.0 0.0.0.0 <gateway> <interface address> <metric>`, whatever the language of the headers. */
export function parseWindowsRoute(text: string): Route | null {
  const routes: Route[] = [];
  for (const line of text.split(/\r?\n/)) {
    const f = line.trim().split(/\s+/);
    if (f.length >= 5 && f[0] === '0.0.0.0' && f[1] === '0.0.0.0' && IPV4.test(f[2]!)) routes.push({ ip: f[2]!, iface: f[3]!, metric: Number(f[4]) || 0 });
  }
  return best(routes);
}

/** `Get-NetRoute … | ConvertTo-Json`: one object or a list. */
export function parsePowerShellRoute(text: string): Route | null {
  try {
    const v = JSON.parse(text) as unknown;
    const list = (Array.isArray(v) ? v : [v]) as { NextHop?: string; InterfaceAlias?: string; RouteMetric?: number; InterfaceMetric?: number }[];
    return best(list.filter((r) => r?.NextHop).map((r) => ({ ip: r.NextHop!, iface: r.InterfaceAlias ?? null, metric: (r.RouteMetric ?? 0) + (r.InterfaceMetric ?? 0) })));
  } catch {
    return null;
  }
}

export const PS_ROUTE = "Get-NetRoute -AddressFamily IPv4 -DestinationPrefix '0.0.0.0/0' -ErrorAction SilentlyContinue | Select-Object NextHop,InterfaceAlias,RouteMetric,InterfaceMetric | ConvertTo-Json -Compress";

/** The default gateway of this system, or null when it has none (offline, a VPN that hides it). */
export async function findGateway(run: Run, os: NodeJS.Platform, o: { timeoutMs: number; signal?: AbortSignal; readProc?: () => Promise<string> }): Promise<Route | null> {
  const tryRun = async (cmd: string, args: string[]) => {
    try {
      const r = await run(cmd, args, { timeoutMs: o.timeoutMs, ...(o.signal ? { signal: o.signal } : {}) });
      return r.code === 0 ? r.stdout : null;
    } catch {
      return null;
    }
  };
  if (os === 'win32') {
    const t = await tryRun('route', ['print', '-4', '0.0.0.0']);
    const r = t ? parseWindowsRoute(t) : null;
    if (r) return r;
    const ps = await tryRun('powershell', ['-NoProfile', '-NonInteractive', '-Command', PS_ROUTE]);
    return ps ? parsePowerShellRoute(ps) : null;
  }
  if (os === 'darwin') {
    const t = await tryRun('route', ['-n', 'get', 'default']);
    return t ? parseMacRoute(t) : null;
  }
  const j = await tryRun('ip', ['-j', 'route', 'show', 'default']);
  const fromJson = j ? parseIpJson(j) : null;
  if (fromJson) return fromJson;
  const t = await tryRun('ip', ['route', 'show', 'default']);
  const fromText = t ? parseIpText(t) : null;
  if (fromText) return fromText;
  try {
    return parseProcRoute(await (o.readProc ?? (() => readFile('/proc/net/route', 'utf8')))());
  } catch {
    return null;
  }
}
