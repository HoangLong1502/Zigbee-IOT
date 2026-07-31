import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Coordinator,
  DeviceType,
  EventSeverity,
  EventType,
  InterviewStatus,
} from '../../domain/entities';
import { WS_EVENTS } from '../../common/constants/ws-events';
import { RealtimeGateway } from '../websocket/realtime.gateway';
import { ZigbeeCommandService } from '../mqtt/zigbee-command.service';
import { MqttService } from '../mqtt/mqtt.service';
import { DeviceService } from '../device/device.service';
import { EventService } from '../event/event.service';
import { ManualSyncDto, SetPairingModeDto } from './dto/discovery.dto';

export interface DiscoveryStatus {
  pairingMode: 'manual' | 'auto';
  autoPairEnabled: boolean;
  autoPairWindowSeconds: number;
  permitJoin: boolean;
  permitJoinTimeout: number | null;
  lastManualSyncAt: string | null;
  bridgeOnline: boolean;
  mqttConnected: boolean;
  pendingInterviewCount: number;
  description: string;
}

/**
 * Device discovery / pairing policies.
 *
 * Zigbee has no Bluetooth-style "nearby device list". A device is "nearby"
 * when it is in pairing mode and within radio range of the coordinator (or a
 * router). Opening *permit join* is what lets those devices connect.
 *
 * - **Auto mode**: keep permit join open (renewed by cron) so any nearby
 *   pairing device joins without further UI action.
 * - **Manual sync**: open a timed join window and optionally re-interview
 *   devices that never finished their Zigbee interview.
 */
@Injectable()
export class DiscoveryService implements OnModuleInit {
  private readonly logger = new Logger(DiscoveryService.name);
  private renewInFlight = false;
  private syncInFlight = false;

  constructor(
    @InjectRepository(Coordinator)
    private readonly coordinators: Repository<Coordinator>,
    private readonly commands: ZigbeeCommandService,
    private readonly mqtt: MqttService,
    private readonly devices: DeviceService,
    private readonly events: EventService,
    private readonly gateway: RealtimeGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    const coordinator = await this.getCoordinator();
    if (coordinator.pairingMode === 'auto' && this.mqtt.isConnected) {
      this.logger.log('Auto-pair was enabled — reopening the join window');
      void this.renewAutoPairJoin().catch((error: Error) =>
        this.logger.warn(`Failed to restore auto-pair: ${error.message}`),
      );
    }
  }

  async getStatus(): Promise<DiscoveryStatus> {
    const coordinator = await this.getCoordinator();
    const pendingInterviewCount = this.devices.cachedDevices.filter(
      (device) =>
        device.type !== DeviceType.COORDINATOR &&
        (!device.interviewCompleted ||
          device.interviewStatus === InterviewStatus.PENDING ||
          device.interviewStatus === InterviewStatus.FAILED),
    ).length;

    const auto = coordinator.pairingMode === 'auto';

    return {
      pairingMode: coordinator.pairingMode ?? 'manual',
      autoPairEnabled: auto,
      autoPairWindowSeconds: coordinator.autoPairWindowSeconds ?? 254,
      permitJoin: coordinator.permitJoin,
      permitJoinTimeout: coordinator.permitJoinTimeout,
      lastManualSyncAt: coordinator.lastManualSyncAt?.toISOString() ?? null,
      bridgeOnline: coordinator.online,
      mqttConnected: this.mqtt.isConnected,
      pendingInterviewCount,
      description: auto
        ? 'Auto: network stays open so nearby pairing devices can join by themselves'
        : 'Manual: devices only join when you press Sync or Permit Join',
    };
  }

  /**
   * Switch between auto (always-open join) and manual (user-triggered) pairing.
   */
  async setPairingMode(dto: SetPairingModeDto): Promise<DiscoveryStatus> {
    const coordinator = await this.getCoordinator();
    coordinator.pairingMode = dto.mode;
    if (dto.windowSeconds !== undefined) {
      coordinator.autoPairWindowSeconds = dto.windowSeconds;
    }
    await this.coordinators.save(coordinator);

    if (dto.mode === 'auto') {
      await this.renewAutoPairJoin();
      this.events.recordAsync({
        type: EventType.PERMIT_JOIN_CHANGED,
        message: 'Auto-pair enabled — nearby pairing devices can join automatically',
        data: { pairingMode: 'auto', windowSeconds: coordinator.autoPairWindowSeconds },
      });
    } else {
      // Leaving auto mode closes the join window so the network is not left open.
      if (this.mqtt.isConnected && coordinator.permitJoin) {
        await this.commands.permitJoin(false);
        coordinator.permitJoin = false;
        coordinator.permitJoinTimeout = null;
        await this.coordinators.save(coordinator);
      }
      this.events.recordAsync({
        type: EventType.PERMIT_JOIN_CHANGED,
        message: 'Auto-pair disabled — switching to manual sync mode',
        data: { pairingMode: 'manual' },
      });
    }

    this.emitCoordinator(coordinator);
    return this.getStatus();
  }

  /**
   * One-shot manual discovery:
   * 1. Open permit join for `durationSeconds` so nearby pairing devices can join
   * 2. Optionally re-interview devices that never completed their interview
   */
  async manualSync(dto: ManualSyncDto = {}): Promise<{
    status: DiscoveryStatus;
    permitJoinSeconds: number;
    interviewed: string[];
    interviewErrors: Array<{ device: string; error: string }>;
  }> {
    if (this.syncInFlight) {
      throw new Error('A manual sync is already running');
    }
    if (!this.mqtt.isConnected) {
      throw new Error('MQTT is not connected — cannot sync with Zigbee2MQTT');
    }

    this.syncInFlight = true;
    const duration = dto.durationSeconds ?? 120;
    const interviewPending = dto.interviewPending ?? true;
    const interviewed: string[] = [];
    const interviewErrors: Array<{ device: string; error: string }> = [];

    try {
      const coordinator = await this.getCoordinator();

      // Manual sync temporarily opens the join window even in auto mode
      // (auto mode will renew it afterwards anyway).
      await this.commands.permitJoin(true, duration);
      coordinator.permitJoin = true;
      coordinator.permitJoinTimeout = duration;
      coordinator.lastManualSyncAt = new Date();
      await this.coordinators.save(coordinator);
      this.emitCoordinator(coordinator);

      this.events.recordAsync({
        type: EventType.COMMAND,
        severity: EventSeverity.INFO,
        message: `Manual sync started — permit join open for ${duration}s`,
        data: { durationSeconds: duration, interviewPending },
      });

      if (interviewPending) {
        const pending = this.devices.cachedDevices.filter(
          (device) =>
            device.type !== DeviceType.COORDINATOR &&
            (!device.interviewCompleted ||
              device.interviewStatus === InterviewStatus.PENDING ||
              device.interviewStatus === InterviewStatus.FAILED ||
              device.interviewStatus === InterviewStatus.STARTED),
        );

        // Cap concurrent interviews — Zigbee interviews are slow and chatty.
        for (const device of pending.slice(0, 10)) {
          try {
            await this.commands.interviewDevice(device.friendlyName);
            interviewed.push(device.friendlyName);
          } catch (error) {
            interviewErrors.push({
              device: device.friendlyName,
              error: (error as Error).message,
            });
          }
        }
      }

      return {
        status: await this.getStatus(),
        permitJoinSeconds: duration,
        interviewed,
        interviewErrors,
      };
    } finally {
      this.syncInFlight = false;
    }
  }

  /**
   * While auto-pair is on, renew permit join before the Zigbee timeout elapses
   * so nearby devices can keep joining without user action.
   */
  @Cron(CronExpression.EVERY_MINUTE)
  async maintainAutoPair(): Promise<void> {
    const coordinator = await this.getCoordinator();
    if (coordinator.pairingMode !== 'auto') return;
    if (!this.mqtt.isConnected || !coordinator.online) return;
    if (this.renewInFlight) return;

    const timeout = coordinator.permitJoinTimeout ?? 0;
    // Renew when closed, or when less than ~90s remain on the window.
    if (coordinator.permitJoin && timeout > 90) return;

    try {
      await this.renewAutoPairJoin();
    } catch (error) {
      this.logger.warn(`Auto-pair renew failed: ${(error as Error).message}`);
    }
  }

  private async renewAutoPairJoin(): Promise<void> {
    if (this.renewInFlight) return;
    this.renewInFlight = true;
    try {
      if (!this.mqtt.isConnected) return;

      const coordinator = await this.getCoordinator();
      if (coordinator.pairingMode !== 'auto') return;

      const windowSeconds = Math.min(
        Math.max(coordinator.autoPairWindowSeconds ?? 254, 30),
        254,
      );

      await this.commands.permitJoin(true, windowSeconds);
      coordinator.permitJoin = true;
      coordinator.permitJoinTimeout = windowSeconds;
      await this.coordinators.save(coordinator);
      this.emitCoordinator(coordinator);
      this.logger.debug(`Auto-pair: permit join renewed for ${windowSeconds}s`);
    } finally {
      this.renewInFlight = false;
    }
  }

  private async getCoordinator(): Promise<Coordinator> {
    const existing = await this.coordinators.findOne({ where: { singleton: true } });
    if (existing) {
      // Defaults for rows created before these columns existed.
      if (!existing.pairingMode) existing.pairingMode = 'manual';
      if (!existing.autoPairWindowSeconds) existing.autoPairWindowSeconds = 254;
      return existing;
    }
    return this.coordinators.save(
      this.coordinators.create({
        singleton: true,
        pairingMode: 'manual',
        autoPairWindowSeconds: 254,
      }),
    );
  }

  private emitCoordinator(coordinator: Coordinator): void {
    this.gateway.emit(WS_EVENTS.COORDINATOR_UPDATED, {
      ...coordinator,
      networkKey: coordinator.networkKey ? '********' : null,
    });
  }
}
