import { Logger } from '@nestjs/common';
import {
  ConnectedSocket,
  MessageBody,
  OnGatewayConnection,
  OnGatewayDisconnect,
  SubscribeMessage,
  WebSocketGateway,
  WebSocketServer,
} from '@nestjs/websockets';
import { Server, Socket } from 'socket.io';
import { WS_EVENTS, WS_ROOMS, WsEventName } from '../../common/constants/ws-events';

/**
 * Socket.IO gateway - the last hop of the real-time pipeline:
 *
 *   MQTT message -> ingestion -> persistence -> **this gateway** -> React UI
 *
 * All broadcasting goes through `emit()` so that every module has a single,
 * typed way of pushing updates and no module needs a reference to socket.io.
 */
@WebSocketGateway({
  cors: { origin: process.env.CORS_ORIGIN ?? '*' },
  transports: ['websocket', 'polling'],
})
export class RealtimeGateway implements OnGatewayConnection, OnGatewayDisconnect {
  private readonly logger = new Logger(RealtimeGateway.name);

  @WebSocketServer()
  private server?: Server;

  private clientCount = 0;

  handleConnection(client: Socket): void {
    this.clientCount += 1;
    void client.join(WS_ROOMS.DEFAULT);
    this.logger.log(`Client connected: ${client.id} (${this.clientCount} total)`);
  }

  handleDisconnect(client: Socket): void {
    this.clientCount = Math.max(0, this.clientCount - 1);
    this.logger.log(`Client disconnected: ${client.id} (${this.clientCount} total)`);
  }

  /**
   * The MQTT firehose can be thousands of messages per minute, so clients must
   * explicitly opt in (the log viewer page does this on mount).
   */
  @SubscribeMessage('subscribe:mqtt-logs')
  onSubscribeMqttLogs(@ConnectedSocket() client: Socket): { subscribed: boolean } {
    void client.join(WS_ROOMS.MQTT_LOGS);
    return { subscribed: true };
  }

  @SubscribeMessage('unsubscribe:mqtt-logs')
  onUnsubscribeMqttLogs(@ConnectedSocket() client: Socket): { subscribed: boolean } {
    void client.leave(WS_ROOMS.MQTT_LOGS);
    return { subscribed: false };
  }

  /** Device detail pages join a per-device room to get focused updates. */
  @SubscribeMessage('subscribe:device')
  onSubscribeDevice(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { ieeeAddress?: string },
  ): { subscribed: boolean } {
    if (!body?.ieeeAddress) return { subscribed: false };
    void client.join(WS_ROOMS.device(body.ieeeAddress));
    return { subscribed: true };
  }

  @SubscribeMessage('unsubscribe:device')
  onUnsubscribeDevice(
    @ConnectedSocket() client: Socket,
    @MessageBody() body: { ieeeAddress?: string },
  ): { subscribed: boolean } {
    if (body?.ieeeAddress) void client.leave(WS_ROOMS.device(body.ieeeAddress));
    return { subscribed: false };
  }

  /** Broadcast to every connected client. */
  emit(event: WsEventName, payload: unknown): void {
    this.server?.emit(event, payload);
  }

  /** Broadcast to one room only. */
  emitToRoom(room: string, event: WsEventName, payload: unknown): void {
    this.server?.to(room).emit(event, payload);
  }

  /** Raw MQTT frames go only to clients that opted into the firehose. */
  emitMqttMessage(payload: unknown): void {
    this.server?.to(WS_ROOMS.MQTT_LOGS).emit(WS_EVENTS.MQTT_MESSAGE, payload);
  }

  /** Telemetry: broadcast globally and to the device-specific room. */
  emitDeviceTelemetry(ieeeAddress: string, payload: unknown): void {
    this.server?.emit(WS_EVENTS.DEVICE_TELEMETRY, payload);
    this.server?.to(WS_ROOMS.device(ieeeAddress)).emit(WS_EVENTS.DEVICE_TELEMETRY, payload);
  }

  get connectedClients(): number {
    return this.clientCount;
  }
}
