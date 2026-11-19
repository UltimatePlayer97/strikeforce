import type { NetworkMessage, PlayerState, GameSnapshot } from '../types';

export interface WebRTCConfig {
  relayUrl: string;
  roomCode: string;
  playerName: string;
  team: 'AUTO' | 'ALPHA' | 'BRAVO';
}

export class WebRTCManager {
  private config: WebRTCConfig;
  private peerConnections: Map<string, RTCPeerConnection> = new Map();
  private dataChannels: Map<string, RTCDataChannel> = new Map();
  private localPlayerId: string;
  private relayWs: WebSocket | null = null;
  private isConnected = false;
  private onMessageCallback: ((msg: NetworkMessage) => void) | null = null;
  private onPlayerJoinCallback: ((player: PlayerState) => void) | null = null;
  private onPlayerLeaveCallback: ((playerId: string) => void) | null = null;
  private onSnapshotCallback: ((snapshot: GameSnapshot) => void) | null = null;
  private pendingCandidates: Map<string, RTCIceCandidate[]> = new Map();

  constructor(config: WebRTCConfig) {
    this.config = config;
    this.localPlayerId = `player_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
  }

  async connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      this.relayWs = new WebSocket(this.config.relayUrl);

      this.relayWs.onopen = () => {
        this.sendRelay({
          type: 'join',
          room: this.config.roomCode,
          name: this.config.playerName,
          team: this.config.team,
          id: this.localPlayerId
        });
      };

      this.relayWs.onmessage = (event) => {
        try {
          const msg = JSON.parse(event.data);
          this.handleRelayMessage(msg);
        } catch (e) {
          console.error('Relay message parse error:', e);
        }
      };

      this.relayWs.onclose = () => {
        this.isConnected = false;
      };

      this.relayWs.onerror = (err) => {
        reject(err);
      };

      setTimeout(() => {
        if (!this.isConnected) reject(new Error('Connection timeout'));
      }, 10000);
    });
  }

  private handleRelayMessage(msg: any): void {
    switch (msg.type) {
      case 'joined':
        this.isConnected = true;
        this.localPlayerId = msg.yourId;
        for (const player of msg.players) {
          if (player.id !== this.localPlayerId) {
            this.createPeerConnection(player.id, true);
          }
        }
        break;

      case 'player-joined':
        if (msg.player.id !== this.localPlayerId) {
          this.createPeerConnection(msg.player.id, false);
          this.onPlayerJoinCallback?.(msg.player);
        }
        break;

      case 'player-left':
        this.destroyPeerConnection(msg.playerId);
        this.onPlayerLeaveCallback?.(msg.playerId);
        break;

      case 'offer':
        this.handleOffer(msg.from, msg.offer);
        break;

      case 'answer':
        this.handleAnswer(msg.from, msg.answer);
        break;

      case 'ice-candidate':
        this.handleIceCandidate(msg.from, msg.candidate);
        break;

      case 'snapshot':
        this.onSnapshotCallback?.(msg.snapshot);
        break;
    }
  }

  private async createPeerConnection(peerId: string, isInitiator: boolean): Promise<void> {
    const pc = new RTCPeerConnection({
      iceServers: [
        { urls: 'stun:stun.l.google.com:19302' },
        { urls: 'stun:stun1.l.google.com:19302' }
      ]
    });

    const dc = pc.createDataChannel('game', { ordered: true });
    this.setupDataChannel(peerId, dc);

    pc.ondatachannel = (event) => {
      this.setupDataChannel(peerId, event.channel);
    };

    pc.onicecandidate = (event) => {
      if (event.candidate) {
        this.sendRelay({
          type: 'ice-candidate',
          to: peerId,
          candidate: event.candidate.toJSON()
        });
      }
    };

    pc.onconnectionstatechange = () => {
      if (pc.connectionState === 'disconnected' || pc.connectionState === 'failed') {
        this.destroyPeerConnection(peerId);
      }
    };

    this.peerConnections.set(peerId, pc);

    if (isInitiator) {
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);
      this.sendRelay({ type: 'offer', to: peerId, offer });
    }
  }

  private setupDataChannel(peerId: string, dc: RTCDataChannel): void {
    dc.onopen = () => {
      this.dataChannels.set(peerId, dc);
    };

    dc.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data);
        msg.senderId = peerId;
        this.onMessageCallback?.(msg);
      } catch (e) {
        console.error('DataChannel message parse error:', e);
      }
    };

    dc.onclose = () => {
      this.dataChannels.delete(peerId);
    };
  }

  private async handleOffer(peerId: string, offer: RTCSessionDescriptionInit): Promise<void> {
    let pc = this.peerConnections.get(peerId);
    if (!pc) {
      pc = new RTCPeerConnection({
        iceServers: [{ urls: 'stun:stun.l.google.com:19302' }]
      });
      pc.ondatachannel = (event) => this.setupDataChannel(peerId, event.channel);
      pc.onicecandidate = (event) => {
        if (event.candidate) {
          this.sendRelay({ type: 'ice-candidate', to: peerId, candidate: event.candidate.toJSON() });
        }
      };
      this.peerConnections.set(peerId, pc);
    }

    await pc.setRemoteDescription(new RTCSessionDescription(offer));
    const answer = await pc.createAnswer();
    await pc.setLocalDescription(answer);
    this.sendRelay({ type: 'answer', to: peerId, answer });
  }

  private async handleAnswer(peerId: string, answer: RTCSessionDescriptionInit): Promise<void> {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      await pc.setRemoteDescription(new RTCSessionDescription(answer));
    }
  }

  private async handleIceCandidate(peerId: string, candidate: RTCIceCandidateInit): Promise<void> {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      try {
        await pc.addIceCandidate(new RTCIceCandidate(candidate));
      } catch (e) {
        console.error('ICE candidate error:', e);
      }
    } else {
      const pending = this.pendingCandidates.get(peerId) || [];
      pending.push(new RTCIceCandidate(candidate));
      this.pendingCandidates.set(peerId, pending);
    }
  }

  private destroyPeerConnection(peerId: string): void {
    const pc = this.peerConnections.get(peerId);
    if (pc) {
      pc.close();
      this.peerConnections.delete(peerId);
    }
    this.dataChannels.delete(peerId);
    this.pendingCandidates.delete(peerId);
  }

  private sendRelay(msg: any): void {
    if (this.relayWs && this.relayWs.readyState === WebSocket.OPEN) {
      this.relayWs.send(JSON.stringify(msg));
    }
  }

  broadcast(msg: NetworkMessage): void {
    msg.senderId = this.localPlayerId;
    msg.timestamp = Date.now();
    const data = JSON.stringify(msg);
    for (const dc of this.dataChannels.values()) {
      if (dc.readyState === 'open') {
        dc.send(data);
      }
    }
  }

  sendTo(peerId: string, msg: NetworkMessage): void {
    const dc = this.dataChannels.get(peerId);
    if (dc && dc.readyState === 'open') {
      msg.senderId = this.localPlayerId;
      msg.timestamp = Date.now();
      dc.send(JSON.stringify(msg));
    }
  }

  onMessage(callback: (msg: NetworkMessage) => void): void {
    this.onMessageCallback = callback;
  }

  onPlayerJoin(callback: (player: PlayerState) => void): void {
    this.onPlayerJoinCallback = callback;
  }

  onPlayerLeave(callback: (playerId: string) => void): void {
    this.onPlayerLeaveCallback = callback;
  }

  onSnapshot(callback: (snapshot: GameSnapshot) => void): void {
    this.onSnapshotCallback = callback;
  }

  getLocalPlayerId(): string {
    return this.localPlayerId;
  }

  isHost(): boolean {
    return true; // Simplified - first player is host
  }

  getConnectedPeers(): string[] {
    return Array.from(this.peerConnections.keys());
  }

  disconnect(): void {
    for (const pc of this.peerConnections.values()) {
      pc.close();
    }
    this.peerConnections.clear();
    this.dataChannels.clear();
    if (this.relayWs) {
      this.relayWs.close();
      this.relayWs = null;
    }
    this.isConnected = false;
  }
}