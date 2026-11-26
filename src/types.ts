/** What the source hands to the widgets: plain data, the same on every system. */

/** One sample of one target: the round-trip times of the replies (ms), out of `sent` probes. */
export interface Sample {
  at: number;
  /** One per reply, in ms. Empty: every probe was lost. */
  rtts: number[];
  sent: number;
}

/** How a target was probed: ICMP with the system's `ping`, or timing a TCP connection. */
export type Method = 'icmp' | 'tcp';

export interface TargetData {
  /** As written in the options (`gateway`, `1.1.1.1`, `NAS=192.168.1.10`). */
  spec: string;
  /** What is shown: "Router", "Cloudflare", "NAS". */
  label: string;
  /** Host or address probed (the gateway's address once known). */
  host: string;
  /** TCP port, when probed by TCP. */
  port?: number;
  /** The default gateway: the local network, not the internet. */
  gateway: boolean;
  method: Method;
  /** Latest sample's median RTT, ms; null when it was all lost. */
  last: number | null;
  /** Median RTT over the stats window, ms. */
  median: number | null;
  /** Mean difference between consecutive RTTs over the stats window, ms. */
  jitter: number | null;
  /** Lost probes over the stats window, 0..1; null before any. */
  loss: number | null;
  /** Something keeps it from being probed at all ("unknown host"); it counts as lost. */
  error?: string;
  /** The history for the graph, oldest first. */
  samples: Sample[];
}

export interface WifiData {
  iface: string;
  /** Null where the system hides it (macOS without location permission). */
  ssid: string | null;
  signalDbm: number | null;
  /** 0..100: as the system gives it, or worked out from dBm. */
  signalPct: number | null;
  freqMhz: number | null;
  channel: number | null;
  /** `2.4`, `5` or `6` (GHz). */
  band: string | null;
  widthMhz: number | null;
  /** Link rate, Mbit/s. */
  rxMbps: number | null;
  txMbps: number | null;
  /** Whether the default route goes through it; null when the system doesn't say. */
  primary: boolean | null;
}

export interface GatewayData {
  ip: string;
  /** Interface name (`enp89s0`, `en0`) or, on Windows, the interface's address. */
  iface: string | null;
  /** The route goes through Wi-Fi: true, false, or null when unknown. */
  wifi: boolean | null;
}

export interface PublicIpData {
  ip: string;
  /** Who answered: `cloudflare`, `ipify`, `icanhazip`. */
  via: string;
  /** Country code, when the service says (Cloudflare does). */
  country?: string;
  checkedAt: number;
  /** The address before this one, and when it changed (epoch ms), if seen. */
  previous?: string;
  changedAt?: number;
  error?: string;
}

export interface SpeedResult {
  at: number;
  /** Mbit/s. */
  down: number;
  up: number;
  /** Idle latency to the test server, ms. */
  latency: number;
  /** Megabytes moved by the test (down + up). */
  mb: number;
  server: string;
  /** Data centre, when the server says (`MAD`). */
  colo?: string;
}

export interface SpeedData {
  enabled: boolean;
  /** Every how long, ms (when enabled). */
  everyMs: number;
  last: SpeedResult | null;
  /** When it is due next (epoch ms); null when off. */
  nextAt: number | null;
  running: boolean;
  error?: string;
}

export interface BlockerData {
  /** `pihole` or `adguard`. */
  provider: string;
  /** "Pi-hole", "AdGuard Home". */
  name: string;
  /** `v6`, `v5`, AdGuard's version. */
  version?: string;
  queries: number;
  blocked: number;
  /** 0..100. */
  percent: number;
  /** Blocking on (true), paused (false), unknown (null). */
  enabled: boolean | null;
  /** Domains on the blocklists, if said. */
  domains?: number;
  /** What the counts cover: since midnight, the last 24 h, or the last days. */
  period: 'today' | '24h' | 'days';
  at: number;
  error?: string;
}

/** The connection, in a word. */
export type Status = 'starting' | 'ok' | 'slow' | 'lossy' | 'local' | 'offline';

export interface Episodes {
  /** First sample of the current run with every internet target lost; null while one answers. */
  downSince: number | null;
  /** When the loss over the alert window went over the threshold; null when under. */
  lossSince: number | null;
  /** Lost share over the alert window (internet targets), 0..1. */
  lossNow: number | null;
}

export interface Thresholds {
  latencyWarnMs: number;
  latencyBadMs: number;
  /** 0..100. */
  lossWarnPct: number;
  lossAlertPct: number;
}

export interface AlertSettings {
  enabled: boolean;
  offlineAfterMs: number;
  lossForMs: number;
  ipChange: boolean;
}

export interface NetData {
  at: number;
  status: Status;
  targets: TargetData[];
  gateway: GatewayData | null;
  wifi: WifiData | null;
  /** Undefined: turned off in the options. Null: not known yet. */
  publicIp?: PublicIpData | null;
  speed: SpeedData;
  /** Undefined: no blocker configured. */
  blocker?: BlockerData | null;
  episodes: Episodes;
  thresholds: Thresholds;
  alerts: AlertSettings;
  /** The source's sampling interval and stats window, ms. */
  intervalMs: number;
  windowMs: number;
  historyMs: number;
  /** Shown instead of the data when it came from `demo`. */
  demo?: boolean;
}
