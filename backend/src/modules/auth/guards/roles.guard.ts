import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import type { Request } from 'express';
import { AuthConfig } from '../../../config/configuration';
import type { AuthenticatedUser } from '../decorators/current-user.decorator';
import { ROLES_KEY } from '../decorators/roles.decorator';
import { RoleName } from '../../../domain/entities';

/** Enforces `@Roles(...)`. Admins implicitly satisfy every requirement. */
@Injectable()
export class RolesGuard implements CanActivate {
  private readonly authEnabled: boolean;

  constructor(
    private readonly reflector: Reflector,
    configService: ConfigService,
  ) {
    this.authEnabled = configService.getOrThrow<AuthConfig>('auth').enabled;
  }

  canActivate(context: ExecutionContext): boolean {
    if (!this.authEnabled) return true;

    const required = this.reflector.getAllAndOverride<string[]>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) return true;

    const request = context
      .switchToHttp()
      .getRequest<Request & { user?: AuthenticatedUser }>();
    const roles = request.user?.roles ?? [];

    if (roles.includes(RoleName.ADMIN)) return true;
    if (required.some((role) => roles.includes(role))) return true;

    throw new ForbiddenException(
      `This action requires one of the following roles: ${required.join(', ')}`,
    );
  }
}
