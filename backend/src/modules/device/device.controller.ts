import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Param,
  Post,
  Query,
} from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiParam, ApiTags } from '@nestjs/swagger';
import { DeviceService } from './device.service';
import { ZigbeeCommandService } from '../mqtt/zigbee-command.service';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleName } from '../../domain/entities';
import {
  BindDto,
  ConfigureReportingDto,
  DeviceStatsDto,
  GetStateDto,
  QueryDevicesDto,
  ReadAttributesDto,
  RemoveDeviceDto,
  RenameDeviceDto,
  SetStateDto,
  WriteAttributesDto,
} from './dto/device.dto';
import { flattenExposes, isSettable } from '../../common/utils/expose.util';

@ApiTags('Devices')
@ApiBearerAuth()
@Controller('devices')
@ApiParam({
  name: 'id',
  required: false,
  description: 'Device UUID, IEEE address or friendly name',
})
export class DeviceController {
  constructor(
    private readonly devices: DeviceService,
    private readonly commands: ZigbeeCommandService,
  ) {}

  // --- read ----------------------------------------------------------------

  @Get()
  @ApiOperation({ summary: 'List discovered Zigbee devices' })
  findAll(@Query() dto: QueryDevicesDto) {
    return this.devices.findAll(dto);
  }

  @Get('stats')
  @ApiOperation({ summary: 'Dashboard counters and network health score' })
  stats(): Promise<DeviceStatsDto> {
    return this.devices.getStats();
  }

  @Get(':id')
  @ApiOperation({ summary: 'Full device detail incl. exposes and attributes' })
  findOne(@Param('id') id: string) {
    return this.devices.findOne(id);
  }

  @Get(':id/exposes')
  @ApiOperation({ summary: 'Flattened expose metadata driving the dynamic UI' })
  async exposes(@Param('id') id: string) {
    const device = await this.devices.findOne(id);
    return this.devices.findExposes(device.id);
  }

  @Get(':id/attributes')
  @ApiOperation({ summary: 'Latest value of every property the device reported' })
  async attributes(@Param('id') id: string) {
    const device = await this.devices.findOne(id);
    return this.devices.findAttributes(device.id);
  }

  @Get(':id/bindings')
  @ApiOperation({ summary: 'Binding table and configured reporting, per endpoint' })
  async bindings(@Param('id') id: string) {
    const device = await this.devices.findOne(id);
    const endpoints = device.endpoints ?? {};

    return Object.entries(endpoints).map(([endpoint, value]) => ({
      endpoint,
      bindings: value?.bindings ?? [],
      configuredReportings: value?.configured_reportings ?? [],
      clusters: value?.clusters ?? { input: [], output: [] },
    }));
  }

  // --- device management ---------------------------------------------------

  @Post(':id/rename')
  @Roles(RoleName.ADMIN, RoleName.OPERATOR)
  @ApiOperation({ summary: 'Rename the device in Zigbee2MQTT' })
  async rename(@Param('id') id: string, @Body() dto: RenameDeviceDto) {
    const device = await this.devices.findOne(id);
    const response = await this.commands.renameDevice(device.friendlyName, dto.name);
    // The bridge republishes bridge/devices afterwards, which refreshes our copy.
    return { status: response.status, from: device.friendlyName, to: dto.name };
  }

  @Delete(':id')
  @Roles(RoleName.ADMIN)
  @ApiOperation({ summary: 'Remove the device from the Zigbee network' })
  async remove(@Param('id') id: string, @Query() dto: RemoveDeviceDto) {
    const device = await this.devices.findOne(id);
    const response = await this.commands.removeDevice(
      device.friendlyName,
      dto.force ?? false,
      dto.block ?? false,
    );
    return { status: response.status, removed: device.friendlyName };
  }

  @Post(':id/factory-reset')
  @Roles(RoleName.ADMIN)
  @ApiOperation({
    summary: 'Force-remove the device and block re-join',
    description:
      'Zigbee has no remote factory-reset command. The closest safe equivalent is a ' +
      'forced removal: the device is dropped from the network and blocked, after which ' +
      'it must be reset physically before it can pair again.',
  })
  async factoryReset(@Param('id') id: string) {
    const device = await this.devices.findOne(id);
    const response = await this.commands.removeDevice(device.friendlyName, true, true);
    return { status: response.status, reset: device.friendlyName };
  }

  @Post(':id/configure')
  @Roles(RoleName.ADMIN, RoleName.OPERATOR)
  @ApiOperation({ summary: 'Re-apply bindings and reporting configuration' })
  async configure(@Param('id') id: string) {
    const device = await this.devices.findOne(id);
    return this.commands.configureDevice(device.friendlyName);
  }

  @Post(':id/interview')
  @Roles(RoleName.ADMIN, RoleName.OPERATOR)
  @ApiOperation({ summary: 'Re-run the Zigbee interview to refresh exposes' })
  async interview(@Param('id') id: string) {
    const device = await this.devices.findOne(id);
    return this.commands.interviewDevice(device.friendlyName);
  }

  @Post(':id/ping')
  @Roles(RoleName.ADMIN, RoleName.OPERATOR)
  @HttpCode(202)
  @ApiOperation({
    summary: 'Probe the device',
    description:
      'Requests a property read; a fresh state message means the device answered. ' +
      'Sleeping battery devices only reply after their next wake-up.',
  })
  async ping(@Param('id') id: string) {
    const device = await this.devices.findOne(id);
    const readable = flattenExposes(device.exposesRaw).find((expose) => expose.access & 4);
    await this.commands.ping(device.friendlyName, readable?.property ?? 'state');
    return { pinged: device.friendlyName, property: readable?.property ?? 'state' };
  }

  @Post(':id/identify')
  @Roles(RoleName.ADMIN, RoleName.OPERATOR)
  @HttpCode(202)
  @ApiOperation({ summary: 'Make the device blink or beep so it can be located' })
  async identify(@Param('id') id: string) {
    const device = await this.devices.findOne(id);
    const exposes = flattenExposes(device.exposesRaw);
    const hasIdentify = exposes.some((expose) => expose.property === 'identify');
    const hasEffect = exposes.some((expose) => expose.property === 'effect');

    if (!hasIdentify && !hasEffect) {
      return { identified: false, reason: 'Device exposes neither identify nor effect' };
    }
    await this.commands.identify(device.friendlyName, !hasIdentify && hasEffect);
    return { identified: true };
  }

  // --- state and attributes ------------------------------------------------

  @Post(':id/set')
  @Roles(RoleName.ADMIN, RoleName.OPERATOR)
  @HttpCode(202)
  @ApiOperation({ summary: 'Write settable exposes (publishes to <device>/set)' })
  async setState(@Param('id') id: string, @Body() dto: SetStateDto) {
    const device = await this.devices.findOne(id);

    // Guard against writing properties the device does not accept: the expose
    // metadata is the single source of truth for what is settable.
    const settable = new Set(
      flattenExposes(device.exposesRaw)
        .filter((expose) => isSettable(expose.access))
        .map((expose) => expose.property),
    );
    const rejected = Object.keys(dto.payload).filter((key) => !settable.has(key));

    const accepted = Object.fromEntries(
      Object.entries(dto.payload).filter(([key]) => settable.has(key)),
    );
    if (Object.keys(accepted).length > 0) {
      await this.commands.setState(device.friendlyName, accepted);
    }

    return { accepted: Object.keys(accepted), rejected };
  }

  @Post(':id/get')
  @Roles(RoleName.ADMIN, RoleName.OPERATOR)
  @HttpCode(202)
  @ApiOperation({ summary: 'Ask the device to publish the given properties now' })
  async getState(@Param('id') id: string, @Body() dto: GetStateDto) {
    const device = await this.devices.findOne(id);
    await this.commands.getState(device.friendlyName, dto.properties);
    return { requested: dto.properties };
  }

  @Post(':id/read')
  @Roles(RoleName.ADMIN, RoleName.OPERATOR)
  @HttpCode(202)
  @ApiOperation({ summary: 'Read raw ZCL attributes from a cluster' })
  async read(@Param('id') id: string, @Body() dto: ReadAttributesDto) {
    const device = await this.devices.findOne(id);
    await this.commands.readAttributes(
      device.friendlyName,
      dto.cluster,
      dto.attributes,
      dto.endpoint,
    );
    return { requested: dto.attributes, cluster: dto.cluster };
  }

  @Post(':id/write')
  @Roles(RoleName.ADMIN)
  @HttpCode(202)
  @ApiOperation({ summary: 'Write raw ZCL attributes to a cluster' })
  async write(@Param('id') id: string, @Body() dto: WriteAttributesDto) {
    const device = await this.devices.findOne(id);
    await this.commands.writeAttributes(
      device.friendlyName,
      dto.cluster,
      dto.payload,
      dto.endpoint,
    );
    return { written: Object.keys(dto.payload), cluster: dto.cluster };
  }

  // --- binding and reporting ----------------------------------------------

  @Post(':id/bind')
  @Roles(RoleName.ADMIN)
  @ApiOperation({ summary: 'Bind a cluster of this device to another device or group' })
  async bind(@Param('id') id: string, @Body() dto: BindDto) {
    const device = await this.devices.findOne(id);
    return this.commands.bind(
      device.friendlyName,
      dto.to,
      dto.clusters,
      dto.fromEndpoint,
      dto.toEndpoint,
    );
  }

  @Post(':id/unbind')
  @Roles(RoleName.ADMIN)
  @ApiOperation({ summary: 'Remove a binding' })
  async unbind(@Param('id') id: string, @Body() dto: BindDto) {
    const device = await this.devices.findOne(id);
    return this.commands.unbind(
      device.friendlyName,
      dto.to,
      dto.clusters,
      dto.fromEndpoint,
      dto.toEndpoint,
    );
  }

  @Post(':id/configure-reporting')
  @Roles(RoleName.ADMIN)
  @ApiOperation({ summary: 'Set ZCL attribute reporting intervals' })
  async configureReporting(
    @Param('id') id: string,
    @Body() dto: ConfigureReportingDto,
  ) {
    const device = await this.devices.findOne(id);
    return this.commands.configureReporting({ id: device.friendlyName, ...dto });
  }
}
