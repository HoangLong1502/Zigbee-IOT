import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { LessThan, Repository } from 'typeorm';
import { Device, History } from '../../domain/entities';
import { RetentionConfig } from '../../config/configuration';
import {
  flattenExposes,
  META_PROPERTIES,
} from '../../common/utils/expose.util';
import { toNumericValue, toStringValue } from '../../common/utils/value.util';
import type { ZigbeeDeviceState } from '../../common/types/zigbee.types';
import {
  HistoryAggregate,
  HistoryPointDto,
  HistoryRange,
  HistorySeriesDto,
  QueryHistoryDto,
} from './dto/history.dto';

interface BucketRow {
  bucket: Date;
  value: string | null;
  min: string | null;
  max: string | null;
  count: string;
}

/**
 * The per-property time series behind every chart.
 *
 * Any numeric or binary value in a payload is appended here, whatever its
 * name, so a new sensor type produces charts without a code change. Values
 * that cannot be projected onto a number (objects, free text) are kept as
 * `stringValue` for enum-style series such as `action` or `contact`.
 */
@Injectable()
export class HistoryService {
  private readonly logger = new Logger(HistoryService.name);
  private readonly retention: RetentionConfig;

  private buffer: History[] = [];
  private flushScheduled = false;
  private readonly maxBufferSize = 500;
  private readonly flushDelayMs = 1000;

  constructor(
    @InjectRepository(History) private readonly repository: Repository<History>,
    configService: ConfigService,
  ) {
    this.retention = configService.getOrThrow<RetentionConfig>('retention');
  }

  /**
   * Expands one payload into individual series points.
   *
   * Units are looked up from the device's expose metadata, again without any
   * hardcoded property list.
   */
  record(device: Device, payload: ZigbeeDeviceState, recordedAt: Date): void {
    const unitByProperty = new Map<string, string | null>();
    for (const expose of flattenExposes(device.exposesRaw)) {
      unitByProperty.set(expose.property, expose.unit);
    }

    for (const [property, raw] of Object.entries(payload)) {
      if (META_PROPERTIES.has(property) && property !== 'linkquality') continue;

      const numeric = toNumericValue(raw);
      const text = toStringValue(raw);
      // Nothing chartable and nothing displayable -> skip (e.g. nested objects).
      if (numeric === null && text === null) continue;

      this.buffer.push(
        this.repository.create({
          deviceId: device.id,
          property: property.slice(0, 128),
          value: numeric,
          stringValue: numeric === null ? text : null,
          unit: unitByProperty.get(property) ?? null,
          recordedAt,
        }),
      );
    }

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
      this.logger.error(`Failed to persist history batch: ${(error as Error).message}`);
    }
  }

  // -------------------------------------------------------------------------
  // Range handling
  // -------------------------------------------------------------------------

  /** Turns a range preset into concrete bounds and a sensible bucket size. */
  resolveRange(dto: QueryHistoryDto): { from: Date; to: Date; bucketSeconds: number } {
    const now = new Date();
    const range = dto.range ?? HistoryRange.LAST_24H;

    let from: Date;
    let to = now;
    let bucketSeconds: number;

    switch (range) {
      case HistoryRange.LAST_HOUR:
        from = new Date(now.getTime() - 3600_000);
        bucketSeconds = 60; // 60 points
        break;
      case HistoryRange.TODAY: {
        const midnight = new Date(now);
        midnight.setHours(0, 0, 0, 0);
        from = midnight;
        bucketSeconds = 300; // 5 minutes
        break;
      }
      case HistoryRange.LAST_24H:
        from = new Date(now.getTime() - 24 * 3600_000);
        bucketSeconds = 600; // 10 minutes -> 144 points
        break;
      case HistoryRange.LAST_7D:
        from = new Date(now.getTime() - 7 * 24 * 3600_000);
        bucketSeconds = 3600; // hourly -> 168 points
        break;
      case HistoryRange.LAST_30D:
        from = new Date(now.getTime() - 30 * 24 * 3600_000);
        bucketSeconds = 6 * 3600; // 6 hours -> 120 points
        break;
      case HistoryRange.CUSTOM:
      default: {
        from = dto.from ? new Date(dto.from) : new Date(now.getTime() - 24 * 3600_000);
        to = dto.to ? new Date(dto.to) : now;
        const span = Math.max((to.getTime() - from.getTime()) / 1000, 60);
        // Aim for roughly 200 points regardless of the requested span.
        bucketSeconds = Math.max(Math.round(span / 200), 1);
        break;
      }
    }

    return { from, to, bucketSeconds: dto.bucketSeconds ?? bucketSeconds };
  }

  /**
   * Down-samples a series into fixed time buckets.
   *
   * Bucketing happens in PostgreSQL (`floor(epoch / size)`) rather than in
   * Node, so a 30-day chart transfers ~120 rows instead of 100k.
   */
  async getSeries(
    deviceId: string,
    property: string,
    dto: QueryHistoryDto,
  ): Promise<HistorySeriesDto> {
    const { from, to, bucketSeconds } = this.resolveRange(dto);
    const aggregate = dto.aggregate ?? HistoryAggregate.AVG;

    const aggregateSql =
      aggregate === HistoryAggregate.SUM
        ? 'SUM(value)'
        : aggregate === HistoryAggregate.MIN
          ? 'MIN(value)'
          : aggregate === HistoryAggregate.MAX
            ? 'MAX(value)'
            : aggregate === HistoryAggregate.LAST
              ? '(ARRAY_AGG(value ORDER BY "recordedAt" DESC))[1]'
              : 'AVG(value)';

    const rows: BucketRow[] = await this.repository.query(
      `SELECT to_timestamp(floor(extract(epoch FROM "recordedAt") / $4) * $4) AS bucket,
              ${aggregateSql} AS value,
              MIN(value) AS min,
              MAX(value) AS max,
              COUNT(*)   AS count
         FROM history
        WHERE "deviceId" = $1
          AND property = $2
          AND "recordedAt" >= $3::timestamptz
          AND "recordedAt" <= $5::timestamptz
          AND value IS NOT NULL
        GROUP BY bucket
        ORDER BY bucket ASC
        LIMIT $6`,
      [deviceId, property, from.toISOString(), bucketSeconds, to.toISOString(), dto.limit ?? 5000],
    );

    const unitRow: Array<{ unit: string | null }> = await this.repository.query(
      `SELECT unit FROM history
        WHERE "deviceId" = $1 AND property = $2 AND unit IS NOT NULL
        ORDER BY "recordedAt" DESC LIMIT 1`,
      [deviceId, property],
    );

    const points: HistoryPointDto[] = rows.map((row) => ({
      timestamp: new Date(row.bucket).toISOString(),
      value: row.value === null ? null : Number(row.value),
      min: row.min === null ? null : Number(row.min),
      max: row.max === null ? null : Number(row.max),
      count: Number(row.count),
    }));

    return {
      property,
      unit: unitRow[0]?.unit ?? null,
      points,
      from: from.toISOString(),
      to: to.toISOString(),
      bucketSeconds,
    };
  }

  /** Every property of a device that has at least one recorded numeric sample. */
  async getChartableProperties(
    deviceId: string,
  ): Promise<Array<{ property: string; unit: string | null; samples: number }>> {
    const rows: Array<{ property: string; unit: string | null; samples: string }> =
      await this.repository.query(
        `SELECT property, MAX(unit) AS unit, COUNT(*) AS samples
           FROM history
          WHERE "deviceId" = $1 AND value IS NOT NULL
          GROUP BY property
          ORDER BY property ASC`,
        [deviceId],
      );

    return rows.map((row) => ({
      property: row.property,
      unit: row.unit,
      samples: Number(row.samples),
    }));
  }

  /** Raw (non-bucketed) rows, used for CSV/JSON export and table views. */
  async getRaw(
    deviceId: string,
    property: string,
    dto: QueryHistoryDto,
  ): Promise<History[]> {
    const { from, to } = this.resolveRange(dto);
    return this.repository
      .createQueryBuilder('history')
      .where('history.deviceId = :deviceId', { deviceId })
      .andWhere('history.property = :property', { property })
      .andWhere('history.recordedAt BETWEEN :from AND :to', { from, to })
      .orderBy('history.recordedAt', 'DESC')
      .take(Math.min(dto.limit ?? 1000, 5000))
      .getMany();
  }

  /**
   * Compares the same property across several devices - the basis of the
   * "all temperatures" style overview charts.
   */
  async getMultiDeviceSeries(
    deviceIds: string[],
    property: string,
    dto: QueryHistoryDto,
  ): Promise<Record<string, HistorySeriesDto>> {
    const result: Record<string, HistorySeriesDto> = {};
    for (const deviceId of deviceIds) {
      result[deviceId] = await this.getSeries(deviceId, property, dto);
    }
    return result;
  }

  @Cron(CronExpression.EVERY_DAY_AT_4AM)
  async prune(): Promise<void> {
    const cutoff = new Date(
      Date.now() - this.retention.historyRetentionDays * 24 * 3600_000,
    );
    const result = await this.repository.delete({ recordedAt: LessThan(cutoff) });
    if (result.affected) {
      this.logger.log(`Pruned ${result.affected} history rows older than ${cutoff.toISOString()}`);
    }
  }
}
