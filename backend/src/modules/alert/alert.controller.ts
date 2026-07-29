import { Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { AlertService } from './alert.service';
import { AlertSeverity, RoleName } from '../../domain/entities';
import { Roles } from '../auth/decorators/roles.decorator';

@ApiTags('Alerts')
@ApiBearerAuth()
@Controller('alerts')
export class AlertController {
  constructor(private readonly alerts: AlertService) {}

  @Get()
  @ApiOperation({ summary: 'List alerts' })
  @ApiQuery({ name: 'resolved', required: false, type: Boolean })
  @ApiQuery({ name: 'acknowledged', required: false, type: Boolean })
  @ApiQuery({ name: 'severity', required: false, enum: AlertSeverity })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'deviceId', required: false })
  @ApiQuery({ name: 'limit', required: false })
  @ApiQuery({ name: 'offset', required: false })
  findAll(
    @Query('resolved') resolved?: string,
    @Query('acknowledged') acknowledged?: string,
    @Query('severity') severity?: AlertSeverity,
    @Query('type') type?: string,
    @Query('deviceId') deviceId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.alerts.findAll({
      resolved: resolved === undefined ? undefined : resolved === 'true',
      acknowledged: acknowledged === undefined ? undefined : acknowledged === 'true',
      severity,
      type,
      deviceId,
      limit: Number(limit) || 100,
      offset: Number(offset) || 0,
    });
  }

  @Get('summary')
  @ApiOperation({ summary: 'Counts of active, critical and unacknowledged alerts' })
  summary() {
    return this.alerts.getSummary();
  }

  @Get('thresholds')
  @ApiOperation({ summary: 'Threshold values used by the rules engine' })
  thresholds() {
    return this.alerts.getThresholds();
  }

  @Post(':id/acknowledge')
  @Roles(RoleName.ADMIN, RoleName.OPERATOR)
  @ApiOperation({ summary: 'Acknowledge one alert' })
  acknowledge(@Param('id') id: string) {
    return this.alerts.acknowledge(id);
  }

  @Post('acknowledge-all')
  @Roles(RoleName.ADMIN, RoleName.OPERATOR)
  @ApiOperation({ summary: 'Acknowledge every open alert' })
  acknowledgeAll() {
    return this.alerts.acknowledgeAll();
  }

  @Post(':id/resolve')
  @Roles(RoleName.ADMIN, RoleName.OPERATOR)
  @ApiOperation({ summary: 'Manually resolve an alert' })
  resolve(@Param('id') id: string) {
    return this.alerts.resolve(id);
  }
}
