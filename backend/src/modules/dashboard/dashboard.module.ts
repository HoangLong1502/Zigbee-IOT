import { Module } from '@nestjs/common';
import { DeviceModule } from '../device/device.module';
import { EventModule } from '../event/event.module';
import { AlertModule } from '../alert/alert.module';
import { CoordinatorModule } from '../coordinator/coordinator.module';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { DashboardController } from './dashboard.controller';

@Module({
  imports: [DeviceModule, EventModule, AlertModule, CoordinatorModule, TelemetryModule],
  controllers: [DashboardController],
})
export class DashboardModule {}
