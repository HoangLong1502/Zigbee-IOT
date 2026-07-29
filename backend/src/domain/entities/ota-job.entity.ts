import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Device } from './device.entity';

export enum OtaJobStatus {
  PENDING = 'pending',
  CHECKING = 'checking',
  AVAILABLE = 'available',
  UP_TO_DATE = 'up_to_date',
  UPDATING = 'updating',
  COMPLETED = 'completed',
  FAILED = 'failed',
}

/**
 * Tracks an OTA firmware operation driven through
 * `zigbee2mqtt/bridge/request/device/ota_update/{check,update}`.
 *
 * Progress arrives asynchronously on `zigbee2mqtt/<device>` as an `update`
 * object (`{ state, progress, remaining }`) and is merged into the job.
 */
@Entity('ota_jobs')
export class OtaJob {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  deviceId: string;

  @ManyToOne(() => Device, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deviceId' })
  device: Device;

  @ApiProperty()
  @Column({ type: 'varchar', length: 255 })
  friendlyName: string;

  @ApiProperty({ enum: OtaJobStatus })
  @Index()
  @Column({ type: 'varchar', length: 24, default: OtaJobStatus.PENDING })
  status: OtaJobStatus;

  @ApiProperty({ description: 'Update progress 0-100' })
  @Column({ type: 'double precision', default: 0 })
  progress: number;

  @ApiProperty({ nullable: true, description: 'Seconds remaining, as reported by the device' })
  @Column({ type: 'int', nullable: true })
  remaining: number | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 128, nullable: true })
  currentVersion: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 128, nullable: true })
  targetVersion: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'text', nullable: true })
  error: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  startedAt: Date | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  finishedAt: Date | null;

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
