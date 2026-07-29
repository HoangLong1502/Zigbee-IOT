import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsBoolean, IsIn, IsNotEmpty, IsOptional, IsString } from 'class-validator';

/** Manual publish, exposed for debugging and advanced automations. */
export class PublishMessageDto {
  @ApiProperty({ example: 'zigbee2mqtt/Living Room Lamp/set' })
  @IsString()
  @IsNotEmpty()
  topic: string;

  @ApiProperty({
    description: 'Raw payload; JSON strings are forwarded as-is',
    example: '{"state":"ON"}',
  })
  @IsString()
  payload: string;

  @ApiPropertyOptional({ enum: [0, 1, 2], default: 0 })
  @IsOptional()
  @IsIn([0, 1, 2])
  qos?: 0 | 1 | 2;

  @ApiPropertyOptional({ default: false })
  @IsOptional()
  @IsBoolean()
  retain?: boolean;
}
