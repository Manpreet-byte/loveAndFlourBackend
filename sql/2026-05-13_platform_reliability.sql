-- Platform reliability foundations (additive).

CREATE TABLE IF NOT EXISTS feature_flags (
  flag_key VARCHAR(120) NOT NULL,
  is_enabled TINYINT(1) NOT NULL DEFAULT 0,
  payload_json JSON NULL,
  description VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (flag_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS system_alerts (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  severity ENUM('info','warning','critical') NOT NULL DEFAULT 'warning',
  title VARCHAR(255) NOT NULL,
  message TEXT NOT NULL,
  source VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  resolved_at DATETIME NULL,
  PRIMARY KEY (id),
  KEY idx_system_alerts_severity_created (severity, created_at),
  KEY idx_system_alerts_resolved (resolved_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS failed_jobs (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  job_type VARCHAR(120) NOT NULL,
  payload_json JSON NULL,
  status ENUM('failed','dead') NOT NULL DEFAULT 'failed',
  attempts INT UNSIGNED NOT NULL DEFAULT 0,
  last_error TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_failed_jobs_type_status (job_type, status, updated_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

