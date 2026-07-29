import { Controller, Get } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { DeviceService } from '../device/device.service';
import { EventService } from '../event/event.service';
import { AlertService } from '../alert/alert.service';
import { CoordinatorService } from '../coordinator/coordinator.service';
import { MqttService } from '../mqtt/mqtt.service';
import { TelemetryService } from '../telemetry/telemetry.service';
import { Public } from '../auth/decorators/public.decorator';

/**
 * Aggregated endpoints that power the landing dashboard.
 *
 * Kept as a thin composition of the other modules so that the frontend can
 * hydrate with a single round trip after login.
 */
@ApiTags('Dashboard')
@ApiBearerAuth()
@Controller('dashboard')
export class DashboardController {
  constructor(
    private readonly devices: DeviceService,
    private readonly events: EventService,
    private readonly alerts: AlertService,
    private readonly coordinator: CoordinatorService,
    private readonly mqtt: MqttService,
    private readonly telemetry: TelemetryService,
  ) {}

  @Get('summary')
  @ApiOperation({ summary: 'Everything the landing dashboard needs in one response' })
  async summary() {
    const [stats, recentEvents, alertSummary, coordinator, messagesLastHour] =
      await Promise.all([
        this.devices.getStats(),
        this.events.findRecent(20),
        this.alerts.getSummary(),
        this.coordinator.getView(),
        this.telemetry.countSince(new Date(Date.now() - 3600_000)),
      ]);

    // Latest sensor readings: devices that reported something in the last hour.
    const { items: recentDevices } = await this.devices.findAll({
      online: true,
      limit: 12,
    });
    const latestReadings = recentDevices
      .filter((device) => device.lastPayload && device.type !== 'Coordinator')
      .map((device) => ({
        id: device.id,
        friendlyName: device.friendlyName,
        ieeeAddress: device.ieeeAddress,
        model: device.model,
        lastSeen: device.lastSeen,
        linkQuality: device.linkQuality,
        battery: device.battery,
        payload: device.lastPayload,
      }));

    return {
      stats: {
        ...stats,
        messagesLastHour,
        mqttConnected: this.mqtt.isConnected,
        coordinatorOnline: coordinator.online,
        permitJoin: coordinator.permitJoin,
      },
      coordinator: {
        online: coordinator.online,
        permitJoin: coordinator.permitJoin,
        channel: coordinator.channel,
        panId: coordinator.panId,
        firmwareVersion: coordinator.firmwareVersion,
        zigbee2mqttVersion: coordinator.zigbee2mqttVersion,
        serialPort: coordinator.serialPort,
        adapter: coordinator.adapter,
      },
      mqtt: this.mqtt.getStatus(),
      alerts: alertSummary,
      recentEvents,
      latestReadings,
    };
  }

  @Public()
  @Get('health')
  @ApiOperation({ summary: 'Process health, used by Docker / load balancers' })
  health() {
    return {
      status: 'ok',
      uptime: process.uptime(),
      mqttConnected: this.mqtt.isConnected,
      timestamp: new Date().toISOString(),
    };
  }
}
