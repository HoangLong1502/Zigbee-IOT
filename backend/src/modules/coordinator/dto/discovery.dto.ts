import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsBoolean, IsIn, IsInt, IsOptional, Max, Min } from 'class-validator';

export class SetPairingModeDto {
  @ApiProperty({
    enum: ['manual', 'auto'],
    description:
      'manual = only join when you press Sync; auto = keep the network open for nearby pairing devices',
  })
  @IsIn(['manual', 'auto'])
  mode: 'manual' | 'auto';

  @ApiPropertyOptional({
    example: 254,
    description: 'Permit-join window length used while auto mode is on (1-254 seconds)',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(30)
  @Max(254)
  windowSeconds?: number;
}

export class ManualSyncDto {
  @ApiPropertyOptional({
    example: 120,
    description: 'How long to open permit join for this sync (1-254 seconds)',
    default: 120,
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(254)
  durationSeconds?: number;

  @ApiPropertyOptional({
    default: true,
    description: 'Re-interview devices whose Zigbee interview never finished',
  })
  @IsOptional()
  @IsBoolean()
  interviewPending?: boolean;
}
