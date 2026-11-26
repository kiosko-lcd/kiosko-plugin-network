# Fixtures

What the parsers are tested against.

**Saved on a Linux machine** (Ubuntu, iputils 20250605, NetworkManager,
Intel AX Wi-Fi, cable and Wi-Fi both up), with the network name changed to
`HomeNet` and MAC addresses replaced by `02:00:00:aa:bb:cc`:
`ping-linux-ok.txt`, `ping-linux-gateway.txt`, `ping-linux-lost.txt`,
`ping-linux-unknown.txt`, `ping-linux-es.txt` (this iputils is built
without translations, so it is English too), `gateway-linux-ip.json`,
`gateway-linux-ip.txt`, `gateway-linux-proc-route.txt`,
`wifi-linux-iw-dev.txt`, `wifi-linux-iw-link.txt`, `wifi-linux-nmcli.txt`,
`wifi-linux-nmcli-dev.txt`.

**Written by hand** in the documented formats of each tool, for the
systems and languages there was no machine for: every `*-macos-*`,
`*-windows-*`, `ping-linux-de-comma.txt` (translated iputils with a
decimal comma), `ping-linux-busybox.txt`, `ping-linux-dup.txt`,
`ping-linux-ipv6.txt`, `ping-linux-noperm.txt`. The two
`wifi-windows-*-cp1252.txt` are in the console's code page (Latin-1
bytes), as `netsh` writes when its output isn't switched to UTF-8: their
accented keys arrive garbled and the parser must not care.

**API answers** of Pi-hole v6 (`/api/auth`, `/api/stats/summary`,
`/api/dns/blocking`), Pi-hole v5 (`/admin/api.php?summaryRaw`) and AdGuard
Home (`/control/stats`, `/control/status`), in the shape their APIs
document, with made-up numbers.

No public IP address of anyone appears here: the tests use the
documentation ranges (192.0.2.0/24, 203.0.113.0/24).
