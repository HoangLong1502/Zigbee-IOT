import { Global, Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { MqttLog } from '../../domain/entities';
import { MqttController } from './mqtt.controller';
import { MqttLogService } from './mqtt-log.service';
import { MqttService } from './mqtt.service';
import { ZigbeeCommandService } from './zigbee-command.service';

/**
 * Transport layer for everything Zigbee2MQTT.
 *
 * Global because the device, coordinator, topology and OTA modules all need to
 * send commands. Interpretation of payloads lives in IngestionModule so that
 * this module stays free of domain dependencies.
 */
@Global()
@Module({
  imports: [TypeOrmModule.forFeature([MqttLog])],
  controllers: [MqttController],
  providers: [MqttService, MqttLogService, ZigbeeCommandService],
  exports: [MqttService, MqttLogService, ZigbeeCommandService],
})
export class MqttModule {}
