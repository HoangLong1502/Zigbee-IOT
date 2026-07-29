import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsEmail, IsEnum, IsOptional, IsString, MinLength } from 'class-validator';
import { RoleName } from '../../../domain/entities';

export class LoginDto {
  @ApiProperty({ example: 'admin@local' })
  @IsEmail()
  email: string;

  @ApiProperty({ example: 'admin123', minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;
}

export class RegisterDto {
  @ApiProperty({ example: 'operator@local' })
  @IsEmail()
  email: string;

  @ApiProperty({ minLength: 6 })
  @IsString()
  @MinLength(6)
  password: string;

  @ApiPropertyOptional()
  @IsOptional()
  @IsString()
  displayName?: string;

  @ApiPropertyOptional({ enum: RoleName, default: RoleName.VIEWER })
  @IsOptional()
  @IsEnum(RoleName)
  role?: RoleName;
}

export class AuthResponseDto {
  @ApiProperty()
  accessToken: string;

  @ApiProperty()
  expiresIn: string;

  @ApiProperty()
  user: {
    id: string;
    email: string;
    displayName: string | null;
    roles: string[];
  };
}
