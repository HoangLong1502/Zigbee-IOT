import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { TelemetryService } from './telemetry.service';
import { DeviceService } from '../device/device.service';

@ApiTags('Telemetry')
@ApiBearerAuth()
@Controller('telemetry')
export class TelemetryController {
  constructor(
    private readonly telemetry: TelemetryService,
    private readonly devices: DeviceService,
  ) {}

  @Get()
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiOperation({ summary: 'Most recent raw device payloads across the network' })
  recent(@Query('limit') limit?: string) {
    return this.telemetry.findRecent(undefined, Number(limit) || 50);
  }

  @Get('device/:id')
  @ApiQuery({ name: 'limit', required: false, example: 50 })
  @ApiOperation({ summary: 'Recent raw payloads for one device' })
  async forDevice(@Param('id') id: string, @Query('limit') limit?: string) {
    const device = await this.devices.findOne(id);
    return this.telemetry.findRecent(device.id, Number(limit) || 50);
  }

  @Get('device/:id/latest')
  @ApiOperation({ summary: 'The last raw payload received from one device' })
  async latest(@Param('id') id: string) {
    const device = await this.devices.findOne(id);
    return this.telemetry.findLatestForDevice(device.id);
  }
}
