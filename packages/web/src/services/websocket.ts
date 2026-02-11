import type { ClientMessage, ServerMessage } from "@serverless-openclaw/shared";

export type ConnectionStatus = "connecting" | "connected" | "disconnected";
export type MessageHandler = (msg: ServerMessage) => void;
export type StatusHandler = (status: ConnectionStatus) => void;

const MAX_BACKOFF_MS = 30_000;
const HEARTBEAT_MS = 30_000;

export class WebSocketClient {
  private ws: WebSocket | null = null;
  private url = "";
  private token = "";
  private messageHandlers: MessageHandler[] = [];
  private statusHandlers: StatusHandler[] = [];
  private reconnectAttempt = 0;
  private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private heartbeatTimer: ReturnType<typeof setInterval> | null = null;
  private intentionalClose = false;

  connect(url: string, token: string): void {
    this.url = url;
    this.token = token;
    this.intentionalClose = false;
    this.reconnectAttempt = 0;
    this.doConnect();
  }

  updateToken(token: string): void {
    this.token = token;
  }

  send(message: ClientMessage): void {
    if (this.ws?.readyState === WebSocket.OPEN) {
      this.ws.send(JSON.stringify(message));
    }
  }

  onMessage(handler: MessageHandler): () => void {
    this.messageHandlers.push(handler);
    return () => {
      this.messageHandlers = this.messageHandlers.filter((h) => h !== handler);
    };
  }

  onStatusChange(handler: StatusHandler): () => void {
    this.statusHandlers.push(handler);
    return () => {
      this.statusHandlers = this.statusHandlers.filter((h) => h !== handler);
    };
  }

  disconnect(): void {
    this.intentionalClose = true;
    this.cleanup();
    if (this.ws) {
      this.ws.close();
      this.ws = null;
    }
  }

  private doConnect(): void {
    this.cleanup();
    this.notifyStatus("connecting");

    const separator = this.url.includes("?") ? "&" : "?";
    this.ws = new WebSocket(`${this.url}${separator}token=${this.token}`);

    this.ws.onopen = () => {
      this.reconnectAttempt = 0;
      this.notifyStatus("connected");
      this.startHeartbeat();
    };

    this.ws.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as ServerMessage;
        for (const handler of this.messageHandlers) {
          handler(msg);
        }
      } catch {
        // ignore malformed messages
      }
    };

    this.ws.onclose = () => {
      this.notifyStatus("disconnected");
      this.stopHeartbeat();
      if (!this.intentionalClose) {
        this.scheduleReconnect();
      }
    };

    this.ws.onerror = () => {
      // onclose will fire after onerror
    };
  }

  private scheduleReconnect(): void {
    const delay = Math.min(1000 * 2 ** this.reconnectAttempt, MAX_BACKOFF_MS);
    this.reconnectAttempt++;
    this.reconnectTimer = setTimeout(() => this.doConnect(), delay);
  }

  private startHeartbeat(): void {
    this.heartbeatTimer = setInterval(() => {
      if (this.ws?.readyState === WebSocket.OPEN) {
        this.ws.send(JSON.stringify({ action: "ping" }));
      }
    }, HEARTBEAT_MS);
  }

  private stopHeartbeat(): void {
    if (this.heartbeatTimer) {
      clearInterval(this.heartbeatTimer);
      this.heartbeatTimer = null;
    }
  }

  private cleanup(): void {
    this.stopHeartbeat();
    if (this.reconnectTimer) {
      clearTimeout(this.reconnectTimer);
      this.reconnectTimer = null;
    }
  }

  private notifyStatus(status: ConnectionStatus): void {
    for (const handler of this.statusHandlers) {
      handler(status);
    }
  }
}
