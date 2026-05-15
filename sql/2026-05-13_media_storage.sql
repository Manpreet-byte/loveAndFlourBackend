-- Media storage migration (2026-05-13)
-- Safe, additive changes only.

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

-- Backward-compatible media references (keep legacy URL columns too)
ALTER TABLE courses
  ADD COLUMN featured_image_media_id BIGINT UNSIGNED NULL AFTER featured_image_url,
  ADD KEY idx_courses_featured_image_media_id (featured_image_media_id),
  ADD CONSTRAINT fk_courses_featured_image_media_id
    FOREIGN KEY (featured_image_media_id) REFERENCES media_files(id)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE recipes
  ADD COLUMN featured_image_media_id BIGINT UNSIGNED NULL AFTER featured_image_url,
  ADD KEY idx_recipes_featured_image_media_id (featured_image_media_id),
  ADD CONSTRAINT fk_recipes_featured_image_media_id
    FOREIGN KEY (featured_image_media_id) REFERENCES media_files(id)
    ON DELETE SET NULL ON UPDATE CASCADE;

ALTER TABLE lessons
  ADD COLUMN video_media_id BIGINT UNSIGNED NULL AFTER video_url,
  ADD COLUMN resource_media_id BIGINT UNSIGNED NULL AFTER resource_url,
  ADD KEY idx_lessons_video_media_id (video_media_id),
  ADD KEY idx_lessons_resource_media_id (resource_media_id),
  ADD CONSTRAINT fk_lessons_video_media_id
    FOREIGN KEY (video_media_id) REFERENCES media_files(id)
    ON DELETE SET NULL ON UPDATE CASCADE,
  ADD CONSTRAINT fk_lessons_resource_media_id
    FOREIGN KEY (resource_media_id) REFERENCES media_files(id)
    ON DELETE SET NULL ON UPDATE CASCADE;

