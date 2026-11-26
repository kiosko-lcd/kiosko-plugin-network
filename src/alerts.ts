/**
 * Full-screen alerts, from the source's data (on by default, the switch in
 * the source's options):
 *
 * - No connection: every internet target lost for `offlineAfterMs` (30 s by
 *   default). Critical. It says whether the router still answers (the
 *   problem is outside: the line, the provider) or not (the Wi-Fi, the
 *   cable, the router itself). One per outage: its id is when it began.
 * - High packet loss: over `lossAlertPct` of the probes lost over the last
 *   `lossForMs`, while something still answers. A warning, one per episode,
 *   until the loss falls under half the threshold.
 * - Optionally, a new public IP: a notice for ten minutes.
 *
 * Alerts get no formatters, so times and numbers are written here in every
 * language, on a 24-hour clock in the machine's time zone.
 */
import type { Alert, Localized } from '@kiosko/sdk';
import { L } from './i18n.ts';
import type { NetData } from './types.ts';

const LOCALES = { en: 'en', es: 'es', de: 'de', 'zh-Hans': 'zh-Hans', 'zh-Hant': 'zh-Hant' } as const;
type Lang = keyof typeof LOCALES;

const each = (fn: (l: Lang) => string): Localized => L(fn('en'), fn('es'), fn('de'), fn('zh-Hans'), fn('zh-Hant'));
const hhmm = (at: number, zone?: string) => new Intl.DateTimeFormat('en-GB', { hour: '2-digit', minute: '2-digit', hourCycle: 'h23', ...(zone ? { timeZone: zone } : {}) }).format(at);
const pct = (l: Lang, v: number) => new Intl.NumberFormat(l, { style: 'percent', maximumFractionDigits: 0 }).format(v);

export const IP_ALERT_MS = 10 * 60_000;

export function networkAlerts(data: NetData | undefined, now: number, zone?: string): Alert[] {
  if (!data?.alerts.enabled && !data?.alerts.ipChange) return [];
  const out: Alert[] = [];
  const e = data.episodes;
  const offline = e.downSince !== null && now - e.downSince >= data.alerts.offlineAfterMs;
  if (data.alerts.enabled && offline) {
    const gw = data.targets.find((t) => t.gateway);
    const routerUp = !!gw && gw.last !== null && data.targets.some((t) => !t.gateway);
    const since = hhmm(e.downSince!, zone);
    const why = routerUp
      ? L('The router answers: the problem is outside', 'El router responde: el problema está fuera', 'Der Router antwortet: Das Problem liegt draußen', '路由器有响应：问题出在外部', '路由器有回應：問題出在外部')
      : gw
        ? L('The router does not answer either', 'Tampoco responde el router', 'Auch der Router antwortet nicht', '路由器也没有响应', '路由器也沒有回應')
        : L('No target answers', 'No responde ningún destino', 'Kein Ziel antwortet', '所有目标都无响应', '所有目標都沒有回應');
    out.push({
      id: `offline-${e.downSince}`,
      level: 'critical',
      icon: 'circle-x',
      title: L('No internet connection', 'Sin conexión a internet', 'Keine Internetverbindung', '网络已断开', '網路已斷線'),
      text: each((l) => `${(why as Record<Lang, string>)[l]} · ${({ en: 'since', es: 'desde las', de: 'seit', 'zh-Hans': '开始于', 'zh-Hant': '開始於' } as const)[l]} ${since}`),
    });
  }
  // Not while everything is lost: that's the outage, its own alert after its own wait.
  if (data.alerts.enabled && e.downSince === null && e.lossSince !== null && e.lossNow !== null) {
    const secs = Math.round(data.alerts.lossForMs / 1000);
    const span = secs % 60 === 0 ? { n: secs / 60, unit: { en: 'min', es: 'min', de: 'min', 'zh-Hans': '分钟', 'zh-Hant': '分鐘' } } : { n: secs, unit: { en: 's', es: 's', de: 's', 'zh-Hans': '秒', 'zh-Hant': '秒' } };
    out.push({
      id: `loss-${e.lossSince}`,
      level: 'warn',
      icon: 'activity',
      title: L('High packet loss', 'Mucha pérdida de paquetes', 'Hoher Paketverlust', '丢包严重', '封包遺失嚴重'),
      text: each((l) => {
        const v = pct(l, e.lossNow!);
        const d = `${span.n} ${span.unit[l]}`;
        return { en: `${v} lost in the last ${d}`, es: `${v} perdido en los últimos ${d}`, de: `${v} verloren in den letzten ${d}`, 'zh-Hans': `最近 ${d}丢包 ${v}`, 'zh-Hant': `最近 ${d}遺失 ${v}` }[l];
      }),
    });
  }
  const ip = data.publicIp;
  if (data.alerts.ipChange && ip?.changedAt && ip.previous && now - ip.changedAt < IP_ALERT_MS) {
    out.push({
      id: `ip-${ip.ip}-${ip.changedAt}`,
      level: 'info',
      icon: 'info',
      title: L('New public IP', 'Nueva IP pública', 'Neue öffentliche IP', '公网 IP 已变更', '公用 IP 已變更'),
      text: each((l) => `${ip.ip} · ${({ en: 'was', es: 'antes', de: 'vorher', 'zh-Hans': '原为', 'zh-Hant': '原為' } as const)[l]} ${ip.previous}`),
      expiresAt: ip.changedAt + IP_ALERT_MS,
    });
  }
  return out;
}
