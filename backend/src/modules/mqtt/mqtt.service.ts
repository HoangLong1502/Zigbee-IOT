import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import mqtt, { IClientOptions, MqttClient } from 'mqtt';
import { Subject } from 'rxjs';
import { MqttConfig } from '../../config/configuration';
import { WS_EVENTS } from '../../common/constants/ws-events';
import { MessageDirection } from '../../domain/entities';
import { safeJsonParse } from '../../common/utils/value.util';
import { RealtimeGateway } from '../websocket/realtime.gateway';
import { MqttLogService } from './mqtt-log.service';

/** A message as it arrived from the broker, before any Zigbee interpretation. */
export interface RawMqttMessage {
  topic: string;
  payload: string;
  qos: number;
  retain: boolean;
  receivedAt: Date;
}

export interface MqttStatus {
  connected: boolean;
  reconnecting: boolean;
  url: string;
  baseTopic: string;
  clientId: string;
  lastConnectedAt: Date | null;
  lastDisconnectedAt: Date | null;
  lastError: string | null;
  reconnectAttempts: number;
  messagesReceived: number;
  messagesPublished: number;
}

/**
 * Step 4 of the pipeline: the transport link to Mosquitto.
 *
 *   Zigbee device -> coordinator -> Zigbee2MQTT -> Mosquitto -> **MqttService**
 *
 * Responsibilities are deliberately narrow: hold exactly one broker
 * connection, keep it alive, subscribe to the Zigbee2MQTT topic tree, and
 * republish every frame on an in-process stream. Interpretation of payloads is
 * the ingestion service's job, which keeps this class free of Zigbee
 * semantics and trivially testable.
 */
@Injectable()
export class MqttService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MqttService.name);
  private readonly config: MqttConfig;

  private client: MqttClient | null = null;

  /** Hot stream of every inbound frame. */
  private readonly messageSubject = new Subject<RawMqttMessage>();
  readonly message$ = this.messageSubject.asObservable();

  /** Emits on every connect/disconnect so other services can react. */
  private readonly statusSubject = new Subject<MqttStatus>();
  readonly status$ = this.statusSubject.asObservable();

  private connected = false;
  private reconnecting = false;
  private lastConnectedAt: Date | null = null;
  private lastDisconnectedAt: Date | null = null;
  private lastError: string | null = null;
  private reconnectAttempts = 0;
  private messagesReceived = 0;
  private messagesPublished = 0;

  constructor(
    configService: ConfigService,
    private readonly gateway: RealtimeGateway,
    private readonly logService: MqttLogService,
  ) {
    this.config = configService.getOrThrow<MqttConfig>('mqtt');
  }

  onModuleInit(): void {
    this.connect();
  }

  onApplicationShutdown(): void {
    this.messageSubject.complete();
    this.statusSubject.complete();
    this.client?.end(true);
    this.client = null;
  }

  // -------------------------------------------------------------------------
  // Connection lifecycle
  // -------------------------------------------------------------------------

  private connect(): void {
    const options: IClientOptions = {
      clientId: this.config.clientId,
      username: this.config.username,
      password: this.config.password,
      // mqtt.js reconnects on its own; we only surface the state.
      reconnectPeriod: this.config.reconnectPeriodMs,
      connectTimeout: this.config.connectTimeoutMs,
      clean: true,
      resubscribe: true,
      keepalive: 60,
    };

    this.logger.log(`Connecting to MQTT broker at ${this.config.url}`);
    const client = mqtt.connect(this.config.url, options);
    this.client = client;

    client.on('connect', () => {
      this.connected = true;
      this.reconnecting = false;
      this.reconnectAttempts = 0;
      this.lastError = null;
      this.lastConnectedAt = new Date();
      this.logger.log('MQTT connected');
      this.subscribeToZigbeeTopics();
      this.publishStatus();
    });

    client.on('reconnect', () => {
      this.reconnecting = true;
      this.reconnectAttempts += 1;
      if (this.reconnectAttempts <= 3 || this.reconnectAttempts % 12 === 0) {
        this.logger.warn(`MQTT reconnect attempt #${this.reconnectAttempts}`);
      }
      this.publishStatus();
    });

    client.on('close', () => {
      if (this.connected) {
        this.connected = false;
        this.lastDisconnectedAt = new Date();
        this.logger.warn('MQTT connection closed');
        this.publishStatus();
      }
    });

    client.on('offline', () => {
      this.connected = false;
      this.publishStatus();
    });

    client.on('error', (error: Error) => {
      this.lastError = error.message;
      this.logger.error(`MQTT error: ${error.message}`);
      this.publishStatus();
    });

    client.on('message', (topic, payload, packet) => {
      this.messagesReceived += 1;
      this.messageSubject.next({
        topic,
        payload: payload.toString('utf8'),
        qos: packet.qos ?? 0,
        retain: packet.retain ?? false,
        receivedAt: new Date(),
      });
    });
  }

  /**
   * `zigbee2mqtt/#` covers device states, availability, and the whole
   * `bridge/*` namespace (devices, info, state, event, logging, response) in a
   * single subscription, which also means a newly paired device is picked up
   * without re-subscribing.
   */
  private subscribeToZigbeeTopics(): void {
    const topics = [
      `${this.config.baseTopic}/#`,
      `${this.config.baseTopic}/bridge/#`,
    ];

    this.client?.subscribe(topics, { qos: 0 }, (error) => {
      if (error) {
        this.logger.error(`Failed to subscribe: ${error.message}`);
        return;
      }
      this.logger.log(`Subscribed to ${topics.join(', ')}`);
    });
  }

  // -------------------------------------------------------------------------
  // Publishing
  // -------------------------------------------------------------------------

  /**
   * Publishes to the broker. Payload objects are JSON-encoded; strings are
   * sent verbatim (Zigbee2MQTT accepts both for most bridge requests).
   */
  async publish(
    topic: string,
    payload: unknown,
    options: { qos?: 0 | 1 | 2; retain?: boolean } = {},
  ): Promise<void> {
    if (!this.client || !this.connected) {
      throw new Error('MQTT client is not connected');
    }

    const body =
      typeof payload === 'string' ? payload : JSON.stringify(payload ?? '');

    await new Promise<void>((resolve, reject) => {
      this.client!.publish(
        topic,
        body,
        { qos: options.qos ?? 0, retain: options.retain ?? false },
        (error) => (error ? reject(error) : resolve()),
      );
    });

    this.messagesPublished += 1;
    this.logger.debug(`-> ${topic} ${body.slice(0, 200)}`);

    // Outbound frames are logged here so that every command issued by the
    // platform shows up in the log viewer next to the inbound traffic.
    this.logService.record({
      topic,
      direction: MessageDirection.OUTBOUND,
      payload: body,
      payloadJson: safeJsonParse<Record<string, unknown>>(body),
      qos: options.qos ?? 0,
      retain: options.retain ?? false,
      deviceName: this.deviceNameFromTopic(topic),
    });
  }

  /**
   * Extracts the friendly name from an outbound device topic such as
   * `zigbee2mqtt/Kitchen Plug/set` (bridge topics resolve to null).
   */
  private deviceNameFromTopic(topic: string): string | null {
    const prefix = `${this.config.baseTopic}/`;
    if (!topic.startsWith(prefix)) return null;
    const rest = topic.slice(prefix.length);
    if (rest.startsWith('bridge/')) return null;
    const name = rest.replace(/\/(set|get)(\/.*)?$/, '');
    return name.length > 0 ? name : null;
  }

  // -------------------------------------------------------------------------
  // Status
  // -------------------------------------------------------------------------

  getStatus(): MqttStatus {
    return {
      connected: this.connected,
      reconnecting: this.reconnecting,
      url: this.config.url,
      baseTopic: this.config.baseTopic,
      clientId: this.config.clientId,
      lastConnectedAt: this.lastConnectedAt,
      lastDisconnectedAt: this.lastDisconnectedAt,
      lastError: this.lastError,
      reconnectAttempts: this.reconnectAttempts,
      messagesReceived: this.messagesReceived,
      messagesPublished: this.messagesPublished,
    };
  }

  get isConnected(): boolean {
    return this.connected;
  }

  get baseTopic(): string {
    return this.config.baseTopic;
  }

  private publishStatus(): void {
    const status = this.getStatus();
    this.statusSubject.next(status);
    this.gateway.emit(WS_EVENTS.MQTT_STATUS, status);
  }
}
