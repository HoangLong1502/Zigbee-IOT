import { Module } from '@nestjs/common';
import { DeviceModule } from '../device/device.module';
import { TelemetryModule } from '../telemetry/telemetry.module';
import { HistoryModule } from '../history/history.module';
import { EventModule } from '../event/event.module';
import { AlertModule } from '../alert/alert.module';
import { CoordinatorModule } from '../coordinator/coordinator.module';
import { TopologyModule } from '../topology/topology.module';
import { OtaModule } from '../ota/ota.module';
import { MqttIngestionService } from './mqtt-ingestion.service';

/**
 * Wires the ingestion pipeline into every feature module it needs to write to.
 *
 * Kept separate from MqttModule so that the transport layer (client, logs,
 * commands) has no dependency on the domain modules, preserving a clean
 * one-way data flow:
 *
 *   MqttModule (transport) -> IngestionModule -> feature modules
 */
@Module({
  imports: [
    DeviceModule,
    TelemetryModule,
    HistoryModule,
    EventModule,
    AlertModule,
    CoordinatorModule,
    TopologyModule,
    OtaModule,
  ],
  providers: [MqttIngestionService],
})
export class IngestionModule {}
