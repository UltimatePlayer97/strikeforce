/// <reference lib="webworker" />
import { init } from '@recast-navigation/core';
import { compileMap } from '../def/compile';
import type { MapDefinition, NavProfileId } from '../def/types';
import { bakeNav } from './bake';

export interface NavWorkerRequest {
  requestId: number;
  def: MapDefinition;
  profile: NavProfileId;
}
export type NavWorkerResponse =
  | { requestId: number; ok: true; profile: NavProfileId; hash: string; version: number; data: Uint8Array; ms: number }
  | { requestId: number; ok: false; error: string };

let ready: Promise<void> | null = null;

self.onmessage = async (ev: MessageEvent<NavWorkerRequest>) => {
  const { requestId, def, profile } = ev.data;
  try {
    ready ??= init();
    await ready;
    const baked = bakeNav(compileMap(def), profile);
    const msg: NavWorkerResponse = {
      requestId,
      ok: true,
      profile,
      hash: baked.hash,
      version: baked.version,
      data: baked.data,
      ms: baked.stats.ms,
    };
    (self as unknown as Worker).postMessage(msg, [baked.data.buffer]);
  } catch (e) {
    const msg: NavWorkerResponse = { requestId, ok: false, error: e instanceof Error ? e.message : String(e) };
    (self as unknown as Worker).postMessage(msg);
  }
};
