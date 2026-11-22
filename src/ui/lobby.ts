import { DEFAULT_RELAY } from '../config';
import { resetFullMatch } from '../game/match';
import { allSoldiers } from '../game/state';
import { net, type NetMessage } from '../net/net';
import { $, storage } from '../util/dom';

const byId = <T extends HTMLElement = HTMLElement>(id: string): T => $<T>(id);

export function setNetStatus(text: string, isErr = false, isOk = false): void {
  const el = byId('mp-status');
  el.textContent = text;
  el.className =
    'text-[11px] font-semibold ' + (isErr ? 'text-red-400' : isOk ? 'text-emerald-400' : 'text-slate-400');
}

export function renderNetUI(msg?: string): void {
  if (msg) setNetStatus(msg, /lost|connect|full|must|Bad|code/i.test(msg));
  const on = net.active;
  byId('mp-connected').classList.toggle('hidden', !on);
  byId('mp-new-btn').classList.toggle('hidden', on);
  byId('mp-join-btn').classList.toggle('hidden', on);
  for (const id of ['mp-relay', 'mp-name', 'mp-room', 'mp-team']) {
    (byId(id) as HTMLInputElement | HTMLSelectElement).disabled = on;
  }
  const box = byId('mp-roster');
  box.textContent = '';
  for (const r of net.roster) {
    const s = allSoldiers[r.slot];
    const row = document.createElement('div');
    row.className = 'flex justify-between';
    const l = document.createElement('span');
    l.className = s && s.team === 'ALPHA' ? 'text-blue-300' : 'text-red-300';
    l.textContent = r.name + (r.slot === net.slot ? ' (you)' : '');
    const rr = document.createElement('span');
    rr.className = 'text-slate-500';
    rr.textContent = (r.slot === net.hostSlot ? 'HOST - ' : '') + (s ? s.team : '');
    row.append(l, rr);
    box.appendChild(row);
  }
}

export function updateNetBadge(): void {
  const b = byId('net-badge');
  if (!net.active) {
    b.classList.add('hidden');
    return;
  }
  b.classList.remove('hidden');
  const links = net.roster.length > 1 ? `${net.p2pReady}/${net.roster.length - 1} P2P` : 'P2P READY';
  b.textContent = `ROOM ${net.room} | ${net.roster.length}/12 | ${links} | ${net.ping}ms${net.isHost ? ' | HOST' : ''}`;
}

function netConnect(relayInput: string, roomInput: string, nameInput: string, team: string): void {
  if (net.ws) netDisconnect('');
  const relay = (relayInput || DEFAULT_RELAY).trim().replace(/^http/i, 'ws').replace(/\/+$/, '');
  if (!/^wss?:\/\/.+/i.test(relay)) {
    setNetStatus('Relay URL must start with wss://', true);
    return;
  }
  const room = roomInput
    .trim()
    .toUpperCase()
    .replace(/[^A-Z0-9]/g, '')
    .slice(0, 12);
  if (room.length < 3) {
    setNetStatus('Bad room code (3-12 letters/digits)', true);
    return;
  }
  const name =
    (nameInput || 'PLAYER')
      .replace(/[^\w \-]/g, '')
      .slice(0, 14)
      .trim() || 'PLAYER';
  storage.set('sf_relay', relay);
  storage.set('sf_name', name);
  byId<HTMLInputElement>('mp-room').value = room;

  let ws: WebSocket;
  try {
    ws = new WebSocket(`${relay}/ws/${room}?name=${encodeURIComponent(name)}&team=${team}`);
  } catch {
    setNetStatus('Bad relay URL', true);
    return;
  }
  net.ws = ws;
  net.room = room;
  setNetStatus('Connecting...');
  ws.onopen = () => {
    if (net.ws === ws && !net.active) setNetStatus('Connected to relay; joining room...');
  };
  ws.onerror = () => {
    if (net.ws === ws) setNetStatus('Relay connection error', true);
  };
  ws.onmessage = (ev: MessageEvent<string>) => {
    let m: NetMessage;
    try {
      m = JSON.parse(ev.data) as NetMessage;
    } catch {
      return;
    }
    if (net.ws === ws) net.handle(m);
  };
  ws.onclose = () => {
    if (net.ws !== ws) return;
    netDisconnect(net.active ? 'Connection lost' : 'Could not connect to relay');
  };
}

function netDisconnect(reason: string): void {
  const was = net.active;
  const ws = net.ws;
  net.ws = null;
  if (ws) {
    try {
      ws.close();
    } catch {
      /* ignore */
    }
  }
  net.closePeers();
  net.seenMessages.clear();
  net.active = false;
  net.slot = -1;
  net.hostSlot = -1;
  net.isHost = false;
  net.humans.clear();
  net.roster = [];
  for (const s of allSoldiers) {
    s.name = s.defName;
    s._net = null;
    s._mm = 0;
  }
  updateNetBadge();
  renderNetUI(reason || 'Offline');
  if (was) resetFullMatch();
}

function randomRoomCode(): string {
  const chars = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789';
  let c = '';
  for (let i = 0; i < 4; i++) c += chars[Math.floor(Math.random() * chars.length)];
  return c;
}

/** Wires up the multiplayer lobby controls. Call once DOM is ready. */
export function initNetUI(): void {
  const qs = new URLSearchParams(location.search);
  const savedRelay = storage.get('sf_relay') || '';
  const savedName = storage.get('sf_name') || '';
  const relayEl = byId<HTMLInputElement>('mp-relay');
  const nameEl = byId<HTMLInputElement>('mp-name');
  const roomEl = byId<HTMLInputElement>('mp-room');
  const teamEl = byId<HTMLSelectElement>('mp-team');

  relayEl.value = qs.get('relay') || savedRelay || DEFAULT_RELAY;
  nameEl.value = (qs.get('name') || savedName || '').slice(0, 14);
  roomEl.value = (qs.get('room') || '').toUpperCase().slice(0, 12);
  const go = (room: string): void => netConnect(relayEl.value, room, nameEl.value, teamEl.value);
  byId('mp-new-btn').addEventListener('click', () => go(randomRoomCode()));
  byId('mp-join-btn').addEventListener('click', () => go(roomEl.value));
  byId('mp-leave-btn').addEventListener('click', () => netDisconnect('Offline'));
  byId('mp-copy-btn').addEventListener('click', async () => {
    const u = new URL(location.href.split('?')[0].split('#')[0]);
    u.searchParams.set('room', net.room);
    u.searchParams.set('relay', relayEl.value.trim());
    try {
      await navigator.clipboard.writeText(u.toString());
      setNetStatus('Invite link copied', false, true);
    } catch {
      window.prompt('Copy invite link:', u.toString());
    }
  });
  renderNetUI('Offline');
}
