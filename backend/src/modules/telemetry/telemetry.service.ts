import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LessThan, Repository } from 'typeorm';
import { ConfigService } from '@nestjs/config';
import { Device, Telemetry } from '../../domain/entities';
import { RetentionConfig } from '../../config/configuration';
import type { ZigbeeDeviceState } from '../../common/types/zigbee.types';

/**
 * Stores the raw device payloads.
 *
 * This is the "everything as received" tier of the data model. It is written
 * on the hot path, so inserts are batched: a chatty network (power meters
 * reporting every second) would otherwise dominate the database round trips.
 */
@Injectable()
export class TelemetryService {
  private readonly logger = new Logger(TelemetryService.name);
  private readonly retention: RetentionConfig;

  private buffer: Telemetry[] = [];
  private flushScheduled = false;
  private readonly maxBufferSize = 200;
  private readonly flushDelayMs = 750;

  constructor(
    @InjectRepository(Telemetry) private readonly repository: Repository<Telemetry>,
    configService: ConfigService,
  ) {
    this.retention = configService.getOrThrow<RetentionConfig>('retention');
  }

  /** Queues one state message for persistence. */
  record(
    device: Device,
    topic: string,
    payload: ZigbeeDeviceState,
    receivedAt: Date,
  ): void {
    this.buffer.push(
      this.repository.create({
        deviceId: device.id,
        topic: topic.slice(0, 512),
        payload: payload as Record<string, unknown>,
        linkQuality: typeof payload.linkquality === 'number' ? payload.linkquality : null,
        receivedAt,
      }),
    );

    if (this.buffer.length >= this.maxBufferSize) {
      void this.flush();
      return;
    }
    if (!this.flushScheduled) {
      this.flushScheduled = true;
      setTimeout(() => void this.flush(), this.flushDelayMs).unref?.();
    }
  }

  private async flush(): Promise<void> {
    this.flushScheduled = false;
    if (this.buffer.length === 0) return;

    const batch = this.buffer;
    this.buffer = [];
    try {
      await this.repository.insert(batch as never);
    } catch (error) {
      this.logger.error(`Failed to persist telemetry batch: ${(error as Error).message}`);
    }
  }

  /** Most recent raw payloads, optionally scoped to a single device. */
  async findRecent(deviceId?: string, limit = 50): Promise<Telemetry[]> {
    return this.repository.find({
      where: deviceId ? { deviceId } : {},
      order: { receivedAt: 'DESC' },
      take: Math.min(limit, 500),
    });
  }

  async findLatestForDevice(deviceId: string): Promise<Telemetry | null> {
    return this.repository.findOne({
      where: { deviceId },
      order: { receivedAt: 'DESC' },
    });
  }

  /** Message throughput indicator shown on the dashboard. */
  async countSince(since: Date): Promise<number> {
    return this.repository
      .createQueryBuilder('telemetry')
      .where('telemetry.receivedAt >= :since', { since })
      .getCount();
  }

  /** Raw payloads are the bulkiest table; prune them on the same schedule. */
  @Cron(CronExpression.EVERY_DAY_AT_3AM)
  async prune(): Promise<void> {
    const cutoff = new Date(
      Date.now() - this.retention.historyRetentionDays * 24 * 3600_000,
    );
    const result = await this.repository.delete({ receivedAt: LessThan(cutoff) });
    if (result.affected) {
      this.logger.log(`Pruned ${result.affected} telemetry rows older than ${cutoff.toISOString()}`);
    }
  }
}
