/**
 * `network/blocker`: what Pi-hole or AdGuard Home blocked: the share of
 * queries, big, a bar of it, and how many out of how many over its period.
 * Amber when blocking is paused.
 */
import { defineWidget, type Graphics } from '@kiosko/sdk';
import { clamp, clipped, dataOf, drawMessage, fitParts, MIN_PX, SOURCE, type Ctx } from './common.ts';
import { demoData } from './demo.ts';
import { compactText, intText } from './format.ts';
import { L } from './i18n.ts';
import { BLOCKED, BLOCKER_ERROR, BLOCKER_HOW, BLOCKER_READING, fill, NO_BLOCKER, OF_QUERIES, PAUSED, PERIOD, WAITING } from './labels.ts';

const pctOf = (locale: string, v: number) => new Intl.NumberFormat(locale, { style: 'percent', maximumFractionDigits: 1 }).format(v / 100);

function bar(g: Graphics, ctx: Ctx, x: number, y: number, w: number, h: number, pct: number, color: string): void {
  const c = ctx.theme.colors;
  g.save();
  g.fillStyle = c.surfaceEdge;
  g.fillRect(x, y, w, h);
  g.fillStyle = color;
  g.fillRect(x, y, Math.max(1, (w * Math.min(100, pct)) / 100), h);
  g.restore();
}

function render(g: Graphics, ctx: Ctx): void {
  const data = dataOf(ctx.sources);
  if (!data) return drawMessage(g, ctx, ctx.t(WAITING));
  const b = data.blocker;
  if (b === undefined) return drawMessage(g, ctx, ctx.t(NO_BLOCKER), ctx.t(BLOCKER_HOW));
  if (b === null) return drawMessage(g, ctx, ctx.t(BLOCKER_READING));
  if (b.error && !b.queries) return drawMessage(g, ctx, fill(ctx.t(BLOCKER_ERROR), { name: b.name }), b.error);
  const { box, kit, theme } = ctx;
  const c = theme.colors;
  const paused = b.enabled === false;
  const color = paused ? c.warn : c.accent;
  const pct = pctOf(ctx.locale, b.percent);
  const head = `${b.name} · ${ctx.t(PERIOD[b.period])}`;
  const counts = [`${intText(ctx.locale, b.blocked)} ${ctx.t(BLOCKED)}`, fill(ctx.t(OF_QUERIES), { n: intText(ctx.locale, b.queries) })];
  const short = `${compactText(ctx.locale, b.blocked)}/${compactText(ctx.locale, b.queries)}`;

  // One line: 27,9 %  8.139 bloqueadas…
  if (box.h < 60) {
    const size = clamp(Math.round(box.h * 0.62), MIN_PX, 28);
    const base = box.y + box.h / 2 + size * 0.36;
    const f = { size, family: theme.fonts.sansBold, color: paused ? c.warn : c.ink };
    const w = kit.drawTracked(g, pct, box.x, base, f);
    const fs = { size: clamp(Math.round(size * 0.6), MIN_PX, 16), family: theme.fonts.sans, color: c.inkDim };
    const room = box.w - w - size * 0.5;
    if (room > fs.size * 3) kit.drawTracked(g, paused ? kit.truncate(g, ctx.t(PAUSED), room, { ...fs, color: c.warn }) : fitParts(g, ctx, [counts[0]!, counts[1]!, b.name], room, fs), box.x + w + size * 0.5, base, paused ? { ...fs, color: c.warn } : fs);
    return;
  }

  const s = clamp(Math.round(Math.min(box.h * 0.1, box.w / 16)), MIN_PX, 22);
  const fHead = { size: s, family: theme.fonts.sans, color: c.inkDim };
  const fCount = { size: s, family: theme.fonts.sans, color: c.ink };
  const barH = clamp(Math.round(s * 0.5), 4, 12);
  const wide = box.w >= Math.max(box.h * 3, 480);
  if (wide) {
    // The number on the left, the bar and the counts beside it.
    const ws = clamp(Math.round(box.h * 0.15), MIN_PX, 22);
    const fh = { ...fHead, size: ws };
    const fc = { ...fCount, size: ws };
    const bh = clamp(Math.round(ws * 0.5), 4, 12);
    const big = clamp(Math.round(box.h * 0.55), MIN_PX, 80);
    const fBig = { size: big, family: theme.fonts.sansBold, color: paused ? c.warn : c.ink };
    const bw = kit.measureTracked(g, pct, fBig);
    const mid = box.y + box.h / 2;
    kit.drawTracked(g, pct, box.x, mid + big * 0.36, fBig);
    const rx = box.x + bw + ws * 1.5;
    const rw = Math.min(box.x + box.w - rx, ws * 32);
    kit.drawTracked(g, kit.truncate(g, paused ? ctx.t(PAUSED) : head, rw, paused ? { ...fh, color: c.warn } : fh), rx, mid - bh - ws * 0.5, paused ? { ...fh, color: c.warn } : fh);
    bar(g, ctx, rx, mid - bh / 2, rw, bh, b.percent, color);
    kit.drawTracked(g, fitParts(g, ctx, counts, box.x + box.w - rx, fc), rx, mid + bh + ws * 1.1, fc);
    return;
  }
  // Stacked: head, number, bar, counts.
  const lines = [counts[0]!, counts[1]!];
  const linesRoom = Math.max(0, Math.min(2, Math.floor((box.h - s * 1.4 - barH - s) / (s * 1.35)) - 1));
  let big = clamp(Math.round(box.h - s * 1.4 - barH - s * 0.8 - linesRoom * s * 1.35) * 0.85, MIN_PX, 96);
  big = kit.fitSize(g, pct, box.w, { size: Math.round(big), family: theme.fonts.sansBold }, MIN_PX);
  const block = s * 1.4 + big * 1.05 + barH + s * 0.6 + linesRoom * s * 1.35;
  let y = box.y + Math.max(0, (box.h - block) / 2);
  y += s * 1.4;
  kit.drawTracked(g, kit.truncate(g, paused ? ctx.t(PAUSED) : head, box.w, paused ? { ...fHead, color: c.warn } : fHead), box.x, y - s * 0.3, paused ? { ...fHead, color: c.warn } : fHead);
  y += big * 1.0;
  kit.drawTracked(g, pct, box.x, y - big * 0.1, { size: big, family: theme.fonts.sansBold, color: paused ? c.warn : c.ink });
  y += s * 0.4;
  bar(g, ctx, box.x, y, box.w, barH, b.percent, color);
  y += barH;
  const shown = linesRoom === 1 ? [kit.measureTracked(g, `${lines[0]} ${lines[1]}`, fCount) <= box.w ? `${lines[0]} ${lines[1]}` : short] : lines.slice(0, linesRoom);
  for (const l of shown) {
    y += s * 1.35;
    kit.drawTracked(g, kit.truncate(g, l, box.w, fCount), box.x, y - s * 0.25, l === lines[1] ? { ...fCount, color: c.inkDim } : fCount);
  }
}

export const blocker = defineWidget({
  id: 'blocker',
  name: L('DNS blocker', 'Bloqueador DNS', 'DNS-Blocker', 'DNS 拦截', 'DNS 封鎖'),
  description: L(
    "What your Pi-hole (v6 or v5) or AdGuard Home blocked: the share of DNS queries, big, with a bar, and how many out of how many in the last 24 hours (Pi-hole v5: today). Amber when blocking is paused. Set it up in the source's options.",
    'Lo que ha bloqueado tu Pi-hole (v6 o v5) o AdGuard Home: el porcentaje de consultas DNS, grande, con una barra, y cuántas de cuántas en las últimas 24 horas (Pi-hole v5: hoy). En ámbar si el bloqueo está en pausa. Se configura en las opciones de la fuente.',
    'Was dein Pi-hole (v6 oder v5) oder AdGuard Home blockiert hat: der Anteil der DNS-Anfragen, groß, mit einem Balken, und wie viele von wie vielen in den letzten 24 Stunden (Pi-hole v5: heute). Gelb, wenn das Blockieren pausiert ist. Einrichten in den Optionen der Quelle.',
    '你的 Pi-hole（v6 或 v5）或 AdGuard Home 拦截了多少：DNS 查询中被拦截的比例（大字和进度条），以及过去 24 小时（Pi-hole v5：今天）的拦截数和总查询数。拦截暂停时显示为琥珀色。在数据源选项中设置。',
    '你的 Pi-hole（v6 或 v5）或 AdGuard Home 封鎖了多少：DNS 查詢中被封鎖的比例（大字和進度條），以及過去 24 小時（Pi-hole v5：今天）的封鎖數和總查詢數。封鎖暫停時顯示為琥珀色。在資料來源選項中設定。',
  ),
  icon: 'shield',
  category: 'system',
  tags: ['network', 'dns', 'pihole', 'adguard', 'adblock'],
  size: { min: { w: 120, h: 30 }, preferred: { w: 320, h: 160 } },
  sources: [SOURCE],
  redraw: 'never',
  /** No blocker set up, not read yet, or it answered only an error: no share or counts to show. */
  empty: ({ sources }) => {
    const d = dataOf(sources);
    return !!d && (!d.blocker || (!!d.blocker.error && !d.blocker.queries));
  },
  render(g, ctx) {
    clipped(g, ctx, () => render(g, ctx));
  },
  demo: ({ now: at }) => ({ sources: { [SOURCE]: demoData(at) } }),
});
