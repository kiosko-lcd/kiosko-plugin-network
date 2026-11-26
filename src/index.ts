/**
 * Your connection on the panel: latency, jitter and loss to the router and
 * the internet as a graph of the last minutes, the Wi-Fi link, the public
 * IP and when it changed, an occasional speed test (off by default) and
 * what Pi-hole or AdGuard Home blocked, with a full-screen alert when the
 * connection drops.
 */
import { definePlugin } from '@kiosko/sdk';
import { IP_SERVICES } from './publicip.ts';
import { L, LANGUAGES } from './i18n.ts';
import { connectionSource, VERSION } from './source.ts';
import { SPEED_HOST } from './speedtest.ts';
import { blocker } from './widget-blocker.ts';
import { latency } from './widget-latency.ts';
import { now } from './widget-now.ts';
import { speed } from './widget-speed.ts';

export { connectionSource } from './source.ts';
export { blocker } from './widget-blocker.ts';
export { latency } from './widget-latency.ts';
export { now } from './widget-now.ts';
export { speed } from './widget-speed.ts';

export default definePlugin({
  id: 'network',
  name: L('Your connection', 'Tu conexión', 'Deine Verbindung', '你的网络连接', '你的網路連線'),
  version: VERSION,
  description: L(
    'Your connection on the panel: latency, jitter and packet loss to your router and the internet as a graph of the last minutes, the Wi-Fi signal and channel, your public IP and when it changed, an occasional speed test (off by default) and what Pi-hole or AdGuard Home blocked, with a full-screen alert when the connection drops.',
    'Tu conexión en el panel: latencia, jitter y pérdida de paquetes hasta tu router e internet en una gráfica de los últimos minutos, la señal y el canal de la Wi-Fi, tu IP pública y cuándo cambió, un test de velocidad de vez en cuando (desactivado por defecto) y lo que ha bloqueado Pi-hole o AdGuard Home, con un aviso a pantalla completa si se cae la conexión.',
    'Deine Verbindung auf dem Panel: Latenz, Jitter und Paketverlust zu deinem Router und ins Internet als Grafik der letzten Minuten, WLAN-Signal und Kanal, deine öffentliche IP und wann sie sich geändert hat, ab und zu ein Geschwindigkeitstest (standardmäßig aus) und was Pi-hole oder AdGuard Home blockiert hat, mit einer Vollbild-Warnung, wenn die Verbindung abbricht.',
    '在副屏上查看你的网络连接：到路由器和互联网的延迟、抖动和丢包（最近几分钟的曲线），Wi-Fi 信号和信道，公网 IP 及其变更时间，偶尔测一次速（默认关闭），以及 Pi-hole 或 AdGuard Home 的拦截数；断网时全屏提醒。',
    '在面板上查看你的網路連線：到路由器和網際網路的延遲、抖動和遺失（最近幾分鐘的曲線），Wi-Fi 訊號和通道，公用 IP 及其變更時間，偶爾測一次速（預設關閉），以及 Pi-hole 或 AdGuard Home 的封鎖數；斷線時全螢幕提醒。',
  ),
  author: 'Loksly',
  license: 'MIT',
  homepage: 'https://github.com/kiosko-lcd/kiosko-plugin-network#readme',
  repository: 'https://github.com/kiosko-lcd/kiosko-plugin-network',
  icon: 'wifi',
  sdk: '^0.2.0',
  platforms: ['linux', 'darwin', 'win32'],
  languages: LANGUAGES,
  permissions: {
    // Pinged by default (ICMP, or TCP :443): 1.1.1.1 and 8.8.8.8; the public IP from Cloudflare (ipify and icanhazip only if chosen);
    // the speed test (off by default); `user` for the targets and the Pi-hole / AdGuard address typed in the options; `lan` for the router.
    network: ['1.1.1.1', '8.8.8.8', ...IP_SERVICES.slice(1).map((s) => s.host), SPEED_HOST, 'lan', 'user'],
    exec: ['ping', 'ping6', 'ip', 'iw', 'nmcli', 'route', 'airport', 'system_profiler', 'netsh', 'cmd', 'powershell'],
    files: ['/proc/net/route'],
  },
  resources: { memoryMb: 15, cpu: 'low' },
  widgets: [now, latency, speed, blocker],
  sources: [connectionSource],
  templates: [
    {
      id: 'network',
      name: L('Connection', 'Conexión', 'Verbindung', '网络', '網路'),
      icon: 'wifi',
      wide: [
        { x: 0, y: 0, w: 0.3, h: 1, widgets: ['now'] },
        { x: 0.3, y: 0, w: 0.45, h: 1, widgets: ['latency'] },
        { x: 0.75, y: 0, w: 0.25, h: 0.5, widgets: ['speed'] },
        { x: 0.75, y: 0.5, w: 0.25, h: 0.5, widgets: ['blocker'] },
      ],
      tall: [
        { x: 0, y: 0, w: 1, h: 0.35, widgets: ['now'] },
        { x: 0, y: 0.35, w: 1, h: 0.35, widgets: ['latency'] },
        { x: 0, y: 0.7, w: 1, h: 0.3, widgets: ['speed', 'blocker'] },
      ],
    },
  ],
});
