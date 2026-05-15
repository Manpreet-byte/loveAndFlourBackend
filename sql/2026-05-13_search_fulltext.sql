-- Search & discovery full-text indexes (2026-05-13)
-- Notes:
-- - Requires MySQL/InnoDB full-text support.
-- - If you use a different charset/collation, validate FULLTEXT behavior.

ALTER TABLE courses
  ADD FULLTEXT KEY ft_courses_title_summary_content (title, summary, content);

ALTER TABLE recipes
  ADD FULLTEXT KEY ft_recipes_title_summary_content (title, summary, content);

ALTER TABLE categories
  ADD FULLTEXT KEY ft_categories_name_description (name, description);

