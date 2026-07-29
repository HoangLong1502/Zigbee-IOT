import { Body, Controller, Get, HttpCode, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AuthService } from './auth.service';
import { AuthResponseDto, LoginDto, RegisterDto } from './dto/auth.dto';
import { Public } from './decorators/public.decorator';
import { Roles } from './decorators/roles.decorator';
import { CurrentUser, type AuthenticatedUser } from './decorators/current-user.decorator';
import { RoleName } from '../../domain/entities';

@ApiTags('Auth')
@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService) {}

  @Public()
  @Post('login')
  @HttpCode(200)
  @ApiOperation({ summary: 'Exchange credentials for a JWT' })
  login(@Body() dto: LoginDto): Promise<AuthResponseDto> {
    return this.auth.login(dto);
  }

  @Roles(RoleName.ADMIN)
  @Post('register')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Create a user (admin only)' })
  register(@Body() dto: RegisterDto): Promise<AuthResponseDto> {
    return this.auth.register(dto);
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Return the caller identity encoded in the token' })
  me(@CurrentUser() user: AuthenticatedUser | undefined) {
    return user ?? { userId: 'anonymous', email: 'anonymous', roles: ['admin'] };
  }
}
