/* eslint-disable prettier/prettier */
import { Controller, Get, UnauthorizedException, UseGuards } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import { CurrentUser, type CurrentUserData } from '../auth/current-user.decorator';
import type { RequestUser } from '../auth/jwt.strategy';

@Controller()
export class UsersController {
  constructor(private readonly prisma: PrismaService) {}

  @UseGuards(JwtAuthGuard)
  @Get('profile')
  async profile(@CurrentUser() user: RequestUser) {
    const dbUser = await this.prisma.user.findUnique({
      where: { id: user.userId },
      select: { id: true, email: true, role: true, status: true, createdAt: true },
    });

    // Optional (khuyến nghị): chặn user bị disabled ngay cả khi token còn hạn
    if (!dbUser || dbUser.status === 'DISABLED') {
      throw new UnauthorizedException({
        errorCode: 'UNAUTHORIZED',
        message: 'Unauthorized',
      });
    }

    return dbUser;
  }

  @UseGuards(JwtAuthGuard)
  @Get('me')
  me(@CurrentUser() user: CurrentUserData) {
    return user;
  }
}
