/** Every DNS blocker the plugin knows. Add a new one here (and its label in the source's options). */
import { adguard } from './adguard.ts';
import { pihole } from './pihole.ts';
import type { BlockerProvider } from './provider.ts';

export const BLOCKERS = { pihole, adguard } satisfies Record<string, BlockerProvider>;
export type BlockerId = keyof typeof BLOCKERS;
export const BLOCKER_IDS = Object.keys(BLOCKERS) as BlockerId[];
