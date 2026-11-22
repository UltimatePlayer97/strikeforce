import type { MapId } from '../../../types';
import type { MapDefinition } from '../types';
import { blasttownMap } from './blasttown';
import { compoundMap } from './compound';
import { downtownMap } from './downtown';
import { shipmentMap } from './shipment';
import { shoothouseMap } from './shoothouse';

/** Registry of every shipped map. Adding a map = add a data file here. */
export const MAP_DEFINITIONS: Record<MapId, MapDefinition> = {
  compound: compoundMap,
  shipment: shipmentMap,
  shoothouse: shoothouseMap,
  blasttown: blasttownMap,
  downtown: downtownMap,
};
