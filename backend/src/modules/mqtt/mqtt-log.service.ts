import {
  Injectable,
  Logger,
  OnApplicationShutdown,
  OnModuleInit,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Brackets, LessThan, Repository } from 'typeorm';
import { MessageDirection, MqttLog } from '../../domain/entities';
import { RetentionConfig } from '../../config/configuration';
import { RealtimeGateway } from '../websocket/realtime.gateway';
import { QueryMqttLogsDto } from './dto/query-mqtt-logs.dto';

export interface MqttLogInput {
  topic: string;
  direction: MessageDirection;
  payload: string;
  payloadJson?: Record<string, unknown> | unknown[] | null;
  qos?: number;
  retain?: boolean;
  deviceName?: string | null;
  deviceId?: string | null;
  createdAt?: Date;
}

/**
 * Persists the raw MQTT traffic that powers the live log viewer.
 *
 * A busy Zigbee network easily produces hundreds of messages per minute, so
 * rows are buffered in memory and flushed as batched inserts. The WebSocket
 * broadcast happens immediately (the UI must feel live) while the database
 * write is deferred by at most `flushIntervalMs`.
 */
@Injectable()
export class MqttLogService implements OnModuleInit, OnApplicationShutdown {
  private readonly logger = new Logger(MqttLogService.name);
  private readonly retention: RetentionConfig;

  private buffer: MqttLog[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private readonly flushIntervalMs = 1000;
  private readonly maxBufferSize = 250;

  constructor(
    @InjectRepository(MqttLog)
    private readonly repository: Repository<MqttLog>,
    private readonly gateway: RealtimeGateway,
    configService: ConfigService,
  ) {
    this.retention = configService.getOrThrow<RetentionConfig>('retention');
  }

  onModuleInit(): void {
    this.flushTimer = setInterval(() => {
      void this.flush();
    }, this.flushIntervalMs);
  }

  async onApplicationShutdown(): Promise<void> {
    if (this.flushTimer) clearInterval(this.flushTimer);
    await this.flush();
  }

  /** Queues a frame for persistence and pushes it to subscribed clients. */
  record(input: MqttLogInput): void {
    const entity = this.repository.create({
      topic: input.topic.slice(0, 512),
      direction: input.direction,
      payload: input.payload,
      payloadJson: input.payloadJson ?? null,
      qos: input.qos ?? 0,
      retain: input.retain ?? false,
      deviceName: input.deviceName ?? null,
      deviceId: input.deviceId ?? null,
      size: Buffer.byteLength(input.payload, 'utf8'),
      createdAt: input.createdAt ?? new Date(),
    });

    this.buffer.push(entity);
    this.gateway.emitMqttMessage({
      topic: entity.topic,
      direction: entity.direction,
      payload: entity.payload,
      payloadJson: entity.payloadJson,
      qos: entity.qos,
      retain: entity.retain,
      deviceName: entity.deviceName,
      size: entity.size,
      createdAt: entity.createdAt,
    });

    if (this.buffer.length >= this.maxBufferSize) void this.flush();
  }

  private async flush(): Promise<void> {
    if (this.buffer.length === 0) return;
    const batch = this.buffer;
    this.buffer = [];

    try {
      // Cast: TypeORM's DeepPartial typing struggles with jsonb union columns.
      await this.repository.insert(batch as never);
    } catch (error) {
      this.logger.error(
        `Failed to persist ${batch.length} MQTT log rows: ${(error as Error).message}`,
      );
    }
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  async query(
    dto: QueryMqttLogsDto,
  ): Promise<{ items: MqttLog[]; total: number; limit: number; offset: number }> {
    const limit = Math.min(dto.limit ?? 100, 1000);
    const offset = dto.offset ?? 0;

    const qb = this.repository.createQueryBuilder('log');

    if (dto.topic) qb.andWhere('log.topic ILIKE :topic', { topic: `%${dto.topic}%` });
    if (dto.direction) qb.andWhere('log.direction = :direction', { direction: dto.direction });
    if (dto.device) qb.andWhere('log.deviceName ILIKE :device', { device: `%${dto.device}%` });
    if (dto.from) qb.andWhere('log.createdAt >= :from', { from: new Date(dto.from) });
    if (dto.to) qb.andWhere('log.createdAt <= :to', { to: new Date(dto.to) });

    // Free text search hits both the topic and the payload body.
    if (dto.search) {
      qb.andWhere(
        new Brackets((where) => {
          where
            .where('log.topic ILIKE :search', { search: `%${dto.search}%` })
            .orWhere('log.payload ILIKE :search', { search: `%${dto.search}%` });
        }),
      );
    }

    const [items, total] = await qb
      .orderBy('log.createdAt', 'DESC')
      .skip(offset)
      .take(limit)
      .getManyAndCount();

    return { items, total, limit, offset };
  }

  /** Same filters as {@link query} but without pagination, for JSON export. */
  async exportAll(dto: QueryMqttLogsDto): Promise<MqttLog[]> {
    const { items } = await this.query({ ...dto, limit: 10_000, offset: 0 });
    return items;
  }

  async clear(): Promise<{ deleted: number }> {
    const result = await this.repository.createQueryBuilder().delete().execute();
    return { deleted: result.affected ?? 0 };
  }

  async stats(): Promise<{ total: number; oldest: Date | null; newest: Date | null }> {
    const total = await this.repository.count();
    const oldest = await this.repository.findOne({
      where: {},
      order: { createdAt: 'ASC' },
    });
    const newest = await this.repository.findOne({
      where: {},
      order: { createdAt: 'DESC' },
    });
    return {
      total,
      oldest: oldest?.createdAt ?? null,
      newest: newest?.createdAt ?? null,
    };
  }

  // -------------------------------------------------------------------------
  // Retention - the log table would otherwise grow without bound
  // -------------------------------------------------------------------------

  @Cron(CronExpression.EVERY_HOUR)
  async pruneOldLogs(): Promise<void> {
    const cutoff = new Date(
      Date.now() - this.retention.mqttLogRetentionHours * 3600_000,
    );

    try {
      const byAge = await this.repository.delete({ createdAt: LessThan(cutoff) });
      if (byAge.affected) {
        this.logger.log(`Pruned ${byAge.affected} MQTT log rows older than ${cutoff.toISOString()}`);
      }

      // Hard cap as a second safety net against traffic spikes.
      const total = await this.repository.count();
      const excess = total - this.retention.mqttLogMaxRows;
      if (excess > 0) {
        await this.repository.query(
          `DELETE FROM mqtt_logs WHERE id IN (
             SELECT id FROM mqtt_logs ORDER BY "createdAt" ASC LIMIT $1
           )`,
          [excess],
        );
        this.logger.log(`Pruned ${excess} MQTT log rows to respect the row cap`);
      }
    } catch (error) {
      this.logger.error(`MQTT log pruning failed: ${(error as Error).message}`);
    }
  }
}
