-- =============================================================================
-- FeedbackAI — 04_triggers.sql
-- Six triggers. Remember: MySQL does NOT fire triggers for rows changed by FK
-- cascade actions (e.g. deleting a user cascades to ratings -> feedback ->
-- sentiment_analysis with no trigger running), so the API writes the audit
-- row for a user deletion itself (docs/00_DECISIONS.md §5a.20).
--
-- Note for seeders: INSERT ... ON DUPLICATE KEY UPDATE fires BEFORE INSERT for
-- every row, even when it ends up updating. trg_ratings_before_insert therefore
-- still rejects an upsert on an archived product / suspended user; the seeder
-- skips unchanged batches via seed_batches.content_sha256 and archives/suspends
-- only after ratings are inserted (§5a.15).
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;

DELIMITER $$

-- Every review gets exactly one PENDING analysis row (UNIQUE feedback_id), so
-- the analysis worker only ever UPDATEs.
DROP TRIGGER IF EXISTS trg_feedback_after_insert $$
CREATE TRIGGER trg_feedback_after_insert
AFTER INSERT ON feedback
FOR EACH ROW
BEGIN
  INSERT INTO sentiment_analysis (feedback_id, status)
  VALUES (NEW.feedback_id, 'PENDING');
END $$

-- Body edited -> stale analysis is reset to PENDING and its aspects removed.
-- Byte comparison because utf8mb4_0900_ai_ci treats 'great' = 'Great'.
-- Status changed -> audit row; @app_actor_id is set by the API in the same
-- transaction and reset afterwards (§5a.8).
DROP TRIGGER IF EXISTS trg_feedback_after_update $$
CREATE TRIGGER trg_feedback_after_update
AFTER UPDATE ON feedback
FOR EACH ROW
BEGIN
  IF CAST(NEW.body AS BINARY) <> CAST(OLD.body AS BINARY) THEN
    DELETE asp
      FROM aspect_sentiments asp
      JOIN sentiment_analysis sa ON sa.analysis_id = asp.analysis_id
     WHERE sa.feedback_id = NEW.feedback_id;

    INSERT INTO sentiment_analysis (feedback_id, status)
    VALUES (NEW.feedback_id, 'PENDING')
    ON DUPLICATE KEY UPDATE
      status            = 'PENDING',
      label             = NULL,
      score_positive    = NULL,
      score_neutral     = NULL,
      score_negative    = NULL,
      detected_language = NULL,
      model_name        = NULL,
      model_version     = NULL,
      text_sha256       = NULL,
      was_truncated     = 0,
      attempt_count     = 0,
      last_error        = NULL,
      analyzed_at       = NULL;
  END IF;

  IF NEW.status <> OLD.status THEN
    INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, details)
    VALUES (@app_actor_id, 'FEEDBACK_STATUS_CHANGED', 'feedback', NEW.feedback_id,
            LEFT(CONCAT(OLD.status, ' -> ', NEW.status,
                        COALESCE(CONCAT(': ', NEW.moderation_note), '')), 255));
  END IF;
END $$

-- No ratings on archived products or by suspended users.
DROP TRIGGER IF EXISTS trg_ratings_before_insert $$
CREATE TRIGGER trg_ratings_before_insert
BEFORE INSERT ON ratings
FOR EACH ROW
BEGIN
  DECLARE v_is_active TINYINT     DEFAULT NULL;
  DECLARE v_status    VARCHAR(10) DEFAULT NULL;

  -- Unknown ids leave the variables NULL; the FK constraint rejects them.
  SELECT is_active INTO v_is_active FROM products WHERE product_id = NEW.product_id;
  SELECT status    INTO v_status    FROM users    WHERE user_id    = NEW.user_id;

  IF v_is_active = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FA_PRODUCT_ARCHIVED: archived products cannot be rated';
  END IF;
  IF v_status = 'SUSPENDED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FA_USER_SUSPENDED: suspended users cannot rate products';
  END IF;
END $$

-- Same rule on update, but only when something that matters actually changes,
-- so a no-op upsert on a product archived later does not fail (§5a.22).
DROP TRIGGER IF EXISTS trg_ratings_before_update $$
CREATE TRIGGER trg_ratings_before_update
BEFORE UPDATE ON ratings
FOR EACH ROW
BEGIN
  DECLARE v_is_active TINYINT     DEFAULT NULL;
  DECLARE v_status    VARCHAR(10) DEFAULT NULL;

  IF NEW.stars <> OLD.stars OR NEW.product_id <> OLD.product_id OR NEW.user_id <> OLD.user_id THEN
    SELECT is_active INTO v_is_active FROM products WHERE product_id = NEW.product_id;
    SELECT status    INTO v_status    FROM users    WHERE user_id    = NEW.user_id;

    IF v_is_active = 0 THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FA_PRODUCT_ARCHIVED: archived products cannot be rated';
    END IF;
    IF v_status = 'SUSPENDED' THEN
      SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FA_USER_SUSPENDED: suspended users cannot rate products';
    END IF;
  END IF;
END $$

-- Keep at least one active administrator. (The admin API additionally locks
-- the active-admin rows FOR UPDATE to close the two-concurrent-deletes race.)
DROP TRIGGER IF EXISTS trg_users_before_delete $$
CREATE TRIGGER trg_users_before_delete
BEFORE DELETE ON users
FOR EACH ROW
BEGIN
  IF OLD.role = 'ADMIN' AND OLD.status = 'ACTIVE'
     AND NOT EXISTS (SELECT 1 FROM users
                      WHERE role = 'ADMIN' AND status = 'ACTIVE' AND user_id <> OLD.user_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FA_LAST_ADMIN: the last active administrator cannot be deleted';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_users_before_update $$
CREATE TRIGGER trg_users_before_update
BEFORE UPDATE ON users
FOR EACH ROW
BEGIN
  IF OLD.role = 'ADMIN' AND OLD.status = 'ACTIVE'
     AND (NEW.role <> 'ADMIN' OR NEW.status <> 'ACTIVE')
     AND NOT EXISTS (SELECT 1 FROM users
                      WHERE role = 'ADMIN' AND status = 'ACTIVE' AND user_id <> OLD.user_id) THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FA_LAST_ADMIN: the last active administrator cannot be demoted or suspended';
  END IF;
END $$

DELIMITER ;
