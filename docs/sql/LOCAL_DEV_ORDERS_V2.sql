-- V2 after Reyna schema merge: ISOLATED TEST TABLES ONLY.
-- Run ONLY in MySQL Workbench with a schema administrator account.
-- This intentionally creates separate local_dev_* tables, not your team's shared order tables.
-- It must never be applied to another school project database or production.
USE coffee_overflow_dev;

CREATE TABLE IF NOT EXISTS local_dev_orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  client_token CHAR(36) NOT NULL UNIQUE,
  customer_name VARCHAR(120) NOT NULL,
  customer_email VARCHAR(254) NOT NULL,
  status ENUM('placed','processing','fulfilled','cancelled') NOT NULL DEFAULT 'placed',
  subtotal_cents INT UNSIGNED NOT NULL,
  discount_cents INT UNSIGNED NOT NULL DEFAULT 0,
  tax_cents INT UNSIGNED NOT NULL,
  total_cents INT UNSIGNED NOT NULL,
  coupon_code VARCHAR(32) DEFAULT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_local_dev_orders_status_created (status,created_at)
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS local_dev_order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  product_id BIGINT UNSIGNED NOT NULL,
  product_name VARCHAR(120) NOT NULL,
  quantity INT UNSIGNED NOT NULL,
  unit_price_cents INT UNSIGNED NOT NULL,
  line_total_cents INT UNSIGNED NOT NULL,
  UNIQUE KEY uq_local_dev_order_line (order_id,product_id),
  CONSTRAINT fk_local_dev_items_order FOREIGN KEY (order_id) REFERENCES local_dev_orders(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

CREATE TABLE IF NOT EXISTS local_dev_order_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT PRIMARY KEY,
  order_id BIGINT UNSIGNED NOT NULL,
  from_status VARCHAR(20) DEFAULT NULL,
  to_status VARCHAR(20) NOT NULL,
  actor_name VARCHAR(80) NOT NULL,
  note VARCHAR(250) NOT NULL DEFAULT '',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_local_dev_order_events_order (order_id,id),
  CONSTRAINT fk_local_dev_events_order FOREIGN KEY (order_id) REFERENCES local_dev_orders(id) ON DELETE RESTRICT
) ENGINE=InnoDB;

-- Verify exactly three tables exist after running:
SHOW TABLES LIKE 'local_dev_%';
