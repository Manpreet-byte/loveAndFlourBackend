-- Encrypted storage for payment provider credentials (Razorpay test/live).

CREATE TABLE IF NOT EXISTS payment_provider_configs (
  provider VARCHAR(32) NOT NULL,
  mode ENUM('test','live') NOT NULL DEFAULT 'test',
  test_key_id VARCHAR(64) NULL,
  test_key_secret_enc TEXT NULL,
  live_key_id VARCHAR(64) NULL,
  live_key_secret_enc TEXT NULL,
  test_webhook_secret_enc TEXT NULL,
  live_webhook_secret_enc TEXT NULL,
  updated_by_admin_id INT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (provider),
  KEY idx_payment_provider_configs_updated_at (updated_at),
  CONSTRAINT fk_payment_provider_configs_updated_by
    FOREIGN KEY (updated_by_admin_id) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

