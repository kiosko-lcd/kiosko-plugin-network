/**
 * A DNS blocker: where the "blocked today" numbers come from. Each is a
 * module here (Pi-hole, AdGuard Home), listed in `blockers/index.ts`; the
 * source asks the one chosen in its options, every minute or so.
 */
import type { HttpClient, Localized } from '@kiosko/sdk';
import type { BlockerData } from '../types.ts';

export interface BlockerOptions {
  url: string;
  /** Pi-hole: the web password or an app password (v6), the API token (v5). AdGuard Home: the password. */
  password: string;
  /** AdGuard Home: the user name. */
  user: string;
}

export interface BlockerProvider {
  id: string;
  name: string;
  label: Localized;
  read(o: BlockerOptions, ctx: { http: HttpClient; now: number; signal?: AbortSignal }): Promise<BlockerData>;
}

/** `http://pi.hole/admin/` → `http://pi.hole`: the user may paste the address of the admin page. */
export function baseUrl(url: string): string {
  let u = url.trim();
  if (!/^https?:\/\//i.test(u)) u = `http://${u}`;
  return u.replace(/\/+$/, '').replace(/\/admin$/i, '').replace(/\/+$/, '');
}

export const pct = (part: number, whole: number): number => (whole > 0 ? Math.round((part / whole) * 1000) / 10 : 0);
