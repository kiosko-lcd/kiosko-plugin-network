/**
 * `network/latency`: latency over the last minutes (10 by default), one line
 * per target on one scale, the amber threshold dashed when it is in range,
 * and a tick at the bottom for every sample with lost packets (amber: some,
 * red: all). With a single target, bars in green, amber or red instead.
 */
import { defineWidget, t, type Graphics } from '@kiosko/sdk';
import { clamp, clipped, dataOf, drawMessage, latencyOf, levelColor, MIN_PX, SOURCE, targetLatencyLevel, targetName, type Ctx } from './common.ts';
import { demoData } from './demo.ts';
import { msText } from './format.ts';
import { L } from './i18n.ts';
import { fill, LAST_SPAN, NOW_TAG, WAITING } from './labels.ts';
import { latencyLevel, median } from './stats.ts';
import type { NetData, TargetData } from './types.ts';

export interface Area {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** Up to four series: the targets chosen, or the router and the first three others. */
export function seriesOf(data: NetData, pick: string): TargetData[] {
  const want = pick.trim().toLowerCase();
  if (want) {
    const one = data.targets.find((x) => [x.spec, x.label, x.host].some((v) => v.toLowerCase() === want) || (want === 'gateway' && x.gateway));
    if (one) return [one];
  }
  const gw = data.targets.filter((x) => x.gateway);
  const net = data.targets.filter((x) => !x.gateway);
  return [...gw, ...net].slice(0, 4);
}

/** One colour per series, by its place, from the theme: the router in dim ink, the others in accent, info and ink. */
export function seriesColors(ctx: Pick<Ctx, 'theme'>, series: TargetData[]): string[] {
  const c = ctx.theme.colors;
  const palette = [...new Set([c.accent, c.info, c.ink].map((x) => x.toUpperCase()))];
  let i = 0;
  return series.map((s) => (s.gateway ? c.inkDim : (palette[i++ % palette.length] ?? c.ink)));
}

/** 1, 2, 5, 10, 20, 50…: the smallest at or over `v`. */
export function niceCeil(v: number): number {
  if (!(v > 0)) return 1;
  const p = 10 ** Math.floor(Math.log10(v));
  for (const m of [1, 1.5, 2, 2.5, 3, 4, 5, 6, 8, 10]) if (m * p >= v) return m * p;
  return 10 * p;
}

const valueOf = (s: { rtts: number[] }): number | null => median(s.rtts);

/** The time the graph spans: the history kept, or less while there isn't that much yet (a minute at least). */
export function spanOf(data: NetData, series: TargetData[]): number {
  const first = Math.min(...series.map((s) => s.samples[0]?.at ?? data.at));
  return Math.max(60_000, Math.min(data.historyMs, data.at - first + Math.max(1000, data.intervalMs || 5000)));
}

/** The plot alone, in `area`: scale, threshold, lines (or bars) and loss ticks. Returns the scale's top (ms). */
export function drawPlot(g: Graphics, ctx: Ctx, data: NetData, series: TargetData[], area: Area, o: { axisLabel?: number } = {}): number {
  const { kit, theme } = ctx;
  const c = theme.colors;
  const end = data.at;
  const span = spanOf(data, series);
  const from = end - span;
  const tickH = Math.max(3, Math.round(area.h * 0.06));
  const plot = { x: area.x, y: area.y, w: area.w, h: area.h - tickH - 2 };
  const all = series.flatMap((s) => s.samples.map(valueOf)).filter((v): v is number => v !== null);
  const top = niceCeil(Math.max(1, ...all) * 1.1);
  const xOf = (at: number) => plot.x + ((at - from) / (end - from)) * plot.w;
  const yOf = (v: number) => plot.y + plot.h - (Math.min(v, top) / top) * plot.h;
  g.save();
  // The base line and the scale's top, faint.
  g.strokeStyle = c.surfaceEdge;
  g.lineWidth = 1;
  g.beginPath();
  for (const y of [plot.y + plot.h, yOf(top)]) {
    g.moveTo(plot.x, Math.round(y) + 0.5);
    g.lineTo(plot.x + plot.w, Math.round(y) + 0.5);
  }
  g.stroke();
  // The amber threshold, dashed, when it's inside the scale.
  if (data.thresholds.latencyWarnMs < top) {
    g.strokeStyle = c.warn;
    g.globalAlpha = 0.55;
    g.setLineDash([4, 4]);
    g.beginPath();
    const y = Math.round(yOf(data.thresholds.latencyWarnMs)) + 0.5;
    g.moveTo(plot.x, y);
    g.lineTo(plot.x + plot.w, y);
    g.stroke();
    g.setLineDash([]);
    g.globalAlpha = 1;
  }
  const colors = seriesColors(ctx, series);
  if (series.length === 1) {
    // One target: bars by level.
    const s = series[0]!;
    const n = Math.max(1, Math.round(span / Math.max(1000, data.intervalMs || 5000)));
    const bw = plot.w / n;
    for (const sm of s.samples) {
      const v = valueOf(sm);
      if (v === null) continue;
      const x = xOf(sm.at) - bw;
      g.fillStyle = levelColor(ctx, latencyLevel(v, data.thresholds));
      const y = yOf(v);
      g.fillRect(x + (bw >= 4 ? 0.5 : 0), y, Math.max(1, bw - (bw >= 4 ? 1 : 0)), plot.y + plot.h - y);
    }
  } else {
    // Several: one 2 px line each, broken where a sample was all lost. The router first, under the rest.
    series.forEach((s, i) => {
      g.strokeStyle = colors[i]!;
      g.lineWidth = Math.max(1.5, Math.min(2.5, area.h / 60));
      g.lineJoin = 'round';
      g.beginPath();
      let pen = false;
      for (const sm of s.samples) {
        const v = valueOf(sm);
        if (v === null) {
          pen = false;
          continue;
        }
        const x = xOf(sm.at);
        const y = yOf(v);
        if (pen) g.lineTo(x, y);
        else g.moveTo(x, y);
        pen = true;
      }
      g.stroke();
    });
  }
  // Loss ticks: amber where some probes were lost, red where all were.
  const lossAt = new Map<number, number>();
  for (const s of series) for (const sm of s.samples) if (sm.sent) lossAt.set(sm.at, Math.max(lossAt.get(sm.at) ?? 0, 1 - Math.min(sm.sent, sm.rtts.length) / sm.sent));
  for (const [at, l] of lossAt) {
    if (l <= 0) continue;
    g.fillStyle = l >= 1 ? c.alert : c.warn;
    const x = xOf(at);
    g.fillRect(x - 1.5, area.y + area.h - tickH, 3, tickH);
  }
  g.restore();
  if (o.axisLabel) {
    const f = { size: o.axisLabel, family: theme.fonts.sans, color: c.inkDim, align: 'right' as const };
    const label = `${msText(ctx.locale, top)} ms`;
    const y = yOf(top) + o.axisLabel + 2;
    if (y + 2 < plot.y + plot.h) kit.drawTracked(g, label, area.x + area.w, y, f);
  }
  return top;
}

function render(g: Graphics, ctx: Ctx): void {
  const data = dataOf(ctx.sources);
  if (!data) return drawMessage(g, ctx, ctx.t(WAITING));
  const { box, kit, theme } = ctx;
  const c = theme.colors;
  const series = seriesOf(data, String(ctx.options.target ?? ''));
  if (!series.length || series.every((s) => !s.samples.length)) return drawMessage(g, ctx, ctx.t(WAITING));
  const colors = seriesColors(ctx, series);
  const s = clamp(Math.round(Math.min(box.h * 0.1, box.w / 20)), MIN_PX, 20);
  const fName = { size: s, family: theme.fonts.sans, color: c.inkDim };
  const fVal = { size: s, family: theme.fonts.sansBold, color: c.ink };
  const sw = Math.max(6, Math.round(s * 0.7));
  const legendItem = (i: number) => {
    const t = series[i]!;
    const v = latencyOf(ctx, t);
    return { name: targetName(ctx, t), value: t.last === null ? v : `${v}`, color: colors[i]!, level: t.last === null ? ('bad' as const) : targetLatencyLevel(data, t) };
  };

  // A wide strip: the legend as a column on the left, the plot beside it.
  if (box.w >= box.h * 3.2 && box.h >= 60 && box.w >= 480) {
    const rows = Math.min(series.length, Math.floor(box.h / (s * 1.45)));
    const items = series.slice(0, rows).map((_, i) => legendItem(i));
    const nameW = Math.max(...items.map((it) => kit.measureTracked(g, it.name, fName)));
    const valW = Math.max(...items.map((it) => kit.measureTracked(g, it.value, fVal)), kit.measureTracked(g, '888', fVal));
    const legW = sw + s * 0.5 + nameW + s * 0.8 + valW + s * 0.4 + kit.measureTracked(g, 'ms', fName);
    const lh = s * 1.45;
    let y = box.y + (box.h - rows * lh) / 2;
    for (const it of items) {
      y += lh;
      const base = y - lh * 0.3;
      g.fillStyle = it.color;
      g.fillRect(box.x, base - s * 0.62, sw, Math.max(2, Math.round(s * 0.22)));
      kit.drawTracked(g, it.name, box.x + sw + s * 0.5, base, fName);
      const vx = box.x + sw + s * 0.5 + nameW + s * 0.8 + valW;
      kit.drawTracked(g, it.value, vx, base, { ...fVal, align: 'right', color: it.level === 'ok' ? c.ink : levelColor(ctx, it.level) });
      kit.drawTracked(g, 'ms', vx + s * 0.3, base, fName);
    }
    const px = box.x + legW + s * 1.2;
    drawPlot(g, ctx, data, series, { x: px, y: box.y + 2, w: box.x + box.w - px, h: box.h - 4 }, { axisLabel: MIN_PX });
    return;
  }

  // Too short for a legend: the plot, and the first internet target's latency in a corner.
  if (box.h < 70) {
    const first = series.find((x) => !x.gateway) ?? series[0]!;
    const v = `${latencyOf(ctx, first)}${first.last === null ? '' : ' ms'}`;
    const f = { size: clamp(Math.round(box.h * 0.3), MIN_PX, 16), family: theme.fonts.sansBold, color: c.ink, align: 'right' as const };
    const vw = kit.measureTracked(g, v, f) + f.size * 0.5;
    drawPlot(g, ctx, data, series, { x: box.x, y: box.y + 1, w: box.w - vw, h: box.h - 2 });
    kit.drawTracked(g, v, box.x + box.w, box.y + f.size, f);
    return;
  }

  // Legend on top (swatch, name, value; as many as fit on one or two lines), the plot, the time under it.
  const legendLines: { x: number; it: ReturnType<typeof legendItem> }[][] = [[]];
  let x = box.x;
  const maxLines = Math.max(1, Math.min(series.length, Math.floor((box.h * 0.3) / (s * 1.4))));
  for (let i = 0; i < series.length; i++) {
    const it = legendItem(i);
    const w = sw + s * 0.35 + kit.measureTracked(g, it.name, fName) + s * 0.35 + kit.measureTracked(g, it.value, fVal) + s * 1.1;
    if (x + w - s * 1.1 > box.x + box.w && legendLines[legendLines.length - 1]!.length) {
      if (legendLines.length >= maxLines) break;
      legendLines.push([]);
      x = box.x;
    }
    legendLines[legendLines.length - 1]!.push({ x, it });
    x += w;
  }
  const lh = s * 1.4;
  legendLines.forEach((line, li) => {
    const base = box.y + lh * (li + 1) - lh * 0.28;
    for (const { x: lx, it } of line) {
      g.fillStyle = it.color;
      g.fillRect(lx, base - s * 0.42, sw, Math.max(2, Math.round(s * 0.22)));
      const nw = kit.drawTracked(g, it.name, lx + sw + s * 0.35, base, fName);
      kit.drawTracked(g, it.value, lx + sw + s * 0.7 + nw, base, { ...fVal, color: it.level === 'ok' ? c.ink : levelColor(ctx, it.level) });
    }
  });
  const axis = box.h >= 120;
  const fAxis = { size: MIN_PX, family: theme.fonts.sans, color: c.inkFaint };
  const top = box.y + legendLines.length * lh + s * 0.3;
  const bottom = box.y + box.h - (axis ? MIN_PX * 1.6 : 0);
  drawPlot(g, ctx, data, series, { x: box.x, y: top, w: box.w, h: bottom - top }, { axisLabel: MIN_PX });
  if (axis) {
    const span = fill(ctx.t(LAST_SPAN), { d: ctx.fmt.duration(spanOf(data, series), { compact: true }) });
    kit.drawTracked(g, span, box.x, box.y + box.h - 2, fAxis);
    kit.drawTracked(g, ctx.t(NOW_TAG), box.x + box.w, box.y + box.h - 2, { ...fAxis, align: 'right' });
  }
}

export const latency = defineWidget({
  id: 'latency',
  name: L('Latency graph', 'Gráfica de latencia', 'Latenzverlauf', '延迟曲线', '延遲曲線'),
  description: L(
    'Latency over the last minutes, one line per target (the router, Cloudflare, Google, yours) on one scale, the amber threshold dashed, and a tick for every moment packets were lost. With one target, bars in green, amber or red.',
    'La latencia de los últimos minutos, una línea por destino (el router, Cloudflare, Google, los tuyos) en la misma escala, el umbral ámbar discontinuo, y una marca en cada momento en que se perdieron paquetes. Con un solo destino, barras en verde, ámbar o rojo.',
    'Die Latenz der letzten Minuten, eine Linie pro Ziel (Router, Cloudflare, Google, deine) auf einer Skala, die gelbe Schwelle gestrichelt und eine Marke für jeden Moment mit Paketverlust. Mit einem Ziel Balken in Grün, Gelb oder Rot.',
    '最近几分钟的延迟，每个目标一条线（路由器、Cloudflare、Google 或你自己的），同一刻度，琥珀色阈值以虚线表示，每次丢包处都有标记。只选一个目标时显示绿色、琥珀色或红色柱状图。',
    '最近幾分鐘的延遲，每個目標一條線（路由器、Cloudflare、Google 或你自己的），同一刻度，琥珀色門檻以虛線表示，每次遺失封包處都有標記。只選一個目標時顯示綠色、琥珀色或紅色長條圖。',
  ),
  icon: 'activity',
  category: 'system',
  tags: ['network', 'ping', 'latency', 'jitter', 'graph'],
  size: { min: { w: 140, h: 40 }, preferred: { w: 480, h: 200 } },
  sources: [SOURCE],
  options: t.object({
    target: t.string({
      label: L('Only this target', 'Solo este destino', 'Nur dieses Ziel', '仅此目标', '僅此目標'),
      help: L('Empty: the router and up to three others. A name or address from the source (gateway, Cloudflare, 8.8.8.8) for one, as bars.', 'Vacío: el router y hasta otros tres. Un nombre o dirección de la fuente (gateway, Cloudflare, 8.8.8.8) para uno solo, en barras.', 'Leer: der Router und bis zu drei andere. Ein Name oder eine Adresse aus der Quelle (gateway, Cloudflare, 8.8.8.8) für eines, als Balken.', '留空：路由器和最多另外三个。填数据源中的名称或地址（gateway、Cloudflare、8.8.8.8）只显示一个，以柱状图显示。', '留空：路由器和最多另外三個。填資料來源中的名稱或位址（gateway、Cloudflare、8.8.8.8）只顯示一個，以長條圖顯示。'),
      choices: { source: SOURCE, list: 'targets' },
    }),
  }),
  redraw: 'never',
  render(g, ctx) {
    clipped(g, ctx, () => render(g, ctx));
  },
  demo: ({ now: at }) => ({ sources: { [SOURCE]: demoData(at) } }),
});
