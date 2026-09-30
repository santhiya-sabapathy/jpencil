-- Executed once by the MySQL container on first start: creates the database
-- used by the e2e test suite next to the main `ecommerce` database.
CREATE DATABASE IF NOT EXISTS `ecommerce_test`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
