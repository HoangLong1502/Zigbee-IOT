import { SetMetadata } from '@nestjs/common';
import { RoleName } from '../../../domain/entities';

export const ROLES_KEY = 'roles';

/**
 * Restricts a route to the given roles. Without this decorator any
 * authenticated user (including `viewer`) may call the endpoint, which is why
 * every mutating route declares it explicitly.
 */
export const Roles = (...roles: (RoleName | string)[]) => SetMetadata(ROLES_KEY, roles);
