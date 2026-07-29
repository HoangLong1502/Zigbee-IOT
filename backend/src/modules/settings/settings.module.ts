import { Module } from '@nestjs/common';
import { AlertModule } from '../alert/alert.module';
import { SettingsController } from './settings.controller';

@Module({
  imports: [AlertModule],
  controllers: [SettingsController],
})
export class SettingsModule {}
