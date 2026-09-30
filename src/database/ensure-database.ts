import mysql from 'mysql2/promise';

/**
 * Ensures the target database exists before TypeORM attempts to connect to it.
 * This prevents `ER_BAD_DB_ERROR` (errno 1049: Unknown database) when running
 * against a fresh local MySQL or MariaDB instance (e.g. XAMPP).
 */
export async function ensureDatabaseExists(
  env: NodeJS.ProcessEnv = process.env,
): Promise<void> {
  const host = env.DB_HOST ?? 'localhost';
  const port = Number(env.DB_PORT ?? 3306);
  const user = env.DB_USERNAME ?? 'root';
  const password = env.DB_PASSWORD ?? '';
  const database = env.DB_DATABASE ?? 'ecommerce';

  if (!database || !/^[a-zA-Z0-9_]+$/.test(database)) {
    return;
  }

  try {
    const connection = await mysql.createConnection({
      host,
      port,
      user,
      password,
    });
    try {
      await connection.query(
        `CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`,
      );
    } finally {
      await connection.end();
    }
  } catch {
    // If database creation cannot be performed (e.g. user lacks CREATE privilege
    // or connection fails), let TypeORM handle and report the connection attempt normally.
  }
}
