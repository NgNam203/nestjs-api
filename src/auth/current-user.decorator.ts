import { createParamDecorator, ExecutionContext } from '@nestjs/common';
import type { Role } from './roles.decorator';

export type CurrentUserData = { userId: string; role: Role };

export const CurrentUser = createParamDecorator(
  (data: keyof CurrentUserData | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest<{ user?: CurrentUserData }>();
    const user = request.user;
    return data ? user?.[data] : user;
  },
);
