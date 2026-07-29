import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { DeviceEvent } from '../../domain/entities';
import { EventController } from './event.controller';
import { EventService } from './event.service';

@Module({
  imports: [TypeOrmModule.forFeature([DeviceEvent])],
  controllers: [EventController],
  providers: [EventService],
  exports: [EventService],
})
export class EventModule {}
