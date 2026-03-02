ALTER TABLE "order_items"
  ADD CONSTRAINT "chk_order_items_quantity" CHECK ("quantity" > 0),
  ADD CONSTRAINT "chk_order_items_unit_price" CHECK ("unit_price" >= 0);

ALTER TABLE "products"
  ADD CONSTRAINT "chk_products_price" CHECK ("price" >= 0);

ALTER TABLE "orders"
  ADD CONSTRAINT "chk_orders_total_amount" CHECK ("total_amount" >= 0);
