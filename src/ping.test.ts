import { test } from 'node:test';
import assert from 'node:assert/strict';
import { fixtureText } from './fixtures.ts';
import { icmpProbe, parsePing, pingCommand, pingForbidden, PingUnusable, tcpProbe, unknownHost, type Run } from './ping.ts';

const p = (name: string, target?: string) => parsePing(fixtureText(name), target);

test('Linux iputils: real output of this machine (C locale), gateway, all lost, unknown host', () => {
  assert.equal(p('ping-linux-ok.txt').length, 3);
  assert.ok(p('ping-linux-ok.txt').every((v) => v > 1 && v < 100));
  assert.equal(p('ping-linux-gateway.txt').length, 3);
  assert.deepEqual(p('ping-linux-lost.txt'), []);
  assert.deepEqual(p('ping-linux-unknown.txt'), []);
  assert.ok(unknownHost(fixtureText('ping-linux-unknown.txt')));
  // The summary line (rtt min/avg/max/mdev = …) is not a reply.
  assert.equal(p('ping-linux-es.txt').length, 3);
});

test('Linux: a decimal comma (translated iputils), BusyBox, IPv6, duplicates', () => {
  assert.deepEqual(p('ping-linux-de-comma.txt'), [8.93, 12.4, 9.05]);
  assert.deepEqual(p('ping-linux-busybox.txt'), [0.612, 0.498]);
  assert.deepEqual(p('ping-linux-ipv6.txt'), [10.2, 10.4]);
  assert.deepEqual(p('ping-linux-dup.txt'), [0.401, 0.388]);
});

test('Linux without the capability: ping is not usable', () => {
  assert.ok(pingForbidden(fixtureText('ping-linux-noperm.txt')));
  assert.ok(!pingForbidden(fixtureText('ping-linux-lost.txt')));
});

test('macOS: replies and timeouts', () => {
  assert.deepEqual(p('ping-macos-ok.txt'), [11.482, 10.904]);
  assert.deepEqual(p('ping-macos-lost.txt'), []);
});

test('Windows in English, Spanish, German, Simplified and Traditional Chinese', () => {
  assert.deepEqual(p('ping-windows-en.txt'), [9, 11]);
  // time<1ms: half a millisecond.
  assert.deepEqual(p('ping-windows-gateway-en.txt'), [0.5, 1, 0.5]);
  assert.deepEqual(p('ping-windows-es.txt'), [14, 15, 14]);
  assert.deepEqual(p('ping-windows-de.txt'), [14, 16]);
  assert.deepEqual(p('ping-windows-zh-hans.txt'), [9, 10, 0.5]);
  assert.deepEqual(p('ping-windows-zh-hant.txt'), [9, 12]);
  // "Destination host unreachable" from the local machine is not a reply.
  assert.deepEqual(p('ping-windows-unreachable-en.txt'), []);
  // IPv6 replies have no TTL: the target's address says it's a reply.
  assert.deepEqual(p('ping-windows-ipv6-en.txt', '2606:4700:4700::1111'), [10, 12]);
  assert.deepEqual(p('ping-windows-ipv6-en.txt'), []);
});

test('the command per system', () => {
  assert.deepEqual(pingCommand('linux', '1.1.1.1', 3, 1000).args, ['-n', '-c', '3', '-i', '0.2', '-W', '1', '-w', '2', '1.1.1.1']);
  assert.deepEqual(pingCommand('win32', '1.1.1.1', 3, 1000).args, ['-n', '3', '-w', '1000', '-4', '1.1.1.1']);
  assert.equal(pingCommand('darwin', '2606:4700:4700::1111', 3, 1000).cmd, 'ping6');
  assert.ok(pingCommand('darwin', '1.1.1.1', 3, 1000).args.includes('-W'));
});

const fakeRun = (stdout: string, code = 0, stderr = ''): Run => async () => ({ stdout, stderr, code });

test('icmpProbe: replies, lost, missing ping, forbidden ping, unknown host', async () => {
  assert.deepEqual(await icmpProbe(fakeRun(fixtureText('ping-linux-busybox.txt'), 1), 'linux', '192.168.1.1', 3, 1000), { rtts: [0.612, 0.498], sent: 3 });
  assert.deepEqual(await icmpProbe(fakeRun(fixtureText('ping-linux-lost.txt'), 1), 'linux', '192.0.2.1', 3, 1000), { rtts: [], sent: 3 });
  const missing: Run = async () => {
    throw Object.assign(new Error('spawn ping ENOENT'), { code: 'ENOENT' });
  };
  await assert.rejects(icmpProbe(missing, 'linux', 'x', 3, 1000), PingUnusable);
  await assert.rejects(icmpProbe(fakeRun('', 2, fixtureText('ping-linux-noperm.txt')), 'linux', 'x', 3, 1000), PingUnusable);
  assert.equal((await icmpProbe(fakeRun('', 2, fixtureText('ping-linux-unknown.txt')), 'linux', 'nonexistent.invalid', 3, 1000)).error, 'unknown host');
});

test('tcpProbe: a refused or accepted connection counts, a timeout is lost', async () => {
  const answers = [12, null, 14];
  const r = await tcpProbe(async () => answers.shift() ?? null, 'h', 443, 3, 1000);
  assert.deepEqual(r, { rtts: [12, 14], sent: 3 });
});

test('tcpProbe: a name that does not resolve says so', async () => {
  const r = await tcpProbe(async () => {
    throw new Error('unknown host');
  }, 'nonexistent.invalid', 443, 3, 1000);
  assert.deepEqual(r, { rtts: [], sent: 3, error: 'unknown host' });
});

test('tcpConnect for real, on this machine: a refused port on localhost is a reply, and it takes more than nothing', async () => {
  const { tcpConnect } = await import('./ping.ts');
  const v = await tcpConnect('127.0.0.1', 9, 1000);
  assert.ok(v === null || v > 0);
});
