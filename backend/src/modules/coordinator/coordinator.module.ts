import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Coordinator } from '../../domain/entities';
import { CoordinatorController } from './coordinator.controller';
import { CoordinatorService } from './coordinator.service';
import { SerialDetectionService } from './serial-detection.service';

@Module({
  imports: [TypeOrmModule.forFeature([Coordinator])],
  controllers: [CoordinatorController],
  providers: [CoordinatorService, SerialDetectionService],
  exports: [CoordinatorService, SerialDetectionService],
})
export class CoordinatorModule {}
