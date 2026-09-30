import type { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import request from 'supertest';
import type { App } from 'supertest/types.js';
import { DataSource } from 'typeorm';

// Point the app at the dedicated test database *before* AppModule is loaded.
// ConfigModule never overrides variables that are already set.
process.env.DB_DATABASE = process.env.DB_TEST_DATABASE ?? 'ecommerce_test';
process.env.DB_MIGRATIONS_RUN = 'true';
process.env.JWT_SECRET ??= 'e2e-test-secret';
process.env.BCRYPT_SALT_ROUNDS = '4';

const { AppModule } = await import('../src/app.module.js');
const { configureApp } = await import('../src/app.setup.js');
const { OrdersService } = await import('../src/orders/orders.service.js');

describe('E-commerce API (e2e)', () => {
  let app: INestApplication<App>;
  let dataSource: DataSource;

  const http = () => request(app.getHttpServer());

  async function registerAndLogin(email: string): Promise<string> {
    await http()
      .post('/auth/register')
      .send({ name: 'Test', email, password: 'password123' })
      .expect(201);
    const res = await http()
      .post('/auth/login')
      .send({ email, password: 'password123' })
      .expect(200);
    return res.body.accessToken as string;
  }

  async function createProduct(
    token: string,
    body: { name: string; price: number; stock: number },
  ): Promise<{ id: number; stock: number }> {
    const res = await http()
      .post('/products')
      .set('Authorization', `Bearer ${token}`)
      .send(body)
      .expect(201);
    return res.body;
  }

  async function stockOf(id: number): Promise<number> {
    const res = await http().get(`/products/${id}`).expect(200);
    return res.body.stock as number;
  }

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      imports: [AppModule],
    }).compile();

    app = moduleRef.createNestApplication();
    configureApp(app);
    // Listen once on a random port so concurrent supertest requests share it.
    await app.listen(0);

    dataSource = app.get(DataSource);
    await dataSource.query('SET FOREIGN_KEY_CHECKS = 0');
    for (const table of ['order_items', 'orders', 'products', 'users']) {
      await dataSource.query(`TRUNCATE TABLE \`${table}\``);
    }
    await dataSource.query('SET FOREIGN_KEY_CHECKS = 1');
  });

  afterAll(async () => {
    await app?.close();
  });

  describe('Auth', () => {
    it('registers a user without returning the password', async () => {
      const res = await http()
        .post('/auth/register')
        .send({
          name: 'John',
          email: 'John@Example.com',
          password: 'password123',
        })
        .expect(201);

      expect(res.body).toMatchObject({
        name: 'John',
        email: 'john@example.com',
      });
      expect(res.body).not.toHaveProperty('password');

      const [row] = await dataSource.query(
        'SELECT password FROM users WHERE email = ?',
        ['john@example.com'],
      );
      expect(row.password).toMatch(/^\$2[aby]\$/); // bcrypt hash, not plain text
    });

    it('rejects a duplicate email with 409', async () => {
      await http()
        .post('/auth/register')
        .send({
          name: 'John',
          email: 'john@example.com',
          password: 'password123',
        })
        .expect(409);
    });

    it('rejects invalid registration data with 400', async () => {
      const res = await http()
        .post('/auth/register')
        .send({ name: '', email: 'not-an-email', password: 'short' })
        .expect(400);
      expect(res.body.message).toEqual(
        expect.arrayContaining([
          'name should not be empty',
          'email must be an email',
          'password must be longer than or equal to 8 characters',
        ]),
      );
    });

    it('returns a JWT for valid credentials', async () => {
      const res = await http()
        .post('/auth/login')
        .send({ email: 'john@example.com', password: 'password123' })
        .expect(200);
      expect(res.body.accessToken).toEqual(expect.any(String));
      expect(res.body.tokenType).toBe('Bearer');
    });

    it('rejects invalid credentials with 401', async () => {
      await http()
        .post('/auth/login')
        .send({ email: 'john@example.com', password: 'wrong-password' })
        .expect(401);
      await http()
        .post('/auth/login')
        .send({ email: 'nobody@example.com', password: 'password123' })
        .expect(401);
    });
  });

  describe('Products', () => {
    let token: string;

    beforeAll(async () => {
      token = await registerAndLogin('products-admin@example.com');
    });

    it('requires authentication to create products', async () => {
      await http()
        .post('/products')
        .send({ name: 'X', price: 1, stock: 1 })
        .expect(401);
      await http()
        .post('/products')
        .set('Authorization', 'Bearer invalid.token.here')
        .send({ name: 'X', price: 1, stock: 1 })
        .expect(401);
    });

    it('supports create, read, update and delete', async () => {
      const created = await createProduct(token, {
        name: 'Temp Product',
        price: 10.5,
        stock: 3,
      });
      expect(created).toMatchObject({
        name: 'Temp Product',
        price: 10.5,
        stock: 3,
      });

      await http()
        .patch(`/products/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .send({ price: 12.25 })
        .expect(200)
        .expect(({ body }) => expect(body.price).toBe(12.25));

      await http()
        .delete(`/products/${created.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);
      await http().get(`/products/${created.id}`).expect(404);
    });

    it('validates product payloads', async () => {
      await http()
        .post('/products')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Bad', price: -1, stock: 1.5 })
        .expect(400);
      await http()
        .post('/products')
        .set('Authorization', `Bearer ${token}`)
        .send({ name: 'Bad', price: 1, stock: 1, unknownField: true })
        .expect(400);
    });

    it('paginates and searches the listing', async () => {
      for (const name of [
        'Gold Ring',
        'Silver Ring',
        'Necklace',
        'Diamond Ring',
      ]) {
        await createProduct(token, { name, price: 100, stock: 10 });
      }

      const page1 = await http()
        .get('/products?page=1&limit=2&search=ring')
        .expect(200);
      expect(page1.body.data).toHaveLength(2);
      expect(page1.body.meta).toMatchObject({
        page: 1,
        limit: 2,
        total: 3,
        totalPages: 2,
        hasNextPage: true,
      });
      for (const p of page1.body.data) {
        expect(p.name.toLowerCase()).toContain('ring');
      }

      const page2 = await http()
        .get('/products?page=2&limit=2&search=ring')
        .expect(200);
      expect(page2.body.data).toHaveLength(1);

      await http().get('/products?page=0&limit=500').expect(400);
    });

    it('returns 404 for unknown products and 400 for bad ids', async () => {
      await http().get('/products/999999').expect(404);
      await http().get('/products/abc').expect(400);
    });
  });

  describe('Orders', () => {
    let token: string;
    let otherToken: string;
    let ring: { id: number };
    let chain: { id: number };

    beforeAll(async () => {
      token = await registerAndLogin('buyer@example.com');
      otherToken = await registerAndLogin('other-buyer@example.com');
      ring = await createProduct(token, {
        name: 'Order Ring',
        price: 19.99,
        stock: 10,
      });
      chain = await createProduct(token, {
        name: 'Order Chain',
        price: 5.1,
        stock: 5,
      });
    });

    it('requires authentication', async () => {
      await http().get('/orders').expect(401);
      await http()
        .post('/orders')
        .send({ items: [{ productId: ring.id, quantity: 1 }] })
        .expect(401);
    });

    it('creates an order, computes the total and reduces stock', async () => {
      const res = await http()
        .post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [
            { productId: ring.id, quantity: 2 },
            { productId: chain.id, quantity: 1 },
          ],
        })
        .expect(201);

      expect(res.body).toMatchObject({
        status: 'PENDING',
        totalAmount: 45.08, // 2 * 19.99 + 5.10
      });
      expect(res.body.items).toHaveLength(2);
      expect(res.body.items[0]).toMatchObject({
        productId: ring.id,
        productName: 'Order Ring',
        unitPrice: 19.99,
        quantity: 2,
        subtotal: 39.98,
      });

      expect(await stockOf(ring.id)).toBe(8);
      expect(await stockOf(chain.id)).toBe(4);
    });

    it('rejects invalid quantities with 400', async () => {
      for (const quantity of [0, -1, 1.5, 'two']) {
        await http()
          .post('/orders')
          .set('Authorization', `Bearer ${token}`)
          .send({ items: [{ productId: ring.id, quantity }] })
          .expect(400);
      }
      await http()
        .post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({ items: [] })
        .expect(400);
    });

    it('returns 404 when a product does not exist, without changing stock', async () => {
      const res = await http()
        .post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [
            { productId: ring.id, quantity: 1 },
            { productId: 999999, quantity: 1 },
          ],
        })
        .expect(404);
      expect(res.body.message).toContain('999999');
      expect(await stockOf(ring.id)).toBe(8);
    });

    it('returns 409 on insufficient stock, without changing stock', async () => {
      const res = await http()
        .post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [
            { productId: ring.id, quantity: 1 },
            { productId: chain.id, quantity: 100 },
          ],
        })
        .expect(409);
      expect(res.body.details).toEqual([
        { productId: chain.id, requested: 100, available: 4 },
      ]);
      expect(await stockOf(ring.id)).toBe(8);
    });

    it('rolls back everything if a step fails mid-transaction', async () => {
      const [{ count: ordersBefore }] = await dataSource.query(
        'SELECT COUNT(*) AS count FROM orders',
      );

      // Let the first stock decrement succeed, then blow up on the second one:
      // by then the order, its items and one stock update have been written.
      const service = app.get(OrdersService);
      const original = (service as any).decrementStock.bind(service);
      let calls = 0;
      const spy = vi
        .spyOn(service as any, 'decrementStock')
        .mockImplementation(async (...args: unknown[]) => {
          if (++calls === 2) throw new Error('Simulated failure');
          return original(...args);
        });

      await http()
        .post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({
          items: [
            { productId: ring.id, quantity: 1 },
            { productId: chain.id, quantity: 1 },
          ],
        })
        .expect(500);
      spy.mockRestore();

      const [{ count: ordersAfter }] = await dataSource.query(
        'SELECT COUNT(*) AS count FROM orders',
      );
      expect(Number(ordersAfter)).toBe(Number(ordersBefore));
      expect(await stockOf(ring.id)).toBe(8);
      expect(await stockOf(chain.id)).toBe(4);
    });

    it('lets two users race for the last unit - exactly one wins', async () => {
      const lastOne = await createProduct(token, {
        name: 'Limited Edition',
        price: 999,
        stock: 1,
      });
      const order = (t: string) =>
        http()
          .post('/orders')
          .set('Authorization', `Bearer ${t}`)
          .send({ items: [{ productId: lastOne.id, quantity: 1 }] });

      const results = await Promise.all([order(token), order(otherToken)]);

      expect(results.map((r) => r.status).sort()).toEqual([201, 409]);
      expect(await stockOf(lastOne.id)).toBe(0);
    });

    it('never oversells under heavy concurrency', async () => {
      const product = await createProduct(token, {
        name: 'Flash Sale',
        price: 1,
        stock: 5,
      });
      const results = await Promise.all(
        Array.from({ length: 20 }, (_, i) =>
          http()
            .post('/orders')
            .set('Authorization', `Bearer ${i % 2 ? token : otherToken}`)
            .send({ items: [{ productId: product.id, quantity: 1 }] }),
        ),
      );

      const statuses = results.map((r) => r.status);
      expect(statuses.filter((s) => s === 201)).toHaveLength(5);
      expect(statuses.filter((s) => s === 409)).toHaveLength(15);
      expect(await stockOf(product.id)).toBe(0);
    });

    it("lists only the authenticated user's orders, paginated", async () => {
      const res = await http()
        .get('/orders?page=1&limit=10')
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(200);

      expect(res.body.meta).toMatchObject({ page: 1, limit: 10 });
      expect(res.body.data.length).toBe(res.body.meta.total);
      const [otherUser] = await dataSource.query(
        'SELECT id FROM users WHERE email = ?',
        ['other-buyer@example.com'],
      );
      for (const o of res.body.data) {
        expect(o.userId).toBe(otherUser.id);
        expect(o).toHaveProperty('id');
        expect(o).toHaveProperty('totalAmount');
        expect(o).toHaveProperty('status');
        expect(o).toHaveProperty('createdAt');
        expect(o.items.length).toBeGreaterThan(0);
      }

      const page = await http()
        .get('/orders?page=1&limit=1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(page.body.data).toHaveLength(1);
      expect(page.body.meta.total).toBeGreaterThan(1);
    });

    it("hides other users' orders from GET /orders/:id", async () => {
      const mine = await http()
        .get('/orders?limit=1')
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      const orderId = mine.body.data[0].id;

      await http()
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      await http()
        .get(`/orders/${orderId}`)
        .set('Authorization', `Bearer ${otherToken}`)
        .expect(404);
    });

    it('keeps order history when a product is deleted', async () => {
      const temp = await createProduct(token, {
        name: 'Discontinued',
        price: 3,
        stock: 2,
      });
      const created = await http()
        .post('/orders')
        .set('Authorization', `Bearer ${token}`)
        .send({ items: [{ productId: temp.id, quantity: 1 }] })
        .expect(201);

      await http()
        .delete(`/products/${temp.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(204);

      const res = await http()
        .get(`/orders/${created.body.id}`)
        .set('Authorization', `Bearer ${token}`)
        .expect(200);
      expect(res.body.items[0]).toMatchObject({
        productId: null,
        productName: 'Discontinued',
        unitPrice: 3,
      });
    });
  });
});
