import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, Repository, type EntityManager } from 'typeorm';
import type { PaginationQueryDto } from '../common/dto/pagination-query.dto.js';
import {
  paginate,
  type Paginated,
} from '../common/dto/paginated-response.dto.js';
import { Product } from '../products/entities/product.entity.js';
import type { CreateOrderDto } from './dto/create-order.dto.js';
import { OrderItem } from './entities/order-item.entity.js';
import { Order } from './entities/order.entity.js';
import { OrderStatus } from './enums/order-status.enum.js';

/** Money is computed in integer cents to avoid floating point drift. */
const toCents = (amount: number): number => Math.round(amount * 100);
const fromCents = (cents: number): number => cents / 100;

@Injectable()
export class OrdersService {
  constructor(
    private readonly dataSource: DataSource,
    @InjectRepository(Order)
    private readonly ordersRepository: Repository<Order>,
  ) {}

  /**
   * Places an order atomically.
   *
   * Concurrency: the product rows are read with `SELECT ... FOR UPDATE`
   * (pessimistic write lock) inside the transaction. If two customers try to
   * buy the last unit at the same time, the second transaction blocks on the
   * row lock until the first one commits, then re-reads the *committed* stock
   * (0) and fails with 409 Insufficient stock. Rows are locked in ascending id
   * order so that two orders containing the same products can't deadlock.
   *
   * As defence in depth, the stock decrement itself is conditional
   * (`WHERE stock >= :qty`) and the column has a `CHECK (stock >= 0)`
   * constraint, so stock can never go negative even if the code changes.
   */
  async create(userId: number, dto: CreateOrderDto): Promise<Order> {
    // Merge duplicate lines for the same product: [{1,2},{1,3}] -> {1: 5}.
    const quantities = new Map<number, number>();
    for (const { productId, quantity } of dto.items) {
      quantities.set(productId, (quantities.get(productId) ?? 0) + quantity);
    }
    const productIds = [...quantities.keys()].sort((a, b) => a - b);

    return this.dataSource.transaction(async (manager) => {
      // 1. Verify all products exist - and lock them for the rest of the transaction.
      const products = await manager.find(Product, {
        where: { id: In(productIds) },
        order: { id: 'ASC' },
        lock: { mode: 'pessimistic_write' },
      });
      const productsById = new Map(products.map((p) => [p.id, p]));

      const missing = productIds.filter((id) => !productsById.has(id));
      if (missing.length > 0) {
        throw new NotFoundException(
          `Product(s) not found: ${missing.join(', ')}`,
        );
      }

      // 2. Verify sufficient stock is available.
      const insufficient = productIds
        .map((id) => ({
          productId: id,
          requested: quantities.get(id)!,
          available: productsById.get(id)!.stock,
        }))
        .filter(({ requested, available }) => requested > available);
      if (insufficient.length > 0) {
        throw new ConflictException({
          statusCode: 409,
          error: 'Conflict',
          message: `Insufficient stock for product(s): ${insufficient
            .map((i) => i.productId)
            .join(', ')}`,
          details: insufficient,
        });
      }

      // 3. Calculate the order total (prices are taken from the DB, never the client).
      let totalCents = 0;
      const items = productIds.map((id) => {
        const product = productsById.get(id)!;
        const quantity = quantities.get(id)!;
        const unitCents = toCents(product.price);
        const subtotalCents = unitCents * quantity;
        totalCents += subtotalCents;

        return manager.create(OrderItem, {
          productId: id,
          productName: product.name,
          unitPrice: fromCents(unitCents),
          quantity,
          subtotal: fromCents(subtotalCents),
        });
      });

      // 4 + 5. Create the order and its items (items are cascade-inserted).
      const order = await manager.save(
        manager.create(Order, {
          userId,
          status: OrderStatus.PENDING,
          totalAmount: fromCents(totalCents),
          items,
        }),
      );

      // 6. Reduce product stock.
      for (const id of productIds) {
        await this.decrementStock(manager, id, quantities.get(id)!);
      }

      // 7. Return the created order.
      return manager.findOneOrFail(Order, {
        where: { id: order.id },
        relations: { items: true },
        order: { items: { id: 'ASC' } },
      });
    });
  }

  async findAllForUser(
    userId: number,
    query: PaginationQueryDto,
  ): Promise<Paginated<Order>> {
    const { page, limit } = query;
    const [data, total] = await this.ordersRepository.findAndCount({
      where: { userId },
      relations: { items: true },
      order: { createdAt: 'DESC', id: 'DESC', items: { id: 'ASC' } },
      skip: query.skip,
      take: limit,
    });
    return paginate(data, total, page, limit);
  }

  async findOneForUser(userId: number, id: number): Promise<Order> {
    // Filtering by userId means another user's order is indistinguishable
    // from a non-existent one (404), so order ids can't be probed.
    const order = await this.ordersRepository.findOne({
      where: { id, userId },
      relations: { items: true },
      order: { items: { id: 'ASC' } },
    });
    if (!order) {
      throw new NotFoundException(`Order with id ${id} not found`);
    }
    return order;
  }

  private async decrementStock(
    manager: EntityManager,
    productId: number,
    quantity: number,
  ): Promise<void> {
    const result = await manager
      .createQueryBuilder()
      .update(Product)
      .set({ stock: () => 'stock - :quantity' })
      .where('id = :productId AND stock >= :quantity', { productId, quantity })
      .execute();

    if (result.affected !== 1) {
      // Unreachable while the row lock above is held; kept as a safety net.
      throw new ConflictException(
        `Insufficient stock for product(s): ${productId}`,
      );
    }
  }
}
