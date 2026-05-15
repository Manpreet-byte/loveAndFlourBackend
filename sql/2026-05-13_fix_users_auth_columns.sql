-- Fix for: ER_BAD_FIELD_ERROR Unknown column 'email_verified_at' in 'field list'
-- This migration brings the `users` table in line with `backend/sql/schema.sql`
-- for the auth system (refresh tokens, email verification, lockouts).
--
-- Safe approach: run these statements one-by-one.
-- If a column already exists, MySQL will error with "Duplicate column name" — you can ignore that specific error.

ALTER TABLE users ADD COLUMN email_verified_at DATETIME NULL AFTER role;
ALTER TABLE users ADD COLUMN token_version INT UNSIGNED NOT NULL DEFAULT 0 AFTER email_verified_at;
ALTER TABLE users ADD COLUMN password_changed_at DATETIME NULL AFTER token_version;
ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL AFTER password_changed_at;
ALTER TABLE users ADD COLUMN failed_login_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER last_login_at;
ALTER TABLE users ADD COLUMN locked_until DATETIME NULL AFTER failed_login_count;

