-- Security hardening migration (2026-05-12)
-- Safe, additive changes only.

-- 1) Users: add security fields (additive)
ALTER TABLE users
  ADD COLUMN email_verified_at DATETIME NULL AFTER role,
  ADD COLUMN token_version INT UNSIGNED NOT NULL DEFAULT 0 AFTER email_verified_at,
  ADD COLUMN password_changed_at DATETIME NULL AFTER token_version,
  ADD COLUMN last_login_at DATETIME NULL AFTER password_changed_at,
  ADD COLUMN failed_login_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER last_login_at,
  ADD COLUMN locked_until DATETIME NULL AFTER failed_login_count;

-- 2) Refresh tokens (opaque, rotated; store only HMAC-SHA256 hash)
CREATE TABLE refresh_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  token_hash BINARY(32) NOT NULL,
  token_family BINARY(16) NOT NULL,
  parent_id BIGINT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  revoked_at DATETIME NULL,
  replaced_by_id BIGINT UNSIGNED NULL,
  created_ip VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_refresh_tokens_hash (token_hash),
  KEY idx_refresh_tokens_user_id (user_id),
  KEY idx_refresh_tokens_family (token_family),
  KEY idx_refresh_tokens_expires_at (expires_at),
  CONSTRAINT fk_refresh_tokens_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_refresh_tokens_parent_id
    FOREIGN KEY (parent_id) REFERENCES refresh_tokens(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  CONSTRAINT fk_refresh_tokens_replaced_by_id
    FOREIGN KEY (replaced_by_id) REFERENCES refresh_tokens(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 3) Email verification tokens (one-time; store only HMAC-SHA256 hash)
CREATE TABLE email_verification_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  token_hash BINARY(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_email_verification_tokens_hash (token_hash),
  KEY idx_email_verification_tokens_user_id (user_id),
  KEY idx_email_verification_tokens_expires_at (expires_at),
  CONSTRAINT fk_email_verification_tokens_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- 4) Password reset tokens (one-time; store only HMAC-SHA256 hash)
CREATE TABLE password_reset_tokens (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  token_hash BINARY(32) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at DATETIME NOT NULL,
  consumed_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_password_reset_tokens_hash (token_hash),
  KEY idx_password_reset_tokens_user_id (user_id),
  KEY idx_password_reset_tokens_expires_at (expires_at),
  CONSTRAINT fk_password_reset_tokens_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

