import { Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { TopologyService } from './topology.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleName } from '../../domain/entities';

@ApiTags('Topology')
@ApiBearerAuth()
@Controller('topology')
export class TopologyController {
  constructor(private readonly topology: TopologyService) {}

  @Get()
  @ApiOperation({ summary: 'Latest network map as nodes and edges' })
  async latest() {
    const graph = await this.topology.getLatest();
    return (
      graph ?? {
        nodes: [],
        edges: [],
        generatedAt: null,
        stats: {
          coordinators: 0,
          routers: 0,
          endDevices: 0,
          links: 0,
          averageLinkQuality: 0,
          weakLinks: 0,
        },
      }
    );
  }

  @Get('status')
  @ApiOperation({ summary: 'Whether a scan is currently running' })
  status() {
    return { scanning: this.topology.isScanning };
  }

  @Get('history')
  @ApiOperation({ summary: 'Previous snapshots (metadata only)' })
  history(@Query('limit') limit?: string) {
    return this.topology.getHistory(Number(limit) || 20);
  }

  @Post('refresh')
  @Roles(RoleName.ADMIN, RoleName.OPERATOR)
  @ApiOperation({
    summary: 'Scan the mesh and store a new snapshot',
    description:
      'Walks every router neighbour table through Zigbee2MQTT. On a large network this ' +
      'can take a minute; the result is also broadcast over WebSocket.',
  })
  refresh() {
    return this.topology.refresh();
  }
}
