/* eslint-disable @typescript-eslint/no-unsafe-argument */
/* eslint-disable @typescript-eslint/no-unsafe-assignment */
/* eslint-disable @typescript-eslint/no-unsafe-member-access */
/* eslint-disable @typescript-eslint/no-unsafe-return */
import {
  ListOrdersQueryDto,
  SortBy,
  SortOrder,
} from './dto/list-orders-query.dto';
import { decodeCursor, encodeCursor } from './orders.cursor';
import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  Logger,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateOrderDto } from './dto/create-order.dto';
import { OrderStatus, Prisma } from '@prisma/client';
import { IdempotencyService } from './idempotency/idempotency.service';
import { hashCreateOrderRequest } from './idempotency/hash-request';
import { normalizeItems } from './helpers/normalize-items';
import { canTransition, TERMINAL_STATUSES } from './order-status';
import { CacheService } from '../cache/cache.service';
import { ExternalMockClient } from '../external/external-mock.client';
import { withTimeout } from '../common/resilience/timeout.util';
import { ResilienceConfig } from '../common/resilience/resilience.config';
import { TimeoutError } from '../common/resilience/timeout.util';
import {
  recordDbTimeout,
  tickShed,
} from '../common/resilience/db-timeout-tracker';
import { emailQueue } from '../infra/queue/queues';
@Injectable()
export class OrdersService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly idem: IdempotencyService,
    private readonly cache: CacheService,
    private readonly external: ExternalMockClient,
  ) {}
  private readonly TTL_DETAIL_SEC = 300;
  private readonly TTL_NEGATIVE_SEC = 60;
  private readonly LOCK_TTL_MS = 3000;
  private readonly logger = new Logger(OrdersService.name);
  private readonly TTL_LIST_SEC = 60; //60
  private detailKey(userId: string, orderId: string) {
    return `orders:v1:user:${userId}:id:${orderId}`;
  }
  private notFoundKey(userId: string, orderId: string) {
    return `orders:v1:user:${userId}:id:${orderId}:nf`;
  }
  private lockKey(cacheKey: string) {
    return `lock:${cacheKey}`;
  }
  private sleep(ms: number) {
    return new Promise((r) => setTimeout(r, ms));
  }
  private jitter(min: number, max: number) {
    return Math.floor(min + Math.random() * (max - min + 1));
  }
  private assertIdempotencyKey(idempotencyKey?: string) {
    if (!idempotencyKey) {
      throw new BadRequestException({
        errorCode: 'MISSING_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key header is required',
      });
    }
    const uuidRegex =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
    if (!uuidRegex.test(idempotencyKey)) {
      throw new BadRequestException({
        errorCode: 'INVALID_IDEMPOTENCY_KEY',
        message: 'Idempotency-Key must be a UUID',
      });
    }
    return idempotencyKey;
  }

  private parseDateRange(q: ListOrdersQueryDto) {
    // Inclusive from, exclusive to
    let fromDate: Date | undefined;
    let toDate: Date | undefined;

    if (q.from) {
      const d = new Date(q.from);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException({
          errorCode: 'INVALID_DATE',
          message: 'Invalid from',
        });
      }
      fromDate = d;
    }

    if (q.to) {
      const d = new Date(q.to);
      if (Number.isNaN(d.getTime())) {
        throw new BadRequestException({
          errorCode: 'INVALID_DATE',
          message: 'Invalid to',
        });
      }
      toDate = d;
    }

    if (fromDate && toDate && fromDate > toDate) {
      throw new BadRequestException({
        errorCode: 'INVALID_DATE_RANGE',
        message: 'from must be <= to',
      });
    }

    return { fromDate, toDate };
  }

  private buildWhere(userId: string, q: ListOrdersQueryDto) {
    const where: any = { userId, deletedAt: null };

    if (q.status) where.status = q.status;

    const { fromDate, toDate } = this.parseDateRange(q);
    if (fromDate || toDate) {
      where.createdAt = {};
      if (fromDate) where.createdAt.gte = fromDate;
      if (toDate) where.createdAt.lt = toDate; // exclusive
    }

    return where;
  }

  private buildOrderBy(q: ListOrdersQueryDto) {
    const order = (q.sortOrder ?? SortOrder.desc) as 'asc' | 'desc';

    if (q.sortBy === SortBy.totalAmount) {
      return [{ totalAmount: order }, { id: order }];
    }

    return [{ createdAt: order }, { id: order }];
  }

  private async listOrdersOffset(userId: string, q: ListOrdersQueryDto) {
    tickShed();
    try {
      const limit = q.limit ?? 20;
      const offset = q.offset ?? 0;

      const where = this.buildWhere(userId, q);
      const orderBy = this.buildOrderBy(q);

      const rows = await withTimeout(
        this.prisma.order.findMany({
          where,
          orderBy,
          skip: offset,
          take: limit + 1,
          select: {
            id: true,
            status: true,
            totalAmount: true,
            createdAt: true,
          },
        }),
        ResilienceConfig.db.timeoutMs,
        'db_timeout_list_orders_offset',
      );

      const hasMore = rows.length > limit;
      const data = hasMore ? rows.slice(0, limit) : rows;

      return {
        data,
        meta: { limit, offset, hasMore },
      };
    } catch (e) {
      if (
        e instanceof TimeoutError &&
        (e.label ?? '').startsWith('db_timeout_')
      ) {
        recordDbTimeout();
        this.logger.warn(
          `db_timeout event=list_orders mode=offset label=${e.label ?? 'none'}`,
        );
      }
      throw e;
    }
  }

  private async listOrdersCursor(userId: string, q: ListOrdersQueryDto) {
    tickShed();
    try {
      if (q.sortOrder && q.sortOrder !== SortOrder.desc) {
        throw new BadRequestException({
          errorCode: 'CURSOR_ORDER_UNSUPPORTED',
          message: 'Cursor pagination only supports sortOrder=desc',
        });
      }

      const limit = q.limit ?? 20;

      // Cursor mode: require stable sort by createdAt (as per design)
      if (q.sortBy && q.sortBy !== SortBy.createdAt) {
        throw new BadRequestException({
          errorCode: 'CURSOR_SORT_UNSUPPORTED',
          message: 'Cursor pagination only supports sortBy=createdAt',
        });
      }

      const whereBase = this.buildWhere(userId, q);

      let where = whereBase;
      if (q.cursor) {
        let decoded;
        try {
          decoded = decodeCursor(q.cursor);
        } catch {
          throw new BadRequestException({
            errorCode: 'INVALID_CURSOR',
            message: 'Invalid cursor',
          });
        }

        const cursorCreatedAt = new Date(decoded.createdAt);
        if (Number.isNaN(cursorCreatedAt.getTime())) {
          throw new BadRequestException({
            errorCode: 'INVALID_CURSOR',
            message: 'Invalid cursor date',
          });
        }

        const cursorId = decoded.id;

        // desc by default (createdAt desc, id desc)
        // next page: items "smaller" than cursor
        where = {
          ...whereBase,
          OR: [
            { createdAt: { lt: cursorCreatedAt } },
            { createdAt: cursorCreatedAt, id: { lt: cursorId } },
          ],
        };
      }

      const rows = await withTimeout(
        this.prisma.order.findMany({
          where,
          orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
          take: limit + 1,
          select: {
            id: true,
            status: true,
            totalAmount: true,
            createdAt: true,
          },
        }),
        3000,
        'db_timeout_list_orders_cursor',
      );

      const hasMore = rows.length > limit;
      const data = hasMore ? rows.slice(0, limit) : rows;

      const last = data[data.length - 1];
      const nextCursor =
        hasMore && last
          ? encodeCursor({
              createdAt: last.createdAt.toISOString(),
              id: last.id,
            })
          : null;

      return {
        data,
        meta: { limit, nextCursor },
      };
    } catch (e) {
      if (
        e instanceof TimeoutError &&
        (e.label ?? '').startsWith('db_timeout_')
      ) {
        recordDbTimeout();
        this.logger.warn(
          `db_timeout event=list_orders mode=offset label=${e.label ?? 'none'}`,
        );
      }
      throw e;
    }
  }

  private async createOrderCore(
    userId: string,
    dto: CreateOrderDto,
    idempotencyKey: string,
  ) {
    const items = normalizeItems(dto.items);
    const productIds = items.map((i) => i.productId);
    try {
      await this.external.checkInventory(productIds);
      return await this.prisma.$transaction(async (tx) => {
        const products = await withTimeout(
          tx.product.findMany({
            where: { id: { in: productIds }, status: 'ACTIVE' },
            select: { id: true, price: true, sku: true, name: true },
          }),
          ResilienceConfig.db.timeoutMs,
          'db_timeout_products',
        );

        if (products.length !== productIds.length) {
          throw new BadRequestException({
            errorCode: 'INVALID_ITEMS',
            message: 'Invalid order items',
          });
        }

        const productMap = new Map(products.map((p) => [p.id, p]));

        let total = new Prisma.Decimal(0);

        const itemsData = items.map((i) => {
          const p = productMap.get(i.productId)!;

          const unitPrice = p.price; // snapshot
          const lineTotal = unitPrice.mul(i.quantity);
          total = total.add(lineTotal);

          return {
            productId: p.id,
            quantity: i.quantity,
            unitPrice,
          };
        });

        const order = await withTimeout(
          tx.order.create({
            data: {
              userId,
              clientRequestId: idempotencyKey,
              status: 'PENDING',
              totalAmount: total,
            },
            select: {
              id: true,
              status: true,
              totalAmount: true,
              createdAt: true,
            },
          }),
          ResilienceConfig.db.timeoutMs,
          'db_timeout_order_create',
        );

        await withTimeout(
          tx.orderItem.createMany({
            data: itemsData.map((d) => ({ ...d, orderId: order.id })),
          }),
          ResilienceConfig.db.timeoutMs,
          'db_timeout_order_items_createMany',
        );
        const detail = await withTimeout(
          tx.order.findUnique({
            where: { id: order.id },
            select: {
              id: true,
              status: true,
              totalAmount: true,
              createdAt: true,
              items: {
                select: {
                  productId: true,
                  quantity: true,
                  unitPrice: true,
                  product: { select: { sku: true, name: true } },
                },
              },
            },
          }),
          ResilienceConfig.db.timeoutMs,
          'db_timeout_order_detail',
        );
        if (!detail) {
          throw new Error('Order missing after create');
        }

        return { data: detail };
      });
    } catch (e) {
      // P2002 = unique constraint violation
      if (
        e instanceof Prisma.PrismaClientKnownRequestError &&
        e.code === 'P2002'
      ) {
        throw new ConflictException({
          errorCode: 'DUPLICATE_CREATE_ORDER',
          message: 'Duplicate create order (same Idempotency-Key)',
        });
      }
      throw e;
    }
  }

  private normalizeListQuery(q: ListOrdersQueryDto): string {
    const limit = q.limit ?? 20;
    const offset = q.offset ?? 0;

    let mode: 'cursor' | 'offset' | 'cursor_first' = 'cursor_first';
    if (q.cursor) mode = 'cursor';
    else if (offset > 0) mode = 'offset';

    const obj: Record<string, string> = { mode };

    // drop defaults
    if (limit !== 20) obj.limit = String(Math.min(limit, 100));
    if (mode === 'offset' && offset !== 0) obj.offset = String(offset);
    if (mode === 'cursor' && q.cursor) obj.cursor = q.cursor;

    if (q.status) obj.status = q.status;

    if (q.from) obj.from = q.from;
    if (q.to) obj.to = q.to;

    // cursor mode: sortBy createdAt + sortOrder desc only (service enforces)
    // still normalize for offset mode
    if (q.sortBy && q.sortBy !== SortBy.createdAt) obj.sortBy = q.sortBy;
    if (q.sortOrder && q.sortOrder !== SortOrder.desc)
      obj.sortOrder = q.sortOrder;

    return Object.keys(obj)
      .sort()
      .map((k) => `${k}=${obj[k]}`)
      .join('&');
  }

  private listKey(userId: string, paramsHash: string) {
    return `orders:v1:user:${userId}:list:${paramsHash}`;
  }

  private async invalidateOrderDetailCache(
    userId: string,
    orderId: string,
    requestId?: string,
    reason?: string,
  ) {
    const detailKey = this.detailKey(userId, orderId);
    const nfKey = this.notFoundKey(userId, orderId);

    await this.cache.del(detailKey);
    await this.cache.del(nfKey);

    this.logger.log(`
      cache_event event=cache_invalidated requestId=${requestId ?? 'none'} reason=${reason ?? 'unknown'} keyPrefix=orders:v1:user:id userId=${userId} orderId=${orderId}
    `);
  }

  private async fetchDetailAndPopulateCache(
    userId: string,
    orderId: string,
    key: string,
    nfKey: string,
    lock: string,
    requestId?: string,
  ) {
    try {
      const result = await this.getOrderDetailCore(userId, orderId);
      await this.cache.setJson(key, result, this.TTL_DETAIL_SEC);
      this.logger.log(`
        cache_event event=cache_set requestId=${requestId ?? 'none'} keyPrefix=orders:v1:user:id orderId=${orderId}
      `);
      return result;
    } catch (e) {
      this.logger.warn(
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
        `debug_catch requestId=${requestId ?? 'no'} errorType=${(e as any)?.constructor?.name ?? 'unknown'}`,
      );

      // nếu core throw NotFoundException => negative cache
      if (e instanceof NotFoundException) {
        await this.cache.setJson(
          nfKey,
          { kind: 'NOT_FOUND' },
          this.TTL_NEGATIVE_SEC,
        );
        this.logger.log(`
          cache_event event=cache_set_nf requestId=${requestId ?? 'none'} keyPrefix=orders:v1:user:id:nf orderId=${orderId}
        `);
      }
      throw e;
    } finally {
      await this.cache.releaseLock(lock);
    }
  }

  async listOrdersCore(userId: string, q: ListOrdersQueryDto) {
    if (q.cursor && (q.offset ?? 0) > 0) {
      throw new BadRequestException({
        errorCode: 'INVALID_PAGINATION',
        message: 'Do not use cursor and offset together',
      });
    }

    // Cursor-first: default to cursor mode unless client explicitly uses offset mode
    if (q.cursor) return this.listOrdersCursor(userId, q);

    const offset = q.offset ?? 0;
    if (offset > 0) return this.listOrdersOffset(userId, q);

    // offset not provided or 0 => cursor page 1
    return this.listOrdersCursor(userId, q);
  }

  async getOrderDetailCore(userId: string, orderId: string) {
    const order = await withTimeout(
      this.prisma.order.findFirst({
        where: { id: orderId, userId, deletedAt: null }, // ownership enforced at query
        select: {
          id: true,
          status: true,
          totalAmount: true,
          createdAt: true,
          items: {
            select: {
              productId: true,
              quantity: true,
              unitPrice: true,
              product: { select: { sku: true, name: true } },
            },
          },
        },
      }),
      ResilienceConfig.db.timeoutMs,
      'db_timeout_order_detail_get',
    );

    if (!order) {
      throw new NotFoundException({
        errorCode: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    return { data: order };
  }

  async createOrderIdempotent(
    userId: string,
    dto: CreateOrderDto,
    idempotencyKey?: string,
  ) {
    const key = this.assertIdempotencyKey(idempotencyKey);

    // validate UUID như bạn đã làm, giữ nguyên

    const requestHash = hashCreateOrderRequest(dto);

    const begin = await this.idem.begin(userId, key, requestHash);

    if (begin.kind === 'REPLAY') {
      return begin.response;
    }

    if (begin.kind === 'IN_PROGRESS') {
      throw new ConflictException({
        errorCode: 'IDEMPOTENCY_IN_PROGRESS',
        message: 'Request in progress, retry later',
      });
    }

    // NEW
    try {
      const result = await this.createOrderCore(userId, dto, key);
      try {
        const emailJobIdempotencyKey = `email:order_confirm:${result.data.id}`;
        const counts = await emailQueue.getJobCounts(
          'waiting',
          'active',
          'delayed',
          'failed',
        );
        const total =
          (counts.waiting ?? 0) + (counts.active ?? 0) + (counts.delayed ?? 0);

        this.logger.log(
          JSON.stringify({
            event: 'queue_depth',
            queue: 'email',
            ...counts,
            total,
            orderId: result.data.id,
          }),
        );
        const DISABLE_EMAIL_THRESHOLD = 10; // tùy bạn, intern-scope ok
        if (total > DISABLE_EMAIL_THRESHOLD) {
          this.logger.warn(
            JSON.stringify({
              event: 'email_disabled_due_backlog',
              queue: 'email',
              total,
              threshold: DISABLE_EMAIL_THRESHOLD,
              orderId: result.data.id,
            }),
          );
          // skip enqueue, vẫn tạo order bình thường
          await this.idem.complete(userId, key, result);
          return result;
        }

        const job = await emailQueue.add(
          'send_order_email',
          {
            orderId: result.data.id,
            userId,
            idempotencyKey: emailJobIdempotencyKey,
          },
          {
            attempts: 3,
            backoff: { type: 'exponential', delay: 1000 }, // base 1s
            removeOnComplete: true,
            removeOnFail: false,
          },
        );

        this.logger.log(
          JSON.stringify({
            event: 'job_enqueued',
            queue: 'email',
            jobId: job.id,
            orderId: result.data.id,
          }),
        );
      } catch (err) {
        this.logger.error(
          JSON.stringify({
            event: 'job_enqueue_failed',
            queue: 'email',
            orderId: result.data.id,
            error: (err as Error).message,
          }),
        );
      }
      // hoặc gọi “createOrderCore” không dính idempotency nếu bạn tách logic
      await this.idem.complete(userId, key, result);
      return result;
    } catch (e) {
      await this.idem.fail(userId, key);
      throw e;
    }
  }

  async updateOrderStatus(
    actor: { userId: string; role: 'USER' | 'ADMIN' },
    orderId: string,
    next: OrderStatus,
    requestId?: string,
  ) {
    const order = await withTimeout(
      this.prisma.order.findFirst({
        where: {
          id: orderId,
          deletedAt: null,
          ...(actor.role === 'ADMIN' ? {} : { userId: actor.userId }),
        },
        select: { id: true, userId: true, status: true },
      }),
      ResilienceConfig.db.timeoutMs,
      'db_timeout_order_find_for_update_status',
    );

    if (!order) {
      throw new NotFoundException({
        errorCode: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    const isOwner = order.userId === actor.userId;

    // 1) Ownership / authorization
    if (actor.role === 'USER' && !isOwner) {
      throw new ForbiddenException({
        errorCode: 'FORBIDDEN',
        message: 'Forbidden',
      });
    }

    // 2) Terminal + no-op
    if (TERMINAL_STATUSES.has(order.status)) {
      throw new ConflictException({
        errorCode: 'ORDER_TERMINAL',
        message: 'Order status is terminal',
      });
    }

    if (order.status === next) {
      throw new ConflictException({
        errorCode: 'NO_STATUS_CHANGE',
        message: 'No status change',
      });
    }

    // 3) Role-aware transition policy
    if (actor.role === 'USER') {
      // USER chỉ được CANCEL khi PENDING
      const allowed =
        order.status === OrderStatus.PENDING && next === OrderStatus.CANCELLED;

      if (!allowed) {
        throw new ForbiddenException({
          errorCode: 'FORBIDDEN',
          message: 'Forbidden',
        });
      }
    } else {
      // ADMIN phải tuân state machine
      if (!canTransition(order.status, next)) {
        throw new ConflictException({
          errorCode: 'INVALID_TRANSITION',
          message: 'Invalid status transition',
        });
      }
    }

    // 4) Optimistic concurrency: update có điều kiện theo status hiện tại
    const updated = await withTimeout(
      this.prisma.order.updateMany({
        where: { id: orderId, status: order.status, deletedAt: null },
        data: { status: next },
      }),
      ResilienceConfig.db.timeoutMs,
      'db_timeout_update_status_update',
    );

    if (updated.count !== 1) {
      throw new ConflictException({
        errorCode: 'STATUS_CHANGED',
        message: 'Order status changed, retry',
      });
    }
    await this.invalidateOrderDetailCache(
      order.userId,
      orderId,
      requestId,
      'order_status_updated',
    );
    return { data: { id: orderId, status: next } };
  }

  async softDeleteOrder(
    actor: { userId: string; role: 'USER' | 'ADMIN' },
    orderId: string,
    requestId?: string,
  ) {
    // ownership + not deleted ngay tại query
    const order = await withTimeout(
      this.prisma.order.findFirst({
        where: { id: orderId, userId: actor.userId, deletedAt: null },
        select: { id: true, status: true },
      }),
      ResilienceConfig.db.timeoutMs,
      'db_timeout_order_find_for_delete',
    );

    if (!order) {
      throw new NotFoundException({
        errorCode: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    // Policy scope Tuần 4: chỉ cho delete khi PENDING
    if (order.status !== OrderStatus.PENDING) {
      throw new ConflictException({
        errorCode: 'ORDER_DELETE_CONFLICT',
        message: 'Order cannot be deleted in current status',
      });
    }

    await withTimeout(
      this.prisma.order.update({
        where: { id: orderId },
        data: { deletedAt: new Date() },
        select: { id: true },
      }),
      ResilienceConfig.db.timeoutMs,
      'db_timeout_update_status_update',
    );
    await this.invalidateOrderDetailCache(
      actor.userId,
      orderId,
      requestId,
      'order_soft_deleted',
    );
    return { data: { id: orderId, deleted: true } };
  }

  async getOrderDetailCached(
    userId: string,
    orderId: string,
    requestId?: string,
  ) {
    const key = this.detailKey(userId, orderId);
    const nfKey = this.notFoundKey(userId, orderId);
    const lock = this.lockKey(key);

    const cached = await this.cache.getJson<{ data: any }>(key);
    if (cached) {
      this.logger.log(`
        cache_event event=cache_hit requestId=${requestId ?? 'none'} keyPrefix=orders:v1:user:id orderId=${orderId}
      `);
      return cached;
    }

    const nf = await this.cache.getJson<{ kind: 'NOT_FOUND' }>(nfKey);
    if (nf) {
      this.logger.log(`
        cache_event event=cache_hit_nf requestId=${requestId ?? 'none'} keyPrefix=orders:v1:user:id:nf orderId=${orderId}
      `);
      throw new NotFoundException({
        errorCode: 'ORDER_NOT_FOUND',
        message: 'Order not found',
      });
    }

    this.logger.log(`
      cache_event event=cache_miss requestId=${requestId ?? 'none'} keyPrefix=orders:v1:user:id orderId=${orderId}
    `);

    const locked = await this.cache.acquireLock(lock, this.LOCK_TTL_MS);

    if (!locked) {
      this.logger.log(`
        cache_event event=cache_lock_wait requestId=${requestId ?? 'none'} keyPrefix=orders:v1:user:id orderId=${orderId}
      `);
      await this.sleep(this.jitter(80, 160));

      const cached2 = await this.cache.getJson<{ data: any }>(key);
      if (cached2) return cached2;

      const nf2 = await this.cache.getJson<{ kind: 'NOT_FOUND' }>(nfKey);
      if (nf2) {
        throw new NotFoundException({
          errorCode: 'ORDER_NOT_FOUND',
          message: 'Order not found',
        });
      }

      // availability-first fallback
      return this.fetchDetailAndPopulateCache(
        userId,
        orderId,
        key,
        nfKey,
        lock,
        requestId,
      );
    }

    this.logger.log(`
      cache_event event=cache_lock_acquired requestId=${requestId ?? 'none'} keyPrefix=orders:v1:user:id orderId=${orderId}
    `);

    return this.fetchDetailAndPopulateCache(
      userId,
      orderId,
      key,
      nfKey,
      lock,
      requestId,
    );
  }

  async listOrdersCached(
    userId: string,
    q: ListOrdersQueryDto,
    requestId?: string,
  ) {
    const noCache =
      (q as any).noCache === true ||
      (q as any).noCache === '1' ||
      (q as any).noCache === 'true';

    if (noCache) {
      if (process.env.NODE_ENV === 'production') {
        this.logger.warn(`cache_bypass_blocked_in_prod`);
        throw new BadRequestException({
          errorCode: 'CACHE_BYPASS_DISABLED',
          message: 'cache bypass disabled in production',
        });
      }

      this.logger.warn(`
        cache_event event=cache_bypass requestId=${requestId ?? 'none'} keyPrefix=orders:v1:user:list userId=${userId}
      `);

      return this.listOrdersCore(userId, q);
    }
    if (this.TTL_LIST_SEC <= 0) {
      return this.listOrdersCore(userId, q);
    }
    const normalized = this.normalizeListQuery(q);
    const paramsHash = this.cache.sha256(normalized);

    const key = this.listKey(userId, paramsHash);
    const lock = this.lockKey(key);

    const cached = await this.cache.getJson<any>(key);
    if (cached) {
      this.logger.log(`
        cache_event event=cache_hit requestId=${requestId ?? 'none'} keyPrefix=orders:v1:user:list userId=${userId}
      `);
      return cached;
    }

    this.logger.log(`
      cache_event event=cache_miss requestId=${requestId ?? 'none'} keyPrefix=orders:v1:user:list userId=${userId}
    `);

    const locked = await this.cache.acquireLock(lock, this.LOCK_TTL_MS);

    if (!locked) {
      this.logger.log(`
        cache_event event=cache_lock_wait requestId=${requestId ?? 'none'} keyPrefix=orders:v1:user:list userId=${userId}
      `);
      await this.sleep(this.jitter(80, 160));

      const cached2 = await this.cache.getJson<any>(key);
      if (cached2) return cached2;

      // fallback DB (availability-first)
      const result = await this.listOrdersCore(userId, q);
      if (this.TTL_LIST_SEC > 0) {
        await this.cache.setJson(key, result, this.TTL_LIST_SEC);
      }
      return result;
    }

    try {
      this.logger.log(`
        cache_event event=cache_lock_acquired requestId=${requestId ?? 'none'} keyPrefix=orders:v1:user:list userId=${userId},
      `);
      const result = await this.listOrdersCore(userId, q);
      if (this.TTL_LIST_SEC > 0) {
        await this.cache.setJson(key, result, this.TTL_LIST_SEC);
      }
      this.logger.log(`
        cache_event event=cache_set requestId=${requestId ?? 'none'} keyPrefix=orders:v1:user:list userId=${userId}
      `);
      return result;
    } finally {
      await this.cache.releaseLock(lock);
    }
  }
}
