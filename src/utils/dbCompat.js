import { env } from './env.js';
import { logger } from './logger.js';

/**
 * Incremental DB compatibility layer.
 * Ensures required columns exist for the current code, without requiring a full migration tool.
 * This is meant for development/staging bootstraps where the DB may lag behind schema.sql.
 */
export async function ensureUsersAuthColumns({ pool }) {
  const required = [
    { name: 'email_verified_at', ddl: 'ALTER TABLE users ADD COLUMN email_verified_at DATETIME NULL AFTER role' },
    {
      name: 'token_version',
      ddl: 'ALTER TABLE users ADD COLUMN token_version INT UNSIGNED NOT NULL DEFAULT 0 AFTER email_verified_at',
    },
    {
      name: 'password_changed_at',
      ddl: 'ALTER TABLE users ADD COLUMN password_changed_at DATETIME NULL AFTER token_version',
    },
    { name: 'last_login_at', ddl: 'ALTER TABLE users ADD COLUMN last_login_at DATETIME NULL AFTER password_changed_at' },
    {
      name: 'failed_login_count',
      ddl: 'ALTER TABLE users ADD COLUMN failed_login_count INT UNSIGNED NOT NULL DEFAULT 0 AFTER last_login_at',
    },
    { name: 'locked_until', ddl: 'ALTER TABLE users ADD COLUMN locked_until DATETIME NULL AFTER failed_login_count' },
    { name: 'phone', ddl: 'ALTER TABLE users ADD COLUMN phone VARCHAR(30) NULL AFTER name' },
  ];

  try {
    const [rows] = await pool.query(
      `SELECT column_name
         FROM information_schema.columns
        WHERE table_schema = ?
          AND table_name = 'users'`,
      [env.DB_NAME],
    );

    const existing = new Set((rows ?? []).map((r) => String(r.column_name)));
    const missing = required.filter((c) => !existing.has(c.name));
    if (!missing.length) return;

    logger.warn(
      { missing: missing.map((m) => m.name), table: 'users', db: env.DB_NAME },
      'db_compat_users_columns_missing',
    );

    // Apply one-by-one for clearer errors and safe partial progress.
    for (const col of missing) {
      try {
        // eslint-disable-next-line no-await-in-loop
        await pool.query(col.ddl);
        logger.info({ column: col.name }, 'db_compat_users_column_added');
      } catch (err) {
        // If multiple nodes race, ignore "duplicate column" and continue.
        if (err?.code === 'ER_DUP_FIELDNAME') continue;
        throw err;
      }
    }
  } catch (err) {
    // If the users table doesn't exist, don't mask it—this is a real missing migration.
    logger.error({ err }, 'db_compat_users_check_failed');
    throw err;
  }
}

/**
 * Ensures expanded roles + instructor fields exist.
 * This is a dev/staging bootstrap convenience only.
 */
export async function ensureCreatorCollaborationColumns({ pool }) {
  try {
    const [rows] = await pool.query(
      `SELECT COLUMN_TYPE AS column_type
         FROM information_schema.columns
        WHERE table_schema = ?
          AND table_name = 'users'
          AND column_name = 'role'
        LIMIT 1`,
      [env.DB_NAME],
    );
    const type = String(rows?.[0]?.column_type ?? '');
    if (type && !type.includes("'instructor'")) {
      logger.warn({ from: type }, 'db_compat_users_role_expand');
      await pool.query(
        "ALTER TABLE users MODIFY COLUMN role ENUM('super_admin','admin','instructor','support_agent','content_editor','user') NOT NULL DEFAULT 'user'",
      );
    }

    const required = [
      { name: 'instructor_bio', ddl: 'ALTER TABLE users ADD COLUMN instructor_bio TEXT NULL AFTER phone' },
      { name: 'instructor_avatar', ddl: 'ALTER TABLE users ADD COLUMN instructor_avatar VARCHAR(1024) NULL AFTER instructor_bio' },
      {
        name: 'instructor_status',
        ddl: "ALTER TABLE users ADD COLUMN instructor_status ENUM('active','suspended') NOT NULL DEFAULT 'active' AFTER instructor_avatar",
      },
      { name: 'payout_preference', ddl: 'ALTER TABLE users ADD COLUMN payout_preference JSON NULL AFTER instructor_status' },
    ];

    const [cols] = await pool.query(
      `SELECT column_name AS c
         FROM information_schema.columns
        WHERE table_schema = ?
          AND table_name = 'users'`,
      [env.DB_NAME],
    );
    const existing = new Set((cols ?? []).map((r) => String(r.c)));
    for (const col of required) {
      if (existing.has(col.name)) continue;
      try {
        // eslint-disable-next-line no-await-in-loop
        await pool.query(col.ddl);
        logger.info({ column: col.name }, 'db_compat_users_column_added');
      } catch (err) {
        if (err?.code === 'ER_DUP_FIELDNAME') continue;
        throw err;
      }
    }
  } catch (err) {
    logger.error({ err }, 'db_compat_creator_collab_failed');
    throw err;
  }
}

async function tableExists({ pool, tableName }) {
  const [rows] = await pool.query(
    `SELECT 1 AS ok
       FROM information_schema.tables
      WHERE table_schema = ?
        AND table_name = ?
      LIMIT 1`,
    [env.DB_NAME, tableName],
  );
  return Boolean(rows?.[0]?.ok);
}

async function columnExists({ pool, tableName, columnName }) {
  const [rows] = await pool.query(
    `SELECT 1 AS ok
       FROM information_schema.columns
      WHERE table_schema = ?
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    [env.DB_NAME, tableName, columnName],
  );
  return Boolean(rows?.[0]?.ok);
}

async function ensureEmailOutboxUpgrades({ pool }) {
  const tableName = 'email_outbox';
  const upgrades = [
    { name: 'next_attempt_at', ddl: 'ALTER TABLE email_outbox ADD COLUMN next_attempt_at DATETIME NULL AFTER scheduled_at' },
    { name: 'provider_message_id', ddl: 'ALTER TABLE email_outbox ADD COLUMN provider_message_id VARCHAR(255) NULL AFTER sent_at' },
    { name: 'provider_response', ddl: 'ALTER TABLE email_outbox ADD COLUMN provider_response TEXT NULL AFTER provider_message_id' },
  ];

  for (const u of upgrades) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await columnExists({ pool, tableName, columnName: u.name });
    if (exists) continue;
    logger.warn({ table: tableName, column: u.name }, 'db_compat_email_outbox_upgrade');
    try {
      // eslint-disable-next-line no-await-in-loop
      await pool.query(u.ddl);
      logger.info({ table: tableName, column: u.name }, 'db_compat_email_outbox_column_added');
    } catch (err) {
      if (err?.code === 'ER_DUP_FIELDNAME') continue;
      throw err;
    }
  }

  // Backfill next_attempt_at for existing pending/failed rows.
  try {
    await pool.query(
      `UPDATE email_outbox
          SET next_attempt_at = COALESCE(scheduled_at, created_at)
        WHERE next_attempt_at IS NULL
          AND status IN ('pending','failed')`,
    );
  } catch (err) {
    logger.warn({ err }, 'db_compat_email_outbox_backfill_failed');
  }
}

/**
 * Ensures core auth/support tables exist for signup/login/refresh flows.
 * This is a dev/staging bootstrap convenience only.
 */
export async function ensureAuthSupportTables({ pool }) {
  const tables = [
    {
      name: 'email_outbox',
      ddl: `CREATE TABLE IF NOT EXISTS email_outbox (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        to_email VARCHAR(254) NOT NULL,
        subject VARCHAR(255) NOT NULL,
        body_text TEXT NULL,
        body_html LONGTEXT NULL,
        status ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
        attempts INT UNSIGNED NOT NULL DEFAULT 0,
        last_error TEXT NULL,
        scheduled_at DATETIME NULL,
        next_attempt_at DATETIME NULL,
        sent_at DATETIME NULL,
        provider_message_id VARCHAR(255) NULL,
        provider_response TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_email_outbox_status_scheduled (status, scheduled_at),
        KEY idx_email_outbox_to_email (to_email)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'refresh_tokens',
      ddl: `CREATE TABLE IF NOT EXISTS refresh_tokens (
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'email_verification_tokens',
      ddl: `CREATE TABLE IF NOT EXISTS email_verification_tokens (
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'password_reset_tokens',
      ddl: `CREATE TABLE IF NOT EXISTS password_reset_tokens (
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'audit_logs',
      ddl: `CREATE TABLE IF NOT EXISTS audit_logs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        actor_type ENUM('user','admin','system') NOT NULL,
        actor_id BIGINT UNSIGNED NULL,
        action_type VARCHAR(64) NOT NULL,
        entity_type VARCHAR(64) NOT NULL,
        entity_id BIGINT UNSIGNED NULL,
        metadata JSON NULL,
        ip_address VARCHAR(45) NULL,
        user_agent VARCHAR(255) NULL,
        request_id VARCHAR(64) NULL,
        status_code INT UNSIGNED NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_audit_logs_actor (actor_type, actor_id),
        KEY idx_audit_logs_entity (entity_type, entity_id),
        KEY idx_audit_logs_created_at (created_at),
        KEY idx_audit_logs_request_id (request_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
  ];

  for (const t of tables) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await tableExists({ pool, tableName: t.name });
    if (exists) continue;
    logger.warn({ table: t.name, db: env.DB_NAME }, 'db_compat_table_missing');
    try {
      // eslint-disable-next-line no-await-in-loop
      await pool.query(t.ddl);
      logger.info({ table: t.name }, 'db_compat_table_created');
    } catch (err) {
      logger.error({ err, table: t.name }, 'db_compat_table_create_failed');
      throw err;
    }
  }

  // Non-breaking upgrades for delivery reliability/observability.
  if (await tableExists({ pool, tableName: 'email_outbox' })) {
    await ensureEmailOutboxUpgrades({ pool });
  }
}

/**
 * Ensures commerce/ops tables exist for orders, coupons, and refunds.
 * This is a dev/staging bootstrap convenience only.
 */
export async function ensureCommerceTables({ pool }) {
  const tables = [
    {
      name: 'discount_rules',
      ddl: `CREATE TABLE IF NOT EXISTS discount_rules (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        min_courses INT UNSIGNED NOT NULL,
        max_courses INT UNSIGNED NULL,
        discount_percent DECIMAL(5,2) NOT NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_discount_rules_active_min (is_active, min_courses),
        KEY idx_discount_rules_active_max (is_active, max_courses)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'orders',
      ddl: `CREATE TABLE IF NOT EXISTS orders (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NOT NULL,
        status ENUM('created','payment_pending','paid','failed','refunded','cancelled') NOT NULL DEFAULT 'created',
        currency CHAR(3) NOT NULL DEFAULT 'INR',
        subtotal_cents INT UNSIGNED NOT NULL DEFAULT 0,
        discount_cents INT UNSIGNED NOT NULL DEFAULT 0,
        tax_cents INT UNSIGNED NOT NULL DEFAULT 0,
        total_cents INT UNSIGNED NOT NULL DEFAULT 0,
        coupon_id BIGINT UNSIGNED NULL,
        coupon_code VARCHAR(64) NULL,
        billing_name VARCHAR(120) NULL,
        billing_email VARCHAR(254) NULL,
        billing_phone VARCHAR(32) NULL,
        billing_gst_number VARCHAR(32) NULL,
        billing_address_json JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_orders_user_id_created_at (user_id, created_at),
        KEY idx_orders_status_created_at (status, created_at),
        KEY idx_orders_coupon_id (coupon_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'order_items',
      ddl: `CREATE TABLE IF NOT EXISTS order_items (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        order_id BIGINT UNSIGNED NOT NULL,
        item_type ENUM('course') NOT NULL DEFAULT 'course',
        course_id INT UNSIGNED NULL,
        title VARCHAR(255) NOT NULL,
        currency CHAR(3) NOT NULL DEFAULT 'INR',
        unit_price_cents INT UNSIGNED NOT NULL DEFAULT 0,
        quantity INT UNSIGNED NOT NULL DEFAULT 1,
        line_subtotal_cents INT UNSIGNED NOT NULL DEFAULT 0,
        line_discount_cents INT UNSIGNED NOT NULL DEFAULT 0,
        line_tax_cents INT UNSIGNED NOT NULL DEFAULT 0,
        line_total_cents INT UNSIGNED NOT NULL DEFAULT 0,
        metadata_json JSON NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_order_items_order_id (order_id),
        KEY idx_order_items_course_id (course_id),
        CONSTRAINT fk_order_items_order_id
          FOREIGN KEY (order_id) REFERENCES orders(id)
          ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'payments',
      ddl: `CREATE TABLE IF NOT EXISTS payments (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        order_id BIGINT UNSIGNED NOT NULL,
        user_id INT UNSIGNED NULL,
        provider VARCHAR(32) NOT NULL,
        provider_order_id VARCHAR(128) NULL,
        provider_payment_id VARCHAR(128) NULL,
        provider_signature VARCHAR(256) NULL,
        status ENUM('created','pending','authorized','captured','failed','refunded') NOT NULL DEFAULT 'created',
        amount_cents INT UNSIGNED NOT NULL DEFAULT 0,
        currency CHAR(3) NOT NULL DEFAULT 'INR',
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        captured_at DATETIME NULL,
        failed_at DATETIME NULL,
        refunded_at DATETIME NULL,
        raw_payload_json LONGTEXT NULL,
        metadata_json JSON NULL,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_payments_order_id (order_id),
        KEY idx_payments_user_id (user_id),
        KEY idx_payments_status_created_at (status, created_at),
        KEY idx_payments_provider_order_id (provider_order_id),
        CONSTRAINT fk_payments_order_id
          FOREIGN KEY (order_id) REFERENCES orders(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_payments_user_id
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'order_notification_log',
      ddl: `CREATE TABLE IF NOT EXISTS order_notification_log (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        order_id BIGINT UNSIGNED NOT NULL,
        notification_type ENUM('order_confirmation_email') NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_order_notification_once (order_id, notification_type),
        KEY idx_order_notification_order_id (order_id),
        CONSTRAINT fk_order_notification_order_id
          FOREIGN KEY (order_id) REFERENCES orders(id)
          ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'refunds',
      ddl: `CREATE TABLE IF NOT EXISTS refunds (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        order_id BIGINT UNSIGNED NOT NULL,
        payment_id BIGINT UNSIGNED NULL,
        amount_cents INT UNSIGNED NOT NULL DEFAULT 0,
        currency CHAR(3) NOT NULL DEFAULT 'INR',
        reason VARCHAR(255) NULL,
        status ENUM('requested','processed','failed') NOT NULL DEFAULT 'requested',
        provider_refund_id VARCHAR(128) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        processed_at DATETIME NULL,
        metadata_json JSON NULL,
        PRIMARY KEY (id),
        KEY idx_refunds_order_id (order_id),
        KEY idx_refunds_payment_id (payment_id),
        KEY idx_refunds_status_created_at (status, created_at),
        CONSTRAINT fk_refunds_order_id
          FOREIGN KEY (order_id) REFERENCES orders(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_refunds_payment_id
          FOREIGN KEY (payment_id) REFERENCES payments(id)
          ON DELETE SET NULL ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'payment_reconciliation',
      ddl: `CREATE TABLE IF NOT EXISTS payment_reconciliation (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        order_id BIGINT UNSIGNED NOT NULL,
        status ENUM('unreconciled','reconciled','needs_review') NOT NULL DEFAULT 'unreconciled',
        notes TEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_payment_reconciliation_order_id (order_id),
        KEY idx_payment_reconciliation_status (status),
        CONSTRAINT fk_payment_reconciliation_order_id
          FOREIGN KEY (order_id) REFERENCES orders(id)
          ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'coupons',
      ddl: `CREATE TABLE IF NOT EXISTS coupons (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        code VARCHAR(64) NOT NULL,
        description VARCHAR(255) NULL,
        discount_type ENUM('amount','percent') NOT NULL DEFAULT 'amount',
        discount_value_cents INT UNSIGNED NULL,
        discount_percent DECIMAL(5,2) NULL,
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
        KEY idx_coupons_active_dates (is_active, starts_at, ends_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'coupon_usages',
      ddl: `CREATE TABLE IF NOT EXISTS coupon_usages (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        coupon_id BIGINT UNSIGNED NOT NULL,
        user_id INT UNSIGNED NOT NULL,
        order_id BIGINT UNSIGNED NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_coupon_user_order (coupon_id, user_id, order_id),
        KEY idx_coupon_usages_coupon_id (coupon_id),
        KEY idx_coupon_usages_user_id (user_id),
        KEY idx_coupon_usages_order_id (order_id),
        CONSTRAINT fk_coupon_usages_coupon_id
          FOREIGN KEY (coupon_id) REFERENCES coupons(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_coupon_usages_order_id
          FOREIGN KEY (order_id) REFERENCES orders(id)
          ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'site_settings',
      ddl: `CREATE TABLE IF NOT EXISTS site_settings (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        setting_key VARCHAR(128) NOT NULL,
        setting_value_json JSON NULL,
        updated_by_admin_id INT UNSIGNED NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_site_settings_key (setting_key),
        KEY idx_site_settings_updated_at (updated_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'notification_jobs',
      ddl: `CREATE TABLE IF NOT EXISTS notification_jobs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        job_type ENUM('broadcast','reminder') NOT NULL,
        channel ENUM('email') NOT NULL DEFAULT 'email',
        subject VARCHAR(255) NULL,
        body_text TEXT NULL,
        body_html LONGTEXT NULL,
        audience_json JSON NULL,
        scheduled_at DATETIME NULL,
        status ENUM('draft','scheduled','processing','sent','failed') NOT NULL DEFAULT 'draft',
        attempts INT UNSIGNED NOT NULL DEFAULT 0,
        last_error TEXT NULL,
        created_by_admin_id INT UNSIGNED NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_notification_jobs_status_scheduled (status, scheduled_at),
        KEY idx_notification_jobs_type (job_type)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'user_notifications',
      ddl: `CREATE TABLE IF NOT EXISTS user_notifications (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NOT NULL,
        title VARCHAR(255) NOT NULL,
        message TEXT NULL,
        kind VARCHAR(64) NOT NULL DEFAULT 'info',
        link_url VARCHAR(255) NULL,
        is_read TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        read_at DATETIME NULL,
        PRIMARY KEY (id),
        KEY idx_user_notifications_user_id_created_at (user_id, created_at),
        KEY idx_user_notifications_user_id_is_read (user_id, is_read)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'push_outbox',
      ddl: `CREATE TABLE IF NOT EXISTS push_outbox (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NOT NULL,
        endpoint VARCHAR(512) NOT NULL,
        payload_json JSON NOT NULL,
        status ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
        attempts INT UNSIGNED NOT NULL DEFAULT 0,
        last_error TEXT NULL,
        scheduled_at DATETIME NULL,
        sent_at DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_push_outbox_status_scheduled (status, scheduled_at),
        KEY idx_push_outbox_user_id (user_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'payment_provider_configs',
      ddl: `CREATE TABLE IF NOT EXISTS payment_provider_configs (
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
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
  ];

  for (const t of tables) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await tableExists({ pool, tableName: t.name });
    if (exists) continue;
    logger.warn({ table: t.name, db: env.DB_NAME }, 'db_compat_table_missing');
    try {
      // eslint-disable-next-line no-await-in-loop
      await pool.query(t.ddl);
      logger.info({ table: t.name }, 'db_compat_table_created');
    } catch (err) {
      logger.error({ err, table: t.name }, 'db_compat_table_create_failed');
      throw err;
    }
  }

  // Non-breaking upgrades for older dev DBs.
  if (await tableExists({ pool, tableName: 'payments' })) {
    const upgrades = [
      { name: 'refunded_at', ddl: 'ALTER TABLE payments ADD COLUMN refunded_at DATETIME NULL AFTER failed_at' },
      { name: 'updated_at', ddl: 'ALTER TABLE payments ADD COLUMN updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP' },
      { name: 'user_id', ddl: 'ALTER TABLE payments ADD COLUMN user_id INT UNSIGNED NULL AFTER order_id' },
      { name: 'provider_signature', ddl: 'ALTER TABLE payments ADD COLUMN provider_signature VARCHAR(256) NULL AFTER provider_payment_id' },
      { name: 'raw_payload_json', ddl: 'ALTER TABLE payments ADD COLUMN raw_payload_json LONGTEXT NULL AFTER refunded_at' },
    ];
    for (const u of upgrades) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await columnExists({ pool, tableName: 'payments', columnName: u.name });
      if (exists) continue;
      logger.warn({ table: 'payments', column: u.name }, 'db_compat_payments_upgrade');
      try {
        // eslint-disable-next-line no-await-in-loop
        await pool.query(u.ddl);
        logger.info({ table: 'payments', column: u.name }, 'db_compat_payments_column_added');
      } catch (err) {
        if (err?.code === 'ER_DUP_FIELDNAME') continue;
        throw err;
      }
    }
  }

  // course_prices: sale / compare-at upgrades (non-breaking).
  try {
    if (await tableExists({ pool, tableName: 'course_prices' })) {
      const upgrades = [
        { name: 'compare_at_amount_cents', ddl: 'ALTER TABLE course_prices ADD COLUMN compare_at_amount_cents INT UNSIGNED NULL AFTER amount_cents' },
        { name: 'sale_amount_cents', ddl: 'ALTER TABLE course_prices ADD COLUMN sale_amount_cents INT UNSIGNED NULL AFTER compare_at_amount_cents' },
        { name: 'sale_starts_at', ddl: 'ALTER TABLE course_prices ADD COLUMN sale_starts_at DATETIME NULL AFTER sale_amount_cents' },
        { name: 'sale_ends_at', ddl: 'ALTER TABLE course_prices ADD COLUMN sale_ends_at DATETIME NULL AFTER sale_starts_at' },
      ];
      for (const u of upgrades) {
        // eslint-disable-next-line no-await-in-loop
        const exists = await columnExists({ pool, tableName: 'course_prices', columnName: u.name });
        if (exists) continue;
        logger.warn({ table: 'course_prices', column: u.name }, 'db_compat_course_prices_upgrade');
        try {
          // eslint-disable-next-line no-await-in-loop
          await pool.query(u.ddl);
          logger.info({ table: 'course_prices', column: u.name }, 'db_compat_course_prices_column_added');
        } catch (err) {
          if (err?.code === 'ER_DUP_FIELDNAME') continue;
          throw err;
        }
      }
    }
  } catch (err) {
    logger.warn({ err }, 'db_compat_course_prices_upgrade_failed');
  }
}

/**
 * Ensures end-user experience tables exist (preferences + offline learning queue).
 * This is a dev/staging bootstrap convenience only.
 */
export async function ensureUserExperienceTables({ pool }) {
  const tables = [
    {
      name: 'push_subscriptions',
      ddl: `CREATE TABLE IF NOT EXISTS push_subscriptions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NOT NULL,
        endpoint VARCHAR(512) NOT NULL,
        p256dh VARCHAR(255) NOT NULL,
        auth VARCHAR(255) NOT NULL,
        user_agent VARCHAR(255) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_push_subscriptions_user_endpoint (user_id, endpoint),
        KEY idx_push_subscriptions_user_id (user_id),
        CONSTRAINT fk_push_subscriptions_user_id
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'user_preferences',
      ddl: `CREATE TABLE IF NOT EXISTS user_preferences (
        user_id INT UNSIGNED NOT NULL,
        marketing_emails TINYINT(1) NOT NULL DEFAULT 1,
        product_updates TINYINT(1) NOT NULL DEFAULT 1,
        workshop_reminders TINYINT(1) NOT NULL DEFAULT 1,
        whatsapp_opt_in TINYINT(1) NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (user_id),
        CONSTRAINT fk_user_preferences_user_id
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'offline_progress_events',
      ddl: `CREATE TABLE IF NOT EXISTS offline_progress_events (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NOT NULL,
        client_event_id VARCHAR(64) NOT NULL,
        event_type VARCHAR(32) NOT NULL,
        lesson_id BIGINT UNSIGNED NOT NULL,
        payload_json JSON NULL,
        occurred_at DATETIME NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_offline_progress_events_user_client (user_id, client_event_id),
        KEY idx_offline_progress_events_user_created (user_id, created_at),
        KEY idx_offline_progress_events_lesson (lesson_id),
        CONSTRAINT fk_offline_progress_events_user_id
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_offline_progress_events_lesson_id
          FOREIGN KEY (lesson_id) REFERENCES lessons(id)
          ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'waitlist_signups',
      ddl: `CREATE TABLE IF NOT EXISTS waitlist_signups (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NOT NULL,
        course_id BIGINT UNSIGNED NOT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_waitlist_user_course (user_id, course_id),
        KEY idx_waitlist_course_created (course_id, created_at),
        CONSTRAINT fk_waitlist_user_id
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_waitlist_course_id
          FOREIGN KEY (course_id) REFERENCES courses(id)
          ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
  ];

  for (const t of tables) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await tableExists({ pool, tableName: t.name });
    if (exists) continue;
    logger.warn({ table: t.name, db: env.DB_NAME }, 'db_compat_table_missing');
    try {
      // eslint-disable-next-line no-await-in-loop
      await pool.query(t.ddl);
      logger.info({ table: t.name }, 'db_compat_table_created');
    } catch (err) {
      logger.error({ err, table: t.name }, 'db_compat_table_create_failed');
      throw err;
    }
  }

  // Live sessions: add missing columns incrementally (table is expected to exist via schema.sql).
  try {
    const [cols] = await pool.query(
      `SELECT column_name AS c, column_type AS t
         FROM information_schema.columns
        WHERE table_schema = ?
          AND table_name = 'live_sessions'`,
      [env.DB_NAME],
    );
    const existing = new Map((cols ?? []).map((r) => [String(r.c), String(r.t)]));

    const addColumn = async (name, ddl) => {
      if (existing.has(name)) return;
      try {
        await pool.query(ddl);
        logger.info({ table: 'live_sessions', column: name }, 'db_compat_column_added');
      } catch (err) {
        if (err?.code === 'ER_DUP_FIELDNAME') return;
        throw err;
      }
    };

    await addColumn('seat_limit', 'ALTER TABLE live_sessions ADD COLUMN seat_limit INT UNSIGNED NOT NULL DEFAULT 0 AFTER ended_at');
    await addColumn('duration_minutes', 'ALTER TABLE live_sessions ADD COLUMN duration_minutes INT UNSIGNED NOT NULL DEFAULT 120 AFTER seat_limit');
    await addColumn(
      'cancelled_at',
      'ALTER TABLE live_sessions ADD COLUMN cancelled_at DATETIME NULL AFTER duration_minutes',
    );
    await addColumn(
      'recording_state',
      "ALTER TABLE live_sessions ADD COLUMN recording_state ENUM('none','processing','ready') NOT NULL DEFAULT 'none' AFTER cancelled_at",
    );
    await addColumn('recording_ready_at', 'ALTER TABLE live_sessions ADD COLUMN recording_ready_at DATETIME NULL AFTER recording_state');
    await addColumn('replay_days', 'ALTER TABLE live_sessions ADD COLUMN replay_days INT UNSIGNED NOT NULL DEFAULT 365 AFTER recording_ready_at');

    // Expand status enum to include cancelled (backward compatible).
    const statusType = existing.get('status') ?? '';
    if (statusType && !statusType.includes("'cancelled'")) {
      logger.warn({ from: statusType }, 'db_compat_live_sessions_status_expand');
      await pool.query("ALTER TABLE live_sessions MODIFY COLUMN status ENUM('upcoming','live','completed','cancelled') NOT NULL DEFAULT 'upcoming'");
    }
  } catch (err) {
    // If live_sessions doesn't exist yet, don't hard fail in dev.
    logger.warn({ err }, 'db_compat_live_sessions_columns_skip');
  }

  // session_recordings: allow nullable URL for processing state (older schema has NOT NULL).
  try {
    const [[col]] = await pool.query(
      `SELECT IS_NULLABLE AS n
         FROM information_schema.columns
        WHERE table_schema = ?
          AND table_name = 'session_recordings'
          AND column_name = 'recording_url'
        LIMIT 1`,
      [env.DB_NAME],
    );
    const isNullable = String(col?.n ?? '').toUpperCase() === 'YES';
    if (col && !isNullable) {
      logger.warn({ table: 'session_recordings', column: 'recording_url' }, 'db_compat_recording_url_nullable');
      await pool.query('ALTER TABLE session_recordings MODIFY COLUMN recording_url VARCHAR(2048) NULL');
    }
  } catch (err) {
    logger.warn({ err }, 'db_compat_session_recordings_columns_skip');
  }
}

/**
 * Ensures CMS/content tables exist for homepage/about, testimonials, FAQs, and announcements.
 * This is a dev/staging bootstrap convenience only.
 */
export async function ensureCmsTables({ pool }) {
  const tables = [
    {
      name: 'site_content',
      ddl: `CREATE TABLE IF NOT EXISTS site_content (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        content_key VARCHAR(120) NOT NULL,
        title VARCHAR(255) NULL,
        content_json JSON NULL,
        content_html LONGTEXT NULL,
        is_published TINYINT(1) NOT NULL DEFAULT 1,
        updated_by INT UNSIGNED NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_site_content_key (content_key),
        KEY idx_site_content_published (is_published),
        CONSTRAINT fk_site_content_updated_by
          FOREIGN KEY (updated_by) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'testimonials',
      ddl: `CREATE TABLE IF NOT EXISTS testimonials (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        student_name VARCHAR(160) NOT NULL,
        testimonial_text TEXT NOT NULL,
        avatar_url VARCHAR(1024) NULL,
        course_id BIGINT UNSIGNED NULL,
        is_featured TINYINT(1) NOT NULL DEFAULT 0,
        is_published TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_testimonials_published_order (is_published, sort_order),
        KEY idx_testimonials_course (course_id)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'faqs',
      ddl: `CREATE TABLE IF NOT EXISTS faqs (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        category VARCHAR(120) NULL,
        question VARCHAR(255) NOT NULL,
        answer_html LONGTEXT NOT NULL,
        is_published TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_faqs_published_order (is_published, sort_order),
        KEY idx_faqs_category (category)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'announcements',
      ddl: `CREATE TABLE IF NOT EXISTS announcements (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        message VARCHAR(280) NOT NULL,
        cta_label VARCHAR(80) NULL,
        cta_url VARCHAR(1024) NULL,
        starts_at DATETIME NULL,
        ends_at DATETIME NULL,
        is_active TINYINT(1) NOT NULL DEFAULT 1,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_announcements_active_dates (is_active, starts_at, ends_at)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'legal_pages',
      ddl: `CREATE TABLE IF NOT EXISTS legal_pages (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        slug VARCHAR(160) NOT NULL,
        title VARCHAR(255) NOT NULL,
        content_html LONGTEXT NOT NULL,
        status ENUM('draft','published') NOT NULL DEFAULT 'published',
        version INT UNSIGNED NOT NULL DEFAULT 1,
        updated_by INT UNSIGNED NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_legal_pages_slug (slug),
        KEY idx_legal_pages_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'seo_meta',
      ddl: `CREATE TABLE IF NOT EXISTS seo_meta (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        page_key VARCHAR(160) NOT NULL,
        meta_title VARCHAR(255) NULL,
        meta_description VARCHAR(320) NULL,
        og_image_url VARCHAR(1024) NULL,
        canonical_url VARCHAR(1024) NULL,
        json_ld LONGTEXT NULL,
        updated_by INT UNSIGNED NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_seo_meta_page (page_key)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'student_gallery',
      ddl: `CREATE TABLE IF NOT EXISTS student_gallery (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        image_url VARCHAR(1024) NOT NULL,
        alt_text VARCHAR(160) NULL,
        caption VARCHAR(255) NULL,
        is_featured TINYINT(1) NOT NULL DEFAULT 0,
        is_published TINYINT(1) NOT NULL DEFAULT 1,
        sort_order INT NOT NULL DEFAULT 0,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_gallery_published_order (is_published, sort_order)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'newsletter_subscribers',
      ddl: `CREATE TABLE IF NOT EXISTS newsletter_subscribers (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        email VARCHAR(254) NOT NULL,
        status ENUM('subscribed','unsubscribed') NOT NULL DEFAULT 'subscribed',
        subscribed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_newsletter_email (email),
        KEY idx_newsletter_status (status)
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
  ];

  for (const t of tables) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await tableExists({ pool, tableName: t.name });
    if (exists) continue;
    logger.warn({ table: t.name, db: env.DB_NAME }, 'db_compat_table_missing');
    try {
      // eslint-disable-next-line no-await-in-loop
      await pool.query(t.ddl);
      logger.info({ table: t.name }, 'db_compat_table_created');
    } catch (err) {
      logger.error({ err, table: t.name }, 'db_compat_table_create_failed');
      throw err;
    }
  }

  // Recipes: scheduled publish support (column upgrade).
  try {
    if (await tableExists({ pool, tableName: 'recipes' })) {
      const exists = await columnExists({ pool, tableName: 'recipes', columnName: 'publish_at' });
      if (!exists) {
        logger.warn({ table: 'recipes', column: 'publish_at' }, 'db_compat_recipes_upgrade');
        await pool.query('ALTER TABLE recipes ADD COLUMN publish_at DATETIME NULL AFTER is_published');
        logger.info({ table: 'recipes', column: 'publish_at' }, 'db_compat_recipes_column_added');
      }
    }
  } catch (err) {
    logger.warn({ err }, 'db_compat_recipes_publish_at_upgrade_failed');
  }

  // Tags (recipes).
  try {
    const tagTables = [
      {
        name: 'tags',
        ddl: `CREATE TABLE IF NOT EXISTS tags (
          id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
          tag_type ENUM('recipe') NOT NULL DEFAULT 'recipe',
          name VARCHAR(120) NOT NULL,
          slug VARCHAR(140) NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (id),
          UNIQUE KEY uk_tags_type_slug (tag_type, slug),
          KEY idx_tags_type_name (tag_type, name)
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      },
      {
        name: 'recipe_tags',
        ddl: `CREATE TABLE IF NOT EXISTS recipe_tags (
          recipe_id BIGINT UNSIGNED NOT NULL,
          tag_id BIGINT UNSIGNED NOT NULL,
          created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
          PRIMARY KEY (recipe_id, tag_id),
          KEY idx_recipe_tags_tag_id (tag_id),
          CONSTRAINT fk_recipe_tags_recipe_id
            FOREIGN KEY (recipe_id) REFERENCES recipes(id)
            ON DELETE CASCADE ON UPDATE CASCADE,
          CONSTRAINT fk_recipe_tags_tag_id
            FOREIGN KEY (tag_id) REFERENCES tags(id)
            ON DELETE CASCADE ON UPDATE CASCADE
        ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
      },
    ];
    for (const t of tagTables) {
      // eslint-disable-next-line no-await-in-loop
      const exists = await tableExists({ pool, tableName: t.name });
      if (exists) continue;
      logger.warn({ table: t.name, db: env.DB_NAME }, 'db_compat_table_missing');
      // eslint-disable-next-line no-await-in-loop
      await pool.query(t.ddl);
      logger.info({ table: t.name }, 'db_compat_table_created');
    }
  } catch (err) {
    logger.warn({ err }, 'db_compat_tags_tables_failed');
  }
}

/**
 * Ensures support/helpdesk tables exist.
 * This is a dev/staging bootstrap convenience only.
 */
export async function ensureSupportTables({ pool }) {
  const tables = [
    {
      name: 'support_tickets',
      ddl: `CREATE TABLE IF NOT EXISTS support_tickets (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NOT NULL,
        category ENUM('payment','access','technical','certificate','live_workshop','refund','other') NOT NULL DEFAULT 'other',
        subject VARCHAR(255) NOT NULL,
        status ENUM('open','pending','resolved','closed') NOT NULL DEFAULT 'open',
        priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
        assigned_admin_id INT UNSIGNED NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_support_tickets_user_created (user_id, created_at),
        KEY idx_support_tickets_status_updated (status, updated_at),
        KEY idx_support_tickets_category_status (category, status),
        KEY idx_support_tickets_assigned (assigned_admin_id, status),
        CONSTRAINT fk_support_tickets_user_id
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_support_tickets_assigned_admin_id
          FOREIGN KEY (assigned_admin_id) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'support_messages',
      ddl: `CREATE TABLE IF NOT EXISTS support_messages (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        ticket_id BIGINT UNSIGNED NOT NULL,
        sender_type ENUM('user','admin','system') NOT NULL DEFAULT 'user',
        sender_id INT UNSIGNED NULL,
        message_text LONGTEXT NOT NULL,
        attachment_url VARCHAR(255) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_support_messages_ticket_created (ticket_id, created_at),
        KEY idx_support_messages_sender (sender_type, sender_id, created_at),
        CONSTRAINT fk_support_messages_ticket_id
          FOREIGN KEY (ticket_id) REFERENCES support_tickets(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_support_messages_sender_id
          FOREIGN KEY (sender_id) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
  ];

  for (const t of tables) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await tableExists({ pool, tableName: t.name });
    if (exists) continue;
    logger.warn({ table: t.name, db: env.DB_NAME }, 'db_compat_table_missing');
    try {
      // eslint-disable-next-line no-await-in-loop
      await pool.query(t.ddl);
      logger.info({ table: t.name }, 'db_compat_table_created');
    } catch (err) {
      logger.error({ err, table: t.name }, 'db_compat_table_create_failed');
      throw err;
    }
  }
}

/**
 * Ensures LMS core tables exist (completions + certificates).
 * This is a dev/staging bootstrap convenience only.
 */
export async function ensureLmsCoreTables({ pool }) {
  const tables = [
    {
      name: 'user_course_completions',
      ddl: `CREATE TABLE IF NOT EXISTS user_course_completions (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NOT NULL,
        course_id BIGINT UNSIGNED NOT NULL,
        completed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_user_course_completions_user_course (user_id, course_id),
        KEY idx_user_course_completions_course_user (course_id, user_id),
        KEY idx_user_course_completions_completed_at (completed_at),
        CONSTRAINT fk_user_course_completions_user_id
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_user_course_completions_course_id
          FOREIGN KEY (course_id) REFERENCES courses(id)
          ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
    {
      name: 'certificates',
      ddl: `CREATE TABLE IF NOT EXISTS certificates (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        certificate_id CHAR(36) NOT NULL,
        user_id INT UNSIGNED NOT NULL,
        course_id BIGINT UNSIGNED NOT NULL,
        issued_at DATETIME NOT NULL,
        verification_code CHAR(32) NOT NULL,
        status ENUM('active','revoked') NOT NULL DEFAULT 'active',
        revoked_at DATETIME NULL,
        revoke_reason VARCHAR(255) NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        UNIQUE KEY uk_certificates_cert_id (certificate_id),
        UNIQUE KEY uk_certificates_verification_code (verification_code),
        UNIQUE KEY uk_certificates_user_course (user_id, course_id),
        KEY idx_certificates_course_user (course_id, user_id),
        KEY idx_certificates_status_issued (status, issued_at),
        CONSTRAINT fk_certificates_user_id
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE CASCADE ON UPDATE CASCADE,
        CONSTRAINT fk_certificates_course_id
          FOREIGN KEY (course_id) REFERENCES courses(id)
          ON DELETE CASCADE ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
  ];

  for (const t of tables) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await tableExists({ pool, tableName: t.name });
    if (exists) continue;
    logger.warn({ table: t.name, db: env.DB_NAME }, 'db_compat_table_missing');
    try {
      // eslint-disable-next-line no-await-in-loop
      await pool.query(t.ddl);
      logger.info({ table: t.name }, 'db_compat_table_created');
    } catch (err) {
      logger.error({ err, table: t.name }, 'db_compat_table_create_failed');
      throw err;
    }
  }

  // Column upgrades for existing courses table.
  // Q&A toggle (default enabled). When disabled, student Q&A endpoints return 403.
  try {
    const qaExists = await columnExists({ pool, tableName: 'courses', columnName: 'qa_enabled' });
    if (!qaExists) {
      logger.warn({ table: 'courses', column: 'qa_enabled' }, 'db_compat_courses_upgrade');
      await pool.query("ALTER TABLE courses ADD COLUMN qa_enabled TINYINT(1) NOT NULL DEFAULT 1 AFTER language");
      logger.info({ table: 'courses', column: 'qa_enabled' }, 'db_compat_courses_column_added');
    }
  } catch (err) {
    logger.warn({ err }, 'db_compat_courses_upgrade_failed');
  }

  // Scheduled publish support.
  try {
    const publishAtExists = await columnExists({ pool, tableName: 'courses', columnName: 'publish_at' });
    if (!publishAtExists) {
      logger.warn({ table: 'courses', column: 'publish_at' }, 'db_compat_courses_upgrade');
      await pool.query('ALTER TABLE courses ADD COLUMN publish_at DATETIME NULL AFTER qa_enabled');
      logger.info({ table: 'courses', column: 'publish_at' }, 'db_compat_courses_column_added');
    }
  } catch (err) {
    logger.warn({ err }, 'db_compat_courses_publish_at_upgrade_failed');
  }
}

/**
 * Ensures analytics event tracking foundation exists.
 * This is a dev/staging bootstrap convenience only.
 */
export async function ensureAnalyticsTables({ pool }) {
  const tables = [
    {
      name: 'analytics_events',
      ddl: `CREATE TABLE IF NOT EXISTS analytics_events (
        id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
        user_id INT UNSIGNED NULL,
        event_type VARCHAR(80) NOT NULL,
        entity_type VARCHAR(40) NULL,
        entity_id BIGINT UNSIGNED NULL,
        metadata_json LONGTEXT NULL,
        created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
        PRIMARY KEY (id),
        KEY idx_analytics_events_created_at (created_at),
        KEY idx_analytics_events_event_type_created (event_type, created_at),
        KEY idx_analytics_events_user_created (user_id, created_at),
        KEY idx_analytics_events_entity (entity_type, entity_id, created_at),
        CONSTRAINT fk_analytics_events_user_id
          FOREIGN KEY (user_id) REFERENCES users(id)
          ON DELETE SET NULL ON UPDATE CASCADE
      ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`,
    },
  ];

  for (const t of tables) {
    // eslint-disable-next-line no-await-in-loop
    const exists = await tableExists({ pool, tableName: t.name });
    if (exists) continue;
    logger.warn({ table: t.name, db: env.DB_NAME }, 'db_compat_table_missing');
    try {
      // eslint-disable-next-line no-await-in-loop
      await pool.query(t.ddl);
      logger.info({ table: t.name }, 'db_compat_table_created');
    } catch (err) {
      logger.error({ err, table: t.name }, 'db_compat_table_create_failed');
      throw err;
    }
  }
}
