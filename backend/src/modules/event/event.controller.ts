import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiQuery, ApiTags } from '@nestjs/swagger';
import { EventService } from './event.service';
import { EventSeverity } from '../../domain/entities';

@ApiTags('Events')
@ApiBearerAuth()
@Controller('events')
export class EventController {
  constructor(private readonly events: EventService) {}

  @Get()
  @ApiOperation({ summary: 'Network event timeline' })
  @ApiQuery({ name: 'type', required: false })
  @ApiQuery({ name: 'severity', required: false, enum: EventSeverity })
  @ApiQuery({ name: 'deviceId', required: false })
  @ApiQuery({ name: 'limit', required: false, example: 100 })
  @ApiQuery({ name: 'offset', required: false, example: 0 })
  findAll(
    @Query('type') type?: string,
    @Query('severity') severity?: EventSeverity,
    @Query('deviceId') deviceId?: string,
    @Query('limit') limit?: string,
    @Query('offset') offset?: string,
  ) {
    return this.events.findAll({
      type,
      severity,
      deviceId,
      limit: Number(limit) || 100,
      offset: Number(offset) || 0,
    });
  }

  @Get('recent')
  @ApiOperation({ summary: 'Latest events for the dashboard card' })
  recent(@Query('limit') limit?: string) {
    return this.events.findRecent(Number(limit) || 20);
  }
}
