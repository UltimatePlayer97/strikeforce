# STRIKEFORCE 6v6

Vite + TypeScript (strict) port of the single-file `index.html` build. Behaviour, visuals and tuning values are unchanged.

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # typecheck + production bundle in dist/
```

## Models

Drop optional assets in `public/models/` (served from `/models/`):

| File | Used for |
| --- | --- |
| `model.obj` + `model.mtl` (+ textures) | M4A1 custom (ASSAULT) |
| `mp5_submachine_gun__low_poly_game_ready_3d.glb` | SMG |
| `awp.glb` | SNIPER |

Missing files are fine: ASSAULT falls back to the embedded copy (`src/assets/m4a1-embedded.json`), SMG/SNIPER fall back to the procedural models.

## Layout

```
src/
  main.ts             bootstrap + init order
  config.ts           tuning constants
  types.ts            shared interfaces
  core/renderer.ts    renderer, scene, camera, lights
  world/
    def/              typed map definition format, pure compiler (visual | collision | nav), validation, 5 map data files
    def/maps/nav/     baked navigation data (generated; `npm run nav:bake`)
    nav/              Recast: bake, NavWorld (queries, crowd, dynamic obstacles, off-mesh), worker, debug overlay
    mapLoader.ts      the single MapLoader; visualBuilder.ts (instancing + disposal); spatialGrid.ts / collisionWorld.ts
  physics/ragdoll.ts  Verlet ragdoll
  rig/                soldier template (GLB + procedural), rig, crouch/stance IK
  weapons/            defs, model import/presets, first-person viewmodel
  combat/             hitscan, throwables, destructibles, tracers/corpses
  ai/bots.ts          bot brains
  game/               state, soldiers, spawns, damage, match, player controller, loop
  net/net.ts          relay + WebRTC mesh (NetClient)
  input/controls.ts   keyboard/mouse
  ui/                 hud, radar, scoreboard, lobby, menu, feedback
  audio/SoundFX.ts    procedural Web Audio
```

Former top-level `let` globals (`humanPlayer`, `isADS`, `currentMapId`, ...) live on the `game` object in `src/game/state.ts`.


## Maps and navigation

- A map is data: `src/world/def/maps/<id>.ts` (pieces, spawns, tactical waypoints, off-mesh links). Register it in `maps/index.ts`.
- After changing map geometry run `npm run nav:bake`. `npm run build` runs `nav:check` and fails on stale baked data.
  At runtime stale/missing data is regenerated in a Web Worker (bots use direct steering until it finishes).
- `npm test` runs map-fidelity, navigation and headless bot-simulation tests.
- In game press **F3** (or open with `?navdebug`) for navmesh + bot route overlay; `window.__nav.stats()` for counters.
