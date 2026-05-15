-- Non-breaking profile enhancement: add nullable phone field.
ALTER TABLE users
  ADD COLUMN phone VARCHAR(30) NULL AFTER email;

