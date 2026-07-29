import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsISO8601, IsOptional, IsString, Max, Min } from 'class-validator';

/** Chart ranges offered by the UI. */
export enum HistoryRange {
  LAST_HOUR = 'hour',
  TODAY = 'today',
  LAST_24H = '24h',
  LAST_7D = '7d',
  LAST_30D = '30d',
  CUSTOM = 'custom',
}

export enum HistoryAggregate {
  AVG = 'avg',
  MIN = 'min',
  MAX = 'max',
  SUM = 'sum',
  LAST = 'last',
}

export class QueryHistoryDto {
  @ApiPropertyOptional({
    description: 'Property to chart, e.g. temperature. Omit for every property.',
  })
  @IsOptional()
  @IsString()
  property?: string;

  @ApiPropertyOptional({ enum: HistoryRange, default: HistoryRange.LAST_24H })
  @IsOptional()
  @IsEnum(HistoryRange)
  range?: HistoryRange;

  @ApiPropertyOptional({ description: 'Required when range=custom' })
  @IsOptional()
  @IsISO8601()
  from?: string;

  @ApiPropertyOptional({ description: 'Required when range=custom' })
  @IsOptional()
  @IsISO8601()
  to?: string;

  @ApiPropertyOptional({
    description: 'Bucket size in seconds. Derived from the range when omitted.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  bucketSeconds?: number;

  @ApiPropertyOptional({ enum: HistoryAggregate, default: HistoryAggregate.AVG })
  @IsOptional()
  @IsEnum(HistoryAggregate)
  aggregate?: HistoryAggregate;

  @ApiPropertyOptional({ default: 1000, maximum: 5000 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(5000)
  limit?: number;
}

export class HistoryPointDto {
  @ApiProperty({ description: 'Bucket start, ISO timestamp' })
  timestamp: string;

  @ApiProperty({ nullable: true })
  value: number | null;

  @ApiProperty({ nullable: true })
  min: number | null;

  @ApiProperty({ nullable: true })
  max: number | null;

  @ApiProperty({ description: 'Samples inside the bucket' })
  count: number;
}

export class HistorySeriesDto {
  @ApiProperty() property: string;
  @ApiProperty({ nullable: true }) unit: string | null;
  @ApiProperty({ type: [HistoryPointDto] }) points: HistoryPointDto[];
  @ApiProperty() from: string;
  @ApiProperty() to: string;
  @ApiProperty() bucketSeconds: number;
}
