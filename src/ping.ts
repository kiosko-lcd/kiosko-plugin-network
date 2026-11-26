/**
 * Probing a target: the system's own `ping` (ICMP without privileges where
 * the system allows it: Linux's unprivileged ICMP sockets or its
 * capability-carrying binary, macOS and Windows as they come), or, when there
 * is no usable `ping` (a container without it, a sandbox that forbids raw
 * sockets) or the target names a port, the time a TCP connection takes.
 *
 * `ping`'s output is read the same way on every system and language: a reply
 * is a line with `ttl=` (or, for IPv6 on Windows, the target's address and a
 * colon) and a time written `=12.3 ms`, `=12,3 ms` (a decimal comma) or
 * `<1ms`. That covers iputils and BusyBox on Linux, macOS, and Windows in
 * English, Spanish, German and Chinese ("时间=9ms TTL=57").
 */
import { connect } from 'node:net';
import { performance } from 'node:perf_hooks';
import { execFile } from 'node:child_process';

/** What a probe of N packets saw. */
export interface ProbeResult {
  rtts: number[];
  sent: number;
  /** Why nothing could be measured ("unknown host"), if that's the case. */
  error?: string;
}

/** Runs a program; resolves with its output and exit code even when the code isn't 0. Rejects when it can't run (`ENOENT`) or times out. */
export type Run = (cmd: string, args: string[], o: { timeoutMs: number; signal?: AbortSignal }) => Promise<{ stdout: string; stderr: string; code: number }>;

export const execRun: Run = (cmd, args, { timeoutMs, signal }) =>
  new Promise((resolve, reject) => {
    execFile(
      cmd,
      args,
      { timeout: timeoutMs, maxBuffer: 4 * 1024 * 1024, windowsHide: true, encoding: 'utf8', ...(signal ? { signal } : {}), env: { ...process.env, LC_ALL: 'C', LANG: 'C' } },
      (err, stdout, stderr) => {
        const e = err as (NodeJS.ErrnoException & { killed?: boolean; code?: unknown }) | null;
        if (e && (typeof e.code !== 'number' || e.killed)) return reject(e);
        resolve({ stdout: String(stdout), stderr: String(stderr), code: e ? (e.code as unknown as number) : 0 });
      },
    );
  });

const TIME = /[=<]\s*(\d+(?:[.,]\d+)?)\s*ms\b/i;
const TTL = /\bttl[=:]\s*\d+/i;

/** The round-trip times in `ping`'s output, ms, in the order they came. Duplicates (`DUP!`) are left out. */
export function parsePing(out: string, target?: string): number[] {
  const rtts: number[] = [];
  for (const line of out.split(/\r?\n/)) {
    if (/DUP!/.test(line)) continue;
    const m = TIME.exec(line);
    if (!m) continue;
    if (!TTL.test(line) && !(target && line.includes(`${target}:`))) continue;
    // `time<1ms`, Windows' way of saying under a millisecond.
    const lt = line.slice(Math.max(0, m.index), m.index + 1) === '<';
    const v = Number(m[1]!.replace(',', '.'));
    if (Number.isFinite(v)) rtts.push(lt ? v / 2 : v);
  }
  return rtts;
}

/** `ping` is there but may not be used (no raw sockets, no capability): probe by TCP instead. */
export function pingForbidden(text: string): boolean {
  return /operation not permitted|permission denied|lacking privilege|cap_net_raw|must be root|socket: .*denied/i.test(text);
}

/** A name that doesn't resolve, in the words of iputils, BusyBox, macOS and Windows (English). */
export function unknownHost(text: string): boolean {
  return /name or service not known|unknown host|cannot resolve|could not find host|temporary failure in name resolution|no address associated|bad address/i.test(text);
}

/** The `ping` command for this system: `count` probes, each waiting up to `timeoutMs`. */
export function pingCommand(os: NodeJS.Platform, host: string, count: number, timeoutMs: number): { cmd: string; args: string[]; budgetMs: number } {
  const v6 = host.includes(':');
  const waitS = Math.max(1, Math.ceil(timeoutMs / 1000));
  if (os === 'win32') {
    // One a second, the only pace Windows' ping has.
    return { cmd: 'ping', args: ['-n', String(count), '-w', String(timeoutMs), ...(v6 ? ['-6'] : ['-4']), host], budgetMs: count * (1000 + timeoutMs) + 2000 };
  }
  if (os === 'darwin') {
    // -W is in ms on macOS; an interval under 1 s needs no privilege there only from 0.1 s up, so 0.2 s like Linux.
    return { cmd: v6 ? 'ping6' : 'ping', args: v6 ? ['-n', '-c', String(count), '-i', '0.2', host] : ['-n', '-c', String(count), '-i', '0.2', '-W', String(timeoutMs), '-t', String(Math.ceil(count * 0.2) + waitS + 1), host], budgetMs: count * 200 + timeoutMs + 3000 };
  }
  // iputils (and BusyBox, which ignores what it doesn't know as long as it's -c/-W/-w): 0.2 s is the shortest interval without privileges.
  return { cmd: 'ping', args: ['-n', '-c', String(count), '-i', '0.2', '-W', String(waitS), '-w', String(Math.ceil(count * 0.2) + waitS), host], budgetMs: count * 200 + timeoutMs + 3000 };
}

/** Probes with the system's `ping`. Throws `PingUnusable` when `ping` is missing or not allowed. */
export class PingUnusable extends Error {}

export async function icmpProbe(run: Run, os: NodeJS.Platform, host: string, count: number, timeoutMs: number, signal?: AbortSignal): Promise<ProbeResult> {
  const { cmd, args, budgetMs } = pingCommand(os, host, count, timeoutMs);
  let r: Awaited<ReturnType<Run>>;
  try {
    r = await run(cmd, args, { timeoutMs: budgetMs, ...(signal ? { signal } : {}) });
  } catch (err) {
    const e = err as NodeJS.ErrnoException & { killed?: boolean };
    if (e.code === 'ENOENT' || e.code === 'EACCES') throw new PingUnusable(`${cmd}: ${e.code}`);
    // Killed for taking too long: everything lost.
    return { rtts: [], sent: count };
  }
  const all = `${r.stdout}\n${r.stderr}`;
  const rtts = parsePing(r.stdout, host);
  if (!rtts.length && pingForbidden(all)) throw new PingUnusable(all.trim().split(/\r?\n/)[0] ?? 'ping not allowed');
  const out: ProbeResult = { rtts: rtts.slice(0, count), sent: count };
  if (!rtts.length && unknownHost(all)) out.error = 'unknown host';
  return out;
}

/** Opens a TCP connection and says how long it took; null when it timed out or the host was unreachable; throws when the name doesn't resolve. A refused connection counts: the host answered. */
export type Connect = (host: string, port: number, timeoutMs: number, signal?: AbortSignal) => Promise<number | null>;

export const tcpConnect: Connect = (host, port, timeoutMs, signal) =>
  new Promise((resolve, reject) => {
    let done = false;
    // Timed from the start, and again from once a name is resolved, so DNS doesn't count as latency (an address has no lookup).
    let t0 = performance.now();
    const sock = connect({ host, port, timeout: timeoutMs });
    const finish = (v: number | null, err?: Error) => {
      if (done) return;
      done = true;
      sock.destroy();
      signal?.removeEventListener('abort', onAbort);
      if (err) reject(err);
      else resolve(v);
    };
    const onAbort = () => finish(null);
    signal?.addEventListener('abort', onAbort);
    sock.on('lookup', () => (t0 = performance.now()));
    sock.on('connect', () => finish(performance.now() - t0));
    sock.on('timeout', () => finish(null));
    sock.on('error', (e: NodeJS.ErrnoException) => {
      if (e.code === 'ECONNREFUSED') finish(performance.now() - t0);
      else if (e.code === 'ENOTFOUND' || e.code === 'EAI_AGAIN') finish(null, Object.assign(new Error('unknown host'), { code: e.code }));
      else finish(null);
    });
  });

/** `count` TCP connections one after another. */
export async function tcpProbe(conn: Connect, host: string, port: number, count: number, timeoutMs: number, signal?: AbortSignal): Promise<ProbeResult> {
  const rtts: number[] = [];
  for (let i = 0; i < count && !signal?.aborted; i++) {
    let v: number | null;
    try {
      v = await conn(host, port, timeoutMs, signal);
    } catch {
      // A name that doesn't resolve: no use trying again this sample.
      return { rtts, sent: count, error: 'unknown host' };
    }
    if (v !== null) rtts.push(Math.max(0.01, v));
  }
  return { rtts, sent: count };
}
