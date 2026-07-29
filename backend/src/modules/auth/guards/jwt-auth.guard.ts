import { ExecutionContext, Injectable } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { AuthGuard } from '@nestjs/passport';
import { AuthConfig } from '../../../config/configuration';
import { IS_PUBLIC_KEY } from '../decorators/public.decorator';

/**
 * Registered globally, so every route requires a bearer token unless it is
 * marked `@Public()`.
 *
 * Setting `AUTH_ENABLED=false` disables the check entirely, which is handy for
 * a trusted home LAN deployment or local development.
 */
@Injectable()
export class JwtAuthGuard extends AuthGuard('jwt') {
  private readonly authEnabled: boolean;

  constructor(
    private readonly reflector: Reflector,
    configService: ConfigService,
  ) {
    super();
    this.authEnabled = configService.getOrThrow<AuthConfig>('auth').enabled;
  }

  canActivate(context: ExecutionContext) {
    if (!this.authEnabled) return true;

    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) return true;

    return super.canActivate(context);
  }
}
