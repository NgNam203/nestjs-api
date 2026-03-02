export type OrderCursor = { createdAt: string; id: string };

export function encodeCursor(c: OrderCursor): string {
  return Buffer.from(JSON.stringify(c), 'utf8').toString('base64url');
}

export function decodeCursor(raw: string): OrderCursor {
  try {
    const json = Buffer.from(raw, 'base64url').toString('utf8');
    const obj = JSON.parse(json) as Partial<OrderCursor>;

    if (!obj?.createdAt || !obj?.id) {
      throw new Error('Invalid cursor shape');
    }

    const d = new Date(obj.createdAt);
    if (Number.isNaN(d.getTime())) {
      throw new Error('Invalid cursor date');
    }

    return { createdAt: obj.createdAt, id: obj.id };
  } catch {
    throw new Error('Invalid cursor');
  }
}
