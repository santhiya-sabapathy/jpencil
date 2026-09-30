import {
  Check,
  Column,
  CreateDateColumn,
  Entity,
  Index,
  PrimaryGeneratedColumn,
  UpdateDateColumn,
} from 'typeorm';
import { decimalTransformer } from '../../database/transformers/decimal.transformer.js';

@Entity({ name: 'products' })
@Check('CHK_products_stock', '`stock` >= 0')
@Check('CHK_products_price', '`price` >= 0')
export class Product {
  @PrimaryGeneratedColumn({ unsigned: true })
  id: number;

  @Index('IDX_products_name')
  @Column({ length: 255 })
  name: string;

  @Column({
    type: 'decimal',
    precision: 10,
    scale: 2,
    transformer: decimalTransformer,
  })
  price: number;

  // UNSIGNED + CHECK constraint make negative stock impossible at the database
  // level, independent of application logic (and of the server's sql_mode).
  @Column({ type: 'int', unsigned: true, default: 0 })
  stock: number;

  @CreateDateColumn({ name: 'created_at' })
  createdAt: Date;

  @UpdateDateColumn({ name: 'updated_at' })
  updatedAt: Date;
}
