import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCanvas } from '@napi-rs/canvas';
import * as kit from '@loksly/lcd-canvas-kit';
import { THEMES, createBaseContext, defaultsOf, type WidgetDefinition } from '@kiosko/sdk';
import { renderWidget } from '@kiosko/sdk/testing';
import { MIN_PX, SOURCE } from './common.ts';
import { demoData } from './demo.ts';
import type { NetData } from './types.ts';
import { blocker } from './widget-blocker.ts';
import { latency, niceCeil, seriesOf } from './widget-latency.ts';
import { now } from './widget-now.ts';
import { speed } from './widget-speed.ts';

const NOW = Date.parse('2026-11-26T21:10:00+01:00');
const SIZES = [{ w: 172, h: 320 }, { w: 240, h: 70 }, { w: 320, h: 200 }, { w: 480, h: 240 }, { w: 800, h: 160 }, { w: 1920, h: 140 }, { w: 200, h: 36 }, { w: 320, h: 480 }];
const LOCALES = ['en', 'es', 'zh-Hant'];
const WIDGETS = [now, latency, speed, blocker] as WidgetDefinition<any, any>[];

/** The demo, and the states that paint differently: offline, no Wi-Fi, speed test off, blocker paused or missing. */
function variants(): [string, NetData][] {
  const d = demoData(NOW);
  const down = structuredClone(d);
  for (const t of down.targets) {
    if (t.gateway) continue;
    t.samples = t.samples.map((s, i) => (i > t.samples.length - 8 ? { ...s, rtts: [] } : s));
    t.last = null;
    t.loss = 0.4;
  }
  down.status = 'local';
  const wired = { ...structuredClone(d), wifi: null, gateway: { ip: '192.168.1.1', iface: 'enp3s0', wifi: false }, speed: { enabled: false, everyMs: 0, last: null, nextAt: null, running: false } };
  const paused = { ...structuredClone(d), blocker: { ...d.blocker!, enabled: false }, publicIp: undefined };
  const none = { ...structuredClone(d), blocker: undefined, speed: { ...d.speed, last: null, running: true } };
  const lonely = { ...structuredClone(d), targets: d.targets.slice(1, 2) };
  return [['demo', d], ['down', down], ['wired', wired], ['paused', paused], ['none', none], ['one target', lonely]];
}

test('every widget paints at 8 sizes × 3 languages, in every state, without throwing or spilling', () => {
  for (const w of WIDGETS)
    for (const [name, data] of variants())
      for (const size of SIZES)
        for (const locale of LOCALES) {
          const r = renderWidget(w, { size, locale, now: NOW, sources: { [SOURCE]: data } });
          const where = `${w.id} ${name} ${size.w}x${size.h} ${locale}`;
          assert.equal(r.error, undefined, where);
          assert.equal(r.outside, 0, where);
          if (w !== latency) assert.ok(r.texts.length > 0, `${where} paints text`);
        }
});

/** Paints a widget and returns every text drawn, with its size. */
function sizesOf(w: WidgetDefinition<any, any>, data: NetData, size: { w: number; h: number }, locale: string) {
  const texts: { text: string; size: number }[] = [];
  const spy = { ...kit, drawTracked: (g: never, text: string, x: number, y: number, o: { size: number }) => (texts.push({ text, size: o.size }), kit.drawTracked(g, text, x, y, o as never)) };
  const g = createCanvas(size.w, size.h).getContext('2d');
  const theme = THEMES[0]!;
  w.render(g as never, { ...createBaseContext({ now: NOW, locale }), options: w.options ? defaultsOf(w.options as never) : {}, data: undefined, sources: { [SOURCE]: data }, working: true, box: { x: 0, y: 0, w: size.w, h: size.h }, theme, fonts: theme.fonts, kit: spy, canvas: { createCanvas }, preview: false } as never);
  return texts;
}

test('nothing under 11 px, in every language, size and state', () => {
  for (const w of WIDGETS)
    for (const [name, data] of variants())
      for (const size of SIZES)
        for (const locale of LOCALES) {
          const small = sizesOf(w, data, size, locale).filter((x) => x.size < MIN_PX);
          assert.deepEqual(small, [], `${w.id} ${name} ${size.w}x${size.h} ${locale}`);
        }
});

test('now: the state, the targets with their numbers, the Wi-Fi and the IP, in Spanish', () => {
  const r = renderWidget(now, { size: { w: 320, h: 200 }, locale: 'es', now: NOW });
  const all = r.texts.join(' | ');
  assert.ok(r.texts.includes('Conectado'), all);
  assert.ok(r.texts.includes('Router') && r.texts.includes('Cloudflare') && r.texts.includes('Google'), all);
  assert.ok(r.texts.some((t) => /^HomeNet · −58 dBm · 5 GHz/.test(t)), all);
  assert.ok(r.texts.some((t) => /^IP 203\.0\.113\.42 · ES · cambió hace 3 h/.test(t)), all);
  // Decimal comma in Spanish, point in English.
  assert.ok(r.texts.some((t) => /^\d,\d$/.test(t)), all);
  const en = renderWidget(now, { size: { w: 320, h: 200 }, locale: 'en', now: NOW });
  assert.ok(en.texts.some((t) => /^\d\.\d$/.test(t)), en.texts.join(' | '));
});

test('now: offline in red words, and no Wi-Fi line on a cable machine (the interface instead)', () => {
  const v = variants();
  const wired = v.find(([n]) => n === 'wired')![1];
  const down = v.find(([n]) => n === 'down')![1];
  const r = renderWidget(now, { size: { w: 320, h: 200 }, locale: 'en', now: NOW, sources: { [SOURCE]: down } });
  assert.ok(r.texts.includes('No internet'), r.texts.join(' | '));
  assert.ok(r.texts.filter((t) => t === '—').length >= 2);
  const w = renderWidget(now, { size: { w: 320, h: 200 }, locale: 'en', now: NOW, sources: { [SOURCE]: wired } });
  assert.ok(!w.texts.some((t) => t.includes('HomeNet')));
  assert.ok(w.texts.includes('Cable · enp3s0'), w.texts.join(' | '));
});

test('latency: a legend with every target; one target alone as bars', () => {
  const r = renderWidget(latency, { size: { w: 480, h: 240 }, locale: 'en', now: NOW });
  for (const n of ['Router', 'Cloudflare', 'Google']) assert.ok(r.texts.includes(n), r.texts.join(' | '));
  assert.ok(r.texts.includes('last 10 min'));
  assert.equal(seriesOf(demoData(NOW), 'google').length, 1);
  assert.equal(seriesOf(demoData(NOW), 'gateway')[0]!.gateway, true);
  assert.equal(seriesOf(demoData(NOW), '').length, 3);
  const one = renderWidget(latency, { size: { w: 480, h: 240 }, locale: 'en', now: NOW, options: { target: 'Cloudflare' } });
  assert.equal(one.error, undefined);
  assert.deepEqual([niceCeil(9), niceCeil(11), niceCeil(55), niceCeil(260)], [10, 15, 60, 300]);
});

test('latency: a young history spans only what has been sampled', () => {
  const d = demoData(NOW);
  for (const t of d.targets) t.samples = t.samples.slice(-36);
  const r = renderWidget(latency, { size: { w: 480, h: 240 }, locale: 'en', now: NOW, sources: { [SOURCE]: d } });
  assert.ok(r.texts.includes('last 3 min'), r.texts.join(' | '));
});

test('speed: down and up in Mbit/s; a message while it is off', () => {
  const r = renderWidget(speed, { size: { w: 320, h: 200 }, locale: 'es', now: NOW });
  assert.ok(r.texts.includes('541') && r.texts.includes('48,2'), r.texts.join(' | '));
  const off = renderWidget(speed, { size: { w: 320, h: 200 }, locale: 'es', now: NOW, sources: { [SOURCE]: variants().find(([n]) => n === 'wired')![1] } });
  assert.deepEqual(off.texts, ['Test de velocidad desactivado', 'Actívalo en Ajustes → Fuentes de datos']);
});

test('blocker: the share, the counts with Intl, paused in amber, and a message when not set up', () => {
  const r = renderWidget(blocker, { size: { w: 320, h: 200 }, locale: 'en', now: NOW });
  assert.ok(r.texts.includes('27.9%'), r.texts.join(' | '));
  assert.ok(r.texts.includes('8,139 blocked'), r.texts.join(' | '));
  const de = renderWidget(blocker, { size: { w: 320, h: 200 }, locale: 'de', now: NOW });
  assert.ok(de.texts.some((t) => /^27,9\s%$/.test(t)) && de.texts.includes('8.139 blockiert'), de.texts.join(' | '));
  const p = renderWidget(blocker, { size: { w: 320, h: 200 }, locale: 'es', now: NOW, sources: { [SOURCE]: variants().find(([n]) => n === 'paused')![1] } });
  assert.ok(p.texts.includes('Bloqueo en pausa'));
  const none = renderWidget(blocker, { size: { w: 320, h: 200 }, locale: 'en', now: NOW, sources: { [SOURCE]: variants().find(([n]) => n === 'none')![1] } });
  assert.equal(none.texts[0], 'No DNS blocker set up');
});

test('before any data: a waiting message', () => {
  for (const w of WIDGETS) {
    const r = renderWidget(w, { size: { w: 320, h: 200 }, locale: 'en', demo: false });
    assert.deepEqual(r.texts, ['Measuring the connection…']);
  }
});

test('empty: blocker not set up or only an error, speed test without a result, latency without samples; now never', () => {
  const st = (d: NetData | undefined, options: Record<string, unknown> = {}) => ({ options, data: undefined, sources: { [SOURCE]: d }, now: NOW, working: true }) as never;
  const v = Object.fromEntries(variants());
  for (const w of WIDGETS) {
    assert.equal(w.empty?.(st(v.demo)) ?? false, false, `${w.id} demo`);
    assert.equal(w.empty?.(st(undefined)) ?? false, false, `${w.id} loading`);
  }
  assert.equal(now.empty, undefined, 'the connection itself is always worth showing');
  assert.equal(blocker.empty!(st(v.none)), true, 'no blocker');
  assert.equal(blocker.empty!(st({ ...v.demo!, blocker: null })), true, 'blocker not read yet');
  assert.equal(blocker.empty!(st({ ...v.demo!, blocker: { ...v.demo!.blocker!, error: 'unauthorized', queries: null } as never })), true, 'blocker down');
  assert.equal(blocker.empty!(st(v.paused)), false, 'paused is worth seeing');
  assert.equal(speed.empty!(st(v.wired)), true, 'speed test off');
  assert.equal(speed.empty!(st(v.none)), true, 'first test running');
  const quiet = structuredClone(v.demo!);
  for (const t of quiet.targets) t.samples = [];
  assert.equal(latency.empty!(st(quiet)), true, 'no samples');
  assert.equal(latency.empty!(st(v.down)), false, 'losing packets is worth seeing');
  assert.equal(latency.empty!(st(v.demo, { target: 'nowhere' })), false, 'an unknown target falls back to all');
});
