import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureText } from './fixtures.ts';
import { findGateway, parseIpJson, parseIpText, parseMacRoute, parsePowerShellRoute, parseProcRoute, parseWindowsRoute } from './gateway.ts';
import type { Run } from './ping.ts';

// Saved on a Linux machine with both cable (metric 100) and Wi-Fi (metric 600).
const WIRED = { ip: '192.168.50.1', iface: 'enp89s0', metric: 100 };

test('Linux: ip -j, ip text and /proc/net/route agree, lowest metric wins', () => {
  assert.deepEqual(parseIpJson(fixtureText('gateway-linux-ip.json')), WIRED);
  assert.deepEqual(parseIpText(fixtureText('gateway-linux-ip.txt')), WIRED);
  assert.deepEqual(parseProcRoute(fixtureText('gateway-linux-proc-route.txt')), WIRED);
  assert.equal(parseIpJson('[]'), null);
  assert.equal(parseIpText(''), null);
});

test('macOS: route -n get default', () => {
  assert.deepEqual(parseMacRoute(fixtureText('gateway-macos-route.txt')), { ip: '192.168.1.1', iface: 'en0', metric: 0 });
  assert.equal(parseMacRoute(fixtureText('gateway-macos-none.txt')), null);
});

test('Windows: route print in English and German, PowerShell', () => {
  assert.deepEqual(parseWindowsRoute(fixtureText('gateway-windows-route-en.txt')), { ip: '10.0.0.1', iface: '10.0.0.5', metric: 25 });
  assert.deepEqual(parseWindowsRoute(fixtureText('gateway-windows-route-de.txt')), { ip: '192.168.178.1', iface: '192.168.178.23', metric: 50 });
  assert.deepEqual(parsePowerShellRoute(fixtureText('gateway-windows-powershell.json')), { ip: '10.0.0.1', iface: 'Ethernet', metric: 25 });
  assert.deepEqual(parsePowerShellRoute('{"NextHop":"192.168.1.1","InterfaceAlias":"Wi-Fi","RouteMetric":0,"InterfaceMetric":35}')?.ip, '192.168.1.1');
});

test('findGateway falls back: no ip command → /proc/net/route', async () => {
  const run: Run = async () => {
    throw Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  };
  const r = await findGateway(run, 'linux', { timeoutMs: 1000, readProc: async () => fixtureText('gateway-linux-proc-route.txt') });
  assert.deepEqual(r, WIRED);
  const win: Run = async (cmd) => ({ stdout: cmd === 'route' ? '' : fixtureText('gateway-windows-powershell.json'), stderr: '', code: 0 });
  assert.equal((await findGateway(win, 'win32', { timeoutMs: 1000 }))?.iface, 'Ethernet');
});
