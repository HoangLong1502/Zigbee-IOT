import { Module } from '@nestjs/common';
import { ConfigModule, ConfigService } from '@nestjs/config';
import { APP_GUARD } from '@nestjs/core';
import { ScheduleModule } from '@nestjs/schedule';
import { TypeOrmModule } from '@nestjs/typeorm';
import { configuration, DatabaseConfig } from './config/configuration';
import { ALL_ENTITIES } from './domain/entities';
import { JwtAuthGuard } from './modules/auth/guards/jwt-auth.guard';
import { RolesGuard } from './modules/auth/guards/roles.guard';
import { AuthModule } from './modules/auth/auth.module';
import { WebsocketModule } from './modules/websocket/websocket.module';
import { MqttModule } from './modules/mqtt/mqtt.module';
import { IngestionModule } from './modules/mqtt/ingestion.module';
import { DeviceModule } from './modules/device/device.module';
import { TelemetryModule } from './modules/telemetry/telemetry.module';
import { HistoryModule } from './modules/history/history.module';
import { EventModule } from './modules/event/event.module';
import { AlertModule } from './modules/alert/alert.module';
import { CoordinatorModule } from './modules/coordinator/coordinator.module';
import { TopologyModule } from './modules/topology/topology.module';
import { OtaModule } from './modules/ota/ota.module';
import { DashboardModule } from './modules/dashboard/dashboard.module';
import { SettingsModule } from './modules/settings/settings.module';

/**
 * Root NestJS module.
 *
 * Composition root for the Zigbee monitoring platform. Feature modules are
 * imported in the same order as the data flow they participate in, so that
 * reading the imports list already tells the story:
 *
 *   Zigbee Devices
 *     -> USB Coordinator
 *     -> Zigbee2MQTT
 *     -> Mosquitto
 *     -> MqttModule / IngestionModule
 *     -> Device / Telemetry / History / Event / Alert / Topology / OTA
 *     -> WebsocketModule
 *     -> React Frontend
 */
@Module({
  imports: [
    ConfigModule.forRoot({
      isGlobal: true,
      load: [configuration],
      envFilePath: ['.env', '../.env'],
    }),

    ScheduleModule.forRoot(),

    TypeOrmModule.forRootAsync({
      inject: [ConfigService],
      useFactory: (configService: ConfigService) => {
        const db = configService.getOrThrow<DatabaseConfig>('database');
        return {
          type: 'postgres' as const,
          host: db.host,
          port: db.port,
          username: db.username,
          password: db.password,
          database: db.database,
          entities: ALL_ENTITIES,
          synchronize: db.synchronize,
          logging: db.logging,
          // Keep a few spare connections for the bursty ingestion path.
          extra: {
            max: 20,
            idleTimeoutMillis: 30_000,
          },
        };
      },
    }),

    // Cross-cutting
    AuthModule,
    WebsocketModule,
    MqttModule,

    // Domain features
    DeviceModule,
    TelemetryModule,
    HistoryModule,
    EventModule,
    AlertModule,
    CoordinatorModule,
    TopologyModule,
    OtaModule,

    // Composition endpoints
    DashboardModule,
    SettingsModule,

    // Must come after the feature modules it writes into.
    IngestionModule,
  ],
  providers: [
    // Every route requires a JWT unless marked @Public(), and mutating
    // routes further require an appropriate role.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
  ],
})
export class AppModule {}
