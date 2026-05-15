-- Support/helpdesk + Q&A hardening (additive/incremental).

-- Extend Q&A schema to support richer status + pinned answers + admin reply marking.
ALTER TABLE course_questions
  MODIFY COLUMN status ENUM('open','answered','resolved','closed') NOT NULL DEFAULT 'open';

ALTER TABLE course_questions
  ADD COLUMN pinned_reply_id BIGINT UNSIGNED NULL AFTER is_pinned;

ALTER TABLE question_replies
  ADD COLUMN is_admin_reply TINYINT(1) NOT NULL DEFAULT 0 AFTER user_id;

CREATE TABLE IF NOT EXISTS question_votes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  question_id BIGINT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  vote ENUM('helpful') NOT NULL DEFAULT 'helpful',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uk_question_votes_question_user (question_id, user_id, vote),
  KEY idx_question_votes_question_created (question_id, created_at),
  CONSTRAINT fk_question_votes_question_id
    FOREIGN KEY (question_id) REFERENCES course_questions(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_question_votes_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Helpdesk / support tickets.
CREATE TABLE IF NOT EXISTS support_tickets (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  category ENUM('payment','access','technical','certificate','live_workshop','refund','other') NOT NULL DEFAULT 'other',
  subject VARCHAR(255) NOT NULL,
  status ENUM('open','pending','resolved','closed') NOT NULL DEFAULT 'open',
  priority ENUM('low','normal','high','urgent') NOT NULL DEFAULT 'normal',
  assigned_admin_id INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_support_tickets_user_created (user_id, created_at),
  KEY idx_support_tickets_status_updated (status, updated_at),
  KEY idx_support_tickets_category_status (category, status),
  KEY idx_support_tickets_assigned (assigned_admin_id, status),
  CONSTRAINT fk_support_tickets_user_id
    FOREIGN KEY (user_id) REFERENCES users(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_support_tickets_assigned_admin_id
    FOREIGN KEY (assigned_admin_id) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS support_messages (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  ticket_id BIGINT UNSIGNED NOT NULL,
  sender_type ENUM('user','admin','system') NOT NULL DEFAULT 'user',
  sender_id INT UNSIGNED NULL,
  message_text LONGTEXT NOT NULL,
  attachment_url VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_support_messages_ticket_created (ticket_id, created_at),
  KEY idx_support_messages_sender (sender_type, sender_id, created_at),
  CONSTRAINT fk_support_messages_ticket_id
    FOREIGN KEY (ticket_id) REFERENCES support_tickets(id)
    ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT fk_support_messages_sender_id
    FOREIGN KEY (sender_id) REFERENCES users(id)
    ON DELETE SET NULL ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

