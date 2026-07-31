import {
  Column,
  CreateDateColumn,
  Entity,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

/**
 * The USB Zigbee coordinator and its network parameters.
 *
 * Values are populated from `zigbee2mqtt/bridge/info` (authoritative, because
 * Zigbee2MQTT owns the serial port) and can be edited through the API, which
 * writes them back with `bridge/request/options`.
 *
 * A single row is maintained (`singleton = true`).
 */
@Entity('coordinators')
export class Coordinator {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ description: 'Only one coordinator row is kept' })
  @Column({ type: 'boolean', default: true, unique: true })
  singleton: boolean;

  // --- serial / hardware ---------------------------------------------------

  @ApiProperty({ nullable: true, example: 'COM3' })
  @Column({ type: 'varchar', length: 128, nullable: true })
  serialPort: string | null;

  @ApiProperty({ nullable: true, example: 115200 })
  @Column({ type: 'int', nullable: true })
  baudRate: number | null;

  @ApiProperty({ nullable: true, example: 'zstack', description: 'zstack | ember | deconz | zigate' })
  @Column({ type: 'varchar', length: 32, nullable: true })
  adapter: string | null;

  @ApiProperty({ nullable: true, description: 'USB vendor id of the detected dongle' })
  @Column({ type: 'varchar', length: 16, nullable: true })
  vendorId: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 16, nullable: true })
  productId: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 255, nullable: true })
  hardwareLabel: string | null;

  // --- Zigbee network ------------------------------------------------------

  @ApiProperty({ nullable: true, example: '0x00124b0022a1b2c3' })
  @Column({ type: 'varchar', length: 32, nullable: true })
  ieeeAddress: string | null;

  @ApiProperty({ nullable: true, example: 6754 })
  @Column({ type: 'int', nullable: true })
  panId: number | null;

  @ApiProperty({ nullable: true, example: 'DDDDDDDDDDDDDDDD' })
  @Column({ type: 'varchar', length: 64, nullable: true })
  extendedPanId: string | null;

  @ApiProperty({ nullable: true, example: 11, description: 'Zigbee channel 11-26' })
  @Column({ type: 'int', nullable: true })
  channel: number | null;

  @ApiProperty({ nullable: true, description: 'Masked unless explicitly revealed' })
  @Column({ type: 'text', nullable: true })
  networkKey: string | null;

  // --- state ---------------------------------------------------------------

  @ApiProperty({ description: 'Zigbee2MQTT bridge state (online/offline)' })
  @Column({ type: 'boolean', default: false })
  online: boolean;

  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  permitJoin: boolean;

  @ApiProperty({ nullable: true, description: 'Seconds remaining on the join window' })
  @Column({ type: 'int', nullable: true })
  permitJoinTimeout: number | null;

  @ApiProperty({ nullable: true, description: 'Zigbee2MQTT version' })
  @Column({ type: 'varchar', length: 64, nullable: true })
  zigbee2mqttVersion: string | null;

  @ApiProperty({ nullable: true, description: 'Coordinator firmware / stack revision' })
  @Column({ type: 'varchar', length: 128, nullable: true })
  firmwareVersion: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  coordinatorType: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  herdsmanVersion: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 64, nullable: true })
  convertersVersion: string | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'varchar', length: 16, nullable: true })
  logLevel: string | null;

  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  restartRequired: boolean;

  /**
   * Pairing / discovery mode for nearby Zigbee devices.
   * - `manual`: join window only opens when the user triggers Manual Sync / Permit Join
   * - `auto`: backend keeps permit join open so devices in pairing range can join alone
   */
  @ApiProperty({ enum: ['manual', 'auto'], default: 'manual' })
  @Column({ type: 'varchar', length: 16, default: 'manual' })
  pairingMode: 'manual' | 'auto';

  @ApiProperty({
    description: 'Seconds for each auto-renewed permit-join window (Zigbee max is 254)',
    default: 254,
  })
  @Column({ type: 'int', default: 254 })
  autoPairWindowSeconds: number;

  @ApiProperty({ nullable: true, description: 'When the last manual sync was started' })
  @Column({ type: 'timestamptz', nullable: true })
  lastManualSyncAt: Date | null;

  @ApiProperty({ nullable: true })
  @Column({ type: 'timestamptz', nullable: true })
  lastSeen: Date | null;

  @ApiProperty({ description: 'Full bridge/info document' })
  @Column({ type: 'jsonb', nullable: true })
  infoRaw: Record<string, unknown> | null;

  @CreateDateColumn({ type: 'timestamptz' })
  createdAt: Date;

  @UpdateDateColumn({ type: 'timestamptz' })
  updatedAt: Date;
}
