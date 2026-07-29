import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsIn,
  IsInt,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';

/**
 * Coordinator settings that can be changed at runtime.
 *
 * Zigbee2MQTT owns the serial port, so these are applied by patching its
 * configuration through `bridge/request/options`. Network level changes
 * (channel, PAN id, network key) force every device to re-join and require a
 * bridge restart, which the API reports back in `restartRequired`.
 */
export class UpdateCoordinatorDto {
  @ApiPropertyOptional({ example: 'COM3', description: 'Serial port path' })
  @IsOptional()
  @IsString()
  serialPort?: string;

  @ApiPropertyOptional({ example: 115200 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  baudRate?: number;

  @ApiPropertyOptional({ enum: ['zstack', 'ember', 'deconz', 'zigate', 'zboss', 'auto'] })
  @IsOptional()
  @IsIn(['zstack', 'ember', 'deconz', 'zigate', 'zboss', 'auto'])
  adapter?: string;

  @ApiPropertyOptional({ example: 6754, description: 'PAN id, 0-65534' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(0)
  @Max(65534)
  panId?: number;

  @ApiPropertyOptional({ example: 11, description: 'Zigbee channel, 11-26' })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(11)
  @Max(26)
  channel?: number;

  @ApiPropertyOptional({
    example: 'DDDDDDDDDDDDDDDD',
    description: '16 hex characters (8 bytes)',
  })
  @IsOptional()
  @IsString()
  extendedPanId?: string;

  @ApiPropertyOptional({
    description: '32 hex characters (16 bytes), or "GENERATE" for a random key',
  })
  @IsOptional()
  @IsString()
  networkKey?: string;

  @ApiPropertyOptional({ enum: ['debug', 'info', 'warning', 'error'] })
  @IsOptional()
  @IsIn(['debug', 'info', 'warning', 'error'])
  logLevel?: string;
}

export class PermitJoinDto {
  @ApiProperty({ description: 'Open or close the join window' })
  @IsBoolean()
  value: boolean;

  @ApiPropertyOptional({
    example: 254,
    description: 'Seconds to keep the window open. Omit for the Zigbee2MQTT default.',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(254)
  time?: number;

  @ApiPropertyOptional({
    description: 'Only allow joining through this router (friendly name)',
  })
  @IsOptional()
  @IsString()
  device?: string;
}
