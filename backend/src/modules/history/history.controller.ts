import { Controller, Get, Param, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { HistoryService } from './history.service';
import { DeviceService } from '../device/device.service';
import { HistorySeriesDto, QueryHistoryDto } from './dto/history.dto';

@ApiTags('History')
@ApiBearerAuth()
@Controller('history')
export class HistoryController {
  constructor(
    private readonly history: HistoryService,
    private readonly devices: DeviceService,
  ) {}

  @Get('device/:id/properties')
  @ApiOperation({ summary: 'Properties of a device that can be charted' })
  async properties(@Param('id') id: string) {
    const device = await this.devices.findOne(id);
    return this.history.getChartableProperties(device.id);
  }

  @Get('device/:id/:property')
  @ApiOperation({
    summary: 'Bucketed time series for one property',
    description:
      'Ranges: hour | today | 24h | 7d | 30d | custom. Bucket size is derived from ' +
      'the range so the payload stays small regardless of the span.',
  })
  async series(
    @Param('id') id: string,
    @Param('property') property: string,
    @Query() dto: QueryHistoryDto,
  ): Promise<HistorySeriesDto> {
    const device = await this.devices.findOne(id);
    return this.history.getSeries(device.id, property, dto);
  }

  @Get('device/:id/:property/raw')
  @ApiOperation({ summary: 'Un-aggregated samples, for export and tables' })
  async raw(
    @Param('id') id: string,
    @Param('property') property: string,
    @Query() dto: QueryHistoryDto,
  ) {
    const device = await this.devices.findOne(id);
    return this.history.getRaw(device.id, property, dto);
  }

  @Get('compare/:property')
  @ApiOperation({
    summary: 'Same property across several devices',
    description: 'Pass `devices` as a comma separated list of ids, IEEE addresses or names.',
  })
  async compare(
    @Param('property') property: string,
    @Query('devices') devices: string,
    @Query() dto: QueryHistoryDto,
  ) {
    const identifiers = (devices ?? '').split(',').map((value) => value.trim()).filter(Boolean);
    const resolved = await Promise.all(
      identifiers.map((identifier) => this.devices.findOne(identifier)),
    );

    const series = await this.history.getMultiDeviceSeries(
      resolved.map((device) => device.id),
      property,
      dto,
    );

    return resolved.map((device) => ({
      deviceId: device.id,
      friendlyName: device.friendlyName,
      ieeeAddress: device.ieeeAddress,
      series: series[device.id],
    }));
  }
}
