export type ItemInput = { productId: string; quantity: number };

export function normalizeItems(items: ItemInput[]): ItemInput[] {
  const map = new Map<string, number>();

  for (const it of items) {
    map.set(it.productId, (map.get(it.productId) ?? 0) + it.quantity);
  }

  return Array.from(map.entries())
    .map(([productId, quantity]) => ({ productId, quantity }))
    .sort((a, b) => a.productId.localeCompare(b.productId));
}
