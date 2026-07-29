import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { OtaService } from './ota.service';
import { DeviceService } from '../device/device.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleName } from '../../domain/entities';

@ApiTags('OTA')
@ApiBearerAuth()
@Controller('ota')
export class OtaController {
  constructor(
    private readonly ota: OtaService,
    private readonly devices: DeviceService,
  ) {}

  @Get('jobs')
  @ApiOperation({ summary: 'Firmware update jobs, newest first' })
  jobs(@Query('deviceId') deviceId?: string) {
    return this.ota.findAll(deviceId);
  }

  @Get('jobs/:id')
  @ApiOperation({ summary: 'One firmware job incl. live progress' })
  job(@Param('id') id: string) {
    return this.ota.findOne(id);
  }

  @Get('devices')
  @ApiOperation({ summary: 'Devices whose definition advertises OTA support' })
  async updatable() {
    const { items } = await this.devices.findAll({ limit: 1000 });
    return this.ota.findUpdatableDevices(items);
  }

  @Post('device/:id/check')
  @Roles(RoleName.ADMIN, RoleName.OPERATOR)
  @ApiOperation({ summary: 'Check whether newer firmware is available' })
  async check(@Param('id') id: string) {
    const device = await this.devices.findOne(id);
    return this.ota.check(device);
  }

  @Post('device/:id/update')
  @Roles(RoleName.ADMIN)
  @ApiOperation({
    summary: 'Start a firmware update',
    description:
      'Returns immediately. Progress is reported on the job and broadcast over WebSocket; ' +
      'a transfer commonly takes 10-30 minutes and must not be interrupted.',
  })
  async update(@Param('id') id: string) {
    const device = await this.devices.findOne(id);
    return this.ota.start(device);
  }
}
