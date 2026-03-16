# Auth Service

## Project Overview

Production-style backend service built with NestJS for authentication and order processing.

Key features:
- JWT authentication with refresh token rotation and Redis-backed session control
- Order processing with transactional persistence and idempotent create flow
- Redis caching for hot read paths
- Asynchronous background job processing using BullMQ workers
- Basic observability with structured logging, metrics, and health checks


## Live Demo

API Base URL  
https://nestjs-api-80n7.onrender.com/

Health Check  
GET https://nestjs-api-80n7.onrender.com/health

Swagger Docs
https://nestjs-api-80n7.onrender.com/docs

## Tech Stack

- **Framework:** NestJS
- **Language:** TypeScript
- **Database:** PostgreSQL
- **ORM:** Prisma
- **Cache / Session Store:** Redis
- **Queue:** BullMQ
- **Logging:** Pino
- **Containerization:** Docker
- **Deployment:** Render

## Architecture Overview

The system follows a simple service + worker architecture.

```text
Client
   │
   ▼
NestJS API
   │
   ├── PostgreSQL (primary data store)
   │
   ├── Redis
   │     ├── caching layer
   │     ├── refresh token session storage
   │     └── BullMQ queue backend
   │
   └── Worker Process
         └── background jobs (email notifications)
```

### Components

- **NestJS API**
  - Handles HTTP requests, authentication, validation, and business logic.

- **PostgreSQL**
  - Primary persistent database accessed via Prisma.

- **Redis**
  - Used for caching hot read paths and storing refresh-token sessions.

- **BullMQ Worker**
  - Processes background jobs asynchronously (e.g. order email notifications).

## Key Flows
### Authentication Flow

1. Client sends login request with credentials
2. API validates user credentials against PostgreSQL
3. API issues:
   - short-lived **access token**
   - long-lived **refresh token**
4. Refresh token is stored in Redis to allow session revocation
5. Client uses the access token to authenticate API requests
6. When the access token expires, client requests a new one using the refresh token

### Order Creation Flow

1. Client sends `POST /orders`
2. API validates request payload and Idempotency-Key
3. Idempotency layer checks whether the request was already processed
4. API creates the order and related order items in PostgreSQL within a transaction
5. API enqueues a background job to send order notifications
6. Worker processes the job asynchronously

### Background Job Flow

1. API enqueues a job into Redis using BullMQ
2. Worker process listens to the queue
3. Worker consumes the job
4. Worker performs the background task (e.g. sending email notification)
5. Job result is logged and the job is removed after completion

### Cache Strategy

1. API checks Redis for cached order data
2. If cache hit → return cached response
3. If cache miss → query PostgreSQL
4. Result is written back to Redis with a TTL
5. Cache is invalidated when order state changes

## Engineering Decisions
**Idempotent Order Creation**

Orders are created using an Idempotency-Key provided by the client.

Why:
- Prevent duplicate order creation during client retries or network failures
- Ensure correctness when the same request is submitted multiple times

Trade-offs:
- Requires additional storage and logic to track idempotency keys
- Slightly increases complexity in the request processing path

**Redis-backed Refresh Token Sessions**

Refresh tokens are stored in Redis rather than being purely stateless.

Why:
- Enables server-side session revocation
- Supports logout and multi-device session control

Trade-offs:
- Introduces a Redis dependency for token refresh flow
- Requires additional operational infrastructure

**Asynchronous Background Jobs with BullMQ**

Background tasks such as order notifications are processed using BullMQ workers.

Why:
- Prevents long-running operations from blocking API responses
- Improves API latency and user experience

Trade-offs:
- Requires an additional worker process
- Introduces operational complexity for queue management

## Failure Handling

**Redis Unavailable**

If Redis becomes unavailable:
- caching is effectively disabled
- the system falls back to PostgreSQL queries

This keeps the API functional at the cost of higher latency.

**Database Slow or Timeout**

Database operations are wrapped with timeout protection.

If a database call exceeds the configured timeout:
- the request fails fast
- timeout metrics are recorded

This prevents resource exhaustion under degraded database conditions.

**Queue Backlog Protection**

Before enqueueing background jobs, the system checks queue depth.

If the queue backlog exceeds a threshold:
- new background jobs are skipped
- the main API request still succeeds

This prevents worker overload from cascading into API latency.

## Current Limitations

- Observability is still basic and does not include distributed tracing.
- Load testing has only been performed at a limited scale.
- The OrdersService module is relatively large and could be further decomposed.
- Queue monitoring and alerting are not yet implemented.

## Quick Start

Clone the repository:

```bash
git clone https://github.com/NgNam203/nestjs-api.git
cd nestjs-api
```

Start dependencies:

```bash
docker compose up -d
```

Install dependencies:

```bash
npm install
```

Run development server:

```bash
npm run start:dev
```