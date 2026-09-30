import {
  Check,
  Column,
  Entity,
  JoinColumn,
  ManyToOne,
  PrimaryGeneratedColumn,
  type Relation,
} from 'typeorm';
import { decimalTransformer } from '../../database/transformers/decimal.transformer.js';
import { Product } from '../../products/entities/product.entity.js';
import { Order } from './order.entity.js';

/**
 * Line item of an order. Product name and unit price are snapshotted at
 * purchase time so order history stays correct if the product is later
 * edited or deleted (product_id is then set to NULL).
 */
@Entity({ name: 'order_items' })
@Check('CHK_order_items_quantity', '`quantity` > 0')
export class OrderItem {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Column({ name: 'order_id', unsigned: true })
  orderId: number;

  @ManyToOne(() => Order, (order) => order.items, { onDelete: 'CASCADE' })
  @JoinColumn({
    name: 'order_id',
    foreignKeyConstraintName: 'FK_order_items_order',
  })
  order?: Relation<Order>;

  @Column({ name: 'product_id', type: 'int', unsigned: true, nullable: true })
  productId: number | null;

  @ManyToOne(() => Product, { onDelete: 'SET NULL', nullable: true })
  @JoinColumn({
    name: 'product_id',
    foreignKeyConstraintName: 'FK_order_items_product',
  })
  product?: Relation<Product> | null;

  @Column({ name: 'product_name', length: 255 })
  productName: string;

  @Column({
    name: 'unit_price',
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: decimalTransformer,
  })
  unitPrice: number;

  @Column({ type: 'int', unsigned: true })
  quantity: number;

  @Column({
    type: 'decimal',
    precision: 12,
    scale: 2,
    transformer: decimalTransformer,
  })
  subtotal: number;
}
