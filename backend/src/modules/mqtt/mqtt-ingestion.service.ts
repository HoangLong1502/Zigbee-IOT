import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Subscription } from 'rxjs';
import {
  AlertType,
  AlertSeverity,
  EventSeverity,
  EventType,
  MessageDirection,
} from '../../domain/entities';
import type {
  ZigbeeAvailabilityPayload,
  ZigbeeBridgeDevice,
  ZigbeeBridgeEvent,
  ZigbeeBridgeInfo,
  ZigbeeBridgeLog,
  ZigbeeBridgeResponse,
  ZigbeeDeviceState,
  ZigbeeNetworkMap,
} from '../../common/types/zigbee.types';
import { safeJsonParse } from '../../common/utils/value.util';
import { WS_EVENTS } from '../../common/constants/ws-events';
import { MqttConfig } from '../../config/configuration';
import { RealtimeGateway } from '../websocket/realtime.gateway';
import { MqttService, RawMqttMessage } from '../mqtt/mqtt.service';
import { MqttLogService } from '../mqtt/mqtt-log.service';
import { ZigbeeCommandService } from '../mqtt/zigbee-command.service';
import { DeviceService } from '../device/device.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { HistoryService } from '../history/history.service';
import { EventService } from '../event/event.service';
import { AlertService } from '../alert/alert.service';
import { CoordinatorService } from '../coordinator/coordinator.service';
import { TopologyService } from '../topology/topology.service';
import { OtaService, OtaProgressPayload } from '../ota/ota.service';

/**
 * The heart of the real-time pipeline.
 *
 *   Zigbee device
 *     -> USB coordinator
 *     -> Zigbee2MQTT
 *     -> Mosquitto
 *     -> MqttService (transport)
 *     -> **MqttIngestionService** (this class)
 *          |-- parse + route by topic
 *          |-- persist (devices / telemetry / history / events / alerts)
 *          `-- emit WebSocket events -> React dashboard
 *
 * Topic routing follows the Zigbee2MQTT contract exactly:
 *   zigbee2mqtt/bridge/state
 *   zigbee2mqtt/bridge/info
 *   zigbee2mqtt/bridge/devices
 *   zigbee2mqtt/bridge/event
 *   zigbee2mqtt/bridge/logging
 *   zigbee2mqtt/bridge/response/<command>
 *   zigbee2mqtt/<friendly_name>
 *   zigbee2mqtt/<friendly_name>/availability
 *   zigbee2mqtt/<friendly_name>/set|get   (ignored - those are our own publishes)
 *
 * The class deliberately owns no Zigbee domain logic itself: every branch
 * delegates to the module that owns that concern.
 */
@Injectable()
export class MqttIngestionService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(MqttIngestionService.name);
  private readonly baseTopic: string;
  private subscription: Subscription | null = null;
  private statusSubscription: Subscription | null = null;

  constructor(
    configService: ConfigService,
    private readonly mqtt: MqttService,
    private readonly logs: MqttLogService,
    private readonly commands: ZigbeeCommandService,
    private readonly devices: DeviceService,
    private readonly telemetry: TelemetryService,
    private readonly history: HistoryService,
    private readonly events: EventService,
    private readonly alerts: AlertService,
    private readonly coordinator: CoordinatorService,
    private readonly topology: TopologyService,
    private readonly ota: OtaService,
    private readonly gateway: RealtimeGateway,
  ) {
    this.baseTopic = configService.getOrThrow<MqttConfig>('mqtt').baseTopic;
  }

  onModuleInit(): void {
    this.subscription = this.mqtt.message$.subscribe((message) => {
      void this.handleMessage(message).catch((error: Error) =>
        this.logger.error(
          `Failed to process ${message.topic}: ${error.message}`,
          error.stack,
        ),
      );
    });

    this.statusSubscription = this.mqtt.status$.subscribe((status) => {
      this.events.recordAsync({
        type: status.connected ? EventType.MQTT_CONNECTED : EventType.MQTT_DISCONNECTED,
        severity: status.connected ? EventSeverity.INFO : EventSeverity.WARNING,
        message: status.connected
          ? 'Connected to the MQTT broker'
          : `Disconnected from the MQTT broker${status.lastError ? `: ${status.lastError}` : ''}`,
        data: { reconnectAttempts: status.reconnectAttempts },
      });

      if (!status.connected) {
        this.alerts.raiseAsync({
          type: AlertType.MQTT_DISCONNECTED,
          severity: AlertSeverity.CRITICAL,
          message: 'MQTT broker is unreachable - Zigbee data will not arrive',
        });
      }
    });

    this.logger.log(`Ingestion pipeline armed for base topic "${this.baseTopic}"`);
  }

  onModuleDestroy(): void {
    this.subscription?.unsubscribe();
    this.statusSubscription?.unsubscribe();
  }

  // -------------------------------------------------------------------------
  // Topic router
  // -------------------------------------------------------------------------

  private async handleMessage(message: RawMqttMessage): Promise<void> {
    const { topic } = message;

    // Only Zigbee2MQTT traffic is of interest.
    if (!topic.startsWith(`${this.baseTopic}/`)) return;

    const relative = topic.slice(this.baseTopic.length + 1);
    const parts = relative.split('/');

    // Persist every inbound frame for the log viewer, even ones we then ignore.
    this.logInbound(message, parts);

    // Bridge namespace -------------------------------------------------------
    if (parts[0] === 'bridge') {
      await this.handleBridge(parts.slice(1), message);
      return;
    }

    // Our own /set and /get publishes echo back when retained or mirrored;
    // ignore them so we do not treat commands as sensor readings.
    if (parts[1] === 'set' || parts[1] === 'get') return;

    // Availability LWT for a device -----------------------------------------
    if (parts[1] === 'availability') {
      await this.handleAvailability(parts[0], message);
      return;
    }

    // Anything else under the base topic with a single segment is a device
    // state report: zigbee2mqtt/<friendly_name>
    if (parts.length === 1) {
      await this.handleDeviceState(parts[0], message);
    }
  }

  private logInbound(message: RawMqttMessage, parts: string[]): void {
    const payloadJson = safeJsonParse(message.payload);
    const deviceName =
      parts[0] === 'bridge' ? null : decodeURIComponent(parts[0]);

    this.logs.record({
      topic: message.topic,
      direction: MessageDirection.INBOUND,
      payload: message.payload,
      payloadJson: (payloadJson as Record<string, unknown> | unknown[] | null) ?? null,
      qos: message.qos,
      retain: message.retain,
      deviceName,
      deviceId: deviceName ? this.devices.resolve(deviceName)?.id ?? null : null,
      createdAt: message.receivedAt,
    });
  }

  // -------------------------------------------------------------------------
  // Bridge handlers
  // -------------------------------------------------------------------------

  private async handleBridge(path: string[], message: RawMqttMessage): Promise<void> {
    const [kind, ...rest] = path;

    switch (kind) {
      case 'state':
        await this.handleBridgeState(message);
        return;
      case 'info':
        await this.handleBridgeInfo(message);
        return;
      case 'devices':
        await this.handleBridgeDevices(message);
        return;
      case 'event':
        await this.handleBridgeEvent(message);
        return;
      case 'logging':
      case 'log':
        this.handleBridgeLog(message);
        return;
      case 'response':
        await this.handleBridgeResponse(rest.join('/'), message);
        return;
      case 'groups':
      case 'definitions':
      case 'extensions':
      case 'converters':
        // Not needed for the monitoring platform; deliberately ignored.
        return;
      default:
        this.logger.debug(`Unhandled bridge topic: bridge/${path.join('/')}`);
    }
  }

  /** `bridge/state` - LWT of the Zigbee2MQTT process itself. */
  private async handleBridgeState(message: RawMqttMessage): Promise<void> {
    const parsed = safeJsonParse<{ state?: string } | string>(message.payload);
    const state =
      typeof parsed === 'string'
        ? parsed
        : typeof parsed === 'object' && parsed
          ? parsed.state
          : message.payload;

    const online = String(state).toLowerCase() === 'online';
    await this.coordinator.setBridgeState(online);

    this.events.recordAsync({
      type: online ? EventType.BRIDGE_ONLINE : EventType.BRIDGE_OFFLINE,
      severity: online ? EventSeverity.INFO : EventSeverity.WARNING,
      message: online ? 'Zigbee2MQTT bridge is online' : 'Zigbee2MQTT bridge went offline',
    });

    if (!online) {
      this.alerts.raiseAsync({
        type: AlertType.COORDINATOR_OFFLINE,
        severity: AlertSeverity.CRITICAL,
        message: 'Zigbee2MQTT bridge is offline - the coordinator is unreachable',
      });
    }
  }

  /** `bridge/info` - coordinator firmware, network params, permit join. */
  private async handleBridgeInfo(message: RawMqttMessage): Promise<void> {
    const info = safeJsonParse<ZigbeeBridgeInfo>(message.payload);
    if (!info) return;

    const previous = await this.coordinator.getOrCreate();
    const previousPermit = previous.permitJoin;

    await this.coordinator.applyBridgeInfo(info);

    if (previousPermit !== Boolean(info.permit_join)) {
      this.events.recordAsync({
        type: EventType.PERMIT_JOIN_CHANGED,
        message: info.permit_join
          ? `Permit join opened${info.permit_join_timeout ? ` for ${info.permit_join_timeout}s` : ''}`
          : 'Permit join closed',
        data: {
          permitJoin: info.permit_join,
          timeout: info.permit_join_timeout ?? null,
        },
      });
    }
  }

  /** `bridge/devices` - the authoritative device inventory. */
  private async handleBridgeDevices(message: RawMqttMessage): Promise<void> {
    const list = safeJsonParse<ZigbeeBridgeDevice[]>(message.payload);
    if (!Array.isArray(list)) return;

    const { added, updated, removed } = await this.devices.syncFromBridge(list);

    for (const device of added) {
      this.events.recordAsync({
        type: EventType.DEVICE_JOINED,
        message: `Device discovered: ${device.friendlyName}`,
        device,
        data: { model: device.model, manufacturer: device.manufacturer },
      });
      this.gateway.emit(WS_EVENTS.DEVICE_ADDED, device);

      // Anything that appears without a recent interview event is unexpected.
      this.alerts.raiseAsync({
        type: AlertType.UNEXPECTED_JOIN,
        severity: AlertSeverity.INFO,
        message: `Unexpected device join: ${device.friendlyName}`,
        device,
      });
    }

    for (const device of updated) {
      this.gateway.emit(WS_EVENTS.DEVICE_UPDATED, device);
    }

    for (const device of removed) {
      this.events.recordAsync({
        type: EventType.DEVICE_LEAVE,
        severity: EventSeverity.WARNING,
        message: `Device left the network: ${device.friendlyName}`,
        device,
      });
      this.gateway.emit(WS_EVENTS.DEVICE_REMOVED, {
        id: device.id,
        ieeeAddress: device.ieeeAddress,
        friendlyName: device.friendlyName,
      });
      this.alerts.raiseAsync({
        type: AlertType.UNEXPECTED_LEAVE,
        severity: AlertSeverity.WARNING,
        message: `Unexpected device leave: ${device.friendlyName}`,
        device,
      });
    }

    // Refresh the dashboard counters after every inventory change.
    await this.emitStats();
  }

  /** `bridge/event` - join / leave / interview / announce. */
  private async handleBridgeEvent(message: RawMqttMessage): Promise<void> {
    const event = safeJsonParse<ZigbeeBridgeEvent>(message.payload);
    if (!event?.type) return;

    const ieee = event.data?.ieee_address ?? null;
    const friendly = event.data?.friendly_name ?? null;
    const device =
      (friendly ? this.devices.resolve(friendly) : undefined) ??
      (ieee ? this.devices.resolve(ieee) : undefined) ??
      null;

    const severity =
      event.type === 'device_leave'
        ? EventSeverity.WARNING
        : event.data?.status === 'failed'
          ? EventSeverity.ERROR
          : EventSeverity.INFO;

    this.events.recordAsync({
      type: event.type,
      severity,
      message: this.describeBridgeEvent(event),
      device,
      friendlyName: friendly,
      ieeeAddress: ieee,
      data: event.data as Record<string, unknown>,
    });
  }

  private describeBridgeEvent(event: ZigbeeBridgeEvent): string {
    const name = event.data?.friendly_name ?? event.data?.ieee_address ?? 'unknown';
    switch (event.type) {
      case 'device_joined':
        return `${name} joined the network`;
      case 'device_leave':
        return `${name} left the network`;
      case 'device_announce':
        return `${name} announced itself`;
      case 'device_interview':
        return `Interview of ${name}: ${event.data?.status ?? 'in progress'}`;
      default:
        return `Bridge event ${event.type} for ${name}`;
    }
  }

  /** `bridge/logging` - forwarded into our own event stream at matching severity. */
  private handleBridgeLog(message: RawMqttMessage): void {
    const log = safeJsonParse<ZigbeeBridgeLog>(message.payload);
    if (!log?.message) return;

    // Debug noise is dropped - it would drown the timeline.
    if (log.level === 'debug') return;

    const severity =
      log.level === 'error'
        ? EventSeverity.ERROR
        : log.level === 'warning'
          ? EventSeverity.WARNING
          : EventSeverity.INFO;

    this.events.recordAsync({
      type: EventType.BRIDGE_LOG,
      severity,
      message: log.message,
      data: { namespace: log.namespace, level: log.level },
    });
  }

  /** `bridge/response/<command>` - correlates with ZigbeeCommandService requests. */
  private async handleBridgeResponse(
    command: string,
    message: RawMqttMessage,
  ): Promise<void> {
    const response = safeJsonParse<ZigbeeBridgeResponse>(message.payload);
    if (!response) return;

    // Hand the response to whoever is awaiting it.
    this.commands.handleResponse(response);

    // Network map responses are also persisted as topology snapshots so a
    // scan initiated from anywhere (UI, cron, CLI) ends up in the same place.
    if (command === 'networkmap' && response.status === 'ok') {
      const value = (response.data as { value?: ZigbeeNetworkMap })?.value;
      if (value?.nodes) await this.topology.store(value);
    }
  }

  // -------------------------------------------------------------------------
  // Device handlers
  // -------------------------------------------------------------------------

  /** `zigbee2mqtt/<friendly_name>` - a sensor reading / state change. */
  private async handleDeviceState(
    friendlyNameEncoded: string,
    message: RawMqttMessage,
  ): Promise<void> {
    const friendlyName = decodeURIComponent(friendlyNameEncoded);
    const payload = safeJsonParse<ZigbeeDeviceState>(message.payload);
    if (!payload || typeof payload !== 'object' || Array.isArray(payload)) return;

    // Empty payloads and bridge echoes with only a `device` key are ignored.
    const keys = Object.keys(payload).filter((key) => key !== 'device');
    if (keys.length === 0) return;

    let device = this.devices.resolve(friendlyName);
    if (!device) {
      // The device list has not arrived yet, or the name is brand new. Skip
      // for now; the next bridge/devices sync will create the row and later
      // payloads will land correctly.
      this.logger.debug(`State for unknown device "${friendlyName}" - waiting for bridge/devices`);
      return;
    }

    const applied = await this.devices.applyState(device, payload, message.receivedAt);
    device = applied.device;

    // Persistence
    this.telemetry.record(device, message.topic, payload, message.receivedAt);
    this.history.record(device, payload, message.receivedAt);

    // OTA progress piggybacks on the same state topic.
    if (payload.update && typeof payload.update === 'object') {
      await this.ota.applyProgress(device, payload.update as OtaProgressPayload);
    }

    // Alert rules run against every payload.
    await this.alerts.evaluate(device, payload);

    // Coming back online clears the offline alert.
    await this.alerts.resolveDeviceOffline(device.id);

    // Real-time push.
    this.gateway.emitDeviceTelemetry(device.ieeeAddress, {
      id: device.id,
      ieeeAddress: device.ieeeAddress,
      friendlyName: device.friendlyName,
      payload,
      changedProperties: applied.changedProperties,
      linkQuality: applied.linkQuality,
      battery: applied.battery,
      online: true,
      lastSeen: message.receivedAt.toISOString(),
    });
  }

  /** `zigbee2mqtt/<friendly_name>/availability`. */
  private async handleAvailability(
    friendlyNameEncoded: string,
    message: RawMqttMessage,
  ): Promise<void> {
    const friendlyName = decodeURIComponent(friendlyNameEncoded);
    const device = this.devices.resolve(friendlyName);
    if (!device) return;

    const parsed = safeJsonParse<ZigbeeAvailabilityPayload | string>(message.payload);
    const state =
      typeof parsed === 'string'
        ? parsed
        : typeof parsed === 'object' && parsed
          ? parsed.state
          : message.payload;

    const online = String(state).toLowerCase() === 'online';
    const previous = device.online;
    await this.devices.setAvailability(device, online);

    if (previous === online) return;

    this.events.recordAsync({
      type: online ? EventType.DEVICE_ONLINE : EventType.DEVICE_OFFLINE,
      severity: online ? EventSeverity.INFO : EventSeverity.WARNING,
      message: `${device.friendlyName} is now ${online ? 'online' : 'offline'}`,
      device,
    });

    if (!online) {
      this.alerts.raiseAsync({
        type: AlertType.DEVICE_OFFLINE,
        severity: AlertSeverity.WARNING,
        message: `${device.friendlyName} went offline`,
        device,
      });
    } else {
      await this.alerts.resolveDeviceOffline(device.id);
    }

    await this.emitStats();
  }

  // -------------------------------------------------------------------------
  // Housekeeping
  // -------------------------------------------------------------------------

  /** Pushes the dashboard counters to every connected client. */
  private async emitStats(): Promise<void> {
    try {
      const stats = await this.devices.getStats();
      this.gateway.emit(WS_EVENTS.STATS, {
        ...stats,
        mqtt: this.mqtt.getStatus(),
        coordinatorOnline: (await this.coordinator.getOrCreate()).online,
        connectedClients: this.gateway.connectedClients,
      });
    } catch (error) {
      this.logger.debug(`emitStats failed: ${(error as Error).message}`);
    }
  }

  /** Safety net for devices that never publish an availability topic. */
  @Cron(CronExpression.EVERY_5_MINUTES)
  async markStaleDevicesOffline(): Promise<void> {
    const stale = await this.devices.markStaleDevicesOffline();
    for (const device of stale) {
      this.events.recordAsync({
        type: EventType.DEVICE_OFFLINE,
        severity: EventSeverity.WARNING,
        message: `${device.friendlyName} marked offline (no recent activity)`,
        device,
      });
      this.alerts.raiseAsync({
        type: AlertType.DEVICE_OFFLINE,
        severity: AlertSeverity.WARNING,
        message: `${device.friendlyName} went offline`,
        device,
      });
    }
    if (stale.length > 0) await this.emitStats();
  }

  /** Periodic stats push so the dashboard stays alive even on a quiet network. */
  @Cron(CronExpression.EVERY_MINUTE)
  async pushStats(): Promise<void> {
    await this.emitStats();
  }
}
