CREATE TABLE users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(150) NOT NULL,
  email VARCHAR(254) NOT NULL,
  phone VARCHAR(30) NULL,
  password VARCHAR(255) NOT NULL,
  role ENUM('admin','user') NOT NULL DEFAULT 'user',
  email_verified_at DATETIME NULL,
  token_version INT UNSIGNED NOT NULL DEFAULT 0,
  password_changed_at DATETIME NULL,
  last_login_at DATETIME NULL,
  failed_login_count INT UNSIGNED NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;


CREATE TABLE categories (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  type ENUM('course','recipe','workshop') NOT NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'local',
  source_external_id BIGINT UNSIGNED NULL,
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(160) NOT NULL,
  description TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_categories_type_slug (type, slug),
  FULLTEXT KEY ft_categories_name_description (name, description),
  KEY idx_categories_type (type),
  KEY idx_categories_source (source),
  KEY idx_categories_source_external_id (source_external_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE courses (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(200) NOT NULL,
  kind ENUM('course','workshop') NOT NULL DEFAULT 'course',
  source VARCHAR(40) NOT NULL DEFAULT 'local',
  source_external_id BIGINT UNSIGNED NULL,
  summary TEXT NULL,
  content LONGTEXT NULL,
  featured_image_url VARCHAR(1024) NULL,
  featured_image_media_id BIGINT UNSIGNED NULL,
  level VARCHAR(60) NULL,
  language VARCHAR(60) NULL,
  qa_enabled TINYINT(1) NOT NULL DEFAULT 1,
  publish_at DATETIME NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  published_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_courses_slug (slug),
  FULLTEXT KEY ft_courses_title_summary_content (title, summary, content),
  KEY idx_courses_featured_image_media_id (featured_image_media_id),
  KEY idx_courses_kind (kind),
  KEY idx_courses_source (source),
  KEY idx_courses_source_external_id (source_external_id),
  KEY idx_courses_is_published (is_published),
  KEY idx_courses_published_at (published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE course_prices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  course_id BIGINT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  amount_cents INT UNSIGNED NOT NULL,
  compare_at_amount_cents INT UNSIGNED NULL,
  sale_amount_cents INT UNSIGNED NULL,
  sale_starts_at DATETIME NULL,
  sale_ends_at DATETIME NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  valid_from DATETIME NULL,
  valid_to DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_course_prices_course_id (course_id),
  KEY idx_course_prices_is_active (is_active),
  CONSTRAINT fk_course_prices_course_id
    FOREIGN KEY (course_id) REFERENCES courses(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE course_categories (
  course_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (course_id, category_id),
  KEY idx_course_categories_category_id (category_id),
  CONSTRAINT fk_course_categories_course_id
    FOREIGN KEY (course_id) REFERENCES courses(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_course_categories_category_id
    FOREIGN KEY (category_id) REFERENCES categories(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE recipes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(255) NOT NULL,
  slug VARCHAR(200) NOT NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'local',
  source_external_id BIGINT UNSIGNED NULL,
  summary TEXT NULL,
  content LONGTEXT NULL,
  featured_image_url VARCHAR(1024) NULL,
  featured_image_media_id BIGINT UNSIGNED NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  publish_at DATETIME NULL,
  published_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_recipes_slug (slug),
  FULLTEXT KEY ft_recipes_title_summary_content (title, summary, content),
  KEY idx_recipes_featured_image_media_id (featured_image_media_id),
  KEY idx_recipes_source (source),
  KEY idx_recipes_source_external_id (source_external_id),
  KEY idx_recipes_is_published (is_published),
  KEY idx_recipes_published_at (published_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE tags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tag_type ENUM('recipe') NOT NULL DEFAULT 'recipe',
  name VARCHAR(120) NOT NULL,
  slug VARCHAR(140) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_tags_type_slug (tag_type, slug),
  KEY idx_tags_type_name (tag_type, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE recipe_tags (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE recipe_categories (
  recipe_id BIGINT UNSIGNED NOT NULL,
  category_id BIGINT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (recipe_id, category_id),
  KEY idx_recipe_categories_category_id (category_id),
  CONSTRAINT fk_recipe_categories_recipe_id
    FOREIGN KEY (recipe_id) REFERENCES recipes(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_recipe_categories_category_id
    FOREIGN KEY (category_id) REFERENCES categories(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE enrollments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  course_id BIGINT UNSIGNED NOT NULL,
  enrolled_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expiry_date DATE NOT NULL,
  status ENUM('active','expired','cancelled') NOT NULL DEFAULT 'active',
  payment_reference VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_enrollments_user_id (user_id),
  KEY idx_enrollments_course_id (course_id),
  KEY idx_enrollments_expiry_date (expiry_date),
  KEY idx_enrollments_user_course (user_id, course_id),
  CONSTRAINT fk_enrollments_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_enrollments_course_id
    FOREIGN KEY (course_id) REFERENCES courses(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE live_sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  course_id BIGINT UNSIGNED NOT NULL,
  title VARCHAR(255) NULL,
  zoom_meeting_id VARCHAR(64) NULL,
  zoom_join_url VARCHAR(2048) NULL,
  scheduled_at DATETIME NOT NULL,
  status ENUM('upcoming','live','completed') NOT NULL DEFAULT 'upcoming',
  started_at DATETIME NULL,
  ended_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_live_sessions_course_id (course_id),
  KEY idx_live_sessions_scheduled_at (scheduled_at),
  KEY idx_live_sessions_status (status),
  CONSTRAINT fk_live_sessions_course_id
    FOREIGN KEY (course_id) REFERENCES courses(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE session_recordings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  live_session_id BIGINT UNSIGNED NOT NULL,
  course_id BIGINT UNSIGNED NOT NULL,
  recording_url VARCHAR(2048) NOT NULL,
  provider VARCHAR(60) NULL,
  recorded_at DATETIME NULL,
  duration_seconds INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_session_recordings_live_session_id (live_session_id),
  KEY idx_session_recordings_course_id (course_id),
  CONSTRAINT fk_session_recordings_live_session_id
    FOREIGN KEY (live_session_id) REFERENCES live_sessions(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_session_recordings_course_id
    FOREIGN KEY (course_id) REFERENCES courses(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE email_outbox (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE live_session_notification_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  live_session_id BIGINT UNSIGNED NOT NULL,
  notification_type ENUM('scheduled','updated','reminder_24h','reminder_1h','recording') NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_live_session_notification_once (live_session_id, notification_type),
  KEY idx_live_session_notification_live_session_id (live_session_id),
  CONSTRAINT fk_live_session_notification_live_session_id
    FOREIGN KEY (live_session_id) REFERENCES live_sessions(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Security tables
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

-- Payments / Orders
ALTER TABLE enrollments
  ADD UNIQUE KEY uk_enrollments_payment_reference_course (payment_reference, course_id);

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

CREATE TABLE payments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  order_id BIGINT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  provider ENUM('razorpay') NOT NULL,
  status ENUM('created','pending','authorized','captured','failed','refunded') NOT NULL DEFAULT 'created',
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
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE payment_provider_configs (
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

CREATE TABLE order_notification_log (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE webhook_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  provider ENUM('razorpay') NOT NULL,
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

-- Server-side cart foundation (optional)
CREATE TABLE carts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_carts_user (user_id),
  CONSTRAINT fk_carts_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE cart_items (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  cart_id BIGINT UNSIGNED NOT NULL,
  course_id BIGINT UNSIGNED NOT NULL,
  quantity INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_cart_items_cart_course (cart_id, course_id),
  KEY idx_cart_items_cart_id (cart_id),
  KEY idx_cart_items_course_id (course_id),
  CONSTRAINT fk_cart_items_cart_id
    FOREIGN KEY (cart_id) REFERENCES carts(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_cart_items_course_id
    FOREIGN KEY (course_id) REFERENCES courses(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CMS / Content Management
CREATE TABLE site_content (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE testimonials (
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
  KEY idx_testimonials_course (course_id),
  CONSTRAINT fk_testimonials_course
    FOREIGN KEY (course_id) REFERENCES courses(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE faqs (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE announcements (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE legal_pages (
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
  KEY idx_legal_pages_status (status),
  CONSTRAINT fk_legal_pages_updated_by
    FOREIGN KEY (updated_by) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE seo_meta (
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
  UNIQUE KEY uk_seo_meta_page (page_key),
  CONSTRAINT fk_seo_meta_updated_by
    FOREIGN KEY (updated_by) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE student_gallery (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE newsletter_subscribers (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(254) NOT NULL,
  status ENUM('subscribed','unsubscribed') NOT NULL DEFAULT 'subscribed',
  subscribed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_newsletter_email (email),
  KEY idx_newsletter_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Communications, community & engagement
CREATE TABLE user_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  notification_type VARCHAR(60) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  link_url VARCHAR(255) NULL,
  metadata_json LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  read_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_user_notifications_user_created (user_id, created_at),
  KEY idx_user_notifications_user_read (user_id, read_at),
  CONSTRAINT fk_user_notifications_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_preferences (
  user_id INT UNSIGNED NOT NULL,
  marketing_emails TINYINT(1) NOT NULL DEFAULT 1,
  product_updates TINYINT(1) NOT NULL DEFAULT 1,
  workshop_reminders TINYINT(1) NOT NULL DEFAULT 1,
  whatsapp_opt_in TINYINT(1) NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_user_preferences_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE course_questions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  course_id BIGINT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  lesson_id BIGINT UNSIGNED NULL,
  title VARCHAR(255) NOT NULL,
  body_html LONGTEXT NOT NULL,
  status ENUM('open','resolved') NOT NULL DEFAULT 'open',
  is_pinned TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_course_questions_course_updated (course_id, updated_at),
  KEY idx_course_questions_course_status (course_id, status),
  KEY idx_course_questions_user (user_id, created_at),
  CONSTRAINT fk_course_questions_course_id
    FOREIGN KEY (course_id) REFERENCES courses(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_course_questions_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_course_questions_lesson_id
    FOREIGN KEY (lesson_id) REFERENCES lessons(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE question_replies (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  question_id BIGINT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  body_html LONGTEXT NOT NULL,
  is_pinned TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_question_replies_question_created (question_id, created_at),
  KEY idx_question_replies_user (user_id, created_at),
  CONSTRAINT fk_question_replies_question_id
    FOREIGN KEY (question_id) REFERENCES course_questions(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_question_replies_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE lesson_comments (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  lesson_id BIGINT UNSIGNED NOT NULL,
  course_id BIGINT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  body_html LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lesson_comments_lesson_created (lesson_id, created_at),
  KEY idx_lesson_comments_course_created (course_id, created_at),
  KEY idx_lesson_comments_user (user_id, created_at),
  CONSTRAINT fk_lesson_comments_lesson_id
    FOREIGN KEY (lesson_id) REFERENCES lessons(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_lesson_comments_course_id
    FOREIGN KEY (course_id) REFERENCES courses(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_lesson_comments_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE moderation_flags (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type ENUM('question','reply','comment') NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  flagged_by INT UNSIGNED NOT NULL,
  reason VARCHAR(255) NULL,
  status ENUM('open','reviewed','dismissed') NOT NULL DEFAULT 'open',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at DATETIME NULL,
  reviewed_by INT UNSIGNED NULL,
  PRIMARY KEY (id),
  KEY idx_moderation_flags_status_created (status, created_at),
  KEY idx_moderation_flags_entity (entity_type, entity_id),
  CONSTRAINT fk_moderation_flags_flagged_by
    FOREIGN KEY (flagged_by) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_moderation_flags_reviewed_by
    FOREIGN KEY (reviewed_by) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE email_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NULL,
  email_to VARCHAR(254) NOT NULL,
  template_key VARCHAR(120) NULL,
  subject VARCHAR(255) NULL,
  status ENUM('queued','sent','failed') NOT NULL DEFAULT 'queued',
  provider_message_id VARCHAR(255) NULL,
  last_error VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_email_logs_status_created (status, created_at),
  KEY idx_email_logs_user_created (user_id, created_at),
  CONSTRAINT fk_email_logs_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE broadcasts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  created_by INT UNSIGNED NOT NULL,
  subject VARCHAR(255) NOT NULL,
  body_html LONGTEXT NULL,
  body_text LONGTEXT NULL,
  audience_json JSON NULL,
  status ENUM('draft','scheduled','sent') NOT NULL DEFAULT 'draft',
  scheduled_at DATETIME NULL,
  sent_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_broadcasts_status_scheduled (status, scheduled_at),
  CONSTRAINT fk_broadcasts_created_by
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- LMS core
CREATE TABLE lessons (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  course_id BIGINT UNSIGNED NOT NULL,
  sequence INT UNSIGNED NOT NULL DEFAULT 1,
  lesson_type ENUM('video','text','resource') NOT NULL DEFAULT 'video',
  title VARCHAR(255) NOT NULL,
  summary TEXT NULL,
  content_html LONGTEXT NULL,
  video_url VARCHAR(2048) NULL,
  video_media_id BIGINT UNSIGNED NULL,
  resource_url VARCHAR(2048) NULL,
  resource_media_id BIGINT UNSIGNED NULL,
  duration_seconds INT UNSIGNED NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  published_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lessons_course_seq (course_id, sequence),
  KEY idx_lessons_course_published (course_id, is_published),
  KEY idx_lessons_video_media_id (video_media_id),
  KEY idx_lessons_resource_media_id (resource_media_id),
  CONSTRAINT fk_lessons_course_id
    FOREIGN KEY (course_id) REFERENCES courses(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE media_files (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  uploaded_by INT UNSIGNED NOT NULL,
  file_name VARCHAR(255) NOT NULL,
  original_file_name VARCHAR(255) NULL,
  file_type ENUM('image','pdf','video','other') NOT NULL,
  mime_type VARCHAR(120) NOT NULL,
  size_bytes BIGINT UNSIGNED NOT NULL,
  sha256 BINARY(32) NOT NULL,
  storage_provider ENUM('local','s3','r2') NOT NULL DEFAULT 'local',
  storage_path VARCHAR(1024) NOT NULL,
  public_url VARCHAR(2048) NULL,
  is_public TINYINT(1) NOT NULL DEFAULT 0,
  status ENUM('uploaded','deleted') NOT NULL DEFAULT 'uploaded',
  deleted_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_media_files_uploaded_by (uploaded_by),
  KEY idx_media_files_file_type (file_type),
  KEY idx_media_files_created_at (created_at),
  UNIQUE KEY uk_media_files_sha256_path (sha256, storage_path),
  CONSTRAINT fk_media_files_uploaded_by
    FOREIGN KEY (uploaded_by) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE courses
  ADD CONSTRAINT fk_courses_featured_image_media_id
    FOREIGN KEY (featured_image_media_id) REFERENCES media_files(id)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE recipes
  ADD CONSTRAINT fk_recipes_featured_image_media_id
    FOREIGN KEY (featured_image_media_id) REFERENCES media_files(id)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE lessons
  ADD CONSTRAINT fk_lessons_video_media_id
    FOREIGN KEY (video_media_id) REFERENCES media_files(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_lessons_resource_media_id
    FOREIGN KEY (resource_media_id) REFERENCES media_files(id)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Course completion + certificates
CREATE TABLE user_course_completions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  course_id BIGINT UNSIGNED NOT NULL,
  completed_at DATETIME NOT NULL,
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE certificates (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Notification & automation engine
CREATE TABLE notification_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  event_id CHAR(64) NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  payload_json LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  processed_at DATETIME NULL,
  status ENUM('received','processed','failed') NOT NULL DEFAULT 'received',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  last_error VARCHAR(255) NULL,
  next_attempt_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_notification_events_event_id (event_id),
  KEY idx_notification_events_status_created (status, created_at),
  KEY idx_notification_events_next_attempt (next_attempt_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NULL,
  type ENUM('email','whatsapp','push','in_app') NOT NULL,
  event_type VARCHAR(80) NOT NULL,
  event_id CHAR(64) NOT NULL,
  title VARCHAR(255) NOT NULL,
  message LONGTEXT NOT NULL,
  status ENUM('pending','sent','failed') NOT NULL DEFAULT 'pending',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  last_error VARCHAR(255) NULL,
  metadata_json LONGTEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  sent_at DATETIME NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_notifications_event_type_user (event_id, type, user_id),
  KEY idx_notifications_user_id (user_id),
  KEY idx_notifications_type_status (type, status, created_at),
  KEY idx_notifications_event_type (event_type),
  CONSTRAINT fk_notifications_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Admin analytics + event tracking foundation
CREATE TABLE analytics_events (
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
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Audit logging + activity tracking
CREATE TABLE audit_logs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_type ENUM('user','admin','system') NOT NULL,
  actor_id INT UNSIGNED NULL,
  action_type VARCHAR(40) NOT NULL,
  entity_type VARCHAR(40) NULL,
  entity_id BIGINT UNSIGNED NULL,
  metadata_json LONGTEXT NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  method VARCHAR(10) NULL,
  path VARCHAR(255) NULL,
  status_code INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_logs_created_at (created_at),
  KEY idx_audit_logs_actor_created (actor_type, actor_id, created_at),
  KEY idx_audit_logs_entity_created (entity_type, entity_id, created_at),
  KEY idx_audit_logs_action_created (action_type, created_at),
  CONSTRAINT fk_audit_logs_actor_id
    FOREIGN KEY (actor_id) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE user_lesson_progress (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  course_id BIGINT UNSIGNED NOT NULL,
  lesson_id BIGINT UNSIGNED NOT NULL,
  started_at DATETIME NULL,
  completed_at DATETIME NULL,
  progress_percentage INT UNSIGNED NOT NULL DEFAULT 0,
  last_position_seconds INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_user_lesson_progress_user_lesson (user_id, lesson_id),
  KEY idx_user_lesson_progress_user_course (user_id, course_id),
  KEY idx_user_lesson_progress_course_user (course_id, user_id),
  KEY idx_user_lesson_progress_completed (user_id, course_id, completed_at),
  CONSTRAINT fk_user_lesson_progress_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_user_lesson_progress_course_id
    FOREIGN KEY (course_id) REFERENCES courses(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_user_lesson_progress_lesson_id
    FOREIGN KEY (lesson_id) REFERENCES lessons(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
