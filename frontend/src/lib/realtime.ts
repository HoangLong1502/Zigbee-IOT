import { io, Socket } from 'socket.io-client';
import { WS_EVENTS, type WsEventName } from './ws-events';

type Handler = (payload: unknown) => void;

/**
 * Singleton Socket.IO client.
 *
 * One connection is shared across the whole app. Pages subscribe to the events
 * they care about and unsubscribe on unmount; the MQTT log viewer additionally
 * joins the `mqtt-logs` room so the firehose only flows when someone is
 * watching.
 */
class RealtimeClient {
  private socket: Socket | null = null;
  private handlers = new Map<WsEventName, Set<Handler>>();
  private connected = false;
  private listeners: Array<(connected: boolean) => void> = [];

  connect(): void {
    if (this.socket) return;

    // Empty URL = same origin. Vite / nginx proxies /socket.io to the backend.
    this.socket = io({
      path: '/socket.io',
      transports: ['websocket', 'polling'],
      reconnection: true,
      reconnectionDelay: 1000,
      reconnectionDelayMax: 10_000,
    });

    this.socket.on('connect', () => {
      this.connected = true;
      this.listeners.forEach((listener) => listener(true));
    });

    this.socket.on('disconnect', () => {
      this.connected = false;
      this.listeners.forEach((listener) => listener(false));
    });

    // Forward every known event to the registered handlers.
    for (const event of Object.values(WS_EVENTS)) {
      this.socket.on(event, (payload: unknown) => {
        this.handlers.get(event)?.forEach((handler) => handler(payload));
      });
    }
  }

  disconnect(): void {
    this.socket?.disconnect();
    this.socket = null;
    this.connected = false;
  }

  on(event: WsEventName, handler: Handler): () => void {
    if (!this.handlers.has(event)) this.handlers.set(event, new Set());
    this.handlers.get(event)!.add(handler);
    return () => this.handlers.get(event)?.delete(handler);
  }

  onConnectionChange(listener: (connected: boolean) => void): () => void {
    this.listeners.push(listener);
    return () => {
      this.listeners = this.listeners.filter((item) => item !== listener);
    };
  }

  get isConnected(): boolean {
    return this.connected;
  }

  /** Opt into the raw MQTT firehose (log viewer). */
  subscribeMqttLogs(): void {
    this.socket?.emit('subscribe:mqtt-logs');
  }

  unsubscribeMqttLogs(): void {
    this.socket?.emit('unsubscribe:mqtt-logs');
  }

  subscribeDevice(ieeeAddress: string): void {
    this.socket?.emit('subscribe:device', { ieeeAddress });
  }

  unsubscribeDevice(ieeeAddress: string): void {
    this.socket?.emit('unsubscribe:device', { ieeeAddress });
  }
}

export const realtime = new RealtimeClient();
