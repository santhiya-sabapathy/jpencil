# E-commerce Order Management API

A NestJS REST API for user authentication, product management and
transactional, concurrency-safe order processing.

| | |
|---|---|
| Framework | NestJS 12 (TypeScript, ESM) |
| Database | MySQL 8 / MariaDB 10.4+ (tested on MariaDB 10.4) |
| ORM | TypeORM (migrations, no `synchronize`) |
| Auth | JWT (passport-jwt), bcrypt password hashing |
| Docs | Swagger / OpenAPI at `/docs` |
| Tests | Vitest unit tests + e2e tests against a real MySQL database |

---

## 1. Setup

### Prerequisites
- Node.js 22+ (tested on 24)
- MySQL 8 or MariaDB 10.4+ (local install, XAMPP, or Docker)

### Steps

```bash
# 1. Install dependencies
npm install

# 2. Start MySQL (skip if you already run MySQL locally)
docker compose up -d        # creates `ecommerce` and `ecommerce_test` databases

# 3. Configure environment
cp .env.example .env         # then adjust DB_* and JWT_SECRET
#   docker compose users: set DB_PASSWORD=root

# 4. Run
npm run start:dev
```

- API: http://localhost:3000
- Swagger UI: http://localhost:3000/docs (the OpenAPI JSON is at `/docs-json`)

With a local MySQL instead of Docker, create the databases first:

```sql
CREATE DATABASE ecommerce      CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
CREATE DATABASE ecommerce_test CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci; -- for e2e tests
```

### Database schema and migrations

The schema is managed by the migration in
[`src/database/migrations`](src/database/migrations). A plain SQL copy is in
[`database/schema.sql`](database/schema.sql).

- With `DB_MIGRATIONS_RUN=true` (the default), pending migrations run automatically on startup.
- To manage them yourself:

```bash
npm run migration:run      # apply
npm run migration:revert   # roll back the last migration
npm run migration:show     # list applied / pending
```

### Environment variables

| Variable | Default | Description |
|---|---|---|
| `PORT` | `3000` | HTTP port |
| `DB_HOST` / `DB_PORT` | `localhost` / `3306` | MySQL connection |
| `DB_USERNAME` / `DB_PASSWORD` | `root` / *(empty)* | MySQL credentials |
| `DB_DATABASE` | `ecommerce` | Database name |
| `DB_MIGRATIONS_RUN` | `true` | Apply pending migrations on start |
| `DB_LOGGING` | `false` | Log SQL, useful for watching the `FOR UPDATE` locks |
| `JWT_SECRET` | – | **Required.** Secret used to sign access tokens |
| `JWT_EXPIRES_IN` | `1h` | Token lifetime |
| `BCRYPT_SALT_ROUNDS` | `10` | bcrypt cost factor |

### Tests

```bash
npm test            # unit tests
npm run test:e2e    # end-to-end tests (uses the `ecommerce_test` database; wipes it first)
```

The e2e suite drives the real HTTP API against a real MySQL database. It
covers:
- validation, auth, and every required error case
- pagination and search
- a **forced mid-transaction failure** to prove rollback
- **concurrent orders racing for the last unit in stock** (2 buyers for 1 unit, and 20 buyers for 5 units)

---

## 2. API overview

Full request and response schemas are in Swagger (`/docs`). Protected
endpoints need an `Authorization: Bearer <accessToken>` header.

| Method | Path | Auth | Description |
|---|---|---|---|
| POST | `/auth/register` | – | Register a user (the password is never returned) |
| POST | `/auth/login` | – | Log in and get a JWT access token |
| POST | `/products` | JWT | Create a product |
| GET | `/products?page=1&limit=10&search=ring` | – | List products with pagination and name search |
| GET | `/products/:id` | – | Get a product |
| PATCH | `/products/:id` | JWT | Partially update a product |
| DELETE | `/products/:id` | JWT | Delete a product (204) |
| POST | `/orders` | JWT | Place an order (transactional) |
| GET | `/orders?page=1&limit=10` | JWT | List **your own** orders with their items |
| GET | `/orders/:id` | JWT | Get one of your orders (404 if it belongs to someone else) |

### Example flow

```bash
curl -X POST localhost:3000/auth/register -H 'Content-Type: application/json' \
  -d '{"name":"John","email":"john@example.com","password":"password123"}'

TOKEN=$(curl -s -X POST localhost:3000/auth/login -H 'Content-Type: application/json' \
  -d '{"email":"john@example.com","password":"password123"}' | jq -r .accessToken)

curl -X POST localhost:3000/products -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"name":"Gold Ring","price":199.99,"stock":3}'

curl -X POST localhost:3000/orders -H "Authorization: Bearer $TOKEN" \
  -H 'Content-Type: application/json' -d '{"items":[{"productId":1,"quantity":2}]}'
```

`POST /orders` response:

```json
{
  "id": 1,
  "userId": 1,
  "status": "PENDING",
  "totalAmount": 399.98,
  "items": [
    { "id": 1, "orderId": 1, "productId": 1, "productName": "Gold Ring",
      "unitPrice": 199.99, "quantity": 2, "subtotal": 399.98 }
  ],
  "createdAt": "2026-09-29T15:21:53.099Z",
  "updatedAt": "2026-09-29T15:21:53.099Z" 
}
```

Paginated endpoints return:

```json
{
  "data": [ ... ],
  "meta": { "page": 1, "limit": 10, "total": 42, "totalPages": 5,
            "hasNextPage": true, "hasPreviousPage": false }
}
```

### Error handling

A global `ValidationPipe` (`whitelist`, `forbidNonWhitelisted`, `transform`)
validates every DTO. Errors use Nest's standard shape:
`{ statusCode, message, error }`.

| Scenario | Status |
|---|---|
| Invalid request data, unknown fields, bad pagination, non-numeric id | 400 |
| Invalid quantity (0, negative, fractional, > 1000) | 400 |
| Missing, invalid or expired token | 401 |
| Invalid credentials (same message for an unknown email and a wrong password) | 401 |
| Product not found (order response lists the missing ids) | 404 |
| Duplicate email (including a concurrent race, via the unique index) | 409 |
| Insufficient stock (response includes `details: [{ productId, requested, available }]`) | 409 |

Database errors are mapped by [`QueryFailedFilter`](src/common/filters/query-failed.filter.ts):
- duplicate key → 409
- deadlock or lock timeout → 503, "retry"
- anything else → a generic 500 without SQL details

---

## 3. Order creation: transaction and concurrency

Code: [`OrdersService.create`](src/orders/orders.service.ts).

Everything runs inside **one database transaction**
(`dataSource.transaction(...)`):

1. Merge duplicate lines (`[{1,2},{1,3}]` → product 1 × 5).
2. `SELECT … FROM products WHERE id IN (…) ORDER BY id FOR UPDATE`. This checks that every product exists and **locks** those rows.
3. Check stock for every line; all shortfalls are reported together.
4. Compute the total **from database prices, in integer cents**. The client never sends prices.
5. Insert the order and its items. Each item snapshots the product name and unit price.
6. Decrement stock with `UPDATE … SET stock = stock - :qty WHERE id = :id AND stock >= :qty`.
7. Re-read and return the order with its items.

If any step throws, the whole transaction rolls back: no order, no items, no
stock change. The e2e test *"rolls back everything if a step fails
mid-transaction"* proves this. It forces a failure after the order, its items
and one stock update have already been written.

### Two users buying the last item at the same time

The protection is layered:

1. **Pessimistic row lock (the main mechanism).** `SELECT … FOR UPDATE` puts an exclusive lock on the product rows.
   - Transaction B blocks on that lock until transaction A commits or rolls back.
   - InnoDB's locking read then returns the **latest committed** row to B (`stock = 0`).
   - B's stock check fails and B gets **409 Insufficient stock**.
2. **Deadlock avoidance.** Rows are always locked in ascending `id` order, so two orders for the same products in a different order can't deadlock.
3. **Conditional decrement.** `WHERE stock >= :qty` plus a check on the affected row count. Even if the lock were removed, an update that would oversell affects 0 rows and the transaction fails.
4. **Database constraints.**
   - `stock` is `INT UNSIGNED` with `CHECK (stock >= 0)`, so stock can never be negative, even if data is written outside this API.
   - The CHECK matters on servers that aren't in strict SQL mode, where UNSIGNED alone would silently clamp to 0.

The e2e tests *"lets two users race for the last unit – exactly one wins"* and
*"never oversells under heavy concurrency"* (20 parallel orders for 5 units →
exactly 5 × 201 and 15 × 409, final stock 0) check this against a real MySQL
database.

**Why pessimistic rather than optimistic locking?** Popular products create
real contention on the same rows. With optimistic locking (a `version`
column), losers need retry loops. A short `FOR UPDATE` lock serialises only
the buyers of the *same* products and gives a clear answer on the first try.
Orders for different products never block each other.

---

## 4. Project structure

```
src/
├── main.ts                       # bootstrap
├── app.module.ts                 # root module (config, TypeORM, feature modules)
├── app.setup.ts                  # global ValidationPipe, filters, Swagger (shared with e2e)
├── auth/
│   ├── auth.controller.ts        # POST /auth/register, /auth/login
│   ├── auth.service.ts           # hashing, credential check, JWT signing
│   ├── dto/                      # RegisterDto, LoginDto, response DTOs
│   ├── guards/jwt-auth.guard.ts
│   ├── strategies/jwt.strategy.ts
│   └── interfaces/
├── users/                        # User entity + UsersService (data access)
├── products/                     # controller, service, DTOs, Product entity
├── orders/                       # controller, service (transaction), DTOs, entities, status enum
├── common/
│   ├── decorators/current-user.decorator.ts
│   ├── dto/                      # pagination query + paginated response
│   └── filters/query-failed.filter.ts
└── database/
    ├── data-source.options.ts    # single TypeORM config (app + CLI)
    ├── data-source.ts            # TypeORM CLI entry
    ├── migrations/
    └── transformers/             # DECIMAL → number
database/schema.sql               # plain SQL copy of the schema
test/app.e2e-spec.ts              # end-to-end tests
```

### Schema

```
users        (id, name, email UNIQUE, password [bcrypt], created_at, updated_at)
products     (id, name [indexed], price DECIMAL(10,2), stock INT UNSIGNED CHECK >= 0, created_at, updated_at)
orders       (id, user_id → users RESTRICT, status ENUM, total_amount DECIMAL(12,2), created_at, updated_at)
             INDEX (user_id, created_at)   -- serves "my orders, newest first"
order_items  (id, order_id → orders CASCADE, product_id → products SET NULL,
              product_name, unit_price, quantity CHECK > 0, subtotal)
```

### Design notes and assumptions

- **Product write endpoints** need a valid JWT; reads are public. The brief defines no roles. In production, product management would sit behind an `admin` role checked by a `RolesGuard`.
- **Order status** starts as `PENDING`. Payment and status transitions are out of scope.
- **Money** is stored as `DECIMAL` and computed in integer cents, so there is no floating-point drift. It is returned as JSON numbers.
- **Order history survives product changes.** Items keep the product name and price at purchase time. Deleting a product sets `order_items.product_id` to `NULL` instead of failing or deleting history.
- **Timestamps are UTC.** Every DB session is pinned to `+00:00`, so `CURRENT_TIMESTAMP` defaults are correct whatever time zone the server uses.
- **Emails are normalised** (trimmed and lower-cased), so `John@Example.com` and `john@example.com` are the same account.
- **Search** is a case-insensitive `LIKE` on the product name, with `%` and `_` escaped. For large catalogues a FULLTEXT index would be the next step.
