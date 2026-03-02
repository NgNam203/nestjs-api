import * as crypto from 'crypto';
import type { CreateOrderDto } from '../dto/create-order.dto';
import { normalizeItems } from '../helpers/normalize-items';

export function hashCreateOrderRequest(dto: CreateOrderDto): string {
  const normalizedItems = normalizeItems(
    dto.items.map((i) => ({ productId: i.productId, quantity: i.quantity })),
  );

  const json = JSON.stringify({ items: normalizedItems });
  return crypto.createHash('sha256').update(json).digest('hex');
}
