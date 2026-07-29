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

export enum AlertType {
  LOW_BATTERY = 'low_battery',
  DEVICE_OFFLINE = 'device_offline',
  HIGH_TEMPERATURE = 'high_temperature',
  WATER_LEAK = 'water_leak',
  SMOKE = 'smoke',
  GAS = 'gas',
  TAMPER = 'tamper',
  UNEXPECTED_LEAVE = 'unexpected_leave',
  UNEXPECTED_JOIN = 'unexpected_join',
  COORDINATOR_OFFLINE = 'coordinator_offline',
  MQTT_DISCONNECTED = 'mqtt_disconnected',
}

export enum AlertSeverity {
  INFO = 'info',
  WARNING = 'warning',
  CRITICAL = 'critical',
}

/**
 * An alert raised by the rules engine.
 *
 * Alerts are de-duplicated per (device, type) while unresolved so a leaking
 * sensor reporting every 10 seconds does not create thousands of rows.
 */
@Entity('alerts')
@Index(['type', 'resolved'])
@Index(['deviceId', 'type', 'resolved'])
export class Alert {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ enum: AlertType })
  @Column({ type: 'varchar', length: 48 })
  type: AlertType | string;

  @ApiProperty({ enum: AlertSeverity })
  @Column({ type: 'varchar', length: 16, default: AlertSeverity.WARNING })
  severity: AlertSeverity;

  @ApiProperty()
  @Column({ type: 'text' })
  message: string;

  @ApiProperty({ nullable: true, format: 'uuid' })
  @Column({ type: 'uuid', nullable: true })
  deviceId: string | null;

  @ManyToOne(() => Device, { onDelete: 'CASCADE', nullable: true })
  @JoinColumn({ name: 'deviceId' })
  device: Device | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  friendlyName: string | null;

  @ApiProperty({ nullable: true, description: 'Property that triggered the alert' })
  @Column({ type: 'varchar', length: 128, nullable: true })
  property: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'jsonb', nullable: true })
  value: unknown;

  @ApiProperty({ nullable: true })
  @Column({ type: 'double precision', nullable: true })
  threshold: number | null;

  @ApiProperty()
  @Index()
  @Column({ type: 'boolean', default: false })
  acknowledged: boolean;

  @ApiProperty({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  acknowledgedAt: Date | null;

  @ApiProperty()
  @Index()
  @Column({ type: 'boolean', default: false })
  resolved: boolean;

  @ApiProperty({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  resolvedAt: Date | null;

  @ApiProperty({ description: 'Number of times the condition re-triggered while unresolved' })
  @Column({ type: 'int', default: 1 })
  occurrences: number;

  @ApiProperty()
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  lastOccurredAt: Date;

  @ApiProperty()
  @Index()
  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;
}
