import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AuthModule } from './auth/auth.module.js';
import { buildDataSourceOptions } from './database/data-source.options.js';
import { ensureDatabaseExists } from './database/ensure-database.js';
import { OrdersModule } from './orders/orders.module.js';
import { ProductsModule } from './products/products.module.js';
import { UsersModule } from './users/users.module.js';

@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),
    TypeOrmModule.forRootAsync({
      // ConfigModule has loaded .env into process.env by the time this runs.
      useFactory: async () => {
        await ensureDatabaseExists(process.env);
        return buildDataSourceOptions(process.env);
      },
    }),
    UsersModule,
    AuthModule,
    ProductsModule,
    OrdersModule,
  ],
})
export class AppModule {}
