-- LOCAL INTEGRATION DATABASE ONLY. Review with Reyna before adopting in shared schema.
-- The user already created this table in coffee_overflow_integration; this is
-- a reproducible record of that specific migration. Do not rerun unnecessarily.
CREATE TABLE coffee_overflow_integration.checkout_requests (
  client_token CHAR(36) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  user_id INT NOT NULL,
  request_hash CHAR(64) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  order_id INT NULL,
  receipt_json JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (client_token),
  INDEX idx_checkout_request_order (order_id),
  CONSTRAINT fk_checkout_request_order FOREIGN KEY (order_id)
    REFERENCES coffee_overflow_integration.orders(order_id) ON DELETE CASCADE
) ENGINE=InnoDB;
