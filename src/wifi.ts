/**
 * The Wi-Fi link, per system, from what it already has:
 *
 * - Linux: `iw dev` (the managed interfaces) and `iw dev <if> link` (SSID,
 *   frequency, signal in dBm, bit rates); else NetworkManager's `nmcli`
 *   (signal in %).
 * - macOS: `airport -I` where it still exists (up to macOS 14.3), else
 *   `system_profiler SPAirPortDataType -json`. Since macOS 14.4 the SSID may
 *   come as "<redacted>" without location permission: the rest still shows.
 * - Windows: `netsh wlan show interfaces`, which is translated. Its keys are
 *   not trusted except `SSID`, the ones with a rate unit (`(Mbps)`,
 *   `(MBit/s)`) and the channel's few names; the signal is the value with a
 *   `%`, the band the one with `GHz`.
 *
 * Null when there's no Wi-Fi or it isn't connected: a wired machine.
 */
import type { Run } from './ping.ts';
import type { WifiData } from './types.ts';

export const bandOf = (mhz: number | null): string | null => (mhz === null ? null : mhz >= 5925 ? '6' : mhz >= 4900 ? '5' : mhz >= 2400 && mhz < 2500 ? '2.4' : null);

/** Channel from frequency (802.11 numbering). */
export function channelOf(mhz: number | null): number | null {
  if (mhz === null) return null;
  if (mhz === 2484) return 14;
  if (mhz >= 2412 && mhz < 2484) return Math.round((mhz - 2407) / 5);
  if (mhz >= 5955 && mhz <= 7115) return Math.round((mhz - 5950) / 5);
  if (mhz >= 5000 && mhz < 5925) return Math.round((mhz - 5000) / 5);
  return null;
}

/** Frequency from channel and band, for the systems that give only the channel. */
export function freqOf(channel: number | null, band: string | null): number | null {
  if (channel === null) return null;
  if (band === '6') return 5950 + channel * 5;
  if (band === '5' || (band === null && channel >= 32)) return 5000 + channel * 5;
  if (channel === 14) return 2484;
  return 2407 + channel * 5;
}

/** Windows' and NetworkManager's mapping: −100 dBm is 0 %, −50 dBm and better 100 %. */
export const pctOfDbm = (dbm: number): number => Math.max(0, Math.min(100, Math.round(2 * (dbm + 100))));

const num = (s: string | undefined): number | null => {
  if (s === undefined) return null;
  const v = Number(s.replace(',', '.'));
  return Number.isFinite(v) ? v : null;
};

function make(o: Partial<WifiData> & { iface: string }): WifiData {
  const freq = o.freqMhz ?? null;
  const band = o.band ?? bandOf(freq);
  return {
    iface: o.iface,
    ssid: o.ssid ?? null,
    signalDbm: o.signalDbm ?? null,
    signalPct: o.signalPct ?? (o.signalDbm != null ? pctOfDbm(o.signalDbm) : null),
    freqMhz: freq ?? freqOf(o.channel ?? null, band),
    channel: o.channel ?? channelOf(freq),
    band,
    widthMhz: o.widthMhz ?? null,
    rxMbps: o.rxMbps ?? null,
    txMbps: o.txMbps ?? null,
    primary: o.primary ?? null,
  };
}

/** `iw dev`: the managed (station) interfaces, with their channel width when given. */
export function parseIwDev(text: string): { iface: string; widthMhz: number | null }[] {
  const out: { iface: string; widthMhz: number | null; managed: boolean }[] = [];
  for (const line of text.split(/\r?\n/)) {
    const i = /^\s*Interface\s+(\S+)/.exec(line);
    if (i) {
      out.push({ iface: i[1]!, widthMhz: null, managed: false });
      continue;
    }
    const cur = out[out.length - 1];
    if (!cur) continue;
    if (/^\s*type\s+managed/.test(line)) cur.managed = true;
    const w = /width:\s*(\d+)\s*MHz/.exec(line);
    if (w && /^\s*channel/.test(line)) cur.widthMhz = Number(w[1]);
  }
  return out.filter((x) => x.managed).map(({ iface, widthMhz }) => ({ iface, widthMhz }));
}

/** `iw dev <if> link`. Null when "Not connected." */
export function parseIwLink(text: string, iface: string, widthMhz: number | null = null): WifiData | null {
  if (!/^Connected to/m.test(text)) return null;
  const get = (re: RegExp) => re.exec(text)?.[1];
  const ssid = get(/^\s*SSID:\s*(.*)$/m);
  return make({
    iface,
    ssid: ssid === undefined ? null : decodeIwEscapes(ssid.trim()),
    freqMhz: num(get(/^\s*freq:\s*([\d.]+)/m)),
    signalDbm: num(get(/^\s*signal:\s*(-?\d+)/m)),
    rxMbps: num(get(/^\s*rx bitrate:\s*([\d.]+)/m)),
    txMbps: num(get(/^\s*tx bitrate:\s*([\d.]+)/m)),
    widthMhz: widthMhz ?? num(get(/(\d+)MHz/)),
  });
}

/** iw writes non-ASCII bytes of an SSID as `\xNN`. */
function decodeIwEscapes(s: string): string {
  if (!/\\x[0-9a-f]{2}/i.test(s)) return s;
  const bytes: number[] = [];
  for (let i = 0; i < s.length; i++) {
    const m = /^\\x([0-9a-f]{2})/i.exec(s.slice(i));
    if (m) {
      bytes.push(parseInt(m[1]!, 16));
      i += 3;
    } else bytes.push(...Buffer.from(s[i]!, 'utf8'));
  }
  return Buffer.from(bytes).toString('utf8');
}

/** nmcli's terse fields are separated by `:`, with `\:` inside a value. */
const splitTerse = (line: string): string[] => line.split(/(?<!\\):/).map((f) => f.replace(/\\:/g, ':').replace(/\\\\/g, '\\'));

/** `nmcli -t -f IN-USE,SSID,CHAN,FREQ,RATE,SIGNAL,DEVICE dev wifi list --rescan no`: the line marked `*`. */
export function parseNmcli(text: string): WifiData | null {
  for (const line of text.split(/\r?\n/)) {
    const f = splitTerse(line);
    if (f.length < 7 || f[0]!.trim() !== '*') continue;
    const [, ssid, chan, freq, rate, signal, dev] = f;
    return make({ iface: dev || 'wifi', ssid: ssid || null, channel: num(chan), freqMhz: num(/\d+/.exec(freq ?? '')?.[0]), rxMbps: num(/[\d.]+/.exec(rate ?? '')?.[0]), signalPct: num(signal) });
  }
  return null;
}

/** macOS `airport -I`. */
export function parseAirport(text: string): WifiData | null {
  const get = (k: string) => new RegExp(`^\\s*${k}:\\s*(.*)$`, 'm').exec(text)?.[1]?.trim();
  if (get('state') !== 'running') return null;
  const ch = get('channel');
  const [c, w] = (ch ?? '').split(',');
  const channel = num(c);
  // `36,80` (width in MHz), `6,-1`/`6,+1` (40 MHz, the old notation), or the channel alone.
  const wn = num(w);
  const widthMhz = wn !== null && wn > 1 ? wn : w ? 40 : 20;
  return make({ iface: 'en0', ssid: get('SSID') || null, signalDbm: num(get('agrCtlRSSI')), channel, band: channel !== null && channel > 14 ? '5' : '2.4', widthMhz, txMbps: num(get('lastTxRate')) });
}

interface SpInterface {
  _name?: string;
  spairport_status_information?: string;
  spairport_current_network_information?: {
    _name?: string;
    spairport_network_channel?: string | number;
    spairport_network_rate?: number;
    spairport_signal_noise?: string;
  };
}

/** `system_profiler SPAirPortDataType -json`. */
export function parseSystemProfiler(text: string): WifiData | null {
  let data: { SPAirPortDataType?: { spairport_airport_interfaces?: SpInterface[] }[] };
  try {
    data = JSON.parse(text);
  } catch {
    return null;
  }
  for (const it of data.SPAirPortDataType?.flatMap((x) => x.spairport_airport_interfaces ?? []) ?? []) {
    const n = it.spairport_current_network_information;
    if (!n || it.spairport_status_information !== 'spairport_status_connected') continue;
    // "149 (5GHz, 80MHz)", "6 (2GHz, 20MHz)".
    const ch = String(n.spairport_network_channel ?? '');
    const channel = num(/^\d+/.exec(ch)?.[0]);
    const ghz = /\((\d)GHz/.exec(ch)?.[1];
    const band = ghz === '2' ? '2.4' : ghz === '5' ? '5' : ghz === '6' ? '6' : null;
    const ssid = n._name && !/^<.*>$/.test(n._name) ? n._name : null;
    return make({
      iface: it._name ?? 'en0',
      ssid,
      channel,
      band,
      widthMhz: num(/(\d+)MHz/.exec(ch)?.[1]),
      signalDbm: num(/(-?\d+)\s*dBm/.exec(n.spairport_signal_noise ?? '')?.[1]),
      txMbps: typeof n.spairport_network_rate === 'number' ? n.spairport_network_rate : null,
    });
  }
  return null;
}

const CHANNEL_KEY = /^(channel|kanal|canal|canale|kanaal|信道|通道|チャネル|채널)$/i;

/** `netsh wlan show interfaces`, in any language: the first interface with an SSID. */
export function parseNetsh(text: string): WifiData | null {
  const blocks: Record<string, string>[] = [];
  let cur: Record<string, string> | null = null;
  const rates: number[][] = [];
  for (const raw of text.split(/\r?\n/)) {
    const m = /^\s{2,}([^:]+?)\s*:\s(.*)$/.exec(raw);
    if (!m) continue;
    const key = m[1]!.trim();
    const value = m[2]!.trim();
    // A new interface starts at its first key (Name, Nombre, 名称…), which comes right after a blank line or the header.
    if (!cur || (key in cur && key !== 'SSID')) {
      cur = {};
      blocks.push(cur);
      rates.push([]);
    }
    cur[key] = value;
    if (/\((mbps|mbit\/s)\)/i.test(key)) {
      const v = num(value);
      if (v !== null) rates[rates.length - 1]!.push(v);
    }
  }
  for (const [i, b] of blocks.entries()) {
    const ssid = b.SSID;
    if (ssid === undefined) continue;
    const vals = Object.values(b);
    const signal = num(vals.find((v) => /^\d{1,3}\s?%$/.test(v))?.replace('%', ''));
    const bandText = vals.find((v) => /^[\d.,]+\s?GHz$/i.test(v));
    const chKey = Object.keys(b).find((k) => CHANNEL_KEY.test(k));
    const channel = chKey ? num(b[chKey]) : null;
    const band = bandText ? (bandText.startsWith('2') ? '2.4' : bandText.startsWith('6') ? '6' : '5') : channel !== null ? (channel > 14 ? '5' : '2.4') : null;
    const [rx, tx] = rates[i]!;
    return make({ iface: Object.values(b)[0] ?? 'Wi-Fi', ssid: ssid || null, signalPct: signal, channel, band, rxMbps: rx ?? null, txMbps: tx ?? null });
  }
  return null;
}

/** Reads the connected Wi-Fi of this system; `gatewayIface` marks whether the default route uses it. */
export async function readWifi(run: Run, os: NodeJS.Platform, o: { timeoutMs: number; signal?: AbortSignal; gatewayIface?: string | null }): Promise<WifiData | null> {
  const out = async (cmd: string, args: string[]) => {
    try {
      const r = await run(cmd, args, { timeoutMs: o.timeoutMs, ...(o.signal ? { signal: o.signal } : {}) });
      return r.code === 0 ? r.stdout : null;
    } catch {
      return null;
    }
  };
  let w: WifiData | null = null;
  if (os === 'linux') {
    const dev = await out('iw', ['dev']);
    for (const d of dev ? parseIwDev(dev) : []) {
      const link = await out('iw', ['dev', d.iface, 'link']);
      w = link ? parseIwLink(link, d.iface, d.widthMhz) : null;
      if (w) break;
    }
    if (!w && dev === null) {
      const nm = await out('nmcli', ['-t', '-f', 'IN-USE,SSID,CHAN,FREQ,RATE,SIGNAL,DEVICE', 'dev', 'wifi', 'list', '--rescan', 'no']);
      w = nm ? parseNmcli(nm) : null;
    }
  } else if (os === 'darwin') {
    const airport = await out('/System/Library/PrivateFrameworks/Apple80211.framework/Versions/Current/Resources/airport', ['-I']);
    w = airport && !/deprecated/i.test(airport) ? parseAirport(airport) : null;
    if (!w) {
      const sp = await out('system_profiler', ['SPAirPortDataType', '-json', '-detailLevel', 'basic']);
      w = sp ? parseSystemProfiler(sp) : null;
    }
  } else if (os === 'win32') {
    // UTF-8 out of the console code page, so an SSID with accents or in Chinese comes through.
    const t = await out(process.env.ComSpec || 'cmd.exe', ['/d', '/s', '/c', '"chcp 65001 >nul && netsh wlan show interfaces"']);
    w = t ? parseNetsh(t) : null;
  }
  if (w && o.gatewayIface !== undefined && o.gatewayIface !== null && os !== 'win32') w.primary = w.iface === o.gatewayIface;
  return w;
}
