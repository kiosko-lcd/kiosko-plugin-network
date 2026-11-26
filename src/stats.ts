/**
 * Latency, jitter and loss from the samples: plain arithmetic, no clock.
 *
 * - Latency is the median of the replies (one slow reply doesn't move it).
 * - Jitter is the mean absolute difference between consecutive replies, in
 *   the order they came (RFC 3550's "interarrival jitter" without its
 *   smoothing): what a call or a game feels, not the spread around the mean.
 * - Loss is the share of probes without a reply.
 */
import type { Sample, Status, TargetData, Thresholds } from './types.ts';

export function median(values: readonly number[]): number | null {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const m = s.length >> 1;
  return s.length % 2 ? s[m]! : (s[m - 1]! + s[m]!) / 2;
}

/** Mean |rtt[i] − rtt[i−1]| over the replies in order; null with fewer than two. */
export function jitter(rtts: readonly number[]): number | null {
  if (rtts.length < 2) return null;
  let sum = 0;
  for (let i = 1; i < rtts.length; i++) sum += Math.abs(rtts[i]! - rtts[i - 1]!);
  return sum / (rtts.length - 1);
}

/** Lost share of the probes, 0..1; null when none were sent. */
export function loss(samples: readonly Sample[]): number | null {
  let sent = 0;
  let got = 0;
  for (const s of samples) {
    sent += s.sent;
    got += Math.min(s.sent, s.rtts.length);
  }
  return sent ? (sent - got) / sent : null;
}

/** The samples taken in the last `ms` before `now`. */
export const within = (samples: readonly Sample[], now: number, ms: number): Sample[] => samples.filter((s) => s.at > now - ms && s.at <= now);

/** A target's numbers over the window. */
export function summarize(samples: readonly Sample[], now: number, windowMs: number): Pick<TargetData, 'last' | 'median' | 'jitter' | 'loss'> {
  const w = within(samples, now, windowMs);
  const lastS = samples[samples.length - 1];
  const rtts = w.flatMap((s) => s.rtts);
  return { last: lastS ? median(lastS.rtts) : null, median: median(rtts), jitter: jitter(rtts), loss: loss(w) };
}

export type Level = 'ok' | 'warn' | 'bad';

export function latencyLevel(ms: number | null, t: Thresholds): Level {
  if (ms === null) return 'bad';
  return ms >= t.latencyBadMs ? 'bad' : ms >= t.latencyWarnMs ? 'warn' : 'ok';
}

export function lossLevel(l: number | null, t: Thresholds): Level {
  if (l === null) return 'ok';
  const pct = l * 100;
  return pct >= t.lossAlertPct ? 'bad' : pct >= t.lossWarnPct && l > 0 ? 'warn' : 'ok';
}

/** The internet targets (everything but the gateway); the gateway alone if that's all there is. */
export function internetOf<T extends { gateway: boolean }>(targets: readonly T[]): T[] {
  const net = targets.filter((t) => !t.gateway);
  return net.length ? net : [...targets];
}

/**
 * The connection in a word, from the latest numbers: offline when no internet
 * target answered in the latest sample (`local` if the router still does),
 * lossy or slow by the thresholds, else ok.
 */
export function statusOf(targets: readonly TargetData[], t: Thresholds): Status {
  if (!targets.length || targets.every((x) => !x.samples.length)) return 'starting';
  const net = internetOf(targets);
  const up = net.filter((x) => x.last !== null);
  if (!up.length) {
    const gw = targets.find((x) => x.gateway);
    return gw && gw.last !== null && net.every((x) => !x.gateway) ? 'local' : 'offline';
  }
  if (net.some((x) => lossLevel(x.loss, t) !== 'ok')) return 'lossy';
  const best = Math.min(...up.map((x) => x.median ?? x.last ?? Infinity));
  return latencyLevel(best, t) === 'ok' ? 'ok' : 'slow';
}
