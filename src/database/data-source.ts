import 'reflect-metadata';
import { loadEnvFile } from 'node:process';
import { DataSource } from 'typeorm';
import { buildDataSourceOptions } from './data-source.options.js';
import { ensureDatabaseExists } from './ensure-database.js';

// DataSource used by the TypeORM CLI (migration:run / migration:revert).
try {
  loadEnvFile();
} catch {
  // No .env file - rely on real environment variables.
}

await ensureDatabaseExists(process.env);

export default new DataSource(buildDataSourceOptions());
