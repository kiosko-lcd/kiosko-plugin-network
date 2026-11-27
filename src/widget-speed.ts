/**
 * `network/speed`: the last speed test, download and upload big, its
 * latency, how long ago and when the next one is. The test is off by
 * default (it spends data): until it's on, the widget says where to turn it on.
 */
import { defineWidget, type Graphics } from '@kiosko/sdk';
import { arrow, clamp, clipped, dataOf, drawMessage, fitParts, MIN_PX, SOURCE, type Ctx } from './common.ts';
import { demoData } from './demo.ts';
import { mbpsText, MBPS, msText } from './format.ts';
import { L } from './i18n.ts';
import { DOWN, FAILED, fill, NEXT_IN, PING, SPEED_FIRST, SPEED_HOW, SPEED_OFF, SPEED_RUNNING, UP, WAITING } from './labels.ts';
import type { NetData, SpeedResult } from './types.ts';

function metaParts(ctx: Ctx, data: NetData, r: SpeedResult): string[] {
  const parts = [`${ctx.t(PING)} ${msText(ctx.locale, r.latency)} ms`, ctx.fmt.ago(r.at)];
  if (data.speed.running) parts.push(ctx.t(SPEED_RUNNING));
  else if (data.speed.error) parts.push(ctx.t(FAILED));
  else if (data.speed.enabled && data.speed.nextAt) parts.push(fill(ctx.t(NEXT_IN), { d: ctx.fmt.duration(Math.max(60_000, data.speed.nextAt - ctx.now), { round: 'up' }) }));
  parts.push(`Cloudflare${r.colo ? ` ${r.colo}` : ''}`);
  return parts;
}

/** One figure: arrow, number, unit; returns its width. */
function figure(g: Graphics, ctx: Ctx, dir: 'down' | 'up', value: string, x: number, base: number, size: number, unitSize: number, draw = true): number {
  const { kit, theme } = ctx;
  const c = theme.colors;
  const aw = size * 0.75;
  if (draw) arrow(g, x + aw * 0.45, base, size, dir, dir === 'down' ? c.accent : c.inkDim);
  const f = { size, family: theme.fonts.sansBold, color: c.ink };
  const w = draw ? kit.drawTracked(g, value, x + aw, base, f) : kit.measureTracked(g, value, f);
  const uw = kit.measureTracked(g, MBPS, { size: unitSize, family: theme.fonts.sans });
  if (draw) kit.drawTracked(g, MBPS, x + aw + w + unitSize * 0.35, base, { size: unitSize, family: theme.fonts.sans, color: c.inkDim });
  return aw + w + unitSize * 0.35 + uw;
}

function render(g: Graphics, ctx: Ctx): void {
  const data = dataOf(ctx.sources);
  if (!data) return drawMessage(g, ctx, ctx.t(WAITING));
  const r = data.speed.last;
  if (!r) {
    if (!data.speed.enabled) return drawMessage(g, ctx, ctx.t(SPEED_OFF), ctx.t(SPEED_HOW));
    if (data.speed.running) return drawMessage(g, ctx, ctx.t(SPEED_RUNNING));
    return drawMessage(g, ctx, fill(ctx.t(SPEED_FIRST), { d: ctx.fmt.duration(Math.max(60_000, (data.speed.nextAt ?? ctx.now) - ctx.now), { round: 'up' }) }));
  }
  const { box, kit, theme } = ctx;
  const c = theme.colors;
  const down = mbpsText(ctx.locale, r.down);
  const up = mbpsText(ctx.locale, r.up);
  const meta = metaParts(ctx, data, r);

  // One line: ▼ 541 ▲ 48 Mbit/s, then the latency and age if there's room.
  if (box.h < 60) {
    let size = clamp(Math.round(box.h * 0.6), MIN_PX, 26);
    const unit = clamp(Math.round(size * 0.6), MIN_PX, 16);
    const need = () => figure(g, ctx, 'down', down, 0, 0, size, unit, false) + size * 0.6 + figure(g, ctx, 'up', up, 0, 0, size, unit, false);
    while (size > MIN_PX && need() > box.w) size--;
    const base = box.y + box.h / 2 + size * 0.36;
    let x = box.x + figure(g, ctx, 'down', down, box.x, base, size, unit) + size * 0.6;
    x += figure(g, ctx, 'up', up, x, base, size, unit) + size;
    const f = { size: unit, family: theme.fonts.sans, color: c.inkDim };
    if (box.x + box.w - x > unit * 6) kit.drawTracked(g, fitParts(g, ctx, meta, box.x + box.w - x, f), x, base, f);
    return;
  }

  // A wide strip: down and up next to each other, the details in a column after them.
  if (box.w >= Math.max(box.h * 3, 480)) {
    const s = clamp(Math.round(box.h * 0.15), MIN_PX, 22);
    const unit = clamp(Math.round(s * 0.9), MIN_PX, 20);
    const big = clamp(Math.round((box.h - s * 1.5) * 0.78), MIN_PX, 90);
    const fLabel = { size: s, family: theme.fonts.sans, color: c.inkDim };
    const block = s * 1.4 + big;
    const top = box.y + (box.h - block) / 2;
    let x = box.x;
    for (const [dir, v, label] of [['down', down, DOWN], ['up', up, UP]] as const) {
      kit.drawTracked(g, ctx.t(label), x, top + s, fLabel);
      x += figure(g, ctx, dir, v, x, top + s * 1.4 + big * 0.92, big, unit) + s * 2.5;
    }
    const fMeta = { size: s, family: theme.fonts.sans, color: c.inkDim };
    const n = Math.max(1, Math.min(meta.length, Math.floor(box.h / (s * 1.45))));
    const w = box.x + box.w - x;
    if (w > s * 6) {
      let y = box.y + (box.h - n * s * 1.45) / 2;
      const per = Math.ceil(meta.length / n);
      for (let i = 0; i < n; i++) {
        y += s * 1.45;
        kit.drawTracked(g, fitParts(g, ctx, meta.slice(i * per, (i + 1) * per), w, fMeta), x, y - s * 0.35, fMeta);
      }
    }
    return;
  }

  const s = clamp(Math.round(Math.min(box.h * 0.1, box.w / 18)), MIN_PX, 22);
  const fLabel = { size: s, family: theme.fonts.sans, color: c.inkDim };
  const fMeta = { size: clamp(Math.round(s * 0.92), MIN_PX, 20), family: theme.fonts.sans, color: c.inkDim };
  const side = box.w >= box.h * 1.5;
  if (side) {
    // Down and up side by side, a label over each, the meta line under them.
    const colW = box.w / 2;
    const metaLines = box.h >= s * 6 ? 2 : 1;
    const metaH = metaLines * fMeta.size * 1.4;
    const unit = clamp(Math.round(s * 0.9), MIN_PX, 20);
    let big = clamp(Math.round((box.h - s * 1.4 - metaH) * 0.8), MIN_PX, 110);
    while (big > MIN_PX && Math.max(figure(g, ctx, 'down', down, 0, 0, big, unit, false), figure(g, ctx, 'up', up, 0, 0, big, unit, false)) > colW - s) big--;
    const block = s * 1.4 + big * 1.05 + metaH;
    const top = box.y + (box.h - block) / 2;
    kit.drawTracked(g, ctx.t(DOWN), box.x, top + s, fLabel);
    kit.drawTracked(g, ctx.t(UP), box.x + colW, top + s, fLabel);
    figure(g, ctx, 'down', down, box.x, top + s * 1.4 + big * 0.92, big, unit);
    figure(g, ctx, 'up', up, box.x + colW, top + s * 1.4 + big * 0.92, big, unit);
    const lines = metaLines === 2 ? [meta.slice(0, 2), meta.slice(2)] : [meta];
    let y = top + s * 1.4 + big * 1.05;
    for (const l of lines) {
      if (!l.length) continue;
      y += fMeta.size * 1.4;
      kit.drawTracked(g, fitParts(g, ctx, l, box.w, fMeta), box.x, y - fMeta.size * 0.3, fMeta);
    }
    return;
  }
  // Stacked: down, up, then the meta lines.
  const unit = clamp(Math.round(s * 0.9), MIN_PX, 20);
  const metaRoom = Math.max(1, Math.min(meta.length, Math.floor((box.h * 0.4) / (fMeta.size * 1.4))));
  const metaH = metaRoom * fMeta.size * 1.4;
  let big = clamp(Math.round((box.h - metaH - s * 2.8) / 2.2), MIN_PX, 90);
  while (big > MIN_PX && Math.max(figure(g, ctx, 'down', down, 0, 0, big, unit, false), figure(g, ctx, 'up', up, 0, 0, big, unit, false)) > box.w) big--;
  const withLabels = box.h - metaH - big * 2.3 >= s * 2.8;
  const block = (withLabels ? s * 2.8 : 0) + big * 2.3 + metaH;
  let y = box.y + (box.h - block) / 2;
  for (const [dir, v, label] of [['down', down, DOWN], ['up', up, UP]] as const) {
    if (withLabels) {
      y += s * 1.4;
      kit.drawTracked(g, ctx.t(label), box.x, y - s * 0.25, fLabel);
    }
    y += big * 1.15;
    figure(g, ctx, dir, v, box.x, y - big * 0.2, big, unit);
  }
  for (const p of meta.slice(0, metaRoom)) {
    y += fMeta.size * 1.4;
    kit.drawTracked(g, kit.truncate(g, p, box.w, fMeta), box.x, y - fMeta.size * 0.3, fMeta);
  }
}

export const speed = defineWidget({
  id: 'speed',
  name: L('Speed test', 'Test de velocidad', 'Geschwindigkeitstest', '网速测试', '網速測試'),
  description: L(
    "The last speed test, download and upload in Mbit/s with its latency, how long ago it ran and when the next one is, from Cloudflare's speed test. Off by default, since every test spends data: turn it on in the source's options (every 6, 12 or 24 hours).",
    'El último test de velocidad, bajada y subida en Mbit/s con su latencia, hace cuánto se hizo y cuándo toca el siguiente, con el test de velocidad de Cloudflare. Desactivado por defecto, porque cada test gasta datos: actívalo en las opciones de la fuente (cada 6, 12 o 24 horas).',
    'Der letzte Geschwindigkeitstest, Download und Upload in Mbit/s mit seiner Latenz, wie lange er her ist und wann der nächste kommt, mit dem Geschwindigkeitstest von Cloudflare. Standardmäßig aus, da jeder Test Daten verbraucht: in den Optionen der Quelle einschalten (alle 6, 12 oder 24 Stunden).',
    '最近一次测速：下载和上传速度（Mbit/s）及延迟、测速时间和下次测速时间，使用 Cloudflare 测速。默认关闭，因为每次测速都会消耗流量：在数据源选项中开启（每 6、12 或 24 小时）。',
    '最近一次測速：下載和上傳速度（Mbit/s）及延遲、測速時間和下次測速時間，使用 Cloudflare 測速。預設關閉，因為每次測速都會消耗流量：在資料來源選項中開啟（每 6、12 或 24 小時）。',
  ),
  icon: 'gauge',
  category: 'system',
  tags: ['network', 'speedtest', 'bandwidth', 'internet'],
  size: { min: { w: 120, h: 30 }, preferred: { w: 320, h: 160 } },
  sources: [SOURCE],
  redraw: 'minute',
  /** No test result yet: the test is off, or the first one is running or still to come. */
  empty: ({ sources }) => {
    const d = dataOf(sources);
    return !!d && !d.speed.last;
  },
  render(g, ctx) {
    clipped(g, ctx, () => render(g, ctx));
  },
  demo: ({ now: at }) => ({ sources: { [SOURCE]: demoData(at) } }),
});
