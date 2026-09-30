-- ---------------------------------------------------------------------------
-- E-commerce Order Management API - database schema (MySQL 8 / MariaDB 10.4+)
--
-- Reference copy of src/database/migrations/1759140000000-InitialSchema.ts.
-- The migration is the source of truth and is applied automatically on start
-- (DB_MIGRATIONS_RUN=true) or with `npm run migration:run`.
-- ---------------------------------------------------------------------------

CREATE DATABASE IF NOT EXISTS `ecommerce`
  CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
USE `ecommerce`;

CREATE TABLE `users` (
  `id`         int UNSIGNED NOT NULL AUTO_INCREMENT,
  `name`       varchar(100) NOT NULL,
  `email`      varchar(255) NOT NULL,
  `password`   varchar(255) NOT NULL COMMENT 'bcrypt hash',
  `created_at` datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6)  NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  UNIQUE INDEX `UQ_users_email` (`email`),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `products` (
  `id`         int UNSIGNED  NOT NULL AUTO_INCREMENT,
  `name`       varchar(255)  NOT NULL,
  `price`      decimal(10,2) NOT NULL,
  `stock`      int UNSIGNED  NOT NULL DEFAULT 0,
  `created_at` datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at` datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX `IDX_products_name` (`name`),
  CONSTRAINT `CHK_products_stock` CHECK (`stock` >= 0),
  CONSTRAINT `CHK_products_price` CHECK (`price` >= 0),
  PRIMARY KEY (`id`)
) ENGINE=InnoDB;

CREATE TABLE `orders` (
  `id`           int UNSIGNED  NOT NULL AUTO_INCREMENT,
  `user_id`      int UNSIGNED  NOT NULL,
  `status`       enum('PENDING','CONFIRMED','SHIPPED','DELIVERED','CANCELLED') NOT NULL DEFAULT 'PENDING',
  `total_amount` decimal(12,2) NOT NULL,
  `created_at`   datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6),
  `updated_at`   datetime(6)   NOT NULL DEFAULT CURRENT_TIMESTAMP(6) ON UPDATE CURRENT_TIMESTAMP(6),
  INDEX `IDX_orders_user_created` (`user_id`, `created_at`),
  PRIMARY KEY (`id`),
  CONSTRAINT `FK_orders_user` FOREIGN KEY (`user_id`)
    REFERENCES `users` (`id`) ON DELETE RESTRICT ON UPDATE NO ACTION
) ENGINE=InnoDB;

-- product_name / unit_price are snapshotted at purchase time so order history
-- survives product edits and deletions (product_id becomes NULL on delete).
CREATE TABLE `order_items` (
  `id`           int UNSIGNED  NOT NULL AUTO_INCREMENT,
  `order_id`     int UNSIGNED  NOT NULL,
  `product_id`   int UNSIGNED  NULL,
  `product_name` varchar(255)  NOT NULL,
  `unit_price`   decimal(10,2) NOT NULL,
  `quantity`     int UNSIGNED  NOT NULL,
  `subtotal`     decimal(12,2) NOT NULL,
  CONSTRAINT `CHK_order_items_quantity` CHECK (`quantity` > 0),
  PRIMARY KEY (`id`),
  CONSTRAINT `FK_order_items_order` FOREIGN KEY (`order_id`)
    REFERENCES `orders` (`id`) ON DELETE CASCADE ON UPDATE NO ACTION,
  CONSTRAINT `FK_order_items_product` FOREIGN KEY (`product_id`)
    REFERENCES `products` (`id`) ON DELETE SET NULL ON UPDATE NO ACTION
) ENGINE=InnoDB;
