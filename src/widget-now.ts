/**
 * `network/now`: the connection at a glance. A dot and a word (online, slow,
 * losing packets, no internet, offline), then per target its latency,
 * jitter and loss in amber or red past the thresholds, the Wi-Fi link and
 * the public IP. One line in a thin strip, columns in a wide one.
 */
import { defineWidget, t, type Graphics } from '@kiosko/sdk';
import {
  bestLatency,
  clamp,
  clipped,
  dataOf,
  dot,
  drawMessage,
  fitParts,
  latencyOf,
  levelInk,
  MIN_PX,
  SOURCE,
  statusColor,
  targetLatencyLevel,
  targetLossLevel,
  targetName,
  wifiParts,
  wifiShown,
  type Ctx,
} from './common.ts';
import { demoData } from './demo.ts';
import { msText, msWithUnit, pctText } from './format.ts';
import { L } from './i18n.ts';
import { CHANGED, fill, JITTER, LOSS, PUBLIC_IP, STATUS_LABELS, WAITING, WIRED } from './labels.ts';
import type { NetData, TargetData } from './types.ts';
import { drawPlot, seriesOf } from './widget-latency.ts';

const DAY = 24 * 3_600_000;

function ipLine(ctx: Ctx, data: NetData): string[] | null {
  const ip = data.publicIp;
  if (!ip?.ip || ctx.options.showIp === false) return null;
  const parts = [`${ctx.t(PUBLIC_IP)} ${ip.ip}`];
  if (ip.country) parts.push(ip.country);
  if (ip.changedAt && ctx.now - ip.changedAt < DAY) parts.push(fill(ctx.t(CHANGED), { ago: ctx.fmt.ago(ip.changedAt) }));
  return parts;
}

function linkLine(ctx: Ctx, data: NetData): string[] | null {
  const w = wifiShown(data, ctx.options.wifi ?? 'auto');
  if (w) return wifiParts(ctx, w);
  if (ctx.options.wifi !== 'never' && data.gateway?.wifi === false && data.gateway.iface) return [`${ctx.t(WIRED)} · ${data.gateway.iface}`];
  return null;
}

interface Font {
  size: number;
  family: string;
  color: string;
  align?: 'left' | 'right';
}

function header(g: Graphics, ctx: Ctx, data: NetData, x: number, y: number, w: number, size: number, withLatency: boolean): void {
  const { kit, theme } = ctx;
  const c = theme.colors;
  const r = Math.max(3, size * 0.3);
  dot(g, x + r, y - size * 0.34, r, statusColor(ctx, data.status));
  const best = bestLatency(data);
  const fBig = { size, family: theme.fonts.sansBold, color: c.ink, align: 'right' as const };
  const right = withLatency && best !== null ? msWithUnit(ctx.locale, best) : '';
  const rw = right ? kit.measureTracked(g, right, fBig) + size * 0.6 : 0;
  const fWord = { size, family: theme.fonts.sansBold, color: data.status === 'ok' ? c.ink : statusColor(ctx, data.status) };
  const word = ctx.t(STATUS_LABELS[data.status]);
  const tx = x + r * 2 + size * 0.4;
  const room = x + w - tx - rw;
  // The word smaller rather than cut; left out if it still doesn't fit (the dot says it).
  const ws = kit.fitSize(g, word, Math.max(1, room), fWord, MIN_PX);
  if (kit.measureTracked(g, word, { ...fWord, size: ws }) <= room) kit.drawTracked(g, word, tx, y, { ...fWord, size: ws });
  if (right) kit.drawTracked(g, right, x + w, y, fBig);
}

/** The table of targets: name, latency, jitter and loss, the columns that fit. */
function rows(g: Graphics, ctx: Ctx, data: NetData, targets: TargetData[], x: number, top: number, w: number, s: number, rowH: number, withHead: boolean): number {
  const { kit, theme } = ctx;
  const c = theme.colors;
  const fName: Font = { size: s, family: theme.fonts.sans, color: c.inkDim };
  const fVal: Font = { size: s, family: theme.fonts.sansBold, color: c.ink, align: 'right' };
  const fSmall: Font = { size: s, family: theme.fonts.sans, color: c.inkDim, align: 'right' };
  const sample = { lat: msText(ctx.locale, 188.8), jit: msText(ctx.locale, 88.8), loss: pctText(ctx.locale, 0.888) };
  const latW = kit.measureTracked(g, sample.lat, fVal);
  const jitW = Math.max(kit.measureTracked(g, sample.jit, fSmall), withHead ? kit.measureTracked(g, ctx.t(JITTER), fSmall) : 0);
  const lossW = Math.max(kit.measureTracked(g, sample.loss, fSmall), withHead ? kit.measureTracked(g, ctx.t(LOSS), fSmall) : 0);
  const gap = s * 0.9;
  const nameMin = s * 4;
  const showLoss = w >= nameMin + latW + gap + lossW + gap;
  const showJit = showLoss && w >= nameMin + latW + gap * 2 + lossW + jitW + gap;
  const lossX = x + w;
  const jitX = lossX - (showLoss ? lossW + gap : 0);
  const latX = (showJit ? jitX - jitW - gap : showLoss ? jitX : x + w);
  const nameW = latX - latW - gap * 0.6 - x;
  let y = top;
  if (withHead) {
    y += rowH;
    const base = y - (rowH - s) / 2 - s * 0.12;
    const fh = { ...fSmall, color: c.inkFaint };
    kit.drawTracked(g, 'ms', latX, base, fh);
    if (showJit) kit.drawTracked(g, ctx.t(JITTER), jitX, base, fh);
    if (showLoss) kit.drawTracked(g, ctx.t(LOSS), lossX, base, fh);
  }
  for (const tg of targets) {
    y += rowH;
    const base = y - (rowH - s) / 2 - s * 0.12;
    kit.drawTracked(g, kit.truncate(g, targetName(ctx, tg), nameW, fName), x, base, fName);
    const lat = latencyOf(ctx, tg);
    const lv = tg.last === null ? 'bad' : targetLatencyLevel(data, tg);
    const fl = { ...fVal, color: levelInk(ctx, lv) };
    kit.drawTracked(g, lat.length > 6 ? kit.truncate(g, lat, latW + nameW / 2, { ...fl, family: theme.fonts.sans }) : lat, latX, base, lat.length > 6 ? { ...fl, family: theme.fonts.sans } : fl);
    if (showJit) kit.drawTracked(g, tg.jitter === null ? '—' : msText(ctx.locale, tg.jitter), jitX, base, fSmall);
    if (showLoss) kit.drawTracked(g, tg.loss === null ? '—' : pctText(ctx.locale, tg.loss), lossX, base, { ...fSmall, color: tg.loss ? levelInk(ctx, targetLossLevel(data, tg)) : c.inkDim });
  }
  return y;
}

function render(g: Graphics, ctx: Ctx): void {
  const data = dataOf(ctx.sources);
  if (!data) return drawMessage(g, ctx, ctx.t(WAITING));
  const { box, kit, theme } = ctx;
  const c = theme.colors;
  const targets = data.targets;
  const ip = ipLine(ctx, data);
  const link = linkLine(ctx, data);

  // One line: dot, word, best latency, and the targets if there's width.
  if (box.h < 46) {
    const s = clamp(Math.round(box.h * 0.56), MIN_PX, 22);
    const base = box.y + box.h / 2 + s * 0.36;
    const w1 = Math.min(box.w, Math.max(s * 9, box.w * 0.42));
    header(g, ctx, data, box.x, base, w1, s, true);
    const rest = box.w - w1 - s;
    if (rest > s * 8) {
      const f = { size: Math.max(MIN_PX, Math.round(s * 0.8)), family: theme.fonts.sans, color: c.inkDim };
      const parts = targets.map((tg) => `${targetName(ctx, tg)} ${latencyOf(ctx, tg)}`);
      kit.drawTracked(g, fitParts(g, ctx, parts, rest, f), box.x + w1 + s, base, f);
    }
    return;
  }

  // A wide strip: the state on the left, one column per target, the link and IP on the right.
  if (box.w >= Math.max(box.h * 3, 560)) {
    const s = clamp(Math.round(Math.min(box.h * 0.16, box.w / 45)), MIN_PX, 24);
    const big = clamp(Math.round(Math.min(box.h * 0.3, box.w / 22)), MIN_PX, 48);
    const leftW = Math.min(box.w * 0.26, Math.max(s * 10, big * 5));
    const midY = box.y + box.h / 2;
    header(g, ctx, data, box.x, midY - big * 0.15, leftW - s, Math.round(big * 0.7), false);
    const best = bestLatency(data);
    if (best !== null && box.h >= big * 1.9) kit.drawTracked(g, msWithUnit(ctx.locale, best), box.x + Math.max(3, big * 0.21) * 2 + big * 0.28, midY + big * 0.85, { size: Math.round(big * 0.7), family: theme.fonts.sans, color: c.inkDim });
    const info = [link, ip].filter((x): x is string[] => !!x);
    const infoW = info.length ? Math.min(box.w * 0.3, s * 22) : 0;
    const colsX = box.x + leftW;
    const colsW = box.w - leftW - (infoW ? infoW + s * 1.5 : 0);
    const n = Math.max(1, targets.length);
    const colW = colsW / n;
    const fName = { size: s, family: theme.fonts.sans, color: c.inkDim };
    const fSub = { size: Math.max(MIN_PX, Math.round(s * 0.85)), family: theme.fonts.sans, color: c.inkDim };
    const blockH = s * 1.3 + big * 1.1 + (box.h >= s * 1.3 + big * 1.1 + fSub.size * 1.4 ? fSub.size * 1.4 : 0);
    const top = box.y + (box.h - blockH) / 2;
    targets.forEach((tg, i) => {
      const x = colsX + i * colW;
      const w = colW - s;
      if (w < s * 3) return;
      kit.drawTracked(g, kit.truncate(g, targetName(ctx, tg), w, fName), x, top + s, fName);
      const lat = latencyOf(ctx, tg);
      const lv = tg.last === null ? 'bad' : targetLatencyLevel(data, tg);
      const fBig = { size: big, family: theme.fonts.sansBold, color: levelInk(ctx, lv) };
      const size = kit.fitSize(g, lat, Math.max(10, w - s * 2), fBig, MIN_PX);
      const lw = kit.drawTracked(g, lat, x, top + s * 1.3 + big, { ...fBig, size });
      if (tg.last !== null && lw + s * 2.2 <= w) kit.drawTracked(g, 'ms', x + lw + s * 0.3, top + s * 1.3 + big, fSub);
      if (blockH > s * 1.3 + big * 1.1) {
        const parts = [`${ctx.t(JITTER)} ${tg.jitter === null ? '—' : msText(ctx.locale, tg.jitter)}`, `${ctx.t(LOSS)} ${tg.loss === null ? '—' : pctText(ctx.locale, tg.loss)}`];
        const lossBad = tg.loss ? targetLossLevel(data, tg) : 'ok';
        kit.drawTracked(g, fitParts(g, ctx, parts, w, fSub), x, top + s * 1.3 + big * 1.1 + fSub.size * 1.2, lossBad === 'ok' ? fSub : { ...fSub, color: levelInk(ctx, lossBad) });
      }
    });
    if (infoW) {
      const fi = { size: s, family: theme.fonts.sans, color: c.inkDim };
      const lines = info.slice(0, Math.max(1, Math.floor(box.h / (s * 1.6))));
      const ih = lines.length * s * 1.5;
      let y = box.y + (box.h - ih) / 2;
      for (const parts of lines) {
        y += s * 1.5;
        kit.drawTracked(g, fitParts(g, ctx, parts, infoW, fi), box.x + box.w - infoW, y - s * 0.4, fi);
      }
    }
    return;
  }

  // Stacked: the state, the targets, then the link and the IP, as far as they fit.
  const s = clamp(Math.round(Math.min(box.h * 0.085, box.w < 260 ? box.w / 12 : box.w / 15)), MIN_PX, 22);
  const hs = clamp(Math.round(s * 1.35), MIN_PX, 30);
  const rowH = Math.round(s * 1.55);
  const footS = clamp(Math.round(s * 0.92), MIN_PX, 20);
  const footH = footS * 1.45;
  const headH = hs * 1.5;
  const roomRows = Math.floor((box.h - headH) / rowH);
  // Short: the targets as one line under the state.
  if (roomRows < Math.min(2, targets.length)) {
    header(g, ctx, data, box.x, box.y + Math.min(box.h * 0.5, hs * 1.1), box.w, hs, true);
    if (box.h - hs * 1.3 >= footS * 1.2) {
      const f = { size: footS, family: theme.fonts.sans, color: c.inkDim };
      const parts = targets.map((tg) => `${targetName(ctx, tg)} ${latencyOf(ctx, tg)}`);
      const lossy = targets.find((tg) => tg.loss);
      if (lossy) parts.push(`${ctx.t(LOSS)} ${pctText(ctx.locale, Math.max(...targets.map((tg) => tg.loss ?? 0)))}`);
      kit.drawTracked(g, fitParts(g, ctx, parts, box.w, f), box.x, box.y + box.h - (box.h - hs * 1.3 - footS) / 2 - footS * 0.2, f);
    }
    return;
  }
  // A narrow tile: the word on its own line, the latency big under it.
  const narrow = box.w < 260 && box.h >= 200;
  const bigS = narrow ? clamp(Math.round(box.w / 5.5), MIN_PX, 40) : 0;
  const top = narrow ? hs * 1.5 + bigS * 1.15 : headH;
  const lines: string[][] = [];
  const avail = box.h - top - Math.min(targets.length, roomRows) * rowH;
  for (const l of [link, ip]) if (l && avail - lines.length * footH >= footH) lines.push(l);
  // Narrow: the Wi-Fi line in two (name and signal, then band and rate).
  if (narrow && lines[0] && lines[0] === link && link.length > 2 && avail - (lines.length + 1) * footH >= footH * 3) lines.splice(0, 1, link.slice(0, 2), link.slice(2));
  const shownRows = Math.min(targets.length, Math.floor((box.h - top - lines.length * footH) / rowH));
  const withHead = !narrow && box.h - top - shownRows * rowH - lines.length * footH >= rowH && shownRows === targets.length;
  const tall = box.h > box.w * 1.3;
  if (narrow) {
    header(g, ctx, data, box.x, box.y + hs * 1.05, box.w, hs, false);
    const best = bestLatency(data);
    if (best !== null) {
      const f = { size: bigS, family: theme.fonts.sansBold, color: c.ink };
      const w = kit.drawTracked(g, msText(ctx.locale, best), box.x, box.y + hs * 1.5 + bigS, f);
      kit.drawTracked(g, 'ms', box.x + w + bigS * 0.2, box.y + hs * 1.5 + bigS, { size: hs, family: theme.fonts.sans, color: c.inkDim });
    }
  } else header(g, ctx, data, box.x, box.y + hs * 1.05, box.w, hs, true);
  let y = rows(g, ctx, data, targets.slice(0, shownRows), box.x, box.y + top, box.w, s, rowH, withHead);
  const fFoot = { size: footS, family: theme.fonts.sans, color: c.inkDim };
  // In a tall tile the link and the IP sit at the bottom, and the graph of the last minutes fills the space between.
  if (tall) {
    const foot = box.y + box.h - lines.length * footH;
    const gap = foot - y - s;
    if (gap >= 56) drawPlot(g, ctx, data, seriesOf(data, ''), { x: box.x, y: y + s * 0.8, w: box.w, h: gap - s * 0.4 }, { axisLabel: MIN_PX });
    y = foot;
  }
  for (const parts of lines) {
    y += footH;
    kit.drawTracked(g, fitParts(g, ctx, parts, box.w, fFoot), box.x, y - footS * 0.35, fFoot);
  }
}

export const now = defineWidget({
  id: 'now',
  name: L('Connection now', 'La conexión ahora', 'Verbindung jetzt', '当前网络连接', '目前網路連線'),
  description: L(
    'Your connection at a glance: online, slow, losing packets or down, with latency, jitter and loss to the router and the internet in amber or red past your thresholds, the Wi-Fi signal and channel, and your public IP and when it changed.',
    'Tu conexión de un vistazo: conectada, lenta, perdiendo paquetes o caída, con la latencia, el jitter y la pérdida hasta el router e internet en ámbar o rojo al pasar tus umbrales, la señal y el canal de la Wi-Fi, y tu IP pública y cuándo cambió.',
    'Deine Verbindung auf einen Blick: verbunden, langsam, mit Paketverlust oder weg, mit Latenz, Jitter und Verlust zum Router und ins Internet in Gelb oder Rot über deinen Schwellen, WLAN-Signal und Kanal, und deine öffentliche IP und wann sie sich geändert hat.',
    '一眼看清网络连接：已连接、较慢、丢包或已断开；到路由器和互联网的延迟、抖动和丢包，超过阈值时以琥珀色或红色显示；Wi-Fi 信号和信道；公网 IP 及其变更时间。',
    '一眼看清網路連線：已連線、較慢、遺失封包或已斷線；到路由器和網際網路的延遲、抖動和遺失，超過門檻時以琥珀色或紅色顯示；Wi-Fi 訊號和通道；公用 IP 及其變更時間。',
  ),
  icon: 'wifi',
  category: 'system',
  tags: ['network', 'ping', 'latency', 'wifi', 'internet'],
  size: { min: { w: 120, h: 30 }, preferred: { w: 320, h: 200 } },
  sources: [SOURCE],
  options: t.object({
    wifi: t.enum(['auto', 'always', 'never'] as const, {
      default: 'auto',
      label: L('Wi-Fi line', 'Línea de la Wi-Fi', 'WLAN-Zeile', 'Wi-Fi 行', 'Wi-Fi 行'),
      help: L('Automatic: when the connection goes through Wi-Fi (on cable, the interface instead).', 'Automático: cuando la conexión va por Wi-Fi (con cable, la interfaz en su lugar).', 'Automatisch: wenn die Verbindung über WLAN läuft (bei Kabel stattdessen die Schnittstelle).', '自动：网络经由 Wi-Fi 时显示（有线时改为显示网卡）。', '自動：網路經由 Wi-Fi 時顯示（有線時改為顯示網卡）。'),
      labels: { auto: L('Automatic', 'Automático', 'Automatisch', '自动', '自動'), always: L('Always', 'Siempre', 'Immer', '始终', '一律'), never: L('Never', 'Nunca', 'Nie', '从不', '從不') },
    }),
    showIp: t.boolean({ default: true, label: L('Show the public IP', 'Mostrar la IP pública', 'Öffentliche IP zeigen', '显示公网 IP', '顯示公用 IP') }),
  }),
  redraw: 'never',
  render(g, ctx) {
    clipped(g, ctx, () => render(g, ctx));
  },
  demo: ({ now: at }) => ({ sources: { [SOURCE]: demoData(at) } }),
});
