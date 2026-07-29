import { Body, Controller, Get, Patch, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { CoordinatorService } from './coordinator.service';
import { PermitJoinDto, UpdateCoordinatorDto } from './dto/coordinator.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleName } from '../../domain/entities';

@ApiTags('Coordinator')
@ApiBearerAuth()
@Controller('coordinator')
export class CoordinatorController {
  constructor(private readonly coordinator: CoordinatorService) {}

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
