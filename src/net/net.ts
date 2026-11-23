import * as THREE from 'three';
import { sfx } from '../audio/SoundFX';
import { damageDestructibleNearPoint } from '../combat/destructibles';
import { spawnBulletTracer, spawnImpactSparks } from '../combat/effects';
import { deploySmokeProjectile, explodeProjectile, spawnThrowerViewProjectile } from '../combat/throwables';
import { damageSoldier, eliminateSoldier } from '../game/damage';
import { setLocalPlayer } from '../game/localPlayer';
import { resetFullMatch, respawnSoldier } from '../game/match';
import { activeProjectiles, allSoldiers, game, matchState } from '../game/state';
import { applyRagdollToSoldierRig } from '../physics/ragdoll';
import { updateSoldierRigVisual } from '../rig/stance';
import type { ProjectileLike, Soldier, ThrowableType, Vec3Tuple } from '../types';
import { showHudToast } from '../ui/feedback';
import { renderNetUI, setNetStatus, updateNetBadge } from '../ui/lobby';
import { isWeaponId } from '../weapons/defs';
import { equipWeapon } from '../weapons/viewmodel';
import { MAP_DEFINITIONS } from '../world/def/maps';
import { loadMap, randomMapId } from '../world/mapLoader';

export interface RosterEntry {
  slot: number;
  name: string;
}

export interface RtcPeer {
  pc: RTCPeerConnection;
  slot: number;
  state: RTCDataChannel | null;
  events: RTCDataChannel | null;
  ready: boolean;
  pendingIce: RTCIceCandidate[];
}

/** One soldier's replicated movement state. */
type StateLike = Pick<NetMessage, 'id' | 'p' | 'y' | 'v' | 'h' | 'w' | 'c'>;

export interface NetStateEntry {
  id: number;
  p: Vec3Tuple;
  y: number;
  v: [number, number];
  h: number;
  w: string;
  c: number;
}

type SyncRow = [id: number, kills: number, deaths: number, alive: number];

/**
 * Wire message. Every packet has a type tag `t`; the remaining fields are
 * optional because each message type uses a different subset.
 */
export interface NetMessage {
  t: string;
  mid?: string;
  ts?: number;
  // signalling
  kind?: string;
  from?: number;
  to?: number;
  room?: string;
  description?: RTCSessionDescriptionInit;
  candidate?: RTCIceCandidateInit;
  // lobby
  slot?: number;
  host?: number;
  isHost?: boolean;
  roster?: RosterEntry[];
  // state ('s' single, 'b' batch of bot states)
  id?: number;
  p?: Vec3Tuple;
  y?: number;
  v?: [number, number] | Vec3Tuple | number;
  h?: number;
  w?: string | number;
  c?: number;
  a?: number | NetStateEntry[];
  // match sync ('m' / 'snap')
  b?: number;
  tr?: number;
  ro?: number;
  map?: string;
  s?: SyncRow[];
  // fire / throw / hit / kill
  o?: Vec3Tuple;
  e?: Vec3Tuple;
  q?: number;
  f?: number;
  k?: number | string;
  d?: number | Vec3Tuple;
  dir?: Vec3Tuple;
  hs?: number;
}

/**
 * Multiplayer net layer (Cloudflare Durable Object relay + WebRTC mesh).
 *  - Each human owns their own soldier (movement, aim, hitscan, hp).
 *  - Room host runs AI for every slot no human has claimed + match clock.
 *  - Hits: shooter -> relay -> victim owner applies damage -> owner broadcasts kill.
 */
export class NetClient {
  active = false;
  ws: WebSocket | null = null;
  slot = -1;
  hostSlot = -1;
  isHost = false;
  humans = new Set<number>();
  roster: RosterEntry[] = [];
  room = '';
  ping = 0;
  sendTimer = 0;
  syncTimer = 0;
  pingTimer = 0;
  badgeTimer = 0;
  peers = new Map<number, RtcPeer>();
  peerSequence = 0;
  seenMessages = new Set<string>();
  p2pReady = 0;

  owns(s: Soldier): boolean {
    const result = !this.active || Number(s.id) === this.slot || (this.isHost && !this.humans.has(Number(s.id)));
    console.log('[owns]', { soldierId: s.id, mySlot: this.slot, isHost: this.isHost, humans: [...this.humans], result });
    return result;
  }
  v3(v: THREE.Vector3): Vec3Tuple {
    return [+v.x.toFixed(2), +v.y.toFixed(2), +v.z.toFixed(2)];
  }
  send(o: NetMessage): void {
    console.log('[send] ENTER', o.t, { active: this.active, ws: !!this.ws, wsReady: this.ws?.readyState, slot: this.slot, isHost: this.isHost });
    if (!this.active || !this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    if (o.t === 'rtc' || o.t === 'ping' || o.t === 'pong') {
      this.ws.send(JSON.stringify(o));
      return;
    }
    const packet = Object.assign({}, o, { mid: `${this.slot}:${++this.peerSequence}` });
    const expected = Math.max(0, this.humans.size - 1);
    const ready = [...this.peers.values()].filter((p) => p.ready).length;
    const useWebRTC = expected > 0 && ready === expected;
    console.log('[send]', o.t, { slot: this.slot, useWebRTC, expected, ready, humans: this.humans.size, peers: this.peers.size, mid: packet.mid });
    if (useWebRTC) {
      const channelName = ['s', 'b'].includes(o.t) ? 'state' : 'events';
      for (const peer of this.peers.values()) {
        const channel = peer[channelName];
        if (channel && channel.readyState === 'open') {
          try {
            channel.send(JSON.stringify(packet));
          } catch {
            /* ignore */
          }
        }
      }
    } else {
      // Relay remains fallback until every room peer has a working P2P link.
      this.ws.send(JSON.stringify(packet));
    }
  }
  vec(a: Vec3Tuple): THREE.Vector3 {
    return new THREE.Vector3(a[0], a[1], a[2]);
  }
  okVec(a: unknown): a is Vec3Tuple {
    return Array.isArray(a) && a.length === 3 && a.every(v => Number.isFinite(Number(v)));
  }

  applyRoster(roster: RosterEntry[]): void {
    this.roster = roster;
    this.humans = new Set(roster.map((r) => r.slot));
    for (const s of allSoldiers) {
      const r = roster.find((x) => x.slot === s.id);
      s.name = r
        ? String(r.name)
            .replace(/[^\w \-]/g, '')
            .slice(0, 14) || s.defName
        : s.defName;
    }
    renderNetUI();
    this.syncPeerConnections();
  }

  syncPeerConnections(): void {
    if (!this.active || !Number.isInteger(this.slot)) return;
    const current = new Set(this.roster.map((r) => r.slot).filter((slot) => slot !== this.slot));
    for (const [slot, peer] of this.peers) {
      if (!current.has(slot)) {
        peer.pc.close();
        this.peers.delete(slot);
      }
    }
    for (const slot of current) {
      // Deterministic offerer: lower slot creates offer, preventing glare.
      if (this.slot < slot && !this.peers.has(slot)) this.createPeer(slot);
    }
    this.updatePeerStatus();
  }

  private buildPeer(slot: number): RtcPeer {
    const pc = new RTCPeerConnection({
      iceServers: [{ urls: 'stun:stun.l.google.com:19302' }],
    });
    const peer: RtcPeer = { pc, slot, state: null, events: null, ready: false, pendingIce: [] };
    this.peers.set(slot, peer);

    pc.onicecandidate = (event) => {
      if (event.candidate) this.signalPeer(slot, 'ice', { candidate: event.candidate });
    };
    pc.ondatachannel = (event) => this.attachDataChannel(peer, event.channel);
    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') {
        peer.ready = false;
        this.updatePeerStatus();
        if (pc.connectionState === 'failed') {
          try {
            pc.restartIce();
          } catch {
            /* ignore */
          }
        }
      }
    };
    return peer;
  }

  private createPeer(slot: number): void {
    if (this.peers.has(slot) || !this.active) return;
    const peer = this.buildPeer(slot);
    const pc = peer.pc;

    if (this.slot < slot) {
      this.attachDataChannel(peer, pc.createDataChannel('events'));
      this.attachDataChannel(
        peer,
        pc.createDataChannel('state', {
          ordered: false,
          maxRetransmits: 0,
        }),
      );
      pc.createOffer()
        .then((offer) => pc.setLocalDescription(offer))
        .then(() => this.signalPeer(slot, 'offer', { description: pc.localDescription }))
        .catch((error) => console.warn('WebRTC offer failed:', error));
    }
  }

  private attachDataChannel(peer: RtcPeer, channel: RTCDataChannel): void {
    if (channel.label === 'state') peer.state = channel;
    else if (channel.label === 'events') peer.events = channel;
    else {
      channel.close();
      return;
    }

    const refresh = () => {
      peer.ready = !!(
        peer.state &&
        peer.events &&
        peer.state.readyState === 'open' &&
        peer.events.readyState === 'open' &&
        peer.pc.connectionState === 'connected'
      );
      this.updatePeerStatus();
    };
    channel.onopen = refresh;
    channel.onclose = refresh;
    channel.onerror = refresh;
    channel.onmessage = (event) => {
      let message;
      try {
        message = JSON.parse(event.data);
      } catch {
        return;
      }
      if (this.validatePeerMessage(message, peer.slot)) this.handle(message, peer.slot);
    };
    refresh();
  }

  private signalPeer(slot: number, kind: string, payload: Record<string, unknown>): void {
    if (!this.ws || this.ws.readyState !== WebSocket.OPEN) return;
    this.ws.send(
      JSON.stringify(
        Object.assign(
          {
            t: 'rtc',
            kind,
            to: slot,
            room: this.room,
          },
          payload,
        ),
      ),
    );
  }

  private async handleSignal(message: NetMessage): Promise<void> {
    const from = Number(message.from);
    if (
      !Number.isInteger(from) ||
      from < 0 ||
      from > 11 ||
      from === this.slot ||
      Number(message.to) !== this.slot ||
      !this.humans.has(from)
    ) {
      return;
    }
    const peer = this.peers.get(from) ?? this.buildPeer(from);
    const pc = peer.pc;
    try {
      if (message.kind === 'offer' && message.description) {
        await pc.setRemoteDescription(message.description);
        for (const candidate of peer.pendingIce.splice(0)) await pc.addIceCandidate(candidate);
        const answer = await pc.createAnswer();
        await pc.setLocalDescription(answer);
        this.signalPeer(from, 'answer', { description: pc.localDescription });
      } else if (message.kind === 'answer' && message.description) {
        await pc.setRemoteDescription(message.description);
        for (const candidate of peer.pendingIce.splice(0)) await pc.addIceCandidate(candidate);
      } else if (message.kind === 'ice' && message.candidate) {
        const candidate = new RTCIceCandidate(message.candidate);
        if (pc.remoteDescription) await pc.addIceCandidate(candidate);
        else peer.pendingIce.push(candidate);
      }
    } catch (error) {
      console.warn(`WebRTC signalling with slot ${from} failed:`, error);
    }
    this.updatePeerStatus();
  }

  /**
   * A peer may speak for its own soldier. The room host additionally speaks for every
   * soldier no human has claimed (the AI bots it simulates).
   */
  private speaksFor(fromSlot: number, soldierId: unknown): boolean {
    const sid = typeof soldierId === 'number' ? soldierId : Number(soldierId);
    const result = Number.isInteger(sid) && sid === fromSlot || (
      fromSlot === this.hostSlot &&
      Number.isInteger(sid) &&
      sid >= 0 &&
      sid < 12 &&
      !this.humans.has(sid)
    );
    console.log('[speaksFor]', { fromSlot, soldierId, sid, hostSlot: this.hostSlot, humans: [...this.humans], result });
    return result;
  }

  validatePeerMessage(message: NetMessage, fromSlot: number): boolean {
    if (!message || typeof message.t !== 'string') return false;
    const idNum = typeof message.id === 'number' ? message.id : Number(message.id);
    switch (message.t) {
      case 's':
        return Number.isInteger(idNum) && idNum === fromSlot;
      case 'b':
        return (
          fromSlot === this.hostSlot &&
          Array.isArray(message.a) &&
          message.a.every(
            (item) =>
              item && Number.isInteger(item.id) && item.id >= 0 && item.id < 12 && !this.humans.has(item.id),
          )
        );
      case 'f':
        return this.speaksFor(fromSlot, message.id);
      case 'g':
        return (
          this.speaksFor(fromSlot, message.id) &&
          (message.k === 'throw' || message.k === 'explode' || message.k === 'smoke') &&
          typeof message.w === 'string'
        );
      case 'h': {
        const valid = this.speaksFor(fromSlot, message.from);
        console.log('[validatePeerMessage] h event:', { fromSlot, messageFrom: message.from, valid, hostSlot: this.hostSlot, humans: [...this.humans] });
        return valid;
      }
      case 'k':
        return this.speaksFor(fromSlot, message.v);
      case 'r':
        return this.speaksFor(fromSlot, message.id);
      case 'm':
      case 'reset':
      case 'snap':
        return fromSlot === this.hostSlot;
      case 'need':
        return true;
      default:
        return false;
    }
  }

  updatePeerStatus(): void {
    this.p2pReady = [...this.peers.values()].filter((peer) => peer.ready).length;
    updateNetBadge();
  }

  closePeers(): void {
    for (const peer of this.peers.values()) {
      try {
        peer.pc.close();
      } catch {
        /* ignore */
      }
    }
    this.peers.clear();
    this.p2pReady = 0;
  }

  private soldier(id: number | undefined): Soldier | undefined {
    return id === undefined ? undefined : allSoldiers[id];
  }

  syncPayload(): Omit<NetMessage, 't'> {
    return {
      a: matchState.alphaScore,
      b: matchState.bravoScore,
      tr: Math.round(matchState.timeRemaining),
      ro: matchState.roundOver ? 1 : 0,
      map: game.currentMapId ?? undefined,
      s: allSoldiers.map((s) => [s.id, s.kills, s.deaths, s.alive ? 1 : 0]),
    };
  }

  private applySync(d: NetMessage, immediate: boolean): void {
    if (!d || !Array.isArray(d.s)) return;
    matchState.alphaScore = Number(d.a) | 0;
    matchState.bravoScore = Number(d.b) | 0;
    matchState.timeRemaining = Math.max(0, Number(d.tr) || 0);
    matchState.roundOver = !!d.ro;
    if (typeof d.map === 'string' && d.map in MAP_DEFINITIONS && d.map !== game.currentMapId) loadMap(d.map);
    for (const row of d.s) {
      const s = allSoldiers[row[0]];
      if (!s) continue;
      const mine = this.owns(s);
      if (!mine) {
        const alive = !!row[3];
        if (alive !== s.alive) {
          // debounce: need two consecutive mismatches (event may be in flight) unless first snapshot
          s._mm = (s._mm || 0) + 1;
          if (immediate || s._mm >= 2) {
            s._mm = 0;
            if (alive) respawnSoldier(s);
            else
              eliminateSoldier(
                s,
                null,
                s.pos.clone().add(new THREE.Vector3(0, 1, 0)),
                new THREE.Vector3(0, 0, -1),
                false,
              );
          }
        } else s._mm = 0;
      }
      if (!mine || immediate) {
        s.kills = row[1] | 0;
        s.deaths = row[2] | 0;
      }
    }
  }

  private applyState(d: StateLike): void {
    const s = this.soldier(d.id);
    if (!s || this.owns(s) || !s.alive || !this.okVec(d.p)) return;
    const r = s._net || (s._net = { pos: new THREE.Vector3(), yaw: 0, vx: 0, vz: 0, t: 0, init: false });
    r.pos.set(d.p[0], d.p[1], d.p[2]);
    r.yaw = typeof d.y === 'number' && Number.isFinite(d.y) ? d.y : 0;
    const vel = Array.isArray(d.v) ? d.v : null;
    r.vx = vel && Number.isFinite(vel[0]) ? vel[0] : 0;
    r.vz = vel && Number.isFinite(vel[1]) ? vel[1] : 0;
    r.t = performance.now();
    if (typeof d.h === 'number' && Number.isFinite(d.h)) s.hp = d.h;
    if (typeof d.c === 'number' && Number.isFinite(d.c)) s.stanceTarget = Math.max(0, Math.min(1, d.c));
    if (typeof d.w === 'string' && isWeaponId(d.w) && d.w !== s.weaponId) equipWeapon(s, d.w);
    if (!r.init) {
      s.pos.copy(r.pos);
      s.yaw = r.yaw;
      r.init = true;
    }
  }

  // Per-frame update for soldiers simulated on someone else's machine
  updateRemote(s: Soldier, dt: number): void {
    if (!s.alive) {
      if (s.ragdoll) {
        s.ragdoll.step(dt);
        applyRagdollToSoldierRig(s.rig, s.ragdoll);
      }
      return;
    }
    const r = s._net;
    if (r && r.init) {
      const raw = (performance.now() - r.t) / 1000;
      const age = Math.min(raw, 0.15);
      const live = raw < 0.5;
      const vx = live ? r.vx : 0,
        vz = live ? r.vz : 0;
      const tx = r.pos.x + vx * age,
        tz = r.pos.z + vz * age,
        ty = r.pos.y;
      const dx = tx - s.pos.x,
        dy = ty - s.pos.y,
        dz = tz - s.pos.z;
      if (dx * dx + dy * dy + dz * dz > 36) s.pos.set(tx, ty, tz);
      else {
        const k = 1 - Math.exp(-14 * dt);
        s.pos.x += dx * k;
        s.pos.y += dy * k;
        s.pos.z += dz * k;
      }
      let da = r.yaw - s.yaw;
      while (da > Math.PI) da -= Math.PI * 2;
      while (da < -Math.PI) da += Math.PI * 2;
      s.yaw += da * (1 - Math.exp(-14 * dt));
      s.vel.set(vx, 0, vz);
    } else {
      s.vel.set(0, 0, 0);
    }

    updateSoldierRigVisual(s, dt);
  }

  tick(dt: number): void {
    if (!this.active) return;
    this.sendTimer -= dt;
    if (this.sendTimer <= 0) {
      this.sendTimer = 0.05; // 20 Hz
      const me = game.humanPlayer;
      if (me.alive) {
        this.send({
          t: 's',
          id: me.id,
          p: this.v3(me.pos),
          y: +me.yaw.toFixed(3),
          v: [+me.vel.x.toFixed(2), +me.vel.z.toFixed(2)],
          h: Math.ceil(me.hp),
          w: me.weaponId,
          c: +(me.crouch || 0).toFixed(2),
        });
      }
      if (this.isHost) {
        const a: NetStateEntry[] = [];
        for (const s of allSoldiers) {
          if (!s.alive || s.isPlayer || !this.owns(s)) continue;
          a.push({
            id: s.id,
            p: this.v3(s.pos),
            y: +s.yaw.toFixed(3),
            v: [+s.vel.x.toFixed(2), +s.vel.z.toFixed(2)],
            h: Math.ceil(s.hp),
            w: s.weaponId,
            c: +(s.crouch || 0).toFixed(2),
          });
        }
        if (a.length) this.send({ t: 'b', a });
      }
    }
    if (this.isHost) {
      this.syncTimer -= dt;
      if (this.syncTimer <= 0) {
        this.syncTimer = 1.0;
        this.send(Object.assign({ t: 'm' }, this.syncPayload()));
      }
    }
    this.pingTimer -= dt;
    if (this.pingTimer <= 0) {
      this.pingTimer = 2.0;
      this.send({ t: 'ping', ts: performance.now() });
    }
    this.badgeTimer -= dt;
    if (this.badgeTimer <= 0) {
      this.badgeTimer = 0.5;
      updateNetBadge();
    }
  }

  handle(m: NetMessage, fromPeerSlot: number | null = null): void {
    if (fromPeerSlot !== null && !this.validatePeerMessage(m, fromPeerSlot)) return;
    if (m.mid) {
      if (this.seenMessages.has(m.mid)) return;
      this.seenMessages.add(m.mid);
      if (this.seenMessages.size > 2048) {
        this.seenMessages = new Set([...this.seenMessages].slice(-1024));
      }
    }
    switch (m.t) {
      case 'rtc':
        this.handleSignal(m);
        break;
      case 'welcome': {
        this.active = true;
        this.slot = m.slot ?? -1;
        this.hostSlot = m.host ?? -1;
        this.isHost = !!m.isHost;
        this.applyRoster(m.roster || []);
        const me = allSoldiers[this.slot];
        setLocalPlayer(me);
        me.kills = 0;
        me.deaths = 0;
        if (this.isHost) {
          const map = randomMapId(game.currentMapId);
          this.send({ t: 'reset', map });
          resetFullMatch(map);
        } // fresh match for a new room
        else {
          respawnSoldier(me, true);
          this.send({ t: 'need' });
        }
        setNetStatus(`Connected - room ${this.room}`, false, true);
        showHudToast(this.isHost ? `ROOM ${this.room} - YOU ARE HOST` : `JOINED ROOM ${this.room}`, 2600);
        updateNetBadge();
        break;
      }
      case 'join': {
        this.applyRoster(m.roster || []);
        const s = this.soldier(m.slot);
        if (s) {
          s.kills = 0;
          s.deaths = 0;
          if (s._net) s._net.init = false;
        }
        showHudToast(`${s ? s.name : 'PLAYER'} JOINED`, 1800);
        break;
      }
      case 'leave': {
        const s = this.soldier(m.slot);
        const nm = s ? s.name : 'PLAYER';
        this.applyRoster(m.roster || []);
        if (s) s._net = null;
        showHudToast(`${nm} LEFT - BOT TAKES OVER`, 1800);
        break;
      }
      case 'host': {
        const was = this.isHost;
        this.hostSlot = m.slot ?? -1;
        this.isHost = m.slot === this.slot;
        if (this.isHost && !was) {
          showHudToast('YOU ARE NOW HOST', 2200);
          if (matchState.roundOver)
            setTimeout(() => {
              const map = randomMapId(game.currentMapId);
              net.send({ t: 'reset', map });
              resetFullMatch(map);
            }, 3000);
        }
        renderNetUI();
        break;
      }
      case 's':
        this.applyState(m);
        break;
      case 'b':
        if (Array.isArray(m.a)) for (const d of m.a) this.applyState(d);
        break;
      case 'f': {
        const s = this.soldier(m.id);
        if (!s || this.owns(s) || !this.okVec(m.o) || !this.okVec(m.e)) break;
        const o = this.vec(m.o),
          e = this.vec(m.e);
        spawnBulletTracer(o, e, s.team);
        if (!m.q) sfx.playGunshot(false, o.distanceTo(game.humanPlayer.pos), s.weaponId, o);
        if (m.w) {
          spawnImpactSparks(e, false);
          damageDestructibleNearPoint(e, 18);
        }
        break;
      }
      case 'g': {
        const owner = this.soldier(m.id);
        const origin = m.o ?? m.p;
        if (!owner || !this.okVec(origin) || (m.v && !this.okVec(m.v))) break;
        if (m.k === 'throw') {
          // The sender owns this throw; every recipient creates a visual projectile.
          if (this.owns(owner)) break;
          const o = this.vec(origin);
          const v = this.okVec(m.v) ? this.vec(m.v) : new THREE.Vector3();
          const thrown = spawnThrowerViewProjectile(owner, m.w === 'smoke' ? 'smoke' : 'grenade', o, v);
          if (thrown && typeof m.f === 'number' && Number.isFinite(m.f))
            thrown.fuse = Math.min(5, Math.max(0.1, m.f));
        } else if (m.k === 'explode' || m.k === 'smoke') {
          if (!this.okVec(m.p)) break;
          const center = this.vec(m.p);
          const type: ThrowableType = m.w === 'smoke' ? 'smoke' : 'grenade';
          const mesh = new THREE.Object3D();
          mesh.position.copy(center);
          const fake: ProjectileLike = { alive: true, owner, type, mesh };
          const pending = activeProjectiles.find(
            (p) =>
              p.owner === owner &&
              p.type === fake.type &&
              !p.simulate &&
              p.mesh.position.distanceToSquared(center) < 25,
          );
          if (pending) {
            if (pending.mesh.parent) pending.mesh.parent.remove(pending.mesh);
            pending.alive = false;
          }
          if (m.k === 'explode') explodeProjectile(fake, true);
          else deploySmokeProjectile(fake, true);
        }
        break;
      }
      case 'h': {
        // someone hit a soldier I own
        const t = this.soldier(m.to),
          a = this.soldier(m.from);
        console.log('[handle] h event received:', { from: m.from, to: m.to, dmg: m.d, hs: m.hs, p: m.p, dir: m.dir, targetExists: !!t, attackerExists: !!a, ownsTarget: t ? this.owns(t) : false, okVecP: this.okVec(m.p), okVecDir: this.okVec(m.dir), mySlot: this.slot, isHost: this.isHost });
        if (!t) { console.log('[handle] h REJECTED: no target'); break; }
        if (!a) { console.log('[handle] h REJECTED: no attacker'); break; }
        if (!this.owns(t)) { console.log('[handle] h REJECTED: not owner of target', { targetId: m.to, mySlot: this.slot, isHost: this.isHost, humans: [...this.humans] }); break; }
        if (!this.okVec(m.p)) { console.log('[handle] h REJECTED: bad p vector', { p: m.p, okVec: this.okVec(m.p) }); break; }
        if (!this.okVec(m.dir)) { console.log('[handle] h REJECTED: bad dir vector', { dir: m.dir, okVec: this.okVec(m.dir) }); break; }
        const dmg = Math.min(100, Math.max(0, Number(m.d) || 0));
        console.log('[handle] h ACCEPTED, applying damage:', { targetId: t.id, attackerId: a.id, dmg });
        damageSoldier(t, a, dmg, this.vec(m.p), this.vec(m.dir), !!m.hs);
        break;
      }
      case 'k': {
        const v = typeof m.v === 'number' ? allSoldiers[m.v] : undefined;
        if (!v || !v.alive || this.owns(v) || !this.okVec(m.p) || !this.okVec(m.d)) break;
        const killerIdx = typeof m.k === 'number' ? m.k : -1;
        const k = killerIdx >= 0 && allSoldiers[killerIdx] ? allSoldiers[killerIdx] : null;
        eliminateSoldier(v, k, this.vec(m.p), this.vec(m.d), !!m.hs);
        break;
      }
      case 'r': {
        const s = this.soldier(m.id);
        if (s && !this.owns(s) && !s.alive) respawnSoldier(s);
        break;
      }
      case 'm':
        this.applySync(m, false);
        break;
      case 'need': {
        if (this.isHost) this.send(Object.assign({ t: 'snap', to: m.from }, this.syncPayload()));
        break;
      }
      case 'snap':
        this.applySync(m, true);
        break;
      case 'reset':
        resetFullMatch(m.map || null);
        break;
      case 'pong':
        this.ping = Math.round(performance.now() - (m.ts ?? 0));
        break;
      case 'full':
        setNetStatus('Room is full (12/12)', true);
        break;
    }
  }
}

export const net = new NetClient();
