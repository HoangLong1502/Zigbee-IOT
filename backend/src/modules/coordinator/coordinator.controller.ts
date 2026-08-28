import { Body, Controller, Get, Param, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CoordinatorService } from './coordinator.service';
import { DiscoveryService } from './discovery.service';
import { PermitJoinDto, UpdateCoordinatorDto } from './dto/coordinator.dto';
import { ManualSyncDto, RejectPairingDto, SetPairingModeDto } from './dto/discovery.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleName } from '../../domain/entities';

@ApiTags('Coordinator')
@ApiBearerAuth()
@Controller('coordinator')
export class CoordinatorController {
  constructor(
    private readonly coordinator: CoordinatorService,
    private readonly discovery: DiscoveryService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Coordinator state, network parameters and detected USB ports',
  })
  get() {
    return this.coordinator.getView();
  }

  @Get('ports')
  @ApiOperation({
    summary: 'Enumerate serial ports and flag likely Zigbee coordinators',
  })
  ports() {
    return this.coordinator.listPorts();
  }

  @Get('discovery')
  @ApiOperation({
    summary: 'Pairing / discovery status (auto-pair vs manual sync)',
  })
  discoveryStatus() {
    return this.discovery.getStatus();
  }

  @Get('discovery/prompts')
  @ApiOperation({
    summary: 'Pending nearby-device pairing prompts waiting for Pair / Don\'t pair',
  })
  pairingPrompts() {
    return this.discovery.listPrompts();
  }

  @Post('discovery/prompts/:ieee/accept')
  @Roles(RoleName.ADMIN, RoleName.OPERATOR)
  @ApiOperation({ summary: 'Keep the nearby device on the network' })
  acceptPairing(@Param('ieee') ieee: string) {
    return this.discovery.accept(ieee);
  }

  @Post('discovery/prompts/:ieee/reject')
  @Roles(RoleName.ADMIN, RoleName.OPERATOR)
  @ApiOperation({
    summary: 'Remove the nearby device instead of pairing it',
  })
  rejectPairing(@Param('ieee') ieee: string, @Body() dto: RejectPairingDto = {}) {
    return this.discovery.reject(ieee, dto.block ?? false);
  }

  @Post('discovery/mode')
  @Roles(RoleName.ADMIN, RoleName.OPERATOR)
  @ApiOperation({
    summary: 'Enable auto-pair (nearby devices) or switch back to manual mode',
    description:
      'Auto mode keeps Zigbee permit-join open so devices in pairing mode within radio ' +
      'range can start joining. The dashboard then asks whether to keep each device.',
  })
  setDiscoveryMode(@Body() dto: SetPairingModeDto) {
    return this.discovery.setPairingMode(dto);
  }

  @Post('discovery/sync')
  @Roles(RoleName.ADMIN, RoleName.OPERATOR)
  @ApiOperation({
    summary: 'Manual sync: open a timed join window and re-interview pending devices',
  })
  manualSync(@Body() dto: ManualSyncDto) {
    return this.discovery.manualSync(dto);
  }

  @Patch('settings')
  @Roles(RoleName.ADMIN)
  @ApiOperation({
    summary: 'Update coordinator and network settings',
    description:
      'Applied through Zigbee2MQTT. Serial changes need a restart; PAN id, channel or ' +
      'network key changes create a new network and require re-pairing every device.',
  })
  update(@Body() dto: UpdateCoordinatorDto) {
    return this.coordinator.updateSettings(dto);
  }

  @Post('permit-join')
  @Roles(RoleName.ADMIN, RoleName.OPERATOR)
  @ApiOperation({ summary: 'Open or close the join window' })
  permitJoin(@Body() dto: PermitJoinDto) {
    return this.coordinator.permitJoin(dto);
  }

  @Post('restart')
  @Roles(RoleName.ADMIN)
  @ApiOperation({ summary: 'Restart the Zigbee2MQTT bridge' })
  restart() {
    return this.coordinator.restart();
  }

  @Get('health')
  @ApiOperation({ summary: 'Ask the bridge whether it considers itself healthy' })
  health() {
    return this.coordinator.healthCheck();
  }
}
