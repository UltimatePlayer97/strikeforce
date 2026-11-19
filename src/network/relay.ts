// Cloudflare Worker relay endpoint configuration
// The actual worker code would be deployed separately

export const RELAY_ENDPOINTS = {
  primary: 'wss://strikeforce-relay.proxy-roblox.workers.dev',
  fallback: 'wss://strikeforce-relay-backup.proxy-roblox.workers.dev'
};

export interface RelayMessage {
  type: string;
  room?: string;
  playerId?: string;
  targetId?: string;
  data?: any;
}

export class RelayClient {
  private ws: WebSocket | null = null;
  private url: string;
  private reconnectAttempts = 0;
  private maxReconnectAttempts = 5;
  private onMessageCallback: ((msg: RelayMessage) => void) | null = null;
  private onOpenCallback: (() => void) | null = null;
  private onCloseCallback: (() => void) | null = null;

  constructor(url: string = RELAY_ENDPOINTS.primary) {
    this.url = url;
  }

  connect(): Promise<void> {
    return new Promise((resolve, reject) => {
      try {
        this.ws = new WebSocket(this.url);

        this.ws.onopen = () => {
          this.reconnectAttempts = 0;
          this.onOpenCallback?.();
          resolve();
        };

        this.ws.onmessage = (event) => {
          try {
            const msg = JSON.parse(event.data);
            this.onMessageCallback?.(msg);
          } catch (e) {
            console.error('Relay message parse error:', e);
          }
        };

        this.ws.onclose = () => {
          this.onCloseCallback?.();
          this.attemptReconnect();
        };

        this.ws.onerror = (err) => {
          reject(err);
        };
      } catch (e) {
        reject(e);
      }
    });
  }

  private attemptReconnect(): void {
    if (this.reconnectAttempts >= this.maxReconnectAttempts) {
      console.error('Max reconnect attempts reached');
      return;
    }

    this.reconnectAttempts++;
    const delay = Math.min(1000 * Math.pow(2, this.reconnectAttempts), 30000);

    setTimeout(() => {
      if (this.url === RELAY_ENDPOINTS.primary) {
        this.url = RELAY_ENDPOINTS.fallback;
      }
      this.connect().catch(() => this.attemptReconnect());
    }, delay);
  }

  send(msg: RelayMessage): void {
    if (this.ws && this.ws.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(msg));
    }
  }

  onMessage(callback: (msg: RelayMessage) => void): void {
    this.onMessageCallback = callback;
  }

  onOpen(callback: () => void): void {
    this.onOpenCallback = callback;
  }

  onClose(callback: () => void): void {
    this.onCloseCallback = callback;
  }

  disconnect(): void {
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  getReadyState(): number {
    return this.ws?.readyState ?? WebSocket.CLOSED;
  }
}