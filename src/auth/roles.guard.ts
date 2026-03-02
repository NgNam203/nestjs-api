import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { ROLES_KEY, type Role } from './roles.decorator';

type RequestUser = { userId: string; role?: Role };

@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    // IMPORTANT: dùng signature 2-args để tương thích
    const requiredRoles =
      this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, [
        ctx.getHandler(),
        ctx.getClass(),
      ]) ?? [];

    if (requiredRoles.length === 0) return true;

    const req = ctx.switchToHttp().getRequest<{ user?: RequestUser }>();
    const user = req.user;

    if (!user?.role) {
      throw new ForbiddenException({
        errorCode: 'FORBIDDEN',
        message: 'Forbidden',
      });
    }

    if (!requiredRoles.includes(user.role)) {
      throw new ForbiddenException({
        errorCode: 'INSUFFICIENT_ROLE',
        message: 'Forbidden',
      });
    }

    return true;
  }
}
