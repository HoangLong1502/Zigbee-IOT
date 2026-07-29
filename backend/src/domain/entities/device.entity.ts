import {
  Column,
  CreateDateColumn,
  Entity,
  Index,
  OneToMany,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import type {
  ZigbeeEndpoint,
  ZigbeeExpose,
} from '../../common/types/zigbee.types';
import { DeviceAttribute } from './device-attribute.entity';
import { DeviceExpose } from './device-expose.entity';

export enum DeviceType {
  COORDINATOR = 'Coordinator',
  ROUTER = 'Router',
  END_DEVICE = 'EndDevice',
  GREEN_POWER = 'GreenPower',
  UNKNOWN = 'Unknown',
}

export enum InterviewStatus {
  PENDING = 'pending',
  STARTED = 'started',
  SUCCESSFUL = 'successful',
  FAILED = 'failed',
}

/**
 * A Zigbee device as reported by `zigbee2mqtt/bridge/devices`.
 *
 * The IEEE address is the stable identity of a physical radio; the friendly
 * name and the (16-bit) network address can both change over the lifetime of
 * the device, so they are never used as the primary key.
 */
@Entity('devices')
export class Device {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: '0x00124b0022a1b2c3', description: '64-bit IEEE address' })
  @Index({ unique: true })
  @Column({ type: 'varchar', length: 32 })
  ieeeAddress: string;

  @ApiProperty({ example: 'Living Room Sensor' })
  @Index()
  @Column({ type: 'varchar', length: 255 })
  friendlyName: string;

  @ApiProperty({ nullable: true, description: '16-bit short address' })
  @Column({ type: 'int', nullable: true })
  networkAddress: number | null;

  @ApiProperty({ enum: DeviceType })
  @Column({ type: 'varchar', length: 32, default: DeviceType.UNKNOWN })
  type: DeviceType;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  manufacturer: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  model: string | null;

  @ApiProperty({ nullable: true, description: 'Human readable model description' })
  @Column({ type: 'text', nullable: true })
  description: string | null;

  @ApiProperty({ nullable: true, example: 'Battery' })
  @Column({ type: 'varchar', length: 64, nullable: true })
  powerSource: string | null;

  @ApiProperty({ nullable: true, description: 'Firmware build id reported by the device' })
  @Column({ type: 'varchar', length: 128, nullable: true })
  softwareBuildId: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  dateCode: string | null;

  @ApiProperty({ enum: InterviewStatus })
  @Column({ type: 'varchar', length: 32, default: InterviewStatus.PENDING })
  interviewStatus: InterviewStatus;

  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  interviewCompleted: boolean;

  @ApiProperty({ description: 'False when no Zigbee2MQTT converter matched' })
  @Column({ type: 'boolean', default: true })
  supported: boolean;

  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  disabled: boolean;

  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  supportsOta: boolean;

  @ApiProperty({ nullable: true, description: 'Device photo URL published by Zigbee2MQTT' })
  @Column({ type: 'text', nullable: true })
  imageUrl: string | null;

  // --- live status ---------------------------------------------------------

  @ApiProperty({ description: 'Derived from availability topic and last activity' })
  @Index()
  @Column({ type: 'boolean', default: false })
  online: boolean;

  @ApiProperty({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  lastSeen: Date | null;

  @ApiProperty({ nullable: true, description: 'Link Quality Indicator, 0-255' })
  @Column({ type: 'int', nullable: true })
  linkQuality: number | null;

  @ApiProperty({ nullable: true, description: 'Received signal strength in dBm, if exposed' })
  @Column({ type: 'double precision', nullable: true })
  rssi: number | null;

  @ApiProperty({ nullable: true, description: 'Battery percentage, if exposed' })
  @Column({ type: 'double precision', nullable: true })
  battery: number | null;

  @ApiProperty({ nullable: true, description: 'Battery voltage in mV, if exposed' })
  @Column({ type: 'double precision', nullable: true })
  batteryVoltage: number | null;

  /** Last full state payload received on `zigbee2mqtt/<friendly_name>`. */
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  @Column({ type: 'jsonb', nullable: true })
  lastPayload: Record<string, unknown> | null;

  /** Raw exposes tree, kept verbatim so the frontend can render any device. */
  @ApiProperty({ type: 'array', items: { type: 'object' }, nullable: true })
  @Column({ type: 'jsonb', nullable: true })
  exposesRaw: ZigbeeExpose[] | null;

  /** Endpoint map incl. bindings and configured reportings. */
  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  @Column({ type: 'jsonb', nullable: true })
  endpoints: Record<string, ZigbeeEndpoint> | null;

  @ApiProperty({ description: 'Whole bridge/devices entry, for the raw view' })
  @Column({ type: 'jsonb', nullable: true })
  definitionRaw: Record<string, unknown> | null;

  @OneToMany(() => DeviceExpose, (expose) => expose.device)
  exposes: DeviceExpose[];

  @OneToMany(() => DeviceAttribute, (attribute) => attribute.device)
  attributes: DeviceAttribute[];

  @ApiProperty()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @ApiProperty()
  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
