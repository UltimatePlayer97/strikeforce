import type { NavProfile, NavProfileId } from './types';

/** Agent dimensions. `soldier` matches the bot collision cylinder (radius 0.42, height 1.8). */
export const NAV_PROFILES: Record<NavProfileId, NavProfile> = {
  soldier: { id: 'soldier', radius: 0.42, height: 1.8, climb: 0.25, maxSlopeDeg: 50 },
  heavy: { id: 'heavy', radius: 0.9, height: 2.3, climb: 0.25, maxSlopeDeg: 40 },
};
