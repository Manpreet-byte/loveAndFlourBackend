-- Multi-instructor / team management foundations (additive/incremental).

-- Expand roles
ALTER TABLE users
  MODIFY COLUMN role ENUM('super_admin','admin','instructor','support_agent','content_editor','user') NOT NULL DEFAULT 'user';

ALTER TABLE users
  ADD COLUMN instructor_bio TEXT NULL AFTER phone,
  ADD COLUMN instructor_avatar VARCHAR(1024) NULL AFTER instructor_bio,
  ADD COLUMN instructor_status ENUM('active','suspended') NOT NULL DEFAULT 'active' AFTER instructor_avatar,
  ADD COLUMN payout_preference JSON NULL AFTER instructor_status;

-- Course workflow status (keeps is_published for backward compatibility)
ALTER TABLE courses
  ADD COLUMN workflow_status ENUM('draft','under_review','approved','published','archived') NOT NULL DEFAULT 'draft' AFTER is_published,
  ADD COLUMN approved_at DATETIME NULL AFTER workflow_status,
  ADD COLUMN approved_by INT UNSIGNED NULL AFTER approved_at;

ALTER TABLE courses
  ADD KEY idx_courses_workflow_status (workflow_status),
  ADD KEY idx_courses_approved_by (approved_by),
  ADD CONSTRAINT fk_courses_approved_by
    FOREIGN KEY (approved_by) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE;

-- Instructors attached to courses (ownership + revenue split foundation)
CREATE TABLE IF NOT EXISTS course_instructors (
  course_id BIGINT UNSIGNED NOT NULL,
  instructor_id INT UNSIGNED NOT NULL,
  role ENUM('owner','co_instructor') NOT NULL DEFAULT 'co_instructor',
  commission_rate_bp INT UNSIGNED NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (course_id, instructor_id),
  KEY idx_course_instructors_instructor (instructor_id, course_id),
  CONSTRAINT fk_course_instructors_course_id
    FOREIGN KEY (course_id) REFERENCES courses(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_course_instructors_instructor_id
    FOREIGN KEY (instructor_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Course team collaboration (editor/moderator/viewer)
CREATE TABLE IF NOT EXISTS course_team_members (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  course_id BIGINT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  permission_role ENUM('course_owner','editor','moderator','viewer') NOT NULL DEFAULT 'viewer',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_course_team_members_course_user (course_id, user_id),
  KEY idx_course_team_members_course_role (course_id, permission_role),
  CONSTRAINT fk_course_team_members_course_id
    FOREIGN KEY (course_id) REFERENCES courses(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_course_team_members_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Review workflow notes
CREATE TABLE IF NOT EXISTS course_review_feedback (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  course_id BIGINT UNSIGNED NOT NULL,
  created_by INT UNSIGNED NOT NULL,
  status ENUM('comment','requested_changes','approved','rejected') NOT NULL DEFAULT 'comment',
  note_text LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_course_review_feedback_course_created (course_id, created_at),
  CONSTRAINT fk_course_review_feedback_course_id
    FOREIGN KEY (course_id) REFERENCES courses(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_course_review_feedback_created_by
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Earnings + payout foundation (no real payouts yet)
CREATE TABLE IF NOT EXISTS instructor_earnings (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  instructor_id INT UNSIGNED NOT NULL,
  course_id BIGINT UNSIGNED NOT NULL,
  order_id BIGINT UNSIGNED NOT NULL,
  gross_amount_cents INT UNSIGNED NOT NULL,
  commission_rate_bp INT UNSIGNED NOT NULL,
  payout_amount_cents INT UNSIGNED NOT NULL,
  payout_status ENUM('pending','available','paid') NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_instructor_earnings_instructor_created (instructor_id, created_at),
  KEY idx_instructor_earnings_payout_status (payout_status, created_at),
  CONSTRAINT fk_instructor_earnings_instructor_id
    FOREIGN KEY (instructor_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_instructor_earnings_course_id
    FOREIGN KEY (course_id) REFERENCES courses(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_instructor_earnings_order_id
    FOREIGN KEY (order_id) REFERENCES orders(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payout_records (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  instructor_id INT UNSIGNED NOT NULL,
  amount_cents INT UNSIGNED NOT NULL,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  status ENUM('draft','queued','paid','failed') NOT NULL DEFAULT 'draft',
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payout_records_instructor_created (instructor_id, created_at),
  CONSTRAINT fk_payout_records_instructor_id
    FOREIGN KEY (instructor_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Internal collaboration notes
CREATE TABLE IF NOT EXISTS internal_notes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  entity_type ENUM('course','lesson','order','user','ticket') NOT NULL,
  entity_id BIGINT UNSIGNED NOT NULL,
  created_by INT UNSIGNED NOT NULL,
  note_text LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_internal_notes_entity_created (entity_type, entity_id, created_at),
  CONSTRAINT fk_internal_notes_created_by
    FOREIGN KEY (created_by) REFERENCES users(id)
    ON DELETE RESTRICT ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

