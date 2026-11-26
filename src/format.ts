/** Numbers written the way the panel's language writes them, with Intl. */

const cache = new Map<string, Intl.NumberFormat>();

function nf(locale: string, o: Intl.NumberFormatOptions): Intl.NumberFormat {
  const key = `${locale}|${JSON.stringify(o)}`;
  let f = cache.get(key);
  if (!f) {
    try {
      f = new Intl.NumberFormat(locale, o);
    } catch {
      f = new Intl.NumberFormat('en', o);
    }
    cache.set(key, f);
  }
  return f;
}

/** Milliseconds: one decimal under 10 ("8,9"), whole above ("14"). */
export function msText(locale: string, ms: number): string {
  return nf(locale, { maximumFractionDigits: ms < 10 ? 1 : 0, minimumFractionDigits: ms < 10 ? 1 : 0 }).format(ms);
}

export const msWithUnit = (locale: string, ms: number): string => `${msText(locale, ms)} ms`;

/** A share 0..1 as a percentage: "0 %", "3,4 %", "33 %" (one decimal between 0 and 10 %). */
export function pctText(locale: string, v: number): string {
  const digits = v > 0 && v < 0.1 ? 1 : 0;
  return nf(locale, { style: 'percent', maximumFractionDigits: digits, minimumFractionDigits: 0 }).format(v);
}

/** Mbit/s: whole from 100 on, one decimal under. */
export function mbpsText(locale: string, v: number): string {
  return nf(locale, { maximumFractionDigits: v >= 100 ? 0 : 1 }).format(v);
}

export const MBPS = 'Mbit/s';

export function intText(locale: string, n: number): string {
  return nf(locale, { maximumFractionDigits: 0 }).format(n);
}

/** "29K", "2,9 mil", "2.9万": for a tight spot. */
export function compactText(locale: string, n: number): string {
  return nf(locale, { notation: 'compact', maximumFractionDigits: 1 }).format(n);
}

/** dBm with a real minus sign. */
export const dbmText = (dbm: number): string => `${dbm < 0 ? '−' : ''}${Math.abs(Math.round(dbm))} dBm`;

/** "5 GHz", "2,4 GHz". */
export function bandText(locale: string, band: string): string {
  return `${nf(locale, { maximumFractionDigits: 1 }).format(Number(band))} GHz`;
}
