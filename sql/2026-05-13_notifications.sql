-- Notification & automation engine (2026-05-13)
-- Safe, additive changes only.

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

