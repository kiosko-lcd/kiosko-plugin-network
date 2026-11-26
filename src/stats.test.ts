import { test } from 'node:test';
import assert from 'node:assert/strict';
import { jitter, latencyLevel, loss, lossLevel, median, statusOf, summarize } from './stats.ts';
import type { TargetData, Thresholds } from './types.ts';

const T: Thresholds = { latencyWarnMs: 80, latencyBadMs: 200, lossWarnPct: 2, lossAlertPct: 20 };

test('median: odd, even, empty', () => {
  assert.equal(median([9, 1, 5]), 5);
  assert.equal(median([4, 1, 3, 2]), 2.5);
  assert.equal(median([]), null);
});

test('jitter: mean difference between consecutive replies, in order', () => {
  assert.equal(jitter([10, 12, 10, 20]), (2 + 2 + 10) / 3);
  assert.equal(jitter([10, 10, 10]), 0);
  assert.equal(jitter([10]), null);
  // In order, not sorted: a zig-zag has jitter, a ramp of the same values less.
  assert.ok(jitter([10, 30, 10, 30])! > jitter([10, 10, 30, 30])!);
});

test('loss: lost probes over sent, duplicates never count as more than sent', () => {
  assert.equal(loss([{ at: 1, rtts: [1, 2, 3], sent: 3 }, { at: 2, rtts: [], sent: 3 }]), 0.5);
  assert.equal(loss([{ at: 1, rtts: [1, 1, 1, 1], sent: 3 }]), 0);
  assert.equal(loss([]), null);
});

test('summarize: only the window counts, the latest sample is "last"', () => {
  const s = [
    { at: 0, rtts: [500], sent: 1 },
    { at: 50_000, rtts: [10, 12], sent: 3 },
    { at: 55_000, rtts: [14], sent: 1 },
  ];
  const r = summarize(s, 60_000, 30_000);
  assert.equal(r.last, 14);
  assert.equal(r.median, 12);
  assert.equal(r.loss, 0.25);
  assert.equal(r.jitter, 2);
});

test('levels by threshold', () => {
  assert.equal(latencyLevel(20, T), 'ok');
  assert.equal(latencyLevel(80, T), 'warn');
  assert.equal(latencyLevel(250, T), 'bad');
  assert.equal(latencyLevel(null, T), 'bad');
  assert.equal(lossLevel(0, T), 'ok');
  assert.equal(lossLevel(0.05, T), 'warn');
  assert.equal(lossLevel(0.2, T), 'bad');
});

const tg = (o: Partial<TargetData>): TargetData => ({ spec: 'x', label: 'x', host: 'x', gateway: false, method: 'icmp', last: 10, median: 10, jitter: 1, loss: 0, samples: [{ at: 1, rtts: [10], sent: 1 }], ...o });

test('status: ok, slow, lossy, local (router only), offline', () => {
  assert.equal(statusOf([tg({ gateway: true, last: 1, median: 1 }), tg({})], T), 'ok');
  assert.equal(statusOf([tg({ median: 120, last: 120 })], T), 'slow');
  assert.equal(statusOf([tg({ loss: 0.1 })], T), 'lossy');
  assert.equal(statusOf([tg({ gateway: true, last: 1 }), tg({ last: null })], T), 'local');
  assert.equal(statusOf([tg({ gateway: true, last: null }), tg({ last: null })], T), 'offline');
  assert.equal(statusOf([tg({ samples: [] })], T), 'starting');
  // One internet target is enough.
  assert.equal(statusOf([tg({ last: null }), tg({})], T), 'ok');
});
