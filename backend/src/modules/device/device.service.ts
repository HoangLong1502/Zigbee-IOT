import { Injectable, Logger, NotFoundException, OnModuleInit } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Brackets, In, Repository } from 'typeorm';
import {
  Device,
  DeviceAttribute,
  DeviceExpose,
  DeviceType,
  InterviewStatus,
} from '../../domain/entities';
import type {
  ZigbeeBridgeDevice,
  ZigbeeDeviceState,
} from '../../common/types/zigbee.types';
import { flattenExposes } from '../../common/utils/expose.util';
import {
  detectValueType,
  toNumericValue,
} from '../../common/utils/value.util';
import { AlertConfig, RetentionConfig } from '../../config/configuration';
import { WS_EVENTS } from '../../common/constants/ws-events';
import { RealtimeGateway } from '../websocket/realtime.gateway';
import { DeviceStatsDto, QueryDevicesDto } from './dto/device.dto';

/** What the ingestion pipeline learned from one device state message. */
export interface AppliedState {
  device: Device;
  changedProperties: string[];
  linkQuality: number | null;
  battery: number | null;
}

/**
 * Owns the device registry.
 *
 * Two responsibilities:
 *  1. Keep the `devices` / `device_exposes` tables in sync with whatever
 *     Zigbee2MQTT reports on `bridge/devices` (discovery).
 *  2. Apply incoming state messages to the live columns (`lastSeen`,
 *     `linkQuality`, `battery`, `lastPayload`) and to `device_attributes`.
 *
 * A friendly-name/IEEE index is kept in memory because the ingestion path runs
 * for every single MQTT frame and must not hit the database just to resolve
 * which device a topic belongs to.
 */
@Injectable()
export class DeviceService implements OnModuleInit {
  private readonly logger = new Logger(DeviceService.name);

  private readonly byFriendlyName = new Map<string, Device>();
  private readonly byIeee = new Map<string, Device>();

  private readonly alertConfig: AlertConfig;
  private readonly retention: RetentionConfig;

  constructor(
    @InjectRepository(Device) private readonly devices: Repository<Device>,
    @InjectRepository(DeviceExpose) private readonly exposes: Repository<DeviceExpose>,
    @InjectRepository(DeviceAttribute)
    private readonly attributes: Repository<DeviceAttribute>,
    private readonly gateway: RealtimeGateway,
    configService: ConfigService,
  ) {
    this.alertConfig = configService.getOrThrow<AlertConfig>('alerts');
    this.retention = configService.getOrThrow<RetentionConfig>('retention');
  }

  async onModuleInit(): Promise<void> {
    await this.reloadCache();
    await this.refreshExposesFromStoredRaw();
  }

  /** Re-flatten exposes from stored Zigbee2MQTT definitions (adds group keys, etc.). */
  private async refreshExposesFromStoredRaw(): Promise<void> {
    const devices = await this.devices.find();
    let refreshed = 0;
    for (const device of devices) {
      if (!device.exposesRaw?.length) continue;
      await this.replaceExposes(device, device.exposesRaw);
      refreshed += 1;
    }
    if (refreshed > 0) {
      this.logger.log(`Refreshed expose metadata for ${refreshed} device(s)`);
    }
  }

  private async reloadCache(): Promise<void> {
    const all = await this.devices.find();
    this.byFriendlyName.clear();
    this.byIeee.clear();
    for (const device of all) this.index(device);
    this.logger.log(`Loaded ${all.length} devices into the resolution cache`);
  }

  private index(device: Device): void {
    this.byFriendlyName.set(device.friendlyName, device);
    this.byIeee.set(device.ieeeAddress.toLowerCase(), device);
  }

  // -------------------------------------------------------------------------
  // Resolution helpers used by the hot ingestion path
  // -------------------------------------------------------------------------

  /** Resolves a device by friendly name or IEEE address, without a DB round trip. */
  resolve(identifier: string): Device | undefined {
    return (
      this.byFriendlyName.get(identifier) ?? this.byIeee.get(identifier.toLowerCase())
    );
  }

  get cachedDevices(): Device[] {
    return [...this.byIeee.values()];
  }

  // -------------------------------------------------------------------------
  // Discovery: bridge/devices -> database
  // -------------------------------------------------------------------------

  /**
   * Reconciles the full device list published by Zigbee2MQTT.
   *
   * The bridge always publishes the *complete* list, so this is a full sync:
   * new entries are inserted, known ones patched, and devices that disappeared
   * are reported back to the caller so an event can be recorded.
   */
  async syncFromBridge(
    bridgeDevices: ZigbeeBridgeDevice[],
  ): Promise<{ added: Device[]; updated: Device[]; removed: Device[] }> {
    const added: Device[] = [];
    const updated: Device[] = [];

    const seenIeee = new Set<string>();

    for (const entry of bridgeDevices) {
      if (!entry?.ieee_address) continue;
      seenIeee.add(entry.ieee_address.toLowerCase());

      const existing =
        this.byIeee.get(entry.ieee_address.toLowerCase()) ??
        (await this.devices.findOne({ where: { ieeeAddress: entry.ieee_address } }));

      const isNew = !existing;
      const device = existing ?? this.devices.create({ ieeeAddress: entry.ieee_address });

      const previousName = device.friendlyName;
      this.applyBridgeEntry(device, entry);

      const saved = await this.devices.save(device);
      this.index(saved);

      // A rename invalidates the old cache key.
      if (previousName && previousName !== saved.friendlyName) {
        this.byFriendlyName.delete(previousName);
      }

      await this.syncExposes(saved, entry);

      if (isNew) added.push(saved);
      else updated.push(saved);
    }

    // Anything not present in the bridge list has left the network.
    const removed: Device[] = [];
    for (const device of this.byIeee.values()) {
      if (seenIeee.has(device.ieeeAddress.toLowerCase())) continue;
      removed.push(device);
    }
    if (removed.length > 0) {
      await this.devices.delete({ id: In(removed.map((device) => device.id)) });
      for (const device of removed) {
        this.byIeee.delete(device.ieeeAddress.toLowerCase());
        this.byFriendlyName.delete(device.friendlyName);
      }
    }

    this.logger.log(
      `bridge/devices sync: ${added.length} added, ${updated.length} updated, ${removed.length} removed`,
    );
    return { added, updated, removed };
  }

  /** Maps one `bridge/devices` entry onto our column model. */
  private applyBridgeEntry(device: Device, entry: ZigbeeBridgeDevice): void {
    device.friendlyName = entry.friendly_name ?? entry.ieee_address;
    device.networkAddress = entry.network_address ?? device.networkAddress ?? null;
    device.type = (entry.type as DeviceType) ?? DeviceType.UNKNOWN;
    device.manufacturer =
      entry.manufacturer ?? entry.definition?.vendor ?? device.manufacturer ?? null;
    device.model = entry.definition?.model ?? entry.model_id ?? device.model ?? null;
    device.description =
      entry.definition?.description ?? entry.description ?? device.description ?? null;
    device.powerSource = entry.power_source ?? device.powerSource ?? null;
    device.softwareBuildId = entry.software_build_id ?? device.softwareBuildId ?? null;
    device.dateCode = entry.date_code ?? device.dateCode ?? null;
    device.supported = entry.supported ?? true;
    device.disabled = entry.disabled ?? false;
    device.supportsOta = entry.definition?.supports_ota ?? false;
    device.imageUrl = entry.definition?.icon ?? device.imageUrl ?? null;
    device.endpoints = entry.endpoints ?? device.endpoints ?? null;
    device.exposesRaw = entry.definition?.exposes ?? device.exposesRaw ?? null;
    device.definitionRaw = entry as unknown as Record<string, unknown>;

    device.interviewCompleted = entry.interview_completed ?? device.interviewCompleted ?? false;
    if (entry.interviewing) device.interviewStatus = InterviewStatus.STARTED;
    else if (entry.interview_completed) device.interviewStatus = InterviewStatus.SUCCESSFUL;
    else if (entry.interview_state === 'FAILED') device.interviewStatus = InterviewStatus.FAILED;

    // The coordinator itself is always reachable while the bridge is up.
    if (device.type === DeviceType.COORDINATOR) device.online = true;
  }

  /**
   * Rebuilds the flattened expose rows for a device.
   *
   * Nothing is hardcoded: whatever properties the converter reports become
   * rows, which is what lets the frontend render an unknown device correctly.
   */
  private async syncExposes(device: Device, entry: ZigbeeBridgeDevice): Promise<void> {
    await this.replaceExposes(device, entry.definition?.exposes ?? []);
  }

  private async replaceExposes(
    device: Device,
    raw: NonNullable<Device['exposesRaw']>,
  ): Promise<void> {
    const flat = flattenExposes(raw);
    if (flat.length === 0) return;

    // Replace-all keeps the table free of historical NULL-endpoint duplicates
    // (Postgres UNIQUE treats NULLs as distinct).
    await this.exposes
      .createQueryBuilder()
      .delete()
      .where('deviceId = :deviceId', { deviceId: device.id })
      .execute();

    const rows = flat.map((expose) =>
      this.exposes.create({
        deviceId: device.id,
        property: expose.property,
        name: expose.name,
        label: expose.label,
        type: expose.type,
        parentType: expose.parentType,
        groupKey: expose.groupKey,
        groupLabel: expose.groupLabel,
        groupDescription: expose.groupDescription,
        endpoint: expose.endpoint || '',
        access: expose.access,
        unit: expose.unit,
        description: expose.description,
        category: expose.category,
        valueMin: expose.valueMin,
        valueMax: expose.valueMax,
        valueStep: expose.valueStep,
        values: expose.values,
        valueOn: expose.valueOn,
        valueOff: expose.valueOff,
        valueToggle: expose.valueToggle,
        raw: expose.raw,
      }),
    );

    await this.exposes.insert(rows as never);
  }

  // -------------------------------------------------------------------------
  // Live state
  // -------------------------------------------------------------------------

  /**
   * Applies an incoming device state payload.
   *
   * Called for every message on `zigbee2mqtt/<friendly_name>`. Only the live
   * columns are touched here; time-series persistence is done by the telemetry
   * and history services so that each concern stays in one place.
   */
  async applyState(
    device: Device,
    payload: ZigbeeDeviceState,
    receivedAt: Date,
  ): Promise<AppliedState> {
    const changedProperties: string[] = [];
    const previous = device.lastPayload ?? {};

    for (const [key, value] of Object.entries(payload)) {
      if (JSON.stringify(previous[key]) !== JSON.stringify(value)) {
        changedProperties.push(key);
      }
    }

    const linkQuality =
      typeof payload.linkquality === 'number' ? payload.linkquality : device.linkQuality;
    const battery =
      typeof payload.battery === 'number' ? payload.battery : device.battery;
    const batteryVoltage =
      typeof payload.voltage === 'number' ? payload.voltage : device.batteryVoltage;
    // Only a handful of converters expose RSSI; keep whatever we had otherwise.
    const rssiRaw = (payload as Record<string, unknown>).rssi;
    const rssi = typeof rssiRaw === 'number' ? rssiRaw : device.rssi;

    device.lastPayload = { ...previous, ...payload };
    device.lastSeen = receivedAt;
    device.linkQuality = linkQuality ?? null;
    device.battery = battery ?? null;
    device.batteryVoltage = batteryVoltage ?? null;
    device.rssi = rssi ?? null;
    // Receiving a message is itself proof the device is reachable.
    device.online = true;

    await this.devices.update(device.id, {
      lastPayload: device.lastPayload as never,
      lastSeen: device.lastSeen,
      linkQuality: device.linkQuality,
      battery: device.battery,
      batteryVoltage: device.batteryVoltage,
      rssi: device.rssi,
      online: true,
    });
    this.index(device);

    await this.upsertAttributes(device, payload, receivedAt);

    return {
      device,
      changedProperties,
      linkQuality: device.linkQuality,
      battery: device.battery,
    };
  }

  /** Stores the newest value of every property in the payload. */
  private async upsertAttributes(
    device: Device,
    payload: ZigbeeDeviceState,
    receivedAt: Date,
  ): Promise<void> {
    const unitByProperty = new Map<string, string | null>();
    for (const expose of flattenExposes(device.exposesRaw)) {
      unitByProperty.set(expose.property, expose.unit);
    }

    const rows = Object.entries(payload).map(([property, value]) =>
      this.attributes.create({
        deviceId: device.id,
        property: property.slice(0, 128),
        value: value as unknown,
        numericValue: toNumericValue(value),
        valueType: detectValueType(value),
        unit: unitByProperty.get(property) ?? null,
        updatedAtSource: receivedAt,
      }),
    );

    if (rows.length === 0) return;
    await this.attributes.upsert(rows as never, {
      conflictPaths: ['deviceId', 'property'],
    });
  }

  /** Handles `zigbee2mqtt/<device>/availability`. */
  async setAvailability(device: Device, online: boolean): Promise<Device> {
    if (device.online === online) return device;

    device.online = online;
    await this.devices.update(device.id, { online });
    this.index(device);

    this.gateway.emit(WS_EVENTS.DEVICE_AVAILABILITY, {
      id: device.id,
      ieeeAddress: device.ieeeAddress,
      friendlyName: device.friendlyName,
      online,
    });
    return device;
  }

  /**
   * Marks devices offline when nothing was heard for longer than the timeout.
   *
   * Zigbee2MQTT's own availability feature is optional, so this is a safety
   * net that keeps the dashboard honest when it is turned off.
   */
  async markStaleDevicesOffline(): Promise<Device[]> {
    const cutoff = new Date(
      Date.now() - this.retention.deviceOfflineTimeoutMinutes * 60_000,
    );

    const stale = await this.devices
      .createQueryBuilder('device')
      .where('device.online = true')
      .andWhere('device.type != :coordinator', { coordinator: DeviceType.COORDINATOR })
      .andWhere('(device.lastSeen IS NULL OR device.lastSeen < :cutoff)', { cutoff })
      .getMany();

    for (const device of stale) await this.setAvailability(device, false);
    return stale;
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  async findAll(
    dto: QueryDevicesDto,
  ): Promise<{ items: Device[]; total: number; limit: number; offset: number }> {
    const limit = Math.min(dto.limit ?? 200, 1000);
    const offset = dto.offset ?? 0;

    const qb = this.devices.createQueryBuilder('device');

    if (dto.search) {
      qb.andWhere(
        new Brackets((where) => {
          where
            .where('device.friendlyName ILIKE :search', { search: `%${dto.search}%` })
            .orWhere('device.model ILIKE :search', { search: `%${dto.search}%` })
            .orWhere('device.manufacturer ILIKE :search', { search: `%${dto.search}%` })
            .orWhere('device.ieeeAddress ILIKE :search', { search: `%${dto.search}%` });
        }),
      );
    }
    if (dto.type) qb.andWhere('device.type = :type', { type: dto.type });
    if (dto.online !== undefined) qb.andWhere('device.online = :online', { online: dto.online });
    if (dto.exposes) {
      qb.andWhere(
        `EXISTS (SELECT 1 FROM device_exposes e
                 WHERE e."deviceId" = device.id AND e.property = :property)`,
        { property: dto.exposes },
      );
    }

    const [items, total] = await qb
      .orderBy('device.friendlyName', 'ASC')
      .skip(offset)
      .take(limit)
      .getManyAndCount();

    return { items, total, limit, offset };
  }

  async findOne(idOrAddress: string): Promise<Device> {
    const device = await this.devices
      .createQueryBuilder('device')
      .leftJoinAndSelect('device.exposes', 'expose')
      .leftJoinAndSelect('device.attributes', 'attribute')
      .where('device.ieeeAddress = :value', { value: idOrAddress })
      .orWhere('device.friendlyName = :value', { value: idOrAddress })
      .orWhere(this.isUuid(idOrAddress) ? 'device.id = :value' : '1 = 0', {
        value: idOrAddress,
      })
      .getOne();

    if (!device) throw new NotFoundException(`Device "${idOrAddress}" not found`);
    return device;
  }

  private isUuid(value: string): boolean {
    return /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(value);
  }

  async findExposes(deviceId: string): Promise<DeviceExpose[]> {
    return this.exposes.find({
      where: { deviceId },
      order: { type: 'ASC', property: 'ASC' },
    });
  }

  async findAttributes(deviceId: string): Promise<DeviceAttribute[]> {
    return this.attributes.find({
      where: { deviceId },
      order: { property: 'ASC' },
    });
  }

  /** Dashboard counters, including a derived mesh health score. */
  async getStats(): Promise<DeviceStatsDto> {
    const devices = await this.devices.find();
    const nonCoordinator = devices.filter(
      (device) => device.type !== DeviceType.COORDINATOR,
    );

    const online = nonCoordinator.filter((device) => device.online);
    const withLqi = online.filter(
      (device) => typeof device.linkQuality === 'number' && device.linkQuality > 0,
    );

    const averageLinkQuality =
      withLqi.length > 0
        ? withLqi.reduce((sum, device) => sum + (device.linkQuality ?? 0), 0) / withLqi.length
        : 0;

    const onlineRatio =
      nonCoordinator.length > 0 ? online.length / nonCoordinator.length : 1;
    // Health blends reachability (70%) with average signal strength (30%).
    const networkHealth = Math.round(
      onlineRatio * 70 + Math.min(averageLinkQuality / 255, 1) * 30,
    );

    return {
      total: nonCoordinator.length,
      online: online.length,
      offline: nonCoordinator.length - online.length,
      routers: nonCoordinator.filter((device) => device.type === DeviceType.ROUTER).length,
      endDevices: nonCoordinator.filter((device) => device.type === DeviceType.END_DEVICE).length,
      batteryPowered: nonCoordinator.filter(
        (device) => device.powerSource === 'Battery',
      ).length,
      lowBattery: nonCoordinator.filter(
        (device) =>
          typeof device.battery === 'number' &&
          device.battery <= this.alertConfig.lowBatteryPercent,
      ).length,
      unsupported: nonCoordinator.filter((device) => !device.supported).length,
      averageLinkQuality: Math.round(averageLinkQuality),
      networkHealth,
    };
  }

  /** Used by the ingestion service after a rename so the cache stays correct. */
  async refresh(): Promise<void> {
    await this.reloadCache();
  }
}
