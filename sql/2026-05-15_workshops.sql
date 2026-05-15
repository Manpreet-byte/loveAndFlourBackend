-- Add workshops as first-class content (implemented as a course "kind").

ALTER TABLE categories
  MODIFY COLUMN type ENUM('course','recipe','workshop') NOT NULL;

ALTER TABLE courses
  ADD COLUMN kind ENUM('course','workshop') NOT NULL DEFAULT 'course' AFTER slug,
  ADD KEY idx_courses_kind (kind);

