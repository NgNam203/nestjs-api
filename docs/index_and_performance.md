# Week 3 Day 4 - Index & Performance

## Data setup
- Orders: 10,000
- Order items: 50,000
- Users: 100
- Products: 200

## Queries measured

docker exec -it auth-postgres psql -U postgres -d auth_db

### Query A: list orders by user sorted by createdAt/id
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status, total_amount, created_at
FROM orders
WHERE user_id = '<USER_ID_TOP>'
ORDER BY created_at DESC, id DESC
LIMIT 20 OFFSET 2000;


### Query B: list orders by user + status + date range
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status, total_amount, created_at
FROM orders
WHERE user_id = '<USER_ID_TOP>'
  AND status = 'PAID'
  AND created_at >= now() - interval '180 days'
  AND created_at < now()
ORDER BY created_at DESC, id DESC
LIMIT 20;


## Before indexes
- Query A plan: 
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status, total_amount, created_at
FROM orders
WHERE user_id = '64f348b1-438c-4840-b156-531ba9cff4f9'
ORDER BY created_at DESC, id DESC
LIMIT 20 OFFSET 2000;
                                                                         QUERY PLAN
------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=228.25..230.53 rows=20 width=31) (actual time=6.114..6.119 rows=20 loops=1)
   Buffers: shared hit=2020
   ->  Incremental Sort  (cost=0.36..1139.80 rows=10000 width=31) (actual time=1.137..6.046 rows=2020 loops=1)
         Sort Key: created_at DESC, id DESC
         Presorted Key: created_at
         Full-sort Groups: 64  Sort Method: quicksort  Average Memory: 27kB  Peak Memory: 27kB
         Buffers: shared hit=2020
         ->  Index Scan using orders_user_id_created_at_idx on orders  (cost=0.29..689.80 rows=10000 width=31) (actual time=0.149..5.437 rows=2021 loops=1)
               Index Cond: (user_id = '64f348b1-438c-4840-b156-531ba9cff4f9'::uuid)
               Buffers: shared hit=2020
 Planning Time: 0.322 ms
 Execution Time: 6.177 ms
(12 rows)

Time: 16.408 ms



- Query B plan: 
EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status, total_amount, created_at
FROM orders
WHERE user_id = '64f348b1-438c-4840-b156-531ba9cff4f9'
  AND status = 'PAID'
  AND created_at >= now() - interval '180 days'
  AND created_at < now()
ORDER BY created_at DESC, id DESC
LIMIT 20;
                                                                       QUERY PLAN
--------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.68..9.18 rows=20 width=31) (actual time=1.201..1.204 rows=20 loops=1)
   Buffers: shared hit=24 read=2
   ->  Incremental Sort  (cost=0.68..512.26 rows=1204 width=31) (actual time=1.200..1.202 rows=20 loops=1)
         Sort Key: created_at DESC, id DESC
         Presorted Key: created_at
         Full-sort Groups: 1  Sort Method: quicksort  Average Memory: 26kB  Peak Memory: 26kB
         Buffers: shared hit=24 read=2
         ->  Index Scan using orders_status_created_at_idx on orders  (cost=0.29..458.08 rows=1204 width=31) (actual time=1.047..1.185 rows=21 loops=1)
               Index Cond: ((status = 'PAID'::"OrderStatus") AND (created_at >= (now() - '180 days'::interval)) AND (created_at < now()))
               Filter: (user_id = '64f348b1-438c-4840-b156-531ba9cff4f9'::uuid)
               Buffers: shared hit=24 read=2
 Planning:
   Buffers: shared hit=13
 Planning Time: 0.409 ms
 Execution Time: 1.221 ms
(15 rows)

Time: 6.109 ms


## Indexes added

CREATE INDEX IF NOT EXISTS idx_orders_user_created_id_desc
ON orders (user_id, created_at DESC, id DESC);


CREATE INDEX IF NOT EXISTS idx_orders_user_status_created_id_desc
ON orders (user_id, status, created_at DESC, id DESC);

CREATE INDEX IF NOT EXISTS idx_order_items_order_id
ON order_items (order_id);

Check : "\d orders".

## After indexes

### Query A:

                                                                       QUERY PLAN
--------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=143.79..145.22 rows=20 width=31) (actual time=4.245..4.253 rows=20 loops=1)
   Buffers: shared hit=2005 read=16
   ->  Index Scan using idx_orders_user_created_id_desc on orders  (cost=0.29..717.80 rows=10000 width=31) (actual time=0.095..4.184 rows=2020 loops=1)
         Index Cond: (user_id = '64f348b1-438c-4840-b156-531ba9cff4f9'::uuid)
         Buffers: shared hit=2005 read=16
 Planning:
   Buffers: shared hit=17 read=2
 Planning Time: 2.085 ms
 Execution Time: 4.350 ms
(9 rows)

Time: 9.130 ms

### Query B:
                                                                                           QUERY PLAN                                                                                        

-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.29..4.79 rows=20 width=31) (actual time=0.448..0.977 rows=20 loops=1)
   Buffers: shared hit=23
   ->  Index Scan using idx_orders_user_status_created_id_desc on orders  (cost=0.29..271.00 rows=1204 width=31) (actual time=0.419..0.944 rows=20 loops=1)
         Index Cond: ((user_id = '64f348b1-438c-4840-b156-531ba9cff4f9'::uuid) AND (status = 'PAID'::"OrderStatus") AND (created_at >= (now() - '180 days'::interval)) AND (created_at < now()))
         Buffers: shared hit=23
 Planning Time: 2.850 ms
 Execution Time: 1.311 ms
(7 rows)

Time: 10.830 ms


## Trade-offs

#### Read benefit:

- Query A removed sort step and reduced latency ~5x.

- Query B index matches access pattern (user + status + time), avoids filtering after scan and avoids sorting.

#### Write cost:

- INSERT/UPDATE on orders now updates more indexes (write amplification).

- Acceptable because list endpoints are hot paths; write cost is traded for predictable read latency.

## Notes

- OFFSET deep still requires scanning/skipping many rows, so buffer usage remains high.

- For deep pagination in production, prefer cursor pagination (Day 3).


---

## 3) Bonus (nhanh mà “đúng người làm thật”)
Bạn chạy thêm 1 query để tự thấy OFFSET deep đau thế nào dù đã index:

EXPLAIN (ANALYZE, BUFFERS)
SELECT id, status, total_amount, created_at
FROM orders
WHERE user_id = '64f348b1-438c-4840-b156-531ba9cff4f9'
ORDER BY created_at DESC, id DESC
LIMIT 20 OFFSET 0;

                                                                      QUERY PLAN
------------------------------------------------------------------------------------------------------------------------------------------------------
 Limit  (cost=0.29..1.72 rows=20 width=31) (actual time=1.450..2.627 rows=20 loops=1)
   Buffers: shared hit=22
   ->  Index Scan using idx_orders_user_created_id_desc on orders  (cost=0.29..717.80 rows=10000 width=31) (actual time=1.415..2.589 rows=20 loops=1)
         Index Cond: (user_id = '64f348b1-438c-4840-b156-531ba9cff4f9'::uuid)
         Buffers: shared hit=22
 Planning Time: 6.700 ms
 Execution Time: 3.013 ms
(7 rows)

Time: 19.725 ms


(So với OFFSET 2000, bạn sẽ thấy latency/buffers khác ngay.)