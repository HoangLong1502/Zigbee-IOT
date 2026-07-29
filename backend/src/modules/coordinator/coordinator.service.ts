import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Coordinator } from '../../domain/entities';
import type { ZigbeeBridgeInfo } from '../../common/types/zigbee.types';
import { formatExtendedPanId } from '../../common/utils/value.util';
import { WS_EVENTS } from '../../common/constants/ws-events';
import { RealtimeGateway } from '../websocket/realtime.gateway';
import { ZigbeeCommandService } from '../mqtt/zigbee-command.service';
import { DetectedSerialPort, SerialDetectionService } from './serial-detection.service';
import { PermitJoinDto, UpdateCoordinatorDto } from './dto/coordinator.dto';

/** The coordinator record enriched with live detection results. */
export interface CoordinatorView extends Coordinator {
  detectedPorts: DetectedSerialPort[];
  detectionAvailable: boolean;
  detectionUnavailableReason: string | null;
}

/**
 * Owns the coordinator record.
 *
 * Important boundary: Zigbee2MQTT holds the serial port open, so this service
 * never talks to the dongle itself. It mirrors what the bridge reports on
 * `bridge/info` and writes changes back through `bridge/request/options`,
 * which is the only safe way to reconfigure a running network.
 */
@Injectable()
export class CoordinatorService implements OnModuleInit {
  private readonly logger = new Logger(CoordinatorService.name);

  constructor(
    @InjectRepository(Coordinator) private readonly repository: Repository<Coordinator>,
    private readonly commands: ZigbeeCommandService,
    private readonly serial: SerialDetectionService,
    private readonly gateway: RealtimeGateway,
  ) {}

  async onModuleInit(): Promise<void> {
    const coordinator = await this.getOrCreate();

    // Pre-fill the serial settings from USB detection on first boot so the
    // settings page is not empty before Zigbee2MQTT reports in.
    if (!coordinator.serialPort) {
      const detected = await this.serial.detectCoordinatorPort();
      if (detected) {
        coordinator.serialPort = detected.path;
        coordinator.baudRate = detected.suggestedBaudRate;
        coordinator.adapter = detected.suggestedAdapter;
        coordinator.vendorId = detected.vendorId;
        coordinator.productId = detected.productId;
        coordinator.hardwareLabel = detected.label;
        await this.repository.save(coordinator);
        this.logger.log(`Detected Zigbee coordinator on ${detected.path} (${detected.label})`);
      }
    }
  }

  /** The singleton coordinator row, created on first access. */
  async getOrCreate(): Promise<Coordinator> {
    const existing = await this.repository.findOne({ where: { singleton: true } });
    if (existing) return existing;
    return this.repository.save(this.repository.create({ singleton: true }));
  }

  async getView(): Promise<CoordinatorView> {
    const coordinator = await this.getOrCreate();
    const detectedPorts = await this.serial.listPorts();

    return {
      ...coordinator,
      // The network key is a secret; expose only whether one is configured.
      networkKey: coordinator.networkKey ? '********' : null,
      detectedPorts,
      detectionAvailable: this.serial.detectionAvailable,
      detectionUnavailableReason: this.serial.unavailableReason,
    };
  }

  async listPorts(): Promise<DetectedSerialPort[]> {
    return this.serial.listPorts();
  }

  // -------------------------------------------------------------------------
  // Ingestion callbacks
  // -------------------------------------------------------------------------

  /** Applies a `bridge/info` document. */
  async applyBridgeInfo(info: ZigbeeBridgeInfo): Promise<Coordinator> {
    const coordinator = await this.getOrCreate();

    coordinator.zigbee2mqttVersion = info.version ?? coordinator.zigbee2mqttVersion;
    coordinator.herdsmanVersion =
      info.zigbee_herdsman?.version ?? coordinator.herdsmanVersion;
    coordinator.convertersVersion =
      info.zigbee_herdsman_converters?.version ?? coordinator.convertersVersion;
    coordinator.logLevel = info.log_level ?? coordinator.logLevel;
    coordinator.restartRequired = info.restart_required ?? false;
    coordinator.permitJoin = info.permit_join ?? false;
    coordinator.permitJoinTimeout = info.permit_join_timeout ?? null;

    if (info.coordinator) {
      coordinator.ieeeAddress = info.coordinator.ieee_address ?? coordinator.ieeeAddress;
      coordinator.coordinatorType = info.coordinator.type ?? coordinator.coordinatorType;
      coordinator.firmwareVersion =
        this.extractFirmwareVersion(info) ?? coordinator.firmwareVersion;
    }

    if (info.network) {
      coordinator.channel = info.network.channel ?? coordinator.channel;
      coordinator.panId = info.network.pan_id ?? coordinator.panId;
      coordinator.extendedPanId =
        formatExtendedPanId(info.network.extended_pan_id) ?? coordinator.extendedPanId;
    }

    if (info.config?.serial) {
      coordinator.serialPort = info.config.serial.port ?? coordinator.serialPort;
      coordinator.baudRate = info.config.serial.baudrate ?? coordinator.baudRate;
      coordinator.adapter = info.config.serial.adapter ?? coordinator.adapter;
    }

    const networkKey = (info.config?.advanced as Record<string, unknown> | undefined)
      ?.network_key;
    if (networkKey) coordinator.networkKey = JSON.stringify(networkKey);

    coordinator.infoRaw = info as unknown as Record<string, unknown>;
    coordinator.lastSeen = new Date();

    const saved = await this.repository.save(coordinator);
    this.emitUpdate(saved);
    return saved;
  }

  /**
   * The coordinator firmware version lives in different places depending on
   * the stack: z-stack reports a `revision`, ember an `ezsp` build string.
   */
  private extractFirmwareVersion(info: ZigbeeBridgeInfo): string | null {
    const meta = info.coordinator?.meta;
    if (!meta) return null;

    if (meta.revision !== undefined) return String(meta.revision);
    if (
      meta.majorrel !== undefined &&
      meta.minorrel !== undefined &&
      meta.maintrel !== undefined
    ) {
      return `${meta.majorrel}.${meta.minorrel}.${meta.maintrel}`;
    }
    const build = (meta as Record<string, unknown>).build;
    return build ? String(build) : null;
  }

  /** Applies `bridge/state` (the bridge's own online/offline LWT). */
  async setBridgeState(online: boolean): Promise<Coordinator> {
    const coordinator = await this.getOrCreate();
    if (coordinator.online === online) return coordinator;

    coordinator.online = online;
    if (online) coordinator.lastSeen = new Date();

    const saved = await this.repository.save(coordinator);
    this.emitUpdate(saved);
    return saved;
  }

  async setPermitJoinState(
    permitJoin: boolean,
    timeout: number | null = null,
  ): Promise<Coordinator> {
    const coordinator = await this.getOrCreate();
    coordinator.permitJoin = permitJoin;
    coordinator.permitJoinTimeout = timeout;

    const saved = await this.repository.save(coordinator);
    this.emitUpdate(saved);
    return saved;
  }

  // -------------------------------------------------------------------------
  // Commands
  // -------------------------------------------------------------------------

  async permitJoin(dto: PermitJoinDto): Promise<Coordinator> {
    await this.commands.permitJoin(dto.value, dto.time, dto.device);
    // The bridge confirms the change on bridge/info; update optimistically so
    // the UI reacts immediately.
    return this.setPermitJoinState(dto.value, dto.time ?? null);
  }

  /**
   * Pushes settings into Zigbee2MQTT's configuration.
   *
   * Serial and network settings only take effect after a bridge restart, and
   * changing the PAN id, channel or network key forces every device to be
   * re-paired - the caller is told through `restartRequired`.
   */
  async updateSettings(dto: UpdateCoordinatorDto): Promise<{
    coordinator: Coordinator;
    restartRequired: boolean;
    warnings: string[];
  }> {
    const options: Record<string, unknown> = {};
    const warnings: string[] = [];

    const serial: Record<string, unknown> = {};
    if (dto.serialPort !== undefined) serial.port = dto.serialPort;
    if (dto.baudRate !== undefined) serial.baudrate = dto.baudRate;
    if (dto.adapter !== undefined) serial.adapter = dto.adapter;
    if (Object.keys(serial).length > 0) {
      options.serial = serial;
      warnings.push('Serial settings require a Zigbee2MQTT restart');
    }

    const advanced: Record<string, unknown> = {};
    if (dto.panId !== undefined) advanced.pan_id = dto.panId;
    if (dto.channel !== undefined) advanced.channel = dto.channel;
    if (dto.extendedPanId !== undefined) {
      advanced.ext_pan_id = this.hexToByteArray(dto.extendedPanId);
    }
    if (dto.networkKey !== undefined) {
      advanced.network_key =
        dto.networkKey.toUpperCase() === 'GENERATE'
          ? 'GENERATE'
          : this.hexToByteArray(dto.networkKey);
    }
    if (dto.logLevel !== undefined) advanced.log_level = dto.logLevel;

    if (Object.keys(advanced).length > 0) options.advanced = advanced;

    if (dto.panId !== undefined || dto.channel !== undefined || dto.networkKey !== undefined) {
      warnings.push(
        'Changing the PAN id, channel or network key forms a new network - every device must be paired again',
      );
    }

    if (Object.keys(options).length === 0) {
      return { coordinator: await this.getOrCreate(), restartRequired: false, warnings };
    }

    await this.commands.setBridgeOptions(options);

    const coordinator = await this.getOrCreate();
    if (dto.serialPort !== undefined) coordinator.serialPort = dto.serialPort;
    if (dto.baudRate !== undefined) coordinator.baudRate = dto.baudRate;
    if (dto.adapter !== undefined) coordinator.adapter = dto.adapter;
    if (dto.panId !== undefined) coordinator.panId = dto.panId;
    if (dto.channel !== undefined) coordinator.channel = dto.channel;
    if (dto.extendedPanId !== undefined) coordinator.extendedPanId = dto.extendedPanId;
    if (dto.logLevel !== undefined) coordinator.logLevel = dto.logLevel;
    coordinator.restartRequired = warnings.length > 0;

    const saved = await this.repository.save(coordinator);
    this.emitUpdate(saved);

    return { coordinator: saved, restartRequired: saved.restartRequired, warnings };
  }

  async restart(): Promise<{ restarting: boolean }> {
    await this.commands.restartBridge();
    return { restarting: true };
  }

  async healthCheck(): Promise<{ healthy: boolean }> {
    const response = await this.commands.healthCheck();
    return { healthy: Boolean(response.data?.healthy) };
  }

  /** `"DDDDDDDDDDDDDDDD"` -> `[0xDD, 0xDD, ...]` as Zigbee2MQTT expects. */
  private hexToByteArray(hex: string): number[] {
    const clean = hex.replace(/^0x/i, '').replace(/[^0-9a-f]/gi, '');
    const bytes: number[] = [];
    for (let index = 0; index < clean.length; index += 2) {
      bytes.push(Number.parseInt(clean.slice(index, index + 2), 16));
    }
    return bytes;
  }

  private emitUpdate(coordinator: Coordinator): void {
    this.gateway.emit(WS_EVENTS.COORDINATOR_UPDATED, {
      ...coordinator,
      networkKey: coordinator.networkKey ? '********' : null,
    });
  }
}
