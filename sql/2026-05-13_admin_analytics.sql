-- Admin analytics + event tracking foundation (2026-05-13)
-- Safe, additive changes only.

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

