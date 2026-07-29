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

export enum EventType {
  DEVICE_JOINED = 'device_joined',
  DEVICE_LEAVE = 'device_leave',
  DEVICE_ANNOUNCE = 'device_announce',
  DEVICE_INTERVIEW = 'device_interview',
  DEVICE_RENAMED = 'device_renamed',
  DEVICE_REMOVED = 'device_removed',
  DEVICE_ONLINE = 'device_online',
  DEVICE_OFFLINE = 'device_offline',
  BRIDGE_ONLINE = 'bridge_online',
  BRIDGE_OFFLINE = 'bridge_offline',
  MQTT_CONNECTED = 'mqtt_connected',
  MQTT_DISCONNECTED = 'mqtt_disconnected',
  PERMIT_JOIN_CHANGED = 'permit_join_changed',
  OTA_UPDATE = 'ota_update',
  BRIDGE_LOG = 'bridge_log',
  COMMAND = 'command',
}

export enum EventSeverity {
  DEBUG = 'debug',
  INFO = 'info',
  WARNING = 'warning',
  ERROR = 'error',
}

/** Timeline of everything that happened on the Zigbee network. */
@Entity('events')
@Index(['type', 'createdAt'])
export class DeviceEvent {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ enum: EventType })
  @Column({ type: 'varchar', length: 64 })
  type: EventType | string;

  @ApiProperty({ enum: EventSeverity })
  @Column({ type: 'varchar', length: 16, default: EventSeverity.INFO })
  severity: EventSeverity;

  @ApiProperty()
  @Column({ type: 'text' })
  message: string;

  @ApiProperty({ nullable: true, format: 'uuid' })
  @Column({ type: 'uuid', nullable: true })
  deviceId: string | null;

  @ManyToOne(() => Device, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({ name: 'deviceId' })
  device: Device | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  friendlyName: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 32, nullable: true })
  ieeeAddress: string | null;

  @ApiProperty({ type: 'object', additionalProperties: true, nullable: true })
  @Column({ type: 'jsonb', nullable: true })
  data: Record<string, unknown> | null;

  @ApiProperty()
  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
