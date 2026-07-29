import { Column, Entity, Index, PrimaryGeneratedColumn } from 'typeorm';
import { ApiProperty } from '@nestjs/swagger';
import type {
  ZigbeeNetworkMapLink,
  ZigbeeNetworkMapNode,
} from '../../common/types/zigbee.types';

/**
 * A snapshot of the mesh, produced by
 * `zigbee2mqtt/bridge/request/networkmap` -> `.../response/networkmap`.
 *
 * Snapshots are kept as whole documents because the topology is only
 * meaningful as a consistent set of nodes and links captured at one instant.
 */
@Entity('topology_snapshots')
export class TopologySnapshot {
  @ApiProperty({ format: 'uuid' })
  @PrimaryGeneratedColumn('uuid')
  id: string;

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  @Column({ type: 'jsonb' })
  nodes: ZigbeeNetworkMapNode[];

  @ApiProperty({ type: 'array', items: { type: 'object' } })
  @Column({ type: 'jsonb' })
  links: ZigbeeNetworkMapLink[];

  @ApiProperty()
  @Column({ type: 'int', default: 0 })
  nodeCount: number;

  @ApiProperty()
  @Column({ type: 'int', default: 0 })
  linkCount: number;

  @ApiProperty()
  @Index()
  @Column({ type: 'timestamptz', default: () => 'CURRENT_TIMESTAMP' })
  createdAt: Date;
}
