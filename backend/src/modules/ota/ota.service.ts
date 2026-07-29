import { Injectable, Logger, NotFoundException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';
import { Device, OtaJob, OtaJobStatus } from '../../domain/entities';
import { WS_EVENTS } from '../../common/constants/ws-events';
import { RealtimeGateway } from '../websocket/realtime.gateway';
import { ZigbeeCommandService } from '../mqtt/zigbee-command.service';

/** The `update` object Zigbee2MQTT merges into a device's state during OTA. */
export interface OtaProgressPayload {
  state?: 'idle' | 'available' | 'updating' | string;
  progress?: number;
  remaining?: number;
  installed_version?: number | string;
  latest_version?: number | string;
}

/**
 * Firmware updates.
 *
 * Zigbee OTA is asynchronous and slow: the bridge acknowledges the request
 * immediately, then the device pulls the image block by block, reporting
 * progress inside its normal state messages. This service therefore keeps a
 * job row that the ingestion pipeline updates as progress arrives.
 */
@Injectable()
export class OtaService {
  private readonly logger = new Logger(OtaService.name);

  constructor(
    @InjectRepository(OtaJob) private readonly repository: Repository<OtaJob>,
    private readonly commands: ZigbeeCommandService,
    private readonly gateway: RealtimeGateway,
  ) {}

  /** Asks Zigbee2MQTT whether a newer image exists for the device. */
  async check(device: Device): Promise<OtaJob> {
    const job = await this.createJob(device, OtaJobStatus.CHECKING);

    try {
      const response = await this.commands.checkOta(device.friendlyName);
      const data = response.data as { updateAvailable?: boolean } | undefined;

      job.status = data?.updateAvailable ? OtaJobStatus.AVAILABLE : OtaJobStatus.UP_TO_DATE;
      job.finishedAt = new Date();
    } catch (error) {
      job.status = OtaJobStatus.FAILED;
      job.error = (error as Error).message;
      job.finishedAt = new Date();
    }

    return this.save(job);
  }

  /** Starts the transfer. Progress arrives later through {@link applyProgress}. */
  async start(device: Device): Promise<OtaJob> {
    const job = await this.createJob(device, OtaJobStatus.UPDATING);
    job.startedAt = new Date();
    job.currentVersion = device.softwareBuildId;
    await this.save(job);

    // Deliberately not awaited: the bridge only answers when the transfer has
    // finished, which can be 15+ minutes.
    void this.commands
      .startOta(device.friendlyName)
      .then(async () => {
        const fresh = await this.repository.findOne({ where: { id: job.id } });
        if (!fresh || fresh.status === OtaJobStatus.FAILED) return;
        fresh.status = OtaJobStatus.COMPLETED;
        fresh.progress = 100;
        fresh.finishedAt = new Date();
        await this.save(fresh);
      })
      .catch(async (error: Error) => {
        const fresh = await this.repository.findOne({ where: { id: job.id } });
        if (!fresh) return;
        fresh.status = OtaJobStatus.FAILED;
        fresh.error = error.message;
        fresh.finishedAt = new Date();
        await this.save(fresh);
        this.logger.error(`OTA for ${device.friendlyName} failed: ${error.message}`);
      });

    return job;
  }

  /**
   * Merges an `update` object from a device state message into the open job.
   * Called by the ingestion pipeline, which is where the progress arrives.
   */
  async applyProgress(device: Device, update: OtaProgressPayload): Promise<void> {
    const job = await this.repository.findOne({
      where: { deviceId: device.id },
      order: { createdAt: 'DESC' },
    });
    if (!job) return;

    // Ignore progress for jobs that already finished.
    if (job.status === OtaJobStatus.COMPLETED || job.status === OtaJobStatus.FAILED) return;

    if (typeof update.progress === 'number') job.progress = update.progress;
    if (typeof update.remaining === 'number') job.remaining = update.remaining;
    if (update.installed_version !== undefined) {
      job.currentVersion = String(update.installed_version);
    }
    if (update.latest_version !== undefined) {
      job.targetVersion = String(update.latest_version);
    }

    if (update.state === 'updating') job.status = OtaJobStatus.UPDATING;
    else if (update.state === 'available') job.status = OtaJobStatus.AVAILABLE;
    else if (update.state === 'idle' && job.status === OtaJobStatus.UPDATING) {
      job.status = OtaJobStatus.COMPLETED;
      job.progress = 100;
      job.finishedAt = new Date();
    }

    await this.save(job);
  }

  async findAll(deviceId?: string): Promise<OtaJob[]> {
    return this.repository.find({
      where: deviceId ? { deviceId } : {},
      order: { createdAt: 'DESC' },
      take: 200,
    });
  }

  async findOne(id: string): Promise<OtaJob> {
    const job = await this.repository.findOne({ where: { id } });
    if (!job) throw new NotFoundException(`OTA job ${id} not found`);
    return job;
  }

  /** Devices whose definition advertises OTA support. */
  async findUpdatableDevices(devices: Device[]): Promise<Device[]> {
    return devices.filter((device) => device.supportsOta);
  }

  private async createJob(device: Device, status: OtaJobStatus): Promise<OtaJob> {
    return this.repository.save(
      this.repository.create({
        deviceId: device.id,
        friendlyName: device.friendlyName,
        status,
        currentVersion: device.softwareBuildId,
      }),
    );
  }

  private async save(job: OtaJob): Promise<OtaJob> {
    const saved = await this.repository.save(job);
    this.gateway.emit(WS_EVENTS.OTA_UPDATED, saved);
    return saved;
  }
}
