-- LMS core migration (2026-05-12)
-- Safe, additive changes only.

CREATE TABLE lessons (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  course_id BIGINT UNSIGNED NOT NULL,
  sequence INT UNSIGNED NOT NULL DEFAULT 1,
  lesson_type ENUM('video','text','resource') NOT NULL DEFAULT 'video',
  title VARCHAR(255) NOT NULL,
  summary TEXT NULL,
  content_html LONGTEXT NULL,
  video_url VARCHAR(2048) NULL,
  resource_url VARCHAR(2048) NULL,
  duration_seconds INT UNSIGNED NULL,
  is_published TINYINT(1) NOT NULL DEFAULT 0,
  published_at DATETIME NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_lessons_course_seq (course_id, sequence),
  KEY idx_lessons_course_published (course_id, is_published),
  CONSTRAINT fk_lessons_course_id
    FOREIGN KEY (course_id) REFERENCES courses(id)
    ON DELETE CASCADE ON UPDATE CASCADE
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

