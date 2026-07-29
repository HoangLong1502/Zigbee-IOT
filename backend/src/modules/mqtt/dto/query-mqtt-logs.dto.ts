import { ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';
import { MessageDirection } from '../../../domain/entities';

export class QueryMqttLogsDto {
  @ApiPropertyOptional({ description: 'Substring match on the MQTT topic' })
  @IsOptional()
  @IsString()
  topic?: string;

  @ApiPropertyOptional({ enum: MessageDirection })
  @IsOptional()
  @IsEnum(MessageDirection)
  direction?: MessageDirection;

  @ApiPropertyOptional({ description: 'Substring match on the resolved device name' })
  @IsOptional()
  @IsString()
  device?: string;

  @ApiPropertyOptional({ description: 'Free text search over topic and payload' })
  @IsOptional()
  @IsString()
  search?: string;

  @ApiPropertyOptional({ description: 'ISO timestamp, inclusive lower bound' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'ISO timestamp, inclusive upper bound' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({ default: 100, maximum: 1000 })
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
