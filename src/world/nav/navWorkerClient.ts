import type { MapDefinition, NavProfileId } from '../def/types';
import type { BakedNav } from './bake';
import type { NavWorkerRequest, NavWorkerResponse } from './navWorker';

/** Runs navmesh generation off the main thread. Used when no fresh baked data exists for a map. */
let worker: Worker | null = null;
let nextId = 1;
const pending = new Map<number, { resolve: (b: BakedNav) => void; reject: (e: Error) => void; mapId: string }>();

function ensureWorker(): Worker {
  if (worker) return worker;
  worker = new Worker(new URL('./navWorker.ts', import.meta.url), { type: 'module' });
  worker.onmessage = (ev: MessageEvent<NavWorkerResponse>) => {
    const msg = ev.data;
    const p = pending.get(msg.requestId);
    if (!p) return;
    pending.delete(msg.requestId);
    if (msg.ok) {
      p.resolve({
        mapId: p.mapId,
        profile: msg.profile,
        hash: msg.hash,
        version: msg.version,
        data: msg.data,
        stats: { triangles: 0, bytes: msg.data.length, ms: msg.ms },
      });
    } else p.reject(new Error(msg.error));
  };
  worker.onerror = (ev) => {
    for (const [id, p] of pending) {
      p.reject(new Error(`nav worker crashed: ${ev.message}`));
      pending.delete(id);
    }
    worker?.terminate();
    worker = null;
  };
  return worker;
}

export function bakeNavInWorker(def: MapDefinition, profile: NavProfileId): Promise<BakedNav> {
  const requestId = nextId++;
  return new Promise((resolve, reject) => {
    pending.set(requestId, { resolve, reject, mapId: def.id });
    const req: NavWorkerRequest = { requestId, def, profile };
    ensureWorker().postMessage(req);
  });
}
