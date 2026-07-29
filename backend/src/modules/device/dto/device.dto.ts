import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsInt,
  IsNotEmpty,
  IsObject,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { DeviceType } from '../../../domain/entities';

export class QueryDevicesDto {
  @ApiPropertyOptional({ description: 'Substring match on friendly name, model or IEEE address' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ enum: DeviceType })
  @IsOptional()
  @IsString()
  type?: DeviceType;

  @ApiPropertyOptional({ description: 'Filter by online state' })
  @IsOptional()
  @Type(() => Boolean)
  @IsBoolean()
  online?: boolean;

  @ApiPropertyOptional({ description: 'Only devices exposing this property, e.g. "temperature"' })
  @IsOptional()
  @IsString()
  exposes?: string;

  @ApiPropertyOptional({ default: 200, maximum: 1000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(1000)
  limit?: number;

  @ApiPropertyOptional({ default: 0 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  offset?: number;
}

export class RenameDeviceDto {
  @ApiProperty({ example: 'Kitchen Temperature' })
  @IsString()
  @IsNotEmpty()
  name: string;
}

export class RemoveDeviceDto {
  @ApiPropertyOptional({
    default: false,
    description: 'Remove from the database even if the device does not respond',
  })
  @IsOptional()
  @IsBoolean()
  force?: boolean;

  @ApiPropertyOptional({ default: false, description: 'Prevent the device from re-joining' })
  @IsOptional()
  @IsBoolean()
  block?: boolean;
}

export class SetStateDto {
  @ApiProperty({
    description: 'Settable exposes and their target values',
    example: { state: 'ON', brightness: 200 },
  })
  @IsObject()
  payload: Record<string, unknown>;
}

export class GetStateDto {
  @ApiProperty({ type: [String], example: ['state', 'brightness'] })
  @IsArray()
  @IsString({ each: true })
  properties: string[];
}

export class ReadAttributesDto {
  @ApiProperty({ example: 'genBasic' })
  @IsString()
  cluster: string;

  @ApiProperty({ type: [String], example: ['zclVersion', 'appVersion'] })
  @IsArray()
  attributes: (string | number)[];

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  endpoint?: number | string;
}

export class WriteAttributesDto {
  @ApiProperty({ example: 'genBasic' })
  @IsString()
  cluster: string;

  @ApiProperty({ example: { zclVersion: 1 } })
  @IsObject()
  payload: Record<string, unknown>;

  @ApiPropertyOptional({ example: 1 })
  @IsOptional()
  endpoint?: number | string;
}

export class BindDto {
  @ApiProperty({ description: 'Target device friendly name or group id' })
  @IsString()
  to: string;

  @ApiPropertyOptional({ type: [String], example: ['genOnOff'] })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  clusters?: string[];

  @ApiPropertyOptional()
  @IsOptional()
  fromEndpoint?: number | string;

  @ApiPropertyOptional()
  @IsOptional()
  toEndpoint?: number | string;
}

export class ConfigureReportingDto {
  @ApiProperty({ example: 1 })
  endpoint: number | string;

  @ApiProperty({ example: 'msTemperatureMeasurement' })
  @IsString()
  cluster: string;

  @ApiProperty({ example: 'measuredValue' })
  attribute: string | number;

  @ApiProperty({ example: 60, description: 'Seconds' })
  @Type(() => Number)
  @IsInt()
  minimumReportInterval: number;

  @ApiProperty({ example: 3600, description: 'Seconds' })
  @Type(() => Number)
  @IsInt()
  maximumReportInterval: number;

  @ApiProperty({ example: 50, description: 'Minimum change that triggers a report' })
  @Type(() => Number)
  reportableChange: number;
}

export class DeviceStatsDto {
  @ApiProperty() total: number;
  @ApiProperty() online: number;
  @ApiProperty() offline: number;
  @ApiProperty() routers: number;
  @ApiProperty() endDevices: number;
  @ApiProperty() batteryPowered: number;
  @ApiProperty() lowBattery: number;
  @ApiProperty() unsupported: number;
  @ApiProperty({ description: 'Average LQI across online devices, 0-255' })
  averageLinkQuality: number;
  @ApiProperty({ description: 'Derived 0-100 mesh health score' })
  networkHealth: number;
}
