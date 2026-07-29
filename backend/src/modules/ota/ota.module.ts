import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { OtaJob } from '../../domain/entities';
import { DeviceModule } from '../device/device.module';
import { OtaController } from './ota.controller';
import { OtaService } from './ota.service';

@Module({
  imports: [TypeOrmModule.forFeature([OtaJob]), DeviceModule],
  controllers: [OtaController],
  providers: [OtaService],
  exports: [OtaService],
})
export class OtaModule {}
