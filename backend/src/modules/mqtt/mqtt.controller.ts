import {
  Body,
  Controller,
  Delete,
  Get,
  Header,
  HttpCode,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MqttService, MqttStatus } from './mqtt.service';
import { MqttLogService } from './mqtt-log.service';
import { QueryMqttLogsDto } from './dto/query-mqtt-logs.dto';
import { PublishMessageDto } from './dto/publish-message.dto';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleName } from '../../domain/entities';

@ApiTags('MQTT')
@Controller('mqtt')
export class MqttController {
  constructor(
    private readonly mqtt: MqttService,
    private readonly logs: MqttLogService,
  ) {}

  @Get('status')
  @ApiOperation({ summary: 'Broker connection state and traffic counters' })
  getStatus(): MqttStatus {
    return this.mqtt.getStatus();
  }

  @Post('publish')
  @Roles(RoleName.ADMIN, RoleName.OPERATOR)
  @HttpCode(202)
  @ApiOperation({ summary: 'Publish a raw MQTT message (debugging / automation)' })
  async publish(@Body() dto: PublishMessageDto): Promise<{ published: boolean }> {
    await this.mqtt.publish(dto.topic, dto.payload, {
      qos: dto.qos,
      retain: dto.retain,
    });
    return { published: true };
  }

  @Get('logs')
  @ApiOperation({ summary: 'Query the MQTT message log with filters and paging' })
  query(@Query() dto: QueryMqttLogsDto) {
    return this.logs.query(dto);
  }

  @Get('logs/stats')
  @ApiOperation({ summary: 'Row count and time range of the stored log' })
  stats() {
    return this.logs.stats();
  }

  @Get('logs/export')
  @Header('Content-Type', 'application/json')
  @Header('Content-Disposition', 'attachment; filename="mqtt-logs.json"')
  @ApiOperation({ summary: 'Export the filtered log as a JSON file' })
  @ApiOkResponse({ description: 'JSON array of log entries' })
  export(@Query() dto: QueryMqttLogsDto) {
    return this.logs.exportAll(dto);
  }

  @Delete('logs')
  @Roles(RoleName.ADMIN)
  @ApiOperation({ summary: 'Delete every stored MQTT log entry' })
  clear() {
    return this.logs.clear();
  }
}
