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
import type { ZigbeeExpose } from '../../common/types/zigbee.types';
import { Device } from './device.entity';

/**
 * A flattened Zigbee2MQTT expose.
 *
 * The nested exposes tree is stored verbatim on `Device.exposesRaw`; this table
 * is the flattened projection (one row per settable/readable property) that
 * makes querying practical: "which devices expose `temperature`?", "is
 * `state` writable on this device?".
 *
 * Nothing here is hardcoded - rows are generated from whatever Zigbee2MQTT
 * reports, so a brand new device type works without a code change.
 */
@Entity('device_exposes')
@Index(['deviceId', 'property', 'endpoint'], { unique: true })
export class DeviceExpose {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  deviceId: string;

  @ManyToOne(() => Device, (device) => device.exposes, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deviceId' })
  device: Device;

  @ApiProperty({ example: 'temperature', description: 'MQTT payload key' })
  @Column({ type: 'varchar', length: 128 })
  property: string;

  @ApiProperty({ example: 'temperature' })
  @Column({ type: 'varchar', length: 128, nullable: true })
  name: string | null;

  @ApiProperty({ example: 'Temperature' })
  @Column({ type: 'varchar', length: 255, nullable: true })
  label: string | null;

  @ApiProperty({ example: 'numeric', description: 'numeric|binary|enum|text|composite|list' })
  @Column({ type: 'varchar', length: 32 })
  type: string;

  @ApiProperty({
    nullable: true,
    description: 'Parent expose type for grouped features, e.g. "light" or "switch"',
  })
  @Column({ type: 'varchar', length: 32, nullable: true })
  parentType: string | null;

  @ApiProperty({ nullable: true, description: 'Endpoint suffix, e.g. "l1"' })
  @Column({ type: 'varchar', length: 32, nullable: true, default: null })
  endpoint: string | null;

  @ApiProperty({ description: 'Bitmask: 1 published, 2 settable, 4 gettable' })
  @Column({ type: 'int', default: 1 })
  access: number;

  @ApiProperty({ nullable: true, example: '°C' })
  @Column({ type: 'varchar', length: 32, nullable: true })
  unit: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiProperty({ nullable: true, description: 'diagnostic | config, when provided' })
  @Column({ type: 'varchar', length: 32, nullable: true })
  category: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'double precision', nullable: true })
  valueMin: number | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'double precision', nullable: true })
  valueMax: number | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'double precision', nullable: true })
  valueStep: number | null;

  @ApiProperty({ nullable: true, description: 'Allowed values for enum exposes' })
  @Column({ type: 'jsonb', nullable: true })
  values: Array<string | number> | null;

  @ApiProperty({ nullable: true, description: 'ON value for binary exposes' })
  @Column({ type: 'jsonb', nullable: true })
  valueOn: unknown;

  @ApiProperty({ nullable: true, description: 'OFF value for binary exposes' })
  @Column({ type: 'jsonb', nullable: true })
  valueOff: unknown;

  @ApiProperty({ nullable: true })
  @Column({ type: 'jsonb', nullable: true })
  valueToggle: unknown;

  @ApiProperty({ description: 'Original expose node, including nested features' })
  @Column({ type: 'jsonb', nullable: true })
  raw: ZigbeeExpose | null;

  @ApiProperty()
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
