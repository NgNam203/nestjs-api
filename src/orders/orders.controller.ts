/* eslint-disable @typescript-eslint/no-unsafe-member-access */
import {
  Body,
  Controller,
  Get,
  Param,
  Post,
  Query,
  UseGuards,
  Headers,
  Patch,
  Delete,
  Req,
  ServiceUnavailableException,
} from '@nestjs/common';
import { OrdersService } from './orders.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { JwtAuthGuard } from '../auth/jwt-auth.guard';
import {
  CurrentUser,
  type CurrentUserData,
} from '../auth/current-user.decorator';
import { ListOrdersQueryDto } from './dto/list-orders-query.dto';
import { UpdateOrderStatusDto } from './dto/update-order-status.dto';
import type { Request } from 'express';
import { RateLimitGuard } from '../rate-limit/rate-limit.guard';
import { DegradeConfig } from '../common/resilience/degrade.config';
import { ShedConfig } from '../common/resilience/shed.config';

@Controller('orders')
@UseGuards(JwtAuthGuard)
export class OrdersController {
  constructor(private readonly orders: OrdersService) {}

  @UseGuards(RateLimitGuard)
  @Post()
  create(
    @CurrentUser() user: CurrentUserData,
    @Body() dto: CreateOrderDto,
    @Headers('idempotency-key') idempotencyKey?: string,
  ) {
    return this.orders.createOrderIdempotent(user.userId, dto, idempotencyKey);
  }

  @Get()
  list(
    @Req() req: Request,
    @CurrentUser() user: CurrentUserData,
    @Query() q: ListOrdersQueryDto,
  ) {
    if (DegradeConfig.disableOrdersList) {
      throw new ServiceUnavailableException({
        errorCode: 'DEGRADED',
        message: 'Service temporarily unavailable',
      });
    }
    if (ShedConfig.shedOrdersList) {
      throw new ServiceUnavailableException({
        errorCode: 'LOAD_SHED',
        message: 'Service temporarily unavailable',
      });
    }
    const requestId = (req as any).requestId as string | undefined;
    return this.orders.listOrdersCached(user.userId, q, requestId);
  }

  @Get(':id')
  getDetail(
    @Req() req: Request,
    @CurrentUser() user: CurrentUserData,
    @Param('id') orderId: string,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    return this.orders.getOrderDetailCached(user.userId, orderId, requestId);
  }

  @Patch(':id/status')
  updateStatus(
    @Req() req: Request,
    @CurrentUser() user: CurrentUserData,
    @Param('id') orderId: string,
    @Body() dto: UpdateOrderStatusDto,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    return this.orders.updateOrderStatus(user, orderId, dto.status, requestId);
  }

  @Delete(':id')
  softDelete(
    @Req() req: Request,
    @CurrentUser() user: CurrentUserData,
    @Param('id') orderId: string,
  ) {
    const requestId = (req as any).requestId as string | undefined;
    return this.orders.softDeleteOrder(user, orderId, requestId);
  }
}
