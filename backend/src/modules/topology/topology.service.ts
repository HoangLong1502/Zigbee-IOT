import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Cron, CronExpression } from '@nestjs/schedule';
import { Repository } from 'typeorm';
import { TopologySnapshot } from '../../domain/entities';
import {
  ZigbeeNetworkMap,
  ZigbeeNetworkMapLink,
  ZigbeeNetworkMapNode,
  ZigbeeRelationship,
} from '../../common/types/zigbee.types';
import { WS_EVENTS } from '../../common/constants/ws-events';
import { RealtimeGateway } from '../websocket/realtime.gateway';
import { ZigbeeCommandService } from '../mqtt/zigbee-command.service';
import { MqttService } from '../mqtt/mqtt.service';

/** Node shape consumed by the frontend graph renderer. */
export interface TopologyNode {
  id: string;
  ieeeAddress: string;
  friendlyName: string;
  type: 'Coordinator' | 'Router' | 'EndDevice' | string;
  networkAddress: number;
  manufacturer: string | null;
  model: string | null;
  lastSeen: string | null;
  /** True when Zigbee2MQTT could not reach the node during the scan. */
  failed: boolean;
}

export interface TopologyEdge {
  source: string;
  target: string;
  /** 0-255 as reported by the neighbour table. */
  linkQuality: number;
  /** Percentage projection of the LQI, for line thickness/colour. */
  quality: number;
  relationship: string;
  depth: number | null;
  /** True for the parent->child edges that form the routing tree. */
  isParentChild: boolean;
}

export interface TopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  generatedAt: string;
  stats: {
    coordinators: number;
    routers: number;
    endDevices: number;
    links: number;
    averageLinkQuality: number;
    weakLinks: number;
  };
}

const RELATIONSHIP_LABELS: Record<number, string> = {
  [ZigbeeRelationship.Parent]: 'parent',
  [ZigbeeRelationship.Child]: 'child',
  [ZigbeeRelationship.Sibling]: 'sibling',
  [ZigbeeRelationship.None]: 'none',
  [ZigbeeRelationship.PreviousChild]: 'previous-child',
  [ZigbeeRelationship.Unauthenticated]: 'unauthenticated',
};

/**
 * Builds the mesh view of the network.
 *
 * Zigbee2MQTT produces the map by walking every router's neighbour table,
 * which is slow (tens of seconds on a large network) and mildly disruptive, so
 * scans are on demand plus a conservative schedule rather than continuous.
 */
@Injectable()
export class TopologyService {
  private readonly logger = new Logger(TopologyService.name);
  private scanInProgress = false;

  constructor(
    @InjectRepository(TopologySnapshot)
    private readonly repository: Repository<TopologySnapshot>,
    private readonly commands: ZigbeeCommandService,
    private readonly mqtt: MqttService,
    private readonly gateway: RealtimeGateway,
  ) {}

  /** Triggers a fresh scan and stores the result. */
  async refresh(): Promise<TopologyGraph> {
    if (!this.mqtt.isConnected) {
      throw new Error('Cannot scan the network while the MQTT broker is unreachable');
    }
    if (this.scanInProgress) {
      throw new Error('A network scan is already running');
    }

    this.scanInProgress = true;
    try {
      this.logger.log('Requesting network map from Zigbee2MQTT (this can take a while)');
      const response = await this.commands.requestNetworkMap('raw', true);

      const map = response.data?.value as ZigbeeNetworkMap | undefined;
      if (!map?.nodes) throw new Error('Zigbee2MQTT returned an empty network map');

      return await this.store(map);
    } finally {
      this.scanInProgress = false;
    }
  }

  /** Persists a map and broadcasts the derived graph. */
  async store(map: ZigbeeNetworkMap): Promise<TopologyGraph> {
    const snapshot = await this.repository.save(
      this.repository.create({
        nodes: map.nodes ?? [],
        links: map.links ?? [],
        nodeCount: map.nodes?.length ?? 0,
        linkCount: map.links?.length ?? 0,
      }),
    );

    const graph = this.toGraph(snapshot.nodes, snapshot.links, snapshot.createdAt);
    this.gateway.emit(WS_EVENTS.TOPOLOGY_UPDATED, graph);
    this.logger.log(
      `Stored topology snapshot: ${graph.nodes.length} nodes, ${graph.edges.length} links`,
    );
    return graph;
  }

  /** Latest stored graph, or an empty one if the network was never scanned. */
  async getLatest(): Promise<TopologyGraph | null> {
    const snapshot = await this.repository.findOne({
      where: {},
      order: { createdAt: 'DESC' },
    });
    if (!snapshot) return null;
    return this.toGraph(snapshot.nodes, snapshot.links, snapshot.createdAt);
  }

  async getHistory(limit = 20): Promise<TopologySnapshot[]> {
    return this.repository.find({
      order: { createdAt: 'DESC' },
      take: Math.min(limit, 100),
      select: ['id', 'nodeCount', 'linkCount', 'createdAt'],
    });
  }

  get isScanning(): boolean {
    return this.scanInProgress;
  }

  /**
   * Converts the raw neighbour tables into a de-duplicated graph.
   *
   * The raw map lists each link from both endpoints' perspective; we keep the
   * strongest reading per unordered pair so the rendered mesh has one edge
   * between any two nodes.
   */
  private toGraph(
    nodes: ZigbeeNetworkMapNode[],
    links: ZigbeeNetworkMapLink[],
    generatedAt: Date,
  ): TopologyGraph {
    const graphNodes: TopologyNode[] = (nodes ?? []).map((node) => ({
      id: node.ieeeAddr,
      ieeeAddress: node.ieeeAddr,
      friendlyName: node.friendlyName ?? node.ieeeAddr,
      type: node.type,
      networkAddress: node.networkAddress,
      manufacturer: node.manufacturerName ?? node.definition?.vendor ?? null,
      model: node.modelID ?? node.definition?.model ?? null,
      lastSeen: node.lastSeen ? new Date(node.lastSeen).toISOString() : null,
      failed: Array.isArray(node.failed) && node.failed.length > 0,
    }));

    const known = new Set(graphNodes.map((node) => node.id));
    const bestByPair = new Map<string, TopologyEdge>();

    for (const link of links ?? []) {
      const source = link.sourceIeeeAddr ?? link.source?.ieeeAddr;
      const target = link.targetIeeeAddr ?? link.target?.ieeeAddr;
      if (!source || !target || !known.has(source) || !known.has(target)) continue;

      const linkQuality = link.lqi ?? link.linkquality ?? 0;
      const relationship = RELATIONSHIP_LABELS[link.relationship] ?? 'unknown';
      const key = [source, target].sort().join('|');

      const edge: TopologyEdge = {
        source,
        target,
        linkQuality,
        quality: Math.round((Math.min(linkQuality, 255) / 255) * 100),
        relationship,
        depth: link.depth ?? null,
        isParentChild:
          link.relationship === ZigbeeRelationship.Parent ||
          link.relationship === ZigbeeRelationship.Child,
      };

      const existing = bestByPair.get(key);
      if (!existing || existing.linkQuality < edge.linkQuality) {
        bestByPair.set(key, edge);
      }
    }

    const edges = [...bestByPair.values()];
    const averageLinkQuality =
      edges.length > 0
        ? Math.round(edges.reduce((sum, edge) => sum + edge.linkQuality, 0) / edges.length)
        : 0;

    return {
      nodes: graphNodes,
      edges,
      generatedAt: generatedAt.toISOString(),
      stats: {
        coordinators: graphNodes.filter((node) => node.type === 'Coordinator').length,
        routers: graphNodes.filter((node) => node.type === 'Router').length,
        endDevices: graphNodes.filter((node) => node.type === 'EndDevice').length,
        links: edges.length,
        averageLinkQuality,
        // Below ~20% LQI links become unreliable and are worth flagging.
        weakLinks: edges.filter((edge) => edge.quality < 20).length,
      },
    };
  }

  /**
   * Scheduled rescan. Skipped when the broker is down or a scan is already in
   * flight so a slow network cannot pile up overlapping scans.
   */
  @Cron(CronExpression.EVERY_6_HOURS)
  async scheduledScan(): Promise<void> {
    if (!this.mqtt.isConnected || this.scanInProgress) return;
    try {
      await this.refresh();
    } catch (error) {
      this.logger.warn(`Scheduled topology scan failed: ${(error as Error).message}`);
    }
  }
}
