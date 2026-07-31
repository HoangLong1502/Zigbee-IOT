import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Coordinator } from '../../domain/entities';
import { DeviceModule } from '../device/device.module';
import { EventModule } from '../event/event.module';
import { CoordinatorController } from './coordinator.controller';
import { CoordinatorService } from './coordinator.service';
import { DiscoveryService } from './discovery.service';
import { SerialDetectionService } from './serial-detection.service';

@Module({
  imports: [
    TypeOrmModule.forFeature([Coordinator]),
    DeviceModule,
    EventModule,
  ],
  controllers: [CoordinatorController],
  providers: [CoordinatorService, SerialDetectionService, DiscoveryService],
  exports: [CoordinatorService, SerialDetectionService, DiscoveryService],
})
export class CoordinatorModule {}
