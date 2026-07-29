import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';

export enum MessageDirection {
  /** Broker -> backend (device reports, bridge messages) */
  INBOUND = 'inbound',
  /** Backend -> broker (commands, /set, /get, bridge requests) */
  OUTBOUND = 'outbound',
}

/** Raw MQTT traffic, surfaced by the live log viewer. */
@Entity('mqtt_logs')
@Index(['topic', 'createdAt'])
@Index(['direction', 'createdAt'])
export class MqttLog {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ example: 'zigbee2mqtt/Living Room Sensor' })
  @Column({ type: 'varchar', length: 512 })
  topic: string;

  @ApiProperty({ enum: MessageDirection })
  @Column({ type: 'varchar', length: 16 })
  direction: MessageDirection;

  @ApiProperty({ description: 'Payload as text; JSON payloads are pretty-printable client side' })
  @Column({ type: 'text' })
  payload: string;

  @ApiProperty({ description: 'Parsed payload when the message was valid JSON', nullable: true })
  @Column({ type: 'jsonb', nullable: true })
  payloadJson: Record<string, unknown> | unknown[] | null;

  @ApiProperty({ example: 0 })
  @Column({ type: 'smallint', default: 0 })
  qos: number;

  @ApiProperty()
  @Column({ type: 'boolean', default: false })
  retain: boolean;

  @ApiProperty({ nullable: true, description: 'Resolved friendly name, when the topic maps to a device' })
  @Index()
  @Column({ type: 'varchar', length: 255, nullable: true })
  deviceName: string | null;

  @ApiProperty({ nullable: true, format: 'uuid' })
  @Column({ type: 'uuid', nullable: true })
  deviceId: string | null;

  @ApiProperty({ description: 'Payload size in bytes' })
  @Column({ type: 'int', default: 0 })
  size: number;

  @ApiProperty()
  @Index()
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
