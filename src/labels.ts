/** Every word the widgets paint, in the plugin's five languages. */
import type { Localized } from '@kiosko/sdk';
import { L } from './i18n.ts';
import type { Status } from './types.ts';

export const ROUTER = L('Router', 'Router', 'Router', '路由器', '路由器');

export const STATUS_LABELS: Record<Status, Localized> = {
  starting: L('Measuring…', 'Midiendo…', 'Messe…', '正在测量…', '正在測量…'),
  ok: L('Online', 'Conectado', 'Verbunden', '已连接', '已連線'),
  slow: L('Slow', 'Lenta', 'Langsam', '较慢', '較慢'),
  lossy: L('Losing packets', 'Pierde paquetes', 'Paketverlust', '丢包', '遺失封包'),
  local: L('No internet', 'Sin internet', 'Kein Internet', '无法上网', '無法上網'),
  offline: L('Offline', 'Sin conexión', 'Offline', '已断开', '已斷線'),
};

export const LOSS = L('loss', 'pérdida', 'Verlust', '丢包', '遺失');
export const JITTER = L('jitter', 'jitter', 'Jitter', '抖动', '抖動');
export const LATENCY = L('Latency', 'Latencia', 'Latenz', '延迟', '延遲');
export const LOST = L('lost', 'perdido', 'verloren', '丢失', '遺失');
export const NO_ROUTE = L('no gateway', 'sin puerta de enlace', 'kein Gateway', '无网关', '無閘道');
export const UNKNOWN_HOST = L('unknown host', 'nombre desconocido', 'unbekannter Host', '无法解析', '無法解析');
export const WIRED = L('Cable', 'Cable', 'Kabel', '有线', '有線');
export const WIFI = L('Wi-Fi', 'Wi-Fi', 'WLAN', 'Wi-Fi', 'Wi-Fi');
export const HIDDEN_SSID = L('Wi-Fi', 'Wi-Fi', 'WLAN', 'Wi-Fi', 'Wi-Fi');
export const CHANNEL = L('ch {n}', 'canal {n}', 'Kanal {n}', '信道 {n}', '通道 {n}');
export const PUBLIC_IP = L('IP', 'IP', 'IP', 'IP', 'IP');
/** `{ago}`: "3 h ago" / "hace 3 h" from `fmt.ago`. */
export const CHANGED = L('changed {ago}', 'cambió {ago}', 'geändert {ago}', '{ago}变更', '{ago}變更');
export const NOW_TAG = L('now', 'ahora', 'jetzt', '现在', '現在');
/** `{d}`: "10 min". */
export const LAST_SPAN = L('last {d}', 'últimos {d}', 'letzte {d}', '最近 {d}', '最近 {d}');

export const WAITING = L('Measuring the connection…', 'Midiendo la conexión…', 'Verbindung wird gemessen…', '正在测量网络连接…', '正在測量網路連線…');

export const DOWN = L('Down', 'Bajada', 'Download', '下载', '下載');
export const UP = L('Up', 'Subida', 'Upload', '上传', '上傳');
export const PING = L('Ping', 'Ping', 'Ping', 'Ping', 'Ping');
export const SPEED_OFF = L('Speed test off', 'Test de velocidad desactivado', 'Geschwindigkeitstest aus', '测速已关闭', '測速已關閉');
export const SPEED_HOW = L('Turn it on in Settings → Data sources', 'Actívalo en Ajustes → Fuentes de datos', 'Unter Einstellungen → Datenquellen einschalten', '在 设置 → 数据源 中开启', '在 設定 → 資料來源 中開啟');
export const SPEED_RUNNING = L('Testing the speed…', 'Midiendo la velocidad…', 'Geschwindigkeit wird gemessen…', '正在测速…', '正在測速…');
/** `{d}`: "3 h 55". */
export const SPEED_FIRST = L('First test in {d}', 'Primer test en {d}', 'Erster Test in {d}', '{d}后首次测速', '{d}後首次測速');
export const NEXT_IN = L('next in {d}', 'siguiente en {d}', 'nächster in {d}', '{d}后再测', '{d}後再測');
export const FAILED = L('last try failed', 'falló el último intento', 'letzter Versuch fehlgeschlagen', '上次测速失败', '上次測速失敗');

export const BLOCKED = L('blocked', 'bloqueadas', 'blockiert', '已拦截', '已封鎖');
/** `{n}`: "29,160". */
export const OF_QUERIES = L('of {n} queries', 'de {n} consultas', 'von {n} Anfragen', '共 {n} 次查询', '共 {n} 次查詢');
export const QUERIES = L('{n} queries', '{n} consultas', '{n} Anfragen', '{n} 次查询', '{n} 次查詢');
export const PERIOD: Record<'today' | '24h' | 'days', Localized> = {
  today: L('today', 'hoy', 'heute', '今天', '今天'),
  '24h': L('24 h', '24 h', '24 h', '24 小时', '24 小時'),
  days: L('last days', 'últimos días', 'letzte Tage', '最近几天', '最近幾天'),
};
export const PAUSED = L('Blocking paused', 'Bloqueo en pausa', 'Blockieren pausiert', '拦截已暂停', '封鎖已暫停');
export const NO_BLOCKER = L('No DNS blocker set up', 'Sin bloqueador DNS', 'Kein DNS-Blocker eingerichtet', '未设置 DNS 拦截器', '未設定 DNS 封鎖器');
export const BLOCKER_HOW = L('Pi-hole or AdGuard Home: Settings → Data sources', 'Pi-hole o AdGuard Home: Ajustes → Fuentes de datos', 'Pi-hole oder AdGuard Home: Einstellungen → Datenquellen', 'Pi-hole 或 AdGuard Home：设置 → 数据源', 'Pi-hole 或 AdGuard Home：設定 → 資料來源');
export const BLOCKER_READING = L('Reading the DNS blocker…', 'Leyendo el bloqueador DNS…', 'DNS-Blocker wird gelesen…', '正在读取 DNS 拦截器…', '正在讀取 DNS 封鎖器…');
export const BLOCKER_ERROR = L("Can't read {name}", 'No se puede leer {name}', '{name} nicht lesbar', '无法读取 {name}', '無法讀取 {name}');

export const fill = (text: string, values: Record<string, string>): string => text.replace(/\{(\w+)\}/g, (m, k: string) => values[k] ?? m);
