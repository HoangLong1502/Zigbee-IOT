import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Device, DeviceAttribute, DeviceExpose } from '../../domain/entities';
import { DeviceController } from './device.controller';
import { DeviceService } from './device.service';

@Module({
  imports: [TypeOrmModule.forFeature([Device, DeviceExpose, DeviceAttribute])],
  controllers: [DeviceController],
  providers: [DeviceService],
  exports: [DeviceService],
})
export class DeviceModule {}
