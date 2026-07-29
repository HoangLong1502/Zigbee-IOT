import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Alert,
  AlertSeverity,
  AlertType,
  Device,
} from '../../domain/entities';
import { AlertConfig } from '../../config/configuration';
import { WS_EVENTS } from '../../common/constants/ws-events';
import { RealtimeGateway } from '../websocket/realtime.gateway';
import { toBooleanValue, toNumericValue } from '../../common/utils/value.util';
import type { ZigbeeDeviceState } from '../../common/types/zigbee.types';

export interface RaiseAlertInput {
  type: AlertType | string;
  message: string;
  severity?: AlertSeverity;
  device?: Device | null;
  friendlyName?: string | null;
  property?: string | null;
  value?: unknown;
  threshold?: number | null;
}

/**
 * A single alert rule.
 *
 * Rules are declarative and driven by property names, so adding a new safety
 * condition never requires touching the evaluation loop.
 */
interface PropertyRule {
  /** Property names that trigger this rule when their value is "active". */
  properties: string[];
  type: AlertType;
  severity: AlertSeverity;
  /** Returns true when the value means "alarm". */
  predicate: (value: unknown, config: AlertConfig) => boolean;
  message: (friendlyName: string, value: unknown) => string;
  /** Whether the alert auto-resolves once the condition clears. */
  autoResolve: boolean;
}

@Injectable()
export class AlertService {
  private readonly logger = new Logger(AlertService.name);
  private readonly config: AlertConfig;

  /**
   * Binary safety sensors: an alert is raised when the value is truthy and
   * resolved automatically when it returns to normal.
   */
  private readonly rules: PropertyRule[] = [
    {
      properties: ['water_leak'],
      type: AlertType.WATER_LEAK,
      severity: AlertSeverity.CRITICAL,
      predicate: (value) => toBooleanValue(value) === true,
      message: (name) => `Water leak detected by ${name}`,
      autoResolve: true,
    },
    {
      properties: ['smoke'],
      type: AlertType.SMOKE,
      severity: AlertSeverity.CRITICAL,
      predicate: (value) => toBooleanValue(value) === true,
      message: (name) => `Smoke detected by ${name}`,
      autoResolve: true,
    },
    {
      properties: ['gas', 'carbon_monoxide'],
      type: AlertType.GAS,
      severity: AlertSeverity.CRITICAL,
      predicate: (value) => toBooleanValue(value) === true,
      message: (name) => `Gas alarm reported by ${name}`,
      autoResolve: true,
    },
    {
      properties: ['tamper'],
      type: AlertType.TAMPER,
      severity: AlertSeverity.WARNING,
      predicate: (value) => toBooleanValue(value) === true,
      message: (name) => `${name} reported tampering`,
      autoResolve: true,
    },
    {
      properties: ['temperature'],
      type: AlertType.HIGH_TEMPERATURE,
      severity: AlertSeverity.WARNING,
      predicate: (value, config) => {
        const numeric = toNumericValue(value);
        return numeric !== null && numeric >= config.highTemperatureC;
      },
      message: (name, value) => `${name} reports a high temperature of ${String(value)} °C`,
      autoResolve: true,
    },
    {
      properties: ['battery'],
      type: AlertType.LOW_BATTERY,
      severity: AlertSeverity.WARNING,
      predicate: (value, config) => {
        const numeric = toNumericValue(value);
        return numeric !== null && numeric <= config.lowBatteryPercent;
      },
      message: (name, value) => `${name} battery is low (${String(value)}%)`,
      autoResolve: true,
    },
    {
      properties: ['battery_low'],
      type: AlertType.LOW_BATTERY,
      severity: AlertSeverity.WARNING,
      predicate: (value) => toBooleanValue(value) === true,
      message: (name) => `${name} reports a low battery`,
      autoResolve: true,
    },
  ];

  constructor(
    @InjectRepository(Alert) private readonly repository: Repository<Alert>,
    private readonly gateway: RealtimeGateway,
    configService: ConfigService,
  ) {
    this.config = configService.getOrThrow<AlertConfig>('alerts');
  }

  // -------------------------------------------------------------------------
  // Rule evaluation
  // -------------------------------------------------------------------------

  /**
   * Runs every rule against an incoming payload.
   *
   * Called from the ingestion pipeline right after the payload is persisted,
   * which keeps alerting on the same code path as the data it reacts to.
   */
  async evaluate(device: Device, payload: ZigbeeDeviceState): Promise<void> {
    for (const rule of this.rules) {
      for (const property of rule.properties) {
        if (!(property in payload)) continue;

        const value = payload[property];
        const triggered = rule.predicate(value, this.config);

        if (triggered) {
          await this.raise({
            type: rule.type,
            severity: rule.severity,
            message: rule.message(device.friendlyName, value),
            device,
            property,
            value,
            threshold:
              rule.type === AlertType.HIGH_TEMPERATURE
                ? this.config.highTemperatureC
                : rule.type === AlertType.LOW_BATTERY
                  ? this.config.lowBatteryPercent
                  : null,
          });
        } else if (rule.autoResolve) {
          await this.resolveByCondition(device.id, rule.type, property);
        }
      }
    }
  }

  // -------------------------------------------------------------------------
  // Lifecycle
  // -------------------------------------------------------------------------

  /**
   * Raises an alert, de-duplicating against an existing unresolved one for the
   * same (device, type). A leaking sensor reporting every ten seconds bumps
   * `occurrences` instead of creating thousands of rows.
   */
  async raise(input: RaiseAlertInput): Promise<Alert> {
    const existing = await this.repository.findOne({
      where: {
        deviceId: input.device?.id ?? undefined,
        type: input.type,
        resolved: false,
      },
      order: { createdAt: 'DESC' },
    });

    if (existing) {
      existing.occurrences += 1;
      existing.lastOccurredAt = new Date();
      existing.value = input.value ?? existing.value;
      const updated = await this.repository.save(existing);
      this.gateway.emit(WS_EVENTS.ALERT_UPDATED, updated);
      return updated;
    }

    const alert = this.repository.create({
      type: input.type,
      severity: input.severity ?? AlertSeverity.WARNING,
      message: input.message,
      deviceId: input.device?.id ?? null,
      friendlyName: input.friendlyName ?? input.device?.friendlyName ?? null,
      property: input.property ?? null,
      value: input.value ?? null,
      threshold: input.threshold ?? null,
      lastOccurredAt: new Date(),
    });

    const saved = await this.repository.save(alert);
    this.logger.warn(`Alert raised: ${saved.message}`);
    // Drives the browser notification on the frontend.
    this.gateway.emit(WS_EVENTS.ALERT_CREATED, saved);
    return saved;
  }

  /** Fire-and-forget variant for the ingestion path. */
  raiseAsync(input: RaiseAlertInput): void {
    void this.raise(input).catch((error: Error) =>
      this.logger.error(`Failed to raise alert: ${error.message}`),
    );
  }

  /** Clears an auto-resolving alert once the sensor reports normal again. */
  private async resolveByCondition(
    deviceId: string,
    type: AlertType,
    property: string,
  ): Promise<void> {
    const open = await this.repository.find({
      where: { deviceId, type, resolved: false, property },
    });
    for (const alert of open) await this.resolve(alert.id);
  }

  async resolve(id: string): Promise<Alert> {
    const alert = await this.repository.findOne({ where: { id } });
    if (!alert) throw new NotFoundException(`Alert ${id} not found`);
    if (alert.resolved) return alert;

    alert.resolved = true;
    alert.resolvedAt = new Date();
    const saved = await this.repository.save(alert);
    this.gateway.emit(WS_EVENTS.ALERT_UPDATED, saved);
    return saved;
  }

  async acknowledge(id: string): Promise<Alert> {
    const alert = await this.repository.findOne({ where: { id } });
    if (!alert) throw new NotFoundException(`Alert ${id} not found`);

    alert.acknowledged = true;
    alert.acknowledgedAt = new Date();
    const saved = await this.repository.save(alert);
    this.gateway.emit(WS_EVENTS.ALERT_UPDATED, saved);
    return saved;
  }

  async acknowledgeAll(): Promise<{ acknowledged: number }> {
    const result = await this.repository.update(
      { acknowledged: false },
      { acknowledged: true, acknowledgedAt: new Date() },
    );
    return { acknowledged: result.affected ?? 0 };
  }

  /** Called when a device comes back online, closing its offline alert. */
  async resolveDeviceOffline(deviceId: string): Promise<void> {
    const open = await this.repository.find({
      where: { deviceId, type: AlertType.DEVICE_OFFLINE, resolved: false },
    });
    for (const alert of open) await this.resolve(alert.id);
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  async findAll(params: {
    resolved?: boolean;
    acknowledged?: boolean;
    severity?: AlertSeverity;
    type?: string;
    deviceId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: Alert[]; total: number }> {
    const qb = this.repository.createQueryBuilder('alert');

    if (params.resolved !== undefined) {
      qb.andWhere('alert.resolved = :resolved', { resolved: params.resolved });
    }
    if (params.acknowledged !== undefined) {
      qb.andWhere('alert.acknowledged = :acknowledged', { acknowledged: params.acknowledged });
    }
    if (params.severity) qb.andWhere('alert.severity = :severity', { severity: params.severity });
    if (params.type) qb.andWhere('alert.type = :type', { type: params.type });
    if (params.deviceId) qb.andWhere('alert.deviceId = :deviceId', { deviceId: params.deviceId });

    const [items, total] = await qb
      .orderBy('alert.lastOccurredAt', 'DESC')
      .skip(params.offset ?? 0)
      .take(Math.min(params.limit ?? 100, 500))
      .getManyAndCount();

    return { items, total };
  }

  async getSummary(): Promise<{
    active: number;
    critical: number;
    warning: number;
    unacknowledged: number;
  }> {
    const active = await this.repository.count({ where: { resolved: false } });
    const critical = await this.repository.count({
      where: { resolved: false, severity: AlertSeverity.CRITICAL },
    });
    const warning = await this.repository.count({
      where: { resolved: false, severity: AlertSeverity.WARNING },
    });
    const unacknowledged = await this.repository.count({
      where: { resolved: false, acknowledged: false },
    });

    return { active, critical, warning, unacknowledged };
  }

  /** Threshold values currently in effect, surfaced on the settings page. */
  getThresholds(): AlertConfig {
    return this.config;
  }
}
