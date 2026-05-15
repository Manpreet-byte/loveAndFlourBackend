-- Course completion + certificates migration (2026-05-13)
-- Safe, additive changes only.

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

