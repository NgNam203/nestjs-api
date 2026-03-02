# Week 3 Day 1 - Schema decisions (Orders domain)

## Domain & entities
- Users: reused from Week 2 (auth) and acts as the owner of orders.
- Products: source of truth for current product info (sku, name, current price, status).
- Orders: order header (owner, status, total, timestamps).
- OrderItems: line items (quantity, unit_price snapshot). This table is expected to have the highest volume.

## Ownership (data-level authorization)
- orders.user_id is mandatory so every order query can enforce ownership using `WHERE user_id = :currentUserId`.
- This prevents data leaks and keeps authorization logic simple and consistent.

## Money type
- Use Decimal (Postgres DECIMAL/NUMERIC via Prisma Decimal) for money fields to avoid floating point precision errors.

## Price snapshot
- order_items.unit_price stores the product price at purchase time.
- Reason: product price can change later; historical orders must remain correct for audit/refund/reconciliation.

## Constraints (DB as last line of defense)
- Added CHECK constraints via migration:
  - products.price >= 0
  - orders.total_amount >= 0
  - order_items.quantity > 0
  - order_items.unit_price >= 0
- Reason: application validation can be bypassed or bugged; DB constraints prevent permanent bad data.

## onDelete policies
- orders.user_id -> users.id: RESTRICT
  - Reason: keep historical/accounting data; avoid deleting a user and losing order history.
- order_items.order_id -> orders.id: CASCADE
  - Reason: if an order is deleted, its items should not remain as orphans.
- order_items.product_id -> products.id: RESTRICT
  - Reason: keep purchase history even if a product is discontinued.

## Indexes (based on query patterns)
- orders(user_id, created_at DESC): list orders for a user by newest first.
- orders(status, created_at DESC): common admin/status filtering by newest first.
- order_items(order_id): order detail join.
- order_items(product_id): reporting/analytics by product (optional but commonly needed).
