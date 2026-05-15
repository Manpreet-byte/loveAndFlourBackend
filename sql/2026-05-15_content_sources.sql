-- Track which content came from the live Love&Flour website import.

ALTER TABLE categories
  ADD COLUMN source VARCHAR(40) NOT NULL DEFAULT 'local' AFTER type,
  ADD COLUMN source_external_id BIGINT UNSIGNED NULL AFTER source,
  ADD KEY idx_categories_source (source),
  ADD KEY idx_categories_source_external_id (source_external_id);

ALTER TABLE courses
  ADD COLUMN source VARCHAR(40) NOT NULL DEFAULT 'local' AFTER kind,
  ADD COLUMN source_external_id BIGINT UNSIGNED NULL AFTER source,
  ADD KEY idx_courses_source (source),
  ADD KEY idx_courses_source_external_id (source_external_id);

ALTER TABLE recipes
  ADD COLUMN source VARCHAR(40) NOT NULL DEFAULT 'local' AFTER slug,
  ADD COLUMN source_external_id BIGINT UNSIGNED NULL AFTER source,
  ADD KEY idx_recipes_source (source),
  ADD KEY idx_recipes_source_external_id (source_external_id);

