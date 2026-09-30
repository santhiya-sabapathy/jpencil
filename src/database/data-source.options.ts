import mysql from 'mysql2';
import type { PoolOptions } from 'mysql2';
import type { DataSourceOptions } from 'typeorm';
import { User } from '../users/entities/user.entity.js';
import { Product } from '../products/entities/product.entity.js';
import { Order } from '../orders/entities/order.entity.js';
import { OrderItem } from '../orders/entities/order-item.entity.js';
import { InitialSchema1759140000000 } from './migrations/1759140000000-InitialSchema.js';

/**
 * mysql2 driver whose pooled connections all run in UTC.
 *
 * `timezone: 'Z'` only tells mysql2 how to convert JS Dates; column defaults
 * such as CURRENT_TIMESTAMP are evaluated in the *session* time zone, which
 * defaults to the DB server's local zone. Pinning every session to UTC keeps
 * DB-generated and app-generated timestamps consistent on any server.
 */
const utcMysqlDriver = {
  ...mysql,
  createPool(options: PoolOptions) {
    const pool = mysql.createPool(options);
    pool.on('connection', (connection) => {
      connection.query("SET time_zone = '+00:00'");
    });
    return pool;
  },
};

/**
 * Single source of truth for the TypeORM connection. Used both by the Nest
 * application (TypeOrmModule) and by the TypeORM CLI (data-source.ts) so the
 * app and migrations always agree on entities and connection settings.
 */
export function buildDataSourceOptions(
  env: NodeJS.ProcessEnv = process.env,
): DataSourceOptions {
  return {
    type: 'mysql',
    driver: utcMysqlDriver,
    host: env.DB_HOST ?? 'localhost',
    port: Number(env.DB_PORT ?? 3306),
    username: env.DB_USERNAME ?? 'root',
    password: env.DB_PASSWORD ?? '',
    database: env.DB_DATABASE ?? 'ecommerce',
    charset: 'utf8mb4_unicode_ci',
    timezone: 'Z',
    entities: [User, Product, Order, OrderItem],
    migrations: [InitialSchema1759140000000],
    // Schema is owned by migrations, never auto-synchronised.
    synchronize: false,
    migrationsRun: env.DB_MIGRATIONS_RUN === 'true',
    logging: env.DB_LOGGING === 'true',
  };
}
