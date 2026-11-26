## Targets

One per line in the source's `targets` option (up to 8):

| Written | Probed |
|---|---|
| `gateway` | Your default gateway (the router), found per system: `ip route` (or `/proc/net/route`) on Linux, `route -n get default` on macOS, `route print` (or PowerShell's `Get-NetRoute`) on Windows. |
| `1.1.1.1`, `example.com` | `ping`; a TCP connection to port 443 if `ping` can't be used. |
| `example.com:8443`, `[2606:4700::1111]:443` | Always a TCP connection to that port. |
| `NAS=192.168.1.10` | The same, with the name to show. |

The default is `gateway`, `1.1.1.1` (Cloudflare) and `8.8.8.8` (Google).
Every read (every 5 s, Settings → Data sources) sends 3 probes to each
target at once; latency is the median over the last minute, jitter the
mean difference between consecutive replies, loss the share without a
reply. The graph keeps the last 10 minutes in memory (nothing is written
to disk but the public IP and the last speed test).

## How it measures, per system

- **ICMP without privileges.** The plugin runs the system's own `ping`,
  never raw sockets of its own: on Linux that's iputils' `ping`, which
  uses unprivileged ICMP sockets (`net.ipv4.ping_group_range`) or its file
  capability; on macOS and Windows `ping` needs nothing. Its output is
  read the same way in every language (a reply is a line with `ttl=` and
  a time; `Zeit=8,9 ms`, `tiempo=14ms`, `时间<1ms` all work) and with the
  C locale where the system allows.
- **TCP when ping can't be used**: a container without `ping`, a sandbox
  without ICMP. The time to open a connection to port 443 (the router's
  80) is one round trip plus a little; a refused connection counts as an
  answer. Set `method` to `tcp` to always do this.
- **Windows and macOS measure differently.** Windows' `ping` sends one
  probe a second and rounds to whole milliseconds (`<1ms` is shown as
  0.5 ms), so a sample takes longer and jitter on the router reads coarse.
  macOS and Linux send a probe every 0.2 s with sub-millisecond times.
  Since macOS 14.4 the Wi-Fi name may come as `<redacted>` without
  location permission: the rest of the Wi-Fi line still shows.
- **Wi-Fi**: `iw` (signal in dBm) or `nmcli` (signal in %) on Linux,
  `airport -I` up to macOS 14.3 and `system_profiler SPAirPortDataType`
  after it, `netsh wlan show interfaces` on Windows (translated: only its
  `SSID`, values with `%`, `GHz` or a rate unit, and the channel's name in
  the common languages are trusted). On a wired machine the line shows the
  interface instead (the `now` widget's `wifi` option: automatic, always,
  never).

## What it sends, and to whom

| What | Where | When | Off by default? |
|---|---|---|---|
| Ping (ICMP or TCP :443) | the targets: by default your router, `1.1.1.1`, `8.8.8.8` | every 5 s | no: it's the plugin |
| Public IP | `https://1.1.1.1/cdn-cgi/trace` (Cloudflare) | every 15 min and when the connection comes back | no, see below |
| Public IP, fallback | `api.ipify.org`, `ipv4.icanhazip.com` | only with `publicIp: any`, when Cloudflare fails | yes |
| Speed test | `speed.cloudflare.com` | every 6, 12 or 24 h | **yes** |
| DNS blocker | the Pi-hole or AdGuard Home address you type | every minute | yes (nothing set) |

**Why the public IP is on by default.** The default targets already ping
Cloudflare's 1.1.1.1 every few seconds, so Cloudflare already sees your
address; asking its trace page tells nobody anything new, and it is
reached by address, so it works even with DNS broken. The other services
(ipify, icanhazip) are new third parties and are only asked if you choose
`any`; `off` asks nobody. Every request carries a User-Agent naming the
plugin and Kiosko, never you.

## The speed test

Off by default: every test spends data. When on (`speedTest`: every 6, 12
or 24 hours), it uses **Cloudflare's speed test endpoints**, the same ones
[speed.cloudflare.com](https://speed.cloudflare.com) uses, with no program
to install:

- latency: six empty downloads (`/__down?bytes=0`), the first only to open
  the connection; the median time to the answer less the time the server
  says it took (`Server-Timing`);
- download: one file of `speedTestMb` (10 MB by default), timed from its
  first byte to its last;
- upload: half that size sent to `/__up`, timed whole, less the latency.

Each test moves 1.5 × `speedTestMb`: **15 MB** by default, so every 6 hours
is about 60 MB a day, 1.8 GB a month. Above ~300 Mbit/s a 10 MB download is
over in a fraction of a second and reads low: raise `speedTestMb` (25 or
50) if your line is that fast and the data doesn't matter. It never runs
while offline, never in the first minutes after Kiosko starts, waits half
an hour after a failed try, and the last result is kept on disk, so a
restart doesn't run it again. A single TCP stream measures less than
multi-stream tools (Ookla's Speedtest, librespeed) on very fast lines:
read it as "is my line as usual", not as a certificate.

## Pi-hole and AdGuard Home

In the source's options: `blocker` (`pihole` or `adguard`), `blockerUrl`
(the address of its web page, `http://pi.hole`), and the credentials, kept
as secrets:

- **Pi-hole v6**: an *app password* (Settings → Web interface / API →
  Configure app password) or the web password. The plugin logs in once
  (`POST /api/auth`), keeps the session until it expires (Pi-hole allows
  only a few), and reads `/api/stats/summary` (the last 24 hours) and
  `/api/dns/blocking` (whether blocking is paused).
- **Pi-hole v5**: the API token (Settings → API → Show API token), sent to
  `/admin/api.php?summaryRaw` (counts since midnight). A v5 is recognised
  by having no `/api`.
- **AdGuard Home**: its user and password (HTTP Basic, as its own API
  expects: use HTTPS if it's not on your LAN), `/control/stats` (its
  statistics period, 24 h by default) and `/control/status`. Blocked
  counts what it filtered plus what Safe Browsing, parental control and
  safe search replaced.

## Alerts

On by default (`alerts`), full-screen:

- **No internet connection** (critical): no internet target answers for
  30 s (`offlineAfterMs`). It says whether the router still answers (the
  problem is outside: the line, the provider) or not (the Wi-Fi, the
  cable, the router), and since when. One per outage.
- **High packet loss** (warning): over 20 % (`lossAlertPct`) of the probes
  to the internet targets lost over the last minute (`lossForMs`), while
  something still answers. Ends when the loss falls under half that. Not
  raised for the minute after an outage.
- **New public IP** (info, ten minutes): off by default (`alertIpChange`).

Latency shows in amber from 80 ms and red from 200 ms (`latencyWarnMs`,
`latencyBadMs`); loss in amber from 2 % and red from the alert threshold.
