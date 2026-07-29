import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Device } from './device.entity';

/**
 * One row per received device state message - the complete, unmodified MQTT
 * payload. Acts as the audit trail / replay source for the pipeline, while the
 * `history` table holds the per-property numeric series used by charts.
 */
@Entity('telemetry')
@Index(['deviceId', 'receivedAt'])
export class Telemetry {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  deviceId: string;

  @ManyToOne(() => Device, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deviceId' })
  device: Device;

  @ApiProperty({ example: 'zigbee2mqtt/Living Room Sensor' })
  @Column({ type: 'varchar', length: 512 })
  topic: string;

  @ApiProperty({ type: 'object', additionalProperties: true })
  @Column({ type: 'jsonb' })
  payload: Record<string, unknown>;

  @ApiProperty({ nullable: true })
  @Column({ type: 'int', nullable: true })
  linkQuality: number | null;

  @ApiProperty()
  @Index()
  @Column({ type: 'timestamptz' })
  receivedAt: Date;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
