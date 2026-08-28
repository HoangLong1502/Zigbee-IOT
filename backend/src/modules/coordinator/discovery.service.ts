import {
  Injectable,
  Logger,
  NotFoundException,
  OnModuleInit,
} from '@nestjs/common';
import { Cron, CronExpression } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Coordinator,
  Device,
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

/** LQI at or above this is treated as "next to the coordinator". */
const NEAR_COORDINATOR_LQI = 100;

export interface PairingPrompt {
  ieeeAddress: string;
  friendlyName: string;
  deviceId: string | null;
  manufacturer: string | null;
  model: string | null;
  description: string | null;
  imageUrl: string | null;
  interviewStatus: string | null;
  supported: boolean | null;
  linkQuality: number | null;
  nearCoordinator: boolean;
  pairingMode: 'manual' | 'auto';
  joinedAt: string;
}

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
  pendingPairingCount: number;
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
 *   pairing device can start joining. The dashboard then asks whether to keep it.
 * - **Manual sync**: open a timed join window and optionally re-interview
 *   devices that never finished their Zigbee interview.
 */
@Injectable()
export class DiscoveryService implements OnModuleInit {
  private readonly logger = new Logger(DiscoveryService.name);
  private renewInFlight = false;
  private syncInFlight = false;
  private readonly pendingPrompts = new Map<string, PairingPrompt>();

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
    await this.restoreUnconfirmedPrompts(coordinator);
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
      pendingPairingCount: this.pendingPrompts.size,
      description: auto
        ? 'Auto: network stays open so nearby pairing devices can join; you still confirm each one'
        : 'Manual: devices only join when you press Sync or Permit Join; you still confirm each one',
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
        message: 'Auto-pair enabled — nearby pairing devices will trigger a Pair / Don\'t pair prompt',
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

  // -------------------------------------------------------------------------
  // Pairing confirmation prompts
  // -------------------------------------------------------------------------

  listPrompts(): PairingPrompt[] {
    return [...this.pendingPrompts.values()].sort((a, b) =>
      a.joinedAt.localeCompare(b.joinedAt),
    );
  }

  /**
   * A live `device_joined` from Zigbee2MQTT: the radio already accepted the
   * join (permit join was open). Ask the operator whether to keep it.
   */
  async offerJoinPrompt(input: {
    ieeeAddress?: string | null;
    friendlyName?: string | null;
  }): Promise<PairingPrompt | null> {
    const ieee = this.normalizeIeee(input.ieeeAddress);
    if (!ieee) return null;

    const coordinator = await this.getCoordinator();
    const existingDevice = this.devices.resolve(ieee) ?? this.devices.resolve(input.friendlyName ?? '');
    if (existingDevice?.type === DeviceType.COORDINATOR) return null;

    const prompt = this.mergePrompt(ieee, {
      ieeeAddress: existingDevice?.ieeeAddress ?? ieee,
      friendlyName: input.friendlyName ?? existingDevice?.friendlyName ?? ieee,
      deviceId: existingDevice?.id ?? null,
      manufacturer: existingDevice?.manufacturer ?? null,
      model: existingDevice?.model ?? null,
      description: existingDevice?.description ?? null,
      imageUrl: existingDevice?.imageUrl ?? null,
      interviewStatus: existingDevice?.interviewStatus ?? InterviewStatus.PENDING,
      supported: existingDevice?.supported ?? null,
      linkQuality: existingDevice?.linkQuality ?? null,
      pairingMode: coordinator.pairingMode ?? 'manual',
      joinedAt: this.pendingPrompts.get(ieee)?.joinedAt ?? new Date().toISOString(),
    });

    if (existingDevice) {
      try {
        await this.devices.setPairingConfirmed(existingDevice.ieeeAddress, false);
      } catch (error) {
        this.logger.debug(`Could not mark pairing unconfirmed: ${(error as Error).message}`);
      }
    }

    this.emitPrompt(prompt);
    return prompt;
  }

  /** Interview progress fills in model / vendor so the prompt is recognizable. */
  updateInterviewPrompt(input: {
    ieeeAddress?: string | null;
    friendlyName?: string | null;
    status?: string | null;
    supported?: boolean | null;
    manufacturer?: string | null;
    model?: string | null;
    description?: string | null;
    imageUrl?: string | null;
  }): PairingPrompt | null {
    const ieee = this.normalizeIeee(input.ieeeAddress);
    if (!ieee || !this.pendingPrompts.has(ieee)) return null;

    const prompt = this.mergePrompt(ieee, {
      friendlyName: input.friendlyName ?? undefined,
      interviewStatus: input.status ?? undefined,
      supported: input.supported ?? undefined,
      manufacturer: input.manufacturer ?? undefined,
      model: input.model ?? undefined,
      description: input.description ?? undefined,
      imageUrl: input.imageUrl ?? undefined,
    });
    this.emitPrompt(prompt);

    if (input.status === 'successful') {
      void this.tryIdentify(prompt.friendlyName);
    }
    return prompt;
  }

  /** Bind the DB row once `bridge/devices` catches up with the live join. */
  attachDiscoveredDevice(device: Device): PairingPrompt | null {
    const ieee = this.normalizeIeee(device.ieeeAddress);
    if (!ieee || device.type === DeviceType.COORDINATOR) return null;
    if (!this.pendingPrompts.has(ieee)) return null;

    void this.devices
      .setPairingConfirmed(device.ieeeAddress, false)
      .catch((error: Error) =>
        this.logger.debug(`Could not mark pairing unconfirmed: ${error.message}`),
      );

    const prompt = this.mergePrompt(ieee, {
      friendlyName: device.friendlyName,
      deviceId: device.id,
      manufacturer: device.manufacturer,
      model: device.model,
      description: device.description,
      imageUrl: device.imageUrl,
      interviewStatus: device.interviewStatus,
      supported: device.supported,
      linkQuality: device.linkQuality,
    });
    this.emitPrompt(prompt);
    return prompt;
  }

  updatePromptLinkQuality(ieeeAddress: string, linkQuality: number | null): void {
    const ieee = this.normalizeIeee(ieeeAddress);
    if (!ieee || linkQuality == null) return;
    const previous = this.pendingPrompts.get(ieee);
    if (!previous || previous.linkQuality === linkQuality) return;
    const prompt = this.mergePrompt(ieee, { linkQuality });
    this.emitPrompt(prompt);
  }

  dismissLeave(ieeeAddress?: string | null, friendlyName?: string | null): void {
    const ieee =
      this.normalizeIeee(ieeeAddress) ??
      this.findIeeeByFriendlyName(friendlyName);
    if (!ieee || !this.pendingPrompts.has(ieee)) return;
    const prompt = this.pendingPrompts.get(ieee)!;
    this.pendingPrompts.delete(ieee);
    this.gateway.emit(WS_EVENTS.PAIRING_RESOLVED, {
      ...prompt,
      decision: 'left',
    });
  }

  async accept(ieeeAddress: string): Promise<PairingPrompt> {
    const ieee = this.requirePendingIeee(ieeeAddress);
    const prompt = this.pendingPrompts.get(ieee)!;
    this.pendingPrompts.delete(ieee);

    try {
      await this.devices.setPairingConfirmed(prompt.deviceId ?? prompt.ieeeAddress, true);
    } catch {
      // The row may not exist yet if bridge/devices has not arrived; keeping
      // the device on the network is still the accept decision.
    }

    void this.tryIdentify(prompt.friendlyName);

    this.events.recordAsync({
      type: EventType.COMMAND,
      message: `Pairing accepted: ${prompt.friendlyName}`,
      friendlyName: prompt.friendlyName,
      ieeeAddress: prompt.ieeeAddress,
      data: { decision: 'accept', model: prompt.model },
    });
    this.gateway.emit(WS_EVENTS.PAIRING_RESOLVED, { ...prompt, decision: 'accept' });
    return prompt;
  }

  async reject(ieeeAddress: string, block = false): Promise<PairingPrompt> {
    const ieee = this.requirePendingIeee(ieeeAddress);
    const prompt = this.pendingPrompts.get(ieee)!;
    this.pendingPrompts.delete(ieee);

    const id = prompt.friendlyName || prompt.ieeeAddress;
    try {
      await this.commands.removeDevice(id, true, block);
    } catch (error) {
      this.logger.warn(
        `Failed to remove rejected device ${id}: ${(error as Error).message}`,
      );
      throw error;
    }

    this.events.recordAsync({
      type: EventType.COMMAND,
      severity: EventSeverity.WARNING,
      message: `Pairing rejected — removed ${prompt.friendlyName}`,
      friendlyName: prompt.friendlyName,
      ieeeAddress: prompt.ieeeAddress,
      data: { decision: 'reject', block },
    });
    this.gateway.emit(WS_EVENTS.PAIRING_RESOLVED, { ...prompt, decision: 'reject' });
    return prompt;
  }

  private async restoreUnconfirmedPrompts(coordinator: Coordinator): Promise<void> {
    const pending = await this.devices.findUnconfirmedPairings();
    for (const device of pending) {
      if (device.type === DeviceType.COORDINATOR) continue;
      const ieee = this.normalizeIeee(device.ieeeAddress);
      if (!ieee) continue;
      this.mergePrompt(ieee, {
        ieeeAddress: device.ieeeAddress,
        friendlyName: device.friendlyName,
        deviceId: device.id,
        manufacturer: device.manufacturer,
        model: device.model,
        description: device.description,
        imageUrl: device.imageUrl,
        interviewStatus: device.interviewStatus,
        supported: device.supported,
        linkQuality: device.linkQuality,
        pairingMode: coordinator.pairingMode ?? 'manual',
        joinedAt: device.createdAt?.toISOString() ?? new Date().toISOString(),
      });
    }
    if (this.pendingPrompts.size > 0) {
      this.logger.log(
        `Restored ${this.pendingPrompts.size} unpaired device prompt(s)`,
      );
    }
  }

  private mergePrompt(
    ieee: string,
    patch: Partial<PairingPrompt> & { ieeeAddress?: string },
  ): PairingPrompt {
    const previous = this.pendingPrompts.get(ieee);
    const linkQuality = patch.linkQuality ?? previous?.linkQuality ?? null;
    const prompt: PairingPrompt = {
      ieeeAddress: patch.ieeeAddress ?? previous?.ieeeAddress ?? ieee,
      friendlyName: patch.friendlyName ?? previous?.friendlyName ?? ieee,
      deviceId: patch.deviceId ?? previous?.deviceId ?? null,
      manufacturer: patch.manufacturer ?? previous?.manufacturer ?? null,
      model: patch.model ?? previous?.model ?? null,
      description: patch.description ?? previous?.description ?? null,
      imageUrl: patch.imageUrl ?? previous?.imageUrl ?? null,
      interviewStatus: patch.interviewStatus ?? previous?.interviewStatus ?? null,
      supported: patch.supported ?? previous?.supported ?? null,
      linkQuality,
      nearCoordinator: linkQuality == null || linkQuality >= NEAR_COORDINATOR_LQI,
      pairingMode: patch.pairingMode ?? previous?.pairingMode ?? 'manual',
      joinedAt: patch.joinedAt ?? previous?.joinedAt ?? new Date().toISOString(),
    };
    this.pendingPrompts.set(ieee, prompt);
    return prompt;
  }

  private emitPrompt(prompt: PairingPrompt): void {
    this.gateway.emit(WS_EVENTS.PAIRING_PROMPT, prompt);
  }

  private requirePendingIeee(ieeeAddress: string): string {
    const ieee = this.normalizeIeee(ieeeAddress) ?? this.findIeeeByFriendlyName(ieeeAddress);
    if (!ieee || !this.pendingPrompts.has(ieee)) {
      throw new NotFoundException(`No pending pairing prompt for "${ieeeAddress}"`);
    }
    return ieee;
  }

  private findIeeeByFriendlyName(friendlyName?: string | null): string | null {
    if (!friendlyName) return null;
    for (const [ieee, prompt] of this.pendingPrompts) {
      if (prompt.friendlyName === friendlyName) return ieee;
    }
    return this.normalizeIeee(this.devices.resolve(friendlyName)?.ieeeAddress ?? null);
  }

  private normalizeIeee(value?: string | null): string | null {
    if (!value) return null;
    return value.trim().toLowerCase();
  }

  private async tryIdentify(friendlyName: string): Promise<void> {
    try {
      await this.commands.identify(friendlyName);
    } catch {
      try {
        await this.commands.identify(friendlyName, true);
      } catch {
        // Many sensors have nothing to blink; ignore.
      }
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
