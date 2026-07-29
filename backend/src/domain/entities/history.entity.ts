import {
  Column,
  Entity,
  Index,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import { Device } from './device.entity';

/**
 * Long-term, per-property time series.
 *
 * Every numeric or boolean value found in an incoming payload is appended
 * here, which is what powers the "Last hour / Today / 7 days / 30 days" charts
 * for temperature, humidity, pressure, power, energy, battery, occupancy,
 * contact, illuminance and any other property a device happens to expose.
 */
@Entity('history')
@Index(['deviceId', 'property', 'recordedAt'])
@Index(['property', 'recordedAt'])
export class History {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ format: 'uuid' })
  @Column({ type: 'uuid' })
  deviceId: string;

  @ManyToOne(() => Device, { onDelete: 'CASCADE' })
  @JoinColumn({ name: 'deviceId' })
  device: Device;

  @ApiProperty({ example: 'temperature' })
  @Column({ type: 'varchar', length: 128 })
  property: string;

  @ApiProperty({ nullable: true, description: 'Numeric value; booleans stored as 0/1' })
  @Column({ type: 'double precision', nullable: true })
  value: number | null;

  @ApiProperty({ nullable: true, description: 'Original value for enum/string properties' })
  @Column({ type: 'varchar', length: 255, nullable: true })
  stringValue: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 32, nullable: true })
  unit: string | null;

  @ApiProperty()
  @Column({ type: 'timestamptz' })
  recordedAt: Date;
}
