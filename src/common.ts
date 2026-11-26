/** What the widgets share: their source, colours, labels and a few drawing helpers. */
import type { Graphics, RenderContext } from '@kiosko/sdk';
import { bandText, dbmText, mbpsText, MBPS, msText } from './format.ts';
import { CHANNEL, fill, HIDDEN_SSID, NO_ROUTE, ROUTER, UNKNOWN_HOST } from './labels.ts';
import { latencyLevel, lossLevel, type Level } from './stats.ts';
import type { NetData, Status, TargetData, WifiData } from './types.ts';

export const SOURCE = 'network/connection';
/** The smallest text drawn, in px of the box: readable on a panel across the desk. */
export const MIN_PX = 11;

export type Ctx = RenderContext<any, any>;

export const dataOf = (sources: Record<string, unknown>): NetData | undefined => sources[SOURCE] as NetData | undefined;

export const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export function levelColor(ctx: Pick<Ctx, 'theme'>, level: Level): string {
  const c = ctx.theme.colors;
  return level === 'bad' ? c.alert : level === 'warn' ? c.warn : c.ok;
}

/** Text of a value: plain ink when fine (green text is loud), amber or red when not. */
export function levelInk(ctx: Pick<Ctx, 'theme'>, level: Level): string {
  return level === 'ok' ? ctx.theme.colors.ink : levelColor(ctx, level);
}

export function statusColor(ctx: Pick<Ctx, 'theme'>, s: Status): string {
  const c = ctx.theme.colors;
  return s === 'ok' ? c.ok : s === 'slow' || s === 'lossy' ? c.warn : s === 'starting' ? c.inkDim : c.alert;
}

export const targetName = (ctx: Ctx, t: TargetData): string => t.label || ctx.t(ROUTER);

export function targetLatencyLevel(data: NetData, t: TargetData): Level {
  return latencyLevel(t.median ?? t.last, data.thresholds);
}

export const targetLossLevel = (data: NetData, t: TargetData): Level => lossLevel(t.loss, data.thresholds);

/** "9,1", or "—" when it was all lost, or why when it can't be probed. */
export function latencyOf(ctx: Ctx, t: TargetData): string {
  const v = t.last ?? null;
  if (v !== null) return msText(ctx.locale, t.median ?? v);
  if (t.error === 'no gateway') return ctx.t(NO_ROUTE);
  if (t.error === 'unknown host') return ctx.t(UNKNOWN_HOST);
  return '—';
}

/** The latency to show for the whole connection: the best internet target's. */
export function bestLatency(data: NetData): number | null {
  const net = data.targets.filter((t) => !t.gateway && t.last !== null);
  const list = net.length ? net : data.targets.filter((t) => t.last !== null);
  const v = list.map((t) => t.median ?? t.last!).filter((x) => x !== null);
  return v.length ? Math.min(...v) : null;
}

/** Whether to show the Wi-Fi: always, never, or (auto) when the connection goes through it. */
export function wifiShown(data: NetData, mode: string): WifiData | null {
  const w = data.wifi;
  if (!w || mode === 'never') return null;
  if (mode === 'always') return w;
  return w.primary === false ? null : w;
}

/** "HomeNet · −58 dBm · 5 GHz · canal 100 · 867 Mbit/s", the parts that fit from the left. */
export function wifiParts(ctx: Ctx, w: WifiData): string[] {
  const parts = [w.ssid ?? ctx.t(HIDDEN_SSID)];
  if (w.signalDbm !== null) parts.push(dbmText(w.signalDbm));
  else if (w.signalPct !== null) parts.push(`${w.signalPct} %`);
  if (w.band) parts.push(bandText(ctx.locale, w.band));
  if (w.channel !== null) parts.push(fill(ctx.t(CHANNEL), { n: String(w.channel) }));
  const rate = w.rxMbps ?? w.txMbps;
  if (rate !== null) parts.push(`${mbpsText(ctx.locale, rate)} ${MBPS}`);
  return parts;
}

/** Joins parts with " · " as far as they fit in `w`. */
export function fitParts(g: Graphics, ctx: Ctx, parts: string[], w: number, font: { size: number; family: string }): string {
  const { kit } = ctx;
  let out = '';
  for (const p of parts) {
    const next = out ? `${out} · ${p}` : p;
    if (kit.measureTracked(g, next, font) > w) return out || kit.truncate(g, p, w, font);
    out = next;
  }
  return out;
}

/** Paints inside the box only, whatever happens. */
export function clipped(g: Graphics, ctx: Ctx, paint: () => void): void {
  const { box } = ctx;
  g.save();
  g.beginPath();
  g.rect(box.x, box.y, box.w, box.h);
  g.clip();
  try {
    paint();
  } finally {
    g.restore();
  }
}

export function drawMessage(g: Graphics, ctx: Ctx, text: string, sub?: string): void {
  const { box, kit, theme } = ctx;
  const c = theme.colors;
  const size = clamp(Math.round(Math.min(box.h * 0.3, box.w / 12)), MIN_PX, 26);
  const subSize = clamp(Math.round(size * 0.66), MIN_PX, 18);
  const font = { size, family: theme.fonts.sans, color: c.inkDim };
  const f2 = { size: subSize, family: theme.fonts.sans, color: c.inkFaint };
  const lines = kit.wrapLines(g, text, box.w, box.h >= size * 3 ? 2 : 1, font);
  const subLines = sub ? kit.wrapLines(g, sub, box.w, 2, f2) : [];
  let keep = subLines.length;
  const h = (n: number) => lines.length * size * 1.25 + (n ? subSize * 0.5 + n * subSize * 1.25 : 0);
  while (keep > 0 && h(keep) > box.h) keep--;
  let y = box.y + (box.h - h(keep)) / 2;
  for (const l of lines) {
    y += size * 1.25;
    kit.drawTracked(g, l, box.x, y - size * 0.3, font);
  }
  y += subSize * 0.5;
  for (const l of subLines.slice(0, keep)) {
    y += subSize * 1.25;
    kit.drawTracked(g, l, box.x, y - subSize * 0.3, f2);
  }
}

export function dot(g: Graphics, x: number, y: number, r: number, color: string): void {
  g.save();
  g.fillStyle = color;
  g.beginPath();
  g.arc(x, y, r, 0, Math.PI * 2);
  g.fill();
  g.restore();
}

/** A small triangle pointing up or down (download/upload), centred on x, sitting on `base`. */
export function arrow(g: Graphics, x: number, base: number, size: number, dir: 'up' | 'down', color: string): void {
  const w = size * 0.7;
  const h = size * 0.62;
  const top = base - size * 0.72;
  g.save();
  g.fillStyle = color;
  g.beginPath();
  if (dir === 'down') {
    g.moveTo(x - w / 2, top + (size * 0.72 - h) / 2);
    g.lineTo(x + w / 2, top + (size * 0.72 - h) / 2);
    g.lineTo(x, top + (size * 0.72 + h) / 2);
  } else {
    g.moveTo(x - w / 2, top + (size * 0.72 + h) / 2);
    g.lineTo(x + w / 2, top + (size * 0.72 + h) / 2);
    g.lineTo(x, top + (size * 0.72 - h) / 2);
  }
  g.closePath();
  g.fill();
  g.restore();
}
