-- Audit logging + activity tracking (2026-05-13)
-- Safe, additive changes only. Append-only table (no update/delete APIs).

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

