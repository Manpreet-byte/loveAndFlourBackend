-- Payments + order management migration (2026-05-12)
-- Safe, additive changes only.

-- 0) Enrollments idempotency for webhook fulfillment (per-order)
ALTER TABLE enrollments
  ADD UNIQUE KEY uk_enrollments_payment_reference_course (payment_reference, course_id);

-- 1) Orders
CREATE TABLE orders (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  status ENUM('created','payment_pending','paid','fulfilled','failed','cancelled','refunded') NOT NULL DEFAULT 'created',
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  subtotal_cents INT UNSIGNED NOT NULL DEFAULT 0,
  discount_cents INT UNSIGNED NOT NULL DEFAULT 0,
  tax_cents INT UNSIGNED NOT NULL DEFAULT 0,
  total_cents INT UNSIGNED NOT NULL DEFAULT 0,
  coupon_id BIGINT UNSIGNED NULL,
  coupon_code VARCHAR(60) NULL,

  billing_name VARCHAR(160) NULL,
  billing_email VARCHAR(254) NULL,
  billing_phone VARCHAR(40) NULL,
  billing_gst_number VARCHAR(32) NULL,
  billing_address_json LONGTEXT NULL,

  invoice_number VARCHAR(40) NULL,
  invoice_issued_at DATETIME NULL,
  invoice_json LONGTEXT NULL,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_orders_user_id (user_id),
  KEY idx_orders_status_created (status, created_at),
  KEY idx_orders_invoice_number (invoice_number),
  CONSTRAINT fk_orders_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 2) Order items (multi-course checkout)
CREATE TABLE order_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  item_type ENUM('course') NOT NULL DEFAULT 'course',
  course_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  unit_price_cents INT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  line_subtotal_cents INT UNSIGNED NOT NULL,
  line_discount_cents INT UNSIGNED NOT NULL DEFAULT 0,
  line_tax_cents INT UNSIGNED NOT NULL DEFAULT 0,
  line_total_cents INT UNSIGNED NOT NULL,
  metadata_json LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_order_items_order_id (order_id),
  KEY idx_order_items_course_id (course_id),
  CONSTRAINT fk_order_items_order_id
    FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_order_items_course_id
    FOREIGN KEY (course_id) REFERENCES courses(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) Payments (audit-safe)
CREATE TABLE payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  provider ENUM('razorpay','stripe') NOT NULL,
  status ENUM('initiated','pending','authorized','captured','failed','refunded') NOT NULL DEFAULT 'initiated',
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  amount_cents INT UNSIGNED NOT NULL,

  provider_order_id VARCHAR(80) NULL,
  provider_payment_id VARCHAR(80) NULL,
  provider_signature VARCHAR(256) NULL,

  failure_code VARCHAR(80) NULL,
  failure_message VARCHAR(255) NULL,

  captured_at DATETIME NULL,
  refunded_at DATETIME NULL,

  raw_payload_json LONGTEXT NULL,

  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_payments_provider_payment (provider, provider_payment_id),
  UNIQUE KEY uk_payments_provider_order (provider, provider_order_id),
  KEY idx_payments_order_id (order_id),
  KEY idx_payments_user_id (user_id),
  KEY idx_payments_status_created (status, created_at),
  CONSTRAINT fk_payments_order_id
    FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_payments_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4) Webhook event log (idempotency + audit)
CREATE TABLE webhook_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider ENUM('razorpay','stripe') NOT NULL,
  event_id VARCHAR(120) NULL,
  event_hash BINARY(32) NOT NULL,
  event_type VARCHAR(120) NULL,
  received_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  status ENUM('received','processed','skipped','failed') NOT NULL DEFAULT 'received',
  error_message VARCHAR(255) NULL,
  payload_json LONGTEXT NOT NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_webhook_events_provider_hash (provider, event_hash),
  UNIQUE KEY uk_webhook_events_provider_event_id (provider, event_id),
  KEY idx_webhook_events_status_received (status, received_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 5) Coupons
CREATE TABLE coupons (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  code VARCHAR(60) NOT NULL,
  description VARCHAR(255) NULL,
  discount_type ENUM('percent','amount') NOT NULL,
  discount_value_cents INT UNSIGNED NOT NULL DEFAULT 0,
  discount_percent INT UNSIGNED NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  max_redemptions INT UNSIGNED NULL,
  max_redemptions_per_user INT UNSIGNED NULL,
  min_order_total_cents INT UNSIGNED NULL,
  starts_at DATETIME NULL,
  ends_at DATETIME NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_coupons_code (code),
  KEY idx_coupons_active (is_active),
  KEY idx_coupons_ends_at (ends_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 6) Coupon usages (only recorded after verified payment)
CREATE TABLE coupon_usages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  coupon_id BIGINT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  used_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_coupon_usages_coupon_user_order (coupon_id, user_id, order_id),
  KEY idx_coupon_usages_coupon_id (coupon_id),
  KEY idx_coupon_usages_user_id (user_id),
  CONSTRAINT fk_coupon_usages_coupon_id
    FOREIGN KEY (coupon_id) REFERENCES coupons(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_coupon_usages_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE CASCADE,
  CONSTRAINT fk_coupon_usages_order_id
    FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

