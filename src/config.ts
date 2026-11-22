export const THROW_GRAVITY = 13.5;
export const GRENADE_LAUNCH_SPEED = 15.2;
export const SMOKE_LAUNCH_SPEED = 15.5;

export const MAX_CORPSES = 20;
/** Seconds of physics before a corpse pose is frozen (saves CPU). */
export const CORPSE_SETTLE_TIME = 7.0;

export const REGEN_DELAY = 5.0; // seconds without taking damage
export const REGEN_RATE = 40; // hp per second once it kicks in

export const STANCE_CLIP_SPEED = { Walk: 1.85, Run: 5.0, CrouchWalk: 1.3 } as const;
/** Metres the hips drop at full crouch. */
export const STANCE_CROUCH_DROP = 0.42;
export const CROUCH_BLEND_RATE = 7.5;

export const DEFAULT_RELAY = 'wss://strikeforce-relay.proxy-roblox.workers.dev';
export const SOLDIER_GLB_URL = 'https://threejs.org/examples/models/gltf/Soldier.glb';
