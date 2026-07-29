import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Device } from './device.entity';

/**
 * The latest value of a single device property ("attribute").
 *
 * One row per (device, property). Written on every MQTT state message so the
 * dashboard can render current values without scanning the history table.
 */
@Entity('device_attributes')
@Index(['deviceId', 'property'], { unique: true })
export class DeviceAttribute {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  deviceId: string;

  @ManyToOne(() => Device, (device) => device.attributes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deviceId' })
  device: Device;

  @ApiProperty({ example: 'temperature' })
  @Column({ type: 'varchar', length: 128 })
  property: string;

  @ApiProperty({ description: 'Value as JSON, preserving the original type' })
  @Column({ type: 'jsonb', nullable: true })
  value: unknown;

  @ApiProperty({ nullable: true, description: 'Numeric projection, when applicable' })
  @Column({ type: 'double precision', nullable: true })
  numericValue: number | null;

  @ApiProperty({ example: 'number', description: 'number|boolean|string|object' })
  @Column({ type: 'varchar', length: 16 })
  valueType: string;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 32, nullable: true })
  unit: string | null;

  @ApiProperty()
  @Column({ type: 'timestamptz' })
  updatedAtSource: Date;

  @ApiProperty()
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
