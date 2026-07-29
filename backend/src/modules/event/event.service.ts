import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import {
  Device,
  DeviceEvent,
  EventSeverity,
  EventType,
} from '../../domain/entities';
import { WS_EVENTS } from '../../common/constants/ws-events';
import { RealtimeGateway } from '../websocket/realtime.gateway';

export interface RecordEventInput {
  type: EventType | string;
  message: string;
  severity?: EventSeverity;
  device?: Device | null;
  friendlyName?: string | null;
  ieeeAddress?: string | null;
  data?: Record<string, unknown> | null;
}

/**
 * The network timeline: joins, leaves, interviews, renames, bridge state
 * changes and MQTT connectivity, all in one chronological stream.
 */
@Injectable()
export class EventService {
  private readonly logger = new Logger(EventService.name);

  constructor(
    @InjectRepository(DeviceEvent) private readonly repository: Repository<DeviceEvent>,
    private readonly gateway: RealtimeGateway,
  ) {}

  /** Persists an event and pushes it to connected dashboards immediately. */
  async record(input: RecordEventInput): Promise<DeviceEvent> {
    const entity = this.repository.create({
      type: input.type,
      severity: input.severity ?? EventSeverity.INFO,
      message: input.message,
      deviceId: input.device?.id ?? null,
      friendlyName: input.friendlyName ?? input.device?.friendlyName ?? null,
      ieeeAddress: input.ieeeAddress ?? input.device?.ieeeAddress ?? null,
      data: input.data ?? null,
    });

    const saved = await this.repository.save(entity);
    this.gateway.emit(WS_EVENTS.EVENT_CREATED, saved);
    return saved;
  }

  /** Fire-and-forget variant for the hot ingestion path. */
  recordAsync(input: RecordEventInput): void {
    void this.record(input).catch((error: Error) =>
      this.logger.error(`Failed to record event: ${error.message}`),
    );
  }

  async findAll(params: {
    type?: string;
    severity?: EventSeverity;
    deviceId?: string;
    limit?: number;
    offset?: number;
  }): Promise<{ items: DeviceEvent[]; total: number }> {
    const qb = this.repository.createQueryBuilder('event');

    if (params.type) qb.andWhere('event.type = :type', { type: params.type });
    if (params.severity) qb.andWhere('event.severity = :severity', { severity: params.severity });
    if (params.deviceId) qb.andWhere('event.deviceId = :deviceId', { deviceId: params.deviceId });

    const [items, total] = await qb
      .orderBy('event.createdAt', 'DESC')
      .skip(params.offset ?? 0)
      .take(Math.min(params.limit ?? 100, 500))
      .getManyAndCount();

    return { items, total };
  }

  /** Feeds the "Recent Events" card on the dashboard. */
  async findRecent(limit = 20): Promise<DeviceEvent[]> {
    return this.repository.find({
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 100),
    });
  }
}
