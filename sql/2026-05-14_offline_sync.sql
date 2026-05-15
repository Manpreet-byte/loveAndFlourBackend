-- Offline learning sync foundations (additive).

CREATE TABLE IF NOT EXISTS offline_progress_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  client_event_id VARCHAR(64) NOT NULL,
  event_type ENUM('lesson_start','lesson_progress','lesson_complete') NOT NULL,
  lesson_id BIGINT UNSIGNED NOT NULL,
  payload_json JSON NULL,
  occurred_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_offline_progress_events_user_client (user_id, client_event_id),
  KEY idx_offline_progress_events_user_created (user_id, created_at),
  KEY idx_offline_progress_events_lesson_created (lesson_id, created_at),
  CONSTRAINT fk_offline_progress_events_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_offline_progress_events_lesson_id
    FOREIGN KEY (lesson_id) REFERENCES lessons(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS push_subscriptions (
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
  KEY idx_push_subscriptions_user (user_id, updated_at),
  CONSTRAINT fk_push_subscriptions_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

