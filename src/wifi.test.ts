import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureText } from './fixtures.ts';
import type { Run } from './ping.ts';
import { channelOf, parseAirport, parseIwDev, parseIwLink, parseNetsh, parseNmcli, parseSystemProfiler, pctOfDbm, readWifi } from './wifi.ts';

test('Linux iw: saved on this machine (2.4 GHz, channel 12, -45 dBm)', () => {
  const devs = parseIwDev(fixtureText('wifi-linux-iw-dev.txt'));
  assert.deepEqual(devs, [{ iface: 'wlp88s0', widthMhz: 20 }]);
  const w = parseIwLink(fixtureText('wifi-linux-iw-link.txt'), 'wlp88s0', 20)!;
  assert.equal(w.ssid, 'HomeNet');
  assert.equal(w.signalDbm, -45);
  assert.equal(w.signalPct, 100);
  assert.equal(w.freqMhz, 2467);
  assert.equal(w.channel, 12);
  assert.equal(w.band, '2.4');
  assert.equal(w.widthMhz, 20);
  assert.equal(w.rxMbps, 286.7);
  assert.equal(w.txMbps, 243.7);
  assert.equal(parseIwLink('Not connected.\n', 'wlan0'), null);
  assert.equal(parseIwLink('Connected to 02:00:00:00:00:01 (on wlan0)\n\tSSID: Caf\\xc3\\xa9\n\tfreq: 5180\n', 'wlan0')!.ssid, 'Café');
});

test('Linux nmcli (C locale): the line in use', () => {
  const w = parseNmcli(fixtureText('wifi-linux-nmcli.txt'))!;
  assert.equal(w.ssid, 'HomeNet');
  assert.equal(w.signalPct, 75);
  assert.equal(w.channel, 12);
  assert.equal(w.iface, 'wlp88s0');
  assert.equal(w.signalDbm, null);
  assert.equal(parseNmcli(':Other:6:2437 MHz:54 Mbit/s:40:wlan0\n'), null);
  assert.equal(parseNmcli('*:My\\:Net:36:5180 MHz:866 Mbit/s:80:wlan0\n')!.ssid, 'My:Net');
});

test('macOS airport -I and system_profiler, including a redacted SSID and Wi-Fi off', () => {
  const a = parseAirport(fixtureText('wifi-macos-airport.txt'))!;
  assert.deepEqual([a.ssid, a.signalDbm, a.channel, a.band, a.widthMhz, a.txMbps, a.freqMhz], ['HomeNet', -58, 36, '5', 80, 866, 5180]);
  assert.equal(parseAirport(fixtureText('wifi-macos-airport-off.txt')), null);
  const s = parseSystemProfiler(fixtureText('wifi-macos-system-profiler.json'))!;
  assert.deepEqual([s.iface, s.ssid, s.signalDbm, s.channel, s.band, s.widthMhz, s.txMbps], ['en0', 'HomeNet', -61, 149, '5', 80, 780]);
  const r = parseSystemProfiler(fixtureText('wifi-macos-system-profiler-redacted.json'))!;
  assert.deepEqual([r.ssid, r.channel, r.band, r.signalDbm], [null, 6, '2.4', -70]);
  assert.equal(parseSystemProfiler(fixtureText('wifi-macos-system-profiler-off.json')), null);
});

test('Windows netsh in English, German and Spanish (console code page) and Chinese', () => {
  const en = parseNetsh(fixtureText('wifi-windows-en.txt'))!;
  assert.deepEqual([en.ssid, en.signalPct, en.channel, en.band, en.rxMbps, en.txMbps, en.iface], ['HomeNet', 88, 44, '5', 1201, 960.8, 'Wi-Fi']);
  const de = parseNetsh(fixtureText('wifi-windows-de-cp1252.txt'))!;
  assert.deepEqual([de.ssid, de.signalPct, de.channel, de.band, de.rxMbps, de.txMbps], ['FRITZ!Box 7590', 72, 6, '2.4', 144.4, 130]);
  const es = parseNetsh(fixtureText('wifi-windows-es-cp1252.txt'))!;
  assert.deepEqual([es.ssid, es.signalPct, es.channel, es.band, es.rxMbps], ['MOVISTAR_1234', 64, 100, '5', 433.3]);
  const zh = parseNetsh(fixtureText('wifi-windows-zh-hans.txt'))!;
  assert.deepEqual([zh.ssid, zh.signalPct, zh.channel, zh.band, zh.rxMbps], ['家里的网', 96, 149, '5', 1201]);
  assert.equal(parseNetsh(fixtureText('wifi-windows-disconnected-en.txt')), null);
  assert.equal(parseNetsh(fixtureText('wifi-windows-nowlan.txt')), null);
});

test('channels and signal', () => {
  assert.equal(channelOf(2412), 1);
  assert.equal(channelOf(5180), 36);
  assert.equal(channelOf(5975), 5);
  assert.equal(pctOfDbm(-75), 50);
});

test('readWifi on Linux: iw first; marked primary when the default route uses it; null on a wired machine', async () => {
  const run: Run = async (_cmd, args) => ({ stdout: args.length === 1 ? fixtureText('wifi-linux-iw-dev.txt') : fixtureText('wifi-linux-iw-link.txt'), stderr: '', code: 0 });
  assert.equal((await readWifi(run, 'linux', { timeoutMs: 1000, gatewayIface: 'enp89s0' }))!.primary, false);
  assert.equal((await readWifi(run, 'linux', { timeoutMs: 1000, gatewayIface: 'wlp88s0' }))!.primary, true);
  const wired: Run = async (_cmd, args) => ({ stdout: args.length === 1 ? 'phy#0\n' : '', stderr: '', code: 0 });
  assert.equal(await readWifi(wired, 'linux', { timeoutMs: 1000 }), null);
  const noIw: Run = async (cmd) => {
    if (cmd === 'iw') throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
    return { stdout: fixtureText('wifi-linux-nmcli.txt'), stderr: '', code: 0 };
  };
  assert.equal((await readWifi(noIw, 'linux', { timeoutMs: 1000 }))!.signalPct, 75);
});
