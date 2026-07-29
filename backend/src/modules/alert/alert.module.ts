import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Alert } from '../../domain/entities';
import { AlertController } from './alert.controller';
import { AlertService } from './alert.service';

@Module({
  imports: [TypeOrmModule.forFeature([Alert])],
  controllers: [AlertController],
  providers: [AlertService],
  exports: [AlertService],
})
export class AlertModule {}
