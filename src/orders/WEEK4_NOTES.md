# WEEK4_NOTES.md – Order System (Week 4)

## 1) Order Flow Tổng Thể

### Create Order Flow

**Mục tiêu:** tạo order đúng business, không duplicate, không tin client.

Flow:
1. Nhận intent tạo order:
   - Input: items[{ productId, quantity }]
   - Header bắt buộc: Idempotency-Key (UUID)
2. Idempotency guard:
   - begin(userId, key, requestHash)
   - REPLAY → trả responseSnapshot
   - IN_PROGRESS → 409
3. Chốt dữ liệu giao dịch:
   - Load product từ DB
   - Snapshot `unitPrice` tại thời điểm tạo
   - Tính `totalAmount` tại backend
4. Transaction:
   - create Order
   - createMany OrderItem
   - reload detail (join có kiểm soát)
5. Commit:
   - complete(idempotencyKey, responseSnapshot)

**Lý do thiết kế:**
- Client không được tin vì có thể sửa price, retry, hoặc gửi duplicate.
- Transaction chỉ bảo vệ atomicity, idempotency bảo vệ *intent*.
- Snapshot price đảm bảo order là “hợp đồng giao dịch”, không phụ thuộc product sau này.

---

### Update Order Status Flow

**Mục tiêu:** status là business state, không phải field CRUD.

Flow:
1. Load order:
   - where: id + deletedAt = null
2. Authorization:
   - USER: chỉ thao tác order của mình
   - ADMIN: theo policy riêng
3. State machine validation:
   - transition map là source of truth
4. Role-aware rule:
   - USER: chỉ `PENDING → CANCELLED`
   - ADMIN: theo state machine
5. Concurrency guard:
   - `updateMany where id + status=currentStatus + deletedAt=null`
   - affectedRows = 0 → 409 Conflict

**Lý do thiết kế:**
- Validate trước để trả error đúng ngữ nghĩa business.
- Guard ở DB write để chống race condition.
- Không dùng lock dài để tránh tăng latency và deadlock.

---

### Read Flow

#### List Orders
- Select nhẹ: `id, status, totalAmount, createdAt`
- Pagination: cursor-first, fallback offset
- Sort ổn định: `createdAt DESC, id DESC`
- Filter bắt buộc: `deletedAt = null`

#### Order Detail
- Join `order_items → product`
- Select tối thiểu field client cần
- Ownership + `deletedAt = null` enforced ngay trong query

**Lý do thiết kế:**
- List là hot path → không join để tránh N+1 và row explosion.
- Detail ít gọi hơn → join có kiểm soát.
- Ownership ở query để tránh leak existence và race.

---

### Soft Delete Flow

- DELETE không xóa physical row
- Set `deletedAt = now()`
- Read path: luôn filter `deletedAt = null`
- Write path:
  - reject update status nếu deleted
  - reject delete lại lần nữa

**Lý do thiết kế:**
- Order là record có hậu quả (payment, shipment, audit).
- Hard delete làm mất khả năng debug và compliance.

---

## 2) Business Rules & Invariants

### Business Rules (Application-level)
- Client không được set:
  - price
  - totalAmount
  - status
  - userId
- Status phải đi theo state machine
- User chỉ thao tác order của mình
- Order deleted coi như terminal

### Business Invariants (Database-level)
- `order_items.quantity > 0`
- `order.totalAmount >= 0`
- Enum status hợp lệ
- FK integrity giữa order ↔ order_items

**Phân biệt:**
- Validation: bảo vệ request
- Invariant: bảo vệ toàn hệ thống, kể cả khi app bug

---

## 3) Concurrency & Defensive Coding

### Các race đã xử lý
- Double submit / retry create order → Idempotency
- Concurrent status update → Conditional update
- Cancel vs ship cùng lúc → một bên 409

### Vì sao transaction không đủ?
- Transaction chỉ bảo vệ 1 request.
- 2 request song song vẫn có thể đọc cùng state cũ và phá nhau.

### Chiến lược chọn
- Fail fast với 409 thay vì lock dài
- Client refresh state và retry có kiểm soát

---

## 4) Trade-offs & Self-critique

### Những gì chấp nhận đánh đổi
- Idempotency:
  - Thêm table + cleanup TTL
  - Đổi lại: không duplicate order
- Conditional update:
  - Trả 409 nhiều hơn
  - Đổi lại: không lost update
- Soft delete:
  - Query phức tạp hơn
  - Đổi lại: audit/debug/compliance

### Nếu làm lại
- Vẫn giữ:
  - Idempotency
  - State machine + DB guard
- Có thể cải thiện:
  - Audit log riêng cho status change
  - Read model tách riêng nếu traffic tăng mạnh

---

## 5) Khi Scale x10, Hệ Thống Gãy Ở Đâu

### Database
- order_items insert là write hotspot

### Index
- (userId, createdAt) và (userId, deletedAt) phình nhanh

### Concurrency
- Status update conflict tăng → nhiều 409

### Read Path
- GET /orders page 1 là endpoint bị gọi nhiều nhất

**Bài học:**
- Local test không lộ race và contention.
- Production sẽ ép lộ mọi quyết định thiết kế mơ hồ.

---

## 6) Kết Luận Tuần 4

- Tuần 4 không phải về code nhiều hơn
- Là về:
  - kiểm soát business logic
  - hiểu ranh giới DB vs application
  - chấp nhận fail đúng thay vì cố “chiều” request

Hoàn thành tuần 4 nghĩa là:
- Không còn viết backend kiểu CRUD ngây thơ
- Bắt đầu nghĩ như người phải trực production
