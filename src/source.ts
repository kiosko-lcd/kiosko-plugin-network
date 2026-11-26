/**
 * The `network/connection` source: latency, jitter and loss to a few
 * targets every few seconds, with the minutes of history the graph draws,
 * the Wi-Fi link, the public IP, the DNS blocker's counts and the speed
 * test, and the alerts. One monitor per data folder, kept between reads.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { createHttp, defineSource, t } from '@kiosko/sdk';
import { networkAlerts } from './alerts.ts';
import { BLOCKER_IDS } from './blockers/index.ts';
import { demoData } from './demo.ts';
import { L } from './i18n.ts';
import { ROUTER } from './labels.ts';
import { Monitor, type MonitorOptions, type Saved, type StateStore } from './monitor.ts';
import { execRun, tcpConnect } from './ping.ts';
import { DEFAULT_TARGETS } from './targets.ts';
import type { NetData } from './types.ts';

export const VERSION = '0.1.0';
export const AGENT = `kiosko-plugin-network/${VERSION}`;

export const sourceOptions = t.object({
  targets: t.list(t.string({ placeholder: 'NAS=192.168.1.10' }), {
    default: DEFAULT_TARGETS,
    max: 8,
    risk: 'network',
    label: L('Targets', 'Destinos', 'Ziele', '目标', '目標'),
    help: L(
      'Up to 8, one per line: gateway (your router), an address or a name (1.1.1.1, example.com) to ping, host:port to time a TCP connection instead (example.com:443), and Name=… to name one (NAS=192.168.1.10).',
      'Hasta 8, uno por línea: gateway (tu router), una dirección o un nombre (1.1.1.1, example.com) a los que hacer ping, host:puerto para medir una conexión TCP en su lugar (example.com:443), y Nombre=… para ponerle nombre (NAS=192.168.1.10).',
      'Bis zu 8, eines pro Zeile: gateway (dein Router), eine Adresse oder ein Name (1.1.1.1, example.com) zum Anpingen, host:port, um stattdessen eine TCP-Verbindung zu messen (example.com:443), und Name=…, um eines zu benennen (NAS=192.168.1.10).',
      '最多 8 个，每行一个：gateway（你的路由器）、要 ping 的地址或域名（1.1.1.1、example.com）、改为测量 TCP 连接的 主机:端口（example.com:443），以及用 名称=… 命名（NAS=192.168.1.10）。',
      '最多 8 個，每行一個：gateway（你的路由器）、要 ping 的位址或網域（1.1.1.1、example.com）、改為測量 TCP 連線的 主機:連接埠（example.com:443），以及用 名稱=… 命名（NAS=192.168.1.10）。',
    ),
  }),
  probes: t.integer({
    default: 3,
    min: 1,
    max: 10,
    label: L('Probes per sample', 'Sondeos por muestra', 'Proben pro Messung', '每次采样的探测数', '每次取樣的探測數'),
    help: L(
      'Packets sent to each target every read (every 5 s by default, in Settings → Data sources). More: finer loss and jitter.',
      'Paquetes que se envían a cada destino en cada lectura (cada 5 s por defecto, en Ajustes → Fuentes de datos). Más: pérdida y jitter más finos.',
      'Pakete, die bei jeder Messung an jedes Ziel gehen (standardmäßig alle 5 s, unter Einstellungen → Datenquellen). Mehr: genauerer Verlust und Jitter.',
      '每次读取向每个目标发送的数据包数（默认每 5 秒一次，见 设置 → 数据源）。越多，丢包和抖动越精确。',
      '每次讀取向每個目標傳送的封包數（預設每 5 秒一次，見 設定 → 資料來源）。越多，遺失和抖動越精確。',
    ),
    advanced: true,
  }),
  method: t.enum(['auto', 'icmp', 'tcp'] as const, {
    default: 'auto',
    label: L('How to probe', 'Cómo sondear', 'Wie gemessen wird', '探测方式', '探測方式'),
    help: L(
      "Automatic: the system's ping, and timing a TCP connection (port 443, the router's 80) where ping can't be used.",
      'Automático: el ping del sistema, y medir una conexión TCP (puerto 443, el 80 en el router) donde no se pueda usar ping.',
      'Automatisch: das ping des Systems und, wo ping nicht geht, die Zeit einer TCP-Verbindung (Port 443, beim Router 80).',
      '自动：使用系统的 ping；无法使用 ping 时改为测量 TCP 连接（端口 443，路由器用 80）。',
      '自動：使用系統的 ping；無法使用 ping 時改為測量 TCP 連線（連接埠 443，路由器用 80）。',
    ),
    labels: {
      auto: L('Automatic', 'Automático', 'Automatisch', '自动', '自動'),
      icmp: L('Ping (ICMP) only', 'Solo ping (ICMP)', 'Nur ping (ICMP)', '仅 ping（ICMP）', '僅 ping（ICMP）'),
      tcp: L('TCP connection only', 'Solo conexión TCP', 'Nur TCP-Verbindung', '仅 TCP 连接', '僅 TCP 連線'),
    },
    advanced: true,
  }),
  windowMs: t.duration({
    default: 60_000,
    min: 15_000,
    max: 10 * 60_000,
    label: L('Averaged over', 'Promedio sobre', 'Gemittelt über', '统计时长', '統計時長'),
    help: L('Latency, jitter and loss are worked out over this last stretch.', 'La latencia, el jitter y la pérdida se calculan sobre este último tramo.', 'Latenz, Jitter und Verlust werden über diesen letzten Zeitraum berechnet.', '延迟、抖动和丢包按最近这段时间计算。', '延遲、抖動和遺失依最近這段時間計算。'),
    advanced: true,
  }),
  historyMs: t.duration({
    default: 10 * 60_000,
    min: 60_000,
    max: 60 * 60_000,
    label: L('History for the graph', 'Historia de la gráfica', 'Verlauf für die Grafik', '图表的历史时长', '圖表的歷史時長'),
    advanced: true,
  }),
  latencyWarnMs: t.integer({ default: 80, min: 1, max: 5000, unit: 'ms', label: L('Latency in amber from', 'Latencia en ámbar desde', 'Latenz gelb ab', '延迟显示琥珀色的阈值', '延遲顯示琥珀色的門檻') }),
  latencyBadMs: t.integer({ default: 200, min: 1, max: 10000, unit: 'ms', label: L('Latency in red from', 'Latencia en rojo desde', 'Latenz rot ab', '延迟显示红色的阈值', '延遲顯示紅色的門檻') }),
  lossWarnPct: t.integer({ default: 2, min: 0, max: 100, unit: '%', label: L('Loss in amber from', 'Pérdida en ámbar desde', 'Verlust gelb ab', '丢包显示琥珀色的阈值', '遺失顯示琥珀色的門檻'), advanced: true }),
  alerts: t.boolean({
    default: true,
    label: L('Full-screen alert when the connection drops', 'Aviso a pantalla completa si se cae la conexión', 'Vollbild-Warnung, wenn die Verbindung abbricht', '断网时全屏提醒', '斷線時全螢幕提醒'),
    help: L(
      'When no internet target answers for the time below, or the loss stays high, saying whether the router still answers.',
      'Cuando ningún destino de internet responda durante el tiempo de abajo, o la pérdida siga alta, diciendo si el router aún responde.',
      'Wenn kein Internetziel für die Zeit unten antwortet oder der Verlust hoch bleibt, mit dem Hinweis, ob der Router noch antwortet.',
      '当所有互联网目标在下方时长内都无响应，或丢包持续偏高时提醒，并说明路由器是否仍有响应。',
      '當所有網際網路目標在下方時長內都沒有回應，或遺失持續偏高時提醒，並說明路由器是否仍有回應。',
    ),
  }),
  offlineAfterMs: t.duration({ default: 30_000, min: 10_000, max: 10 * 60_000, label: L('Offline for', 'Sin conexión durante', 'Offline seit', '断网持续', '斷線持續') }),
  lossAlertPct: t.integer({ default: 20, min: 1, max: 100, unit: '%', label: L('Alert on loss over', 'Avisar con pérdida por encima de', 'Warnen bei Verlust über', '丢包超过此值时提醒', '遺失超過此值時提醒') }),
  lossForMs: t.duration({ default: 60_000, min: 15_000, max: 10 * 60_000, label: L('Loss measured over', 'Pérdida medida durante', 'Verlust gemessen über', '丢包统计时长', '遺失統計時長'), advanced: true }),
  wifi: t.boolean({
    default: true,
    label: L('Read the Wi-Fi link', 'Leer el enlace Wi-Fi', 'WLAN-Verbindung lesen', '读取 Wi-Fi 连接', '讀取 Wi-Fi 連線'),
    help: L(
      'Network name, signal, band, channel and link rate, from iw or nmcli (Linux), airport or system_profiler (macOS), netsh (Windows). Nothing is shown on a wired machine.',
      'Nombre de la red, señal, banda, canal y velocidad del enlace, de iw o nmcli (Linux), airport o system_profiler (macOS), netsh (Windows). En un equipo con cable no se muestra nada.',
      'Netzname, Signal, Band, Kanal und Verbindungsrate, aus iw oder nmcli (Linux), airport oder system_profiler (macOS), netsh (Windows). Auf einem Rechner mit Kabel wird nichts gezeigt.',
      '网络名称、信号、频段、信道和连接速率，来自 iw 或 nmcli（Linux）、airport 或 system_profiler（macOS）、netsh（Windows）。有线连接的电脑不显示。',
      '網路名稱、訊號、頻段、通道和連線速率，來自 iw 或 nmcli（Linux）、airport 或 system_profiler（macOS）、netsh（Windows）。有線連線的電腦不顯示。',
    ),
  }),
  publicIp: t.enum(['cloudflare', 'any', 'off'] as const, {
    default: 'cloudflare',
    label: L('Public IP', 'IP pública', 'Öffentliche IP', '公网 IP', '公用 IP'),
    help: L(
      'Asked every 15 minutes and when the connection comes back. Cloudflare: only 1.1.1.1/cdn-cgi/trace, the same company as the default ping target. Any: also api.ipify.org and icanhazip.com when Cloudflare fails. Off: no address is asked.',
      'Se pregunta cada 15 minutos y al volver la conexión. Cloudflare: solo 1.1.1.1/cdn-cgi/trace, la misma empresa que el destino de ping por defecto. Cualquiera: también api.ipify.org e icanhazip.com si falla Cloudflare. Desactivada: no se pregunta.',
      'Alle 15 Minuten und bei Rückkehr der Verbindung abgefragt. Cloudflare: nur 1.1.1.1/cdn-cgi/trace, dieselbe Firma wie das Standard-Pingziel. Beliebig: auch api.ipify.org und icanhazip.com, wenn Cloudflare ausfällt. Aus: keine Abfrage.',
      '每 15 分钟及网络恢复时查询一次。Cloudflare：只查询 1.1.1.1/cdn-cgi/trace，与默认 ping 目标同属一家公司。任意：Cloudflare 失败时也查询 api.ipify.org 和 icanhazip.com。关闭：不查询。',
      '每 15 分鐘及網路恢復時查詢一次。Cloudflare：只查詢 1.1.1.1/cdn-cgi/trace，與預設 ping 目標同屬一家公司。任意：Cloudflare 失敗時也查詢 api.ipify.org 和 icanhazip.com。關閉：不查詢。',
    ),
    labels: {
      cloudflare: L('Cloudflare only', 'Solo Cloudflare', 'Nur Cloudflare', '仅 Cloudflare', '僅 Cloudflare'),
      any: L('Cloudflare, then ipify or icanhazip', 'Cloudflare, y si no ipify o icanhazip', 'Cloudflare, sonst ipify oder icanhazip', 'Cloudflare，失败时 ipify 或 icanhazip', 'Cloudflare，失敗時 ipify 或 icanhazip'),
      off: L('Off', 'Desactivada', 'Aus', '关闭', '關閉'),
    },
  }),
  alertIpChange: t.boolean({ default: false, label: L('Notice when the public IP changes', 'Aviso cuando cambie la IP pública', 'Hinweis, wenn sich die öffentliche IP ändert', '公网 IP 变更时提醒', '公用 IP 變更時提醒'), advanced: true }),
  speedTest: t.enum(['off', '6h', '12h', '24h'] as const, {
    default: 'off',
    label: L('Speed test', 'Test de velocidad', 'Geschwindigkeitstest', '测速', '測速'),
    help: L(
      "Download and upload speed from Cloudflare's speed test (speed.cloudflare.com). Each test moves about 1.5 times the size below (15 MB by default): every 6 h that is some 60 MB a day, 1.8 GB a month. Never on while offline, never in the first minutes after starting.",
      'Velocidad de bajada y subida con el test de velocidad de Cloudflare (speed.cloudflare.com). Cada test mueve 1,5 veces el tamaño de abajo (15 MB por defecto): cada 6 h son unos 60 MB al día, 1,8 GB al mes. Nunca sin conexión ni en los primeros minutos tras arrancar.',
      'Download- und Upload-Geschwindigkeit mit dem Geschwindigkeitstest von Cloudflare (speed.cloudflare.com). Jeder Test überträgt etwa das 1,5-Fache der Größe unten (standardmäßig 15 MB): alle 6 h sind das rund 60 MB am Tag, 1,8 GB im Monat. Nie offline, nie in den ersten Minuten nach dem Start.',
      '使用 Cloudflare 测速（speed.cloudflare.com）测量下载和上传速度。每次测试消耗约为下方大小的 1.5 倍（默认 15 MB）：每 6 小时一次约每天 60 MB、每月 1.8 GB。断网时及启动后最初几分钟内不会运行。',
      '使用 Cloudflare 測速（speed.cloudflare.com）測量下載和上傳速度。每次測試消耗約為下方大小的 1.5 倍（預設 15 MB）：每 6 小時一次約每天 60 MB、每月 1.8 GB。斷線時及啟動後最初幾分鐘內不會執行。',
    ),
    labels: {
      off: L('Off', 'Desactivado', 'Aus', '关闭', '關閉'),
      '6h': L('Every 6 hours', 'Cada 6 horas', 'Alle 6 Stunden', '每 6 小时', '每 6 小時'),
      '12h': L('Every 12 hours', 'Cada 12 horas', 'Alle 12 Stunden', '每 12 小时', '每 12 小時'),
      '24h': L('Once a day', 'Una vez al día', 'Einmal am Tag', '每天一次', '每天一次'),
    },
  }),
  speedTestMb: t.integer({
    default: 10,
    min: 2,
    max: 100,
    unit: 'MB',
    label: L('Speed test download size', 'Tamaño de la descarga del test', 'Download-Größe des Tests', '测速下载大小', '測速下載大小'),
    help: L('Plus half as much uploaded. Larger is steadier on fast lines (over 300 Mbit/s) and costs more data.', 'Más la mitad de subida. Más grande es más estable en líneas rápidas (más de 300 Mbit/s) y gasta más datos.', 'Plus die Hälfte im Upload. Größer ist bei schnellen Leitungen (über 300 Mbit/s) stabiler und kostet mehr Daten.', '另加一半的上传量。数值越大，在高速线路（300 Mbit/s 以上）上越稳定，但更耗流量。', '另加一半的上傳量。數值越大，在高速線路（300 Mbit/s 以上）上越穩定，但更耗流量。'),
    advanced: true,
  }),
  blocker: t.enum(['off', ...BLOCKER_IDS] as const, {
    default: 'off',
    label: L('DNS blocker', 'Bloqueador DNS', 'DNS-Blocker', 'DNS 拦截器', 'DNS 封鎖器'),
    help: L("Pi-hole (v6 or v5) or AdGuard Home on your network: what it blocked in the last 24 hours (Pi-hole v5: today).", 'Pi-hole (v6 o v5) o AdGuard Home en tu red: lo que ha bloqueado en las últimas 24 horas (Pi-hole v5: hoy).', 'Pi-hole (v6 oder v5) oder AdGuard Home in deinem Netz: was es in den letzten 24 Stunden blockiert hat (Pi-hole v5: heute).', '你网络中的 Pi-hole（v6 或 v5）或 AdGuard Home：过去 24 小时拦截的数量（Pi-hole v5：今天）。', '你網路中的 Pi-hole（v6 或 v5）或 AdGuard Home：過去 24 小時封鎖的數量（Pi-hole v5：今天）。'),
    labels: { off: L('None', 'Ninguno', 'Keiner', '无', '無'), pihole: L('Pi-hole', 'Pi-hole', 'Pi-hole', 'Pi-hole', 'Pi-hole'), adguard: L('AdGuard Home', 'AdGuard Home', 'AdGuard Home', 'AdGuard Home', 'AdGuard Home') },
  }),
  blockerUrl: t.string({
    format: 'url',
    risk: 'network',
    placeholder: 'http://pi.hole',
    label: L('DNS blocker address', 'Dirección del bloqueador DNS', 'Adresse des DNS-Blockers', 'DNS 拦截器地址', 'DNS 封鎖器位址'),
    help: L('The one of its web page: http://pi.hole, http://192.168.1.2:3000.', 'La de su página web: http://pi.hole, http://192.168.1.2:3000.', 'Die seiner Webseite: http://pi.hole, http://192.168.1.2:3000.', '其网页的地址：http://pi.hole、http://192.168.1.2:3000。', '其網頁的位址：http://pi.hole、http://192.168.1.2:3000。'),
  }),
  blockerUser: t.string({ label: L('User (AdGuard Home)', 'Usuario (AdGuard Home)', 'Benutzer (AdGuard Home)', '用户名（AdGuard Home）', '使用者名稱（AdGuard Home）') }),
  blockerPassword: t.string({
    secret: true,
    label: L('Password or API token', 'Contraseña o token de la API', 'Passwort oder API-Token', '密码或 API 令牌', '密碼或 API 權杖'),
    help: L(
      'Pi-hole v6: the web password or, better, an app password (Settings → Web interface / API). Pi-hole v5: the API token (Settings → API). AdGuard Home: the password of the user above.',
      'Pi-hole v6: la contraseña web o, mejor, una contraseña de aplicación (Settings → Web interface / API). Pi-hole v5: el token de la API (Settings → API). AdGuard Home: la contraseña del usuario de arriba.',
      'Pi-hole v6: das Web-Passwort oder besser ein App-Passwort (Settings → Web interface / API). Pi-hole v5: das API-Token (Settings → API). AdGuard Home: das Passwort des Benutzers oben.',
      'Pi-hole v6：网页密码，最好用应用密码（Settings → Web interface / API）。Pi-hole v5：API 令牌（Settings → API）。AdGuard Home：上方用户的密码。',
      'Pi-hole v6：網頁密碼，最好用應用程式密碼（Settings → Web interface / API）。Pi-hole v5：API 權杖（Settings → API）。AdGuard Home：上方使用者的密碼。',
    ),
  }),
});

const fileStore = (dir: string): StateStore => {
  const file = join(dir, 'state.json');
  return {
    async load() {
      try {
        return JSON.parse(await readFile(file, 'utf8')) as Saved;
      } catch {
        return {};
      }
    },
    async save(s) {
      try {
        await mkdir(dir, { recursive: true });
        await writeFile(file, JSON.stringify(s));
      } catch {
        /* kept in memory */
      }
    },
  };
};

const monitors = new Map<string, Monitor>();
const http = createHttp({ agent: AGENT });

/** Turns the validated options into what the monitor reads (each probe waits up to 1 s). */
export const monitorOptions = (o: Record<string, unknown>): MonitorOptions => ({ ...(o as unknown as MonitorOptions), probeTimeoutMs: 1000 });

export const connectionSource = defineSource({
  id: 'connection',
  name: L('Your connection', 'Tu conexión', 'Deine Verbindung', '你的网络连接', '你的網路連線'),
  description: L(
    "Latency, jitter and packet loss to your router and the internet, every few seconds, with the system's ping (or a TCP connection where ping can't be used); the Wi-Fi link; your public IP; Pi-hole's or AdGuard Home's counts; and, if you turn it on, a speed test every few hours.",
    'Latencia, jitter y pérdida de paquetes hasta tu router e internet, cada pocos segundos, con el ping del sistema (o una conexión TCP donde no se pueda usar ping); el enlace Wi-Fi; tu IP pública; las cifras de Pi-hole o AdGuard Home; y, si lo activas, un test de velocidad cada pocas horas.',
    'Latenz, Jitter und Paketverlust zu deinem Router und ins Internet, alle paar Sekunden, mit dem ping des Systems (oder einer TCP-Verbindung, wo ping nicht geht); die WLAN-Verbindung; deine öffentliche IP; die Zahlen von Pi-hole oder AdGuard Home; und, wenn du ihn einschaltest, alle paar Stunden ein Geschwindigkeitstest.',
    '每隔几秒用系统的 ping（无法使用 ping 时改用 TCP 连接）测量到路由器和互联网的延迟、抖动和丢包；Wi-Fi 连接；公网 IP；Pi-hole 或 AdGuard Home 的统计；开启后每隔几小时测一次速。',
    '每隔幾秒用系統的 ping（無法使用 ping 時改用 TCP 連線）測量到路由器和網際網路的延遲、抖動和遺失；Wi-Fi 連線；公用 IP；Pi-hole 或 AdGuard Home 的統計；開啟後每隔幾小時測一次速。',
  ),
  options: sourceOptions,
  intervalMs: 5000,
  minIntervalMs: 5000,
  timeoutMs: 20_000,
  background: true,
  async read(ctx): Promise<NetData> {
    let m = monitors.get(ctx.dataDir);
    if (!m) monitors.set(ctx.dataDir, (m = new Monitor({ run: execRun, connect: tcpConnect, os: process.platform, http, fetch, store: fileStore(ctx.dataDir), log: (s) => ctx.log(s), agent: AGENT }, ctx.now)));
    const data = await m.sample(monitorOptions(ctx.options as Record<string, unknown>), ctx.now, ctx.signal);
    return { ...data, intervalMs: ctx.intervalMs };
  },
  demo: ({ now }) => demoData(now),
  alerts: ({ data, now }) => networkAlerts(data, now),
  choices: {
    targets: (data, { t: tr }) => data.targets.map((x) => ({ value: x.gateway ? 'gateway' : x.label || x.host, label: x.gateway ? tr(ROUTER) : `${x.label || x.host}${x.label && x.label !== x.host ? ` (${x.host})` : ''}` })),
  },
});
