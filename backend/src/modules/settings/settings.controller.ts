import { Body, Controller, Get, Patch } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiProperty, ApiPropertyOptional, ApiTags } from '@nestjs/swagger';
import { ConfigService } from '@nestjs/config';
import { IsNumber, IsOptional, Max, Min } from 'class-validator';
import { Type } from 'class-transformer';
import { Roles } from '../auth/decorators/roles.decorator';
import { RoleName } from '../../domain/entities';
import {
  AlertConfig,
  AuthConfig,
  MqttConfig,
  RetentionConfig,
  RootConfig,
} from '../../config/configuration';
import { AlertService } from '../alert/alert.service';

class UpdateThresholdsDto {
  @ApiPropertyOptional({ example: 20 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(1)
  @Max(100)
  lowBatteryPercent?: number;

  @ApiPropertyOptional({ example: 40 })
  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-40)
  @Max(100)
  highTemperatureC?: number;
}

class SettingsViewDto {
  @ApiProperty() mqtt: Pick<MqttConfig, 'url' | 'baseTopic' | 'clientId'>;
  @ApiProperty() retention: RetentionConfig;
  @ApiProperty() alerts: AlertConfig;
  @ApiProperty() authEnabled: boolean;
  @ApiProperty() version: string;
}

/**
 * Read-mostly settings surface.
 *
 * Thresholds can be patched at runtime (they live in memory / env); structural
 * settings such as the MQTT URL still require a process restart and are
 * therefore shown as read-only.
 */
@ApiTags('Settings')
@ApiBearerAuth()
@Controller('settings')
export class SettingsController {
  constructor(
    private readonly config: ConfigService<RootConfig, true>,
    private readonly alerts: AlertService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Current platform settings' })
  get(): SettingsViewDto {
    const mqtt = this.config.get('mqtt', { infer: true });
    const retention = this.config.get('retention', { infer: true });
    const auth = this.config.get('auth', { infer: true }) as AuthConfig;

    return {
      mqtt: {
        url: mqtt.url,
        baseTopic: mqtt.baseTopic,
        clientId: mqtt.clientId,
      },
      retention,
      alerts: this.alerts.getThresholds(),
      authEnabled: auth.enabled,
      version: process.env.npm_package_version ?? '1.0.0',
    };
  }

  @Patch('thresholds')
  @Roles(RoleName.ADMIN)
  @ApiOperation({
    summary: 'Update alert thresholds (in-memory for the lifetime of the process)',
  })
  updateThresholds(@Body() dto: UpdateThresholdsDto): AlertConfig {
    // Thresholds are held in the configuration object returned by ConfigService;
    // mutating it here is enough because AlertService keeps a reference to the
    // same object.
    const alerts = this.config.get('alerts', { infer: true }) as AlertConfig;
    if (dto.lowBatteryPercent !== undefined) alerts.lowBatteryPercent = dto.lowBatteryPercent;
    if (dto.highTemperatureC !== undefined) alerts.highTemperatureC = dto.highTemperatureC;
    return alerts;
  }
}
