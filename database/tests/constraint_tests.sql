-- =============================================================================
-- FeedbackAI — tests/constraint_tests.sql
-- Executable constraint / trigger / procedure tests. Run ONLY through
-- database/tests/run_constraint_tests.sh, which targets feedback_ai_test_db,
-- empties it first (reset_test_db.sql) and cleans up afterwards.
--
-- Each check writes one row to t_results; the runner prints PASS/FAIL lines.
-- Expected MySQL error numbers: 1062 duplicate key, 1451 parent row is
-- referenced (RESTRICT), 1452 missing parent row, 3819 CHECK violated,
-- 1644 SIGNAL SQLSTATE '45000' (business rule).
-- =============================================================================

SELECT IF(DATABASE() = 'feedback_ai_test_db', 1, (SELECT 1 UNION ALL SELECT 2)) INTO @fa_guard;
SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET time_zone = '+00:00';
SET @app_actor_id = NULL;

CREATE TEMPORARY TABLE t_results (
  id      INT AUTO_INCREMENT PRIMARY KEY,
  label   VARCHAR(200) NOT NULL,
  passed  TINYINT      NOT NULL,
  detail  VARCHAR(300) NULL
);

DELIMITER $$

-- Runs p_sql and passes when it fails with one of the listed error numbers.
CREATE PROCEDURE t_expect_error(IN p_label VARCHAR(200), IN p_errnos VARCHAR(60), IN p_sql TEXT)
BEGIN
  DECLARE v_errno INT DEFAULT 0;
  DECLARE v_msg   VARCHAR(255) DEFAULT '';
  DECLARE v_e     INT;
  DECLARE v_m     VARCHAR(255);
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION
  BEGIN
    GET DIAGNOSTICS CONDITION 1 v_e = MYSQL_ERRNO, v_m = MESSAGE_TEXT;
    IF v_errno = 0 THEN SET v_errno = v_e, v_msg = v_m; END IF;
  END;
  SET @t_sql = p_sql;
  PREPARE t_stmt FROM @t_sql;
  EXECUTE t_stmt;
  DEALLOCATE PREPARE t_stmt;
  INSERT INTO t_results (label, passed, detail)
  VALUES (p_label,
          v_errno > 0 AND FIND_IN_SET(v_errno, p_errnos) > 0,
          IF(v_errno = 0, 'statement succeeded but should have failed',
             LEFT(CONCAT(v_errno, ' ', v_msg), 300)));
END $$

-- Runs p_sql and passes when it succeeds.
CREATE PROCEDURE t_expect_ok(IN p_label VARCHAR(200), IN p_sql TEXT)
BEGIN
  DECLARE v_errno INT DEFAULT 0;
  DECLARE v_msg   VARCHAR(255) DEFAULT '';
  DECLARE v_e     INT;
  DECLARE v_m     VARCHAR(255);
  DECLARE CONTINUE HANDLER FOR SQLEXCEPTION
  BEGIN
    GET DIAGNOSTICS CONDITION 1 v_e = MYSQL_ERRNO, v_m = MESSAGE_TEXT;
    IF v_errno = 0 THEN SET v_errno = v_e, v_msg = v_m; END IF;
  END;
  SET @t_sql = p_sql;
  PREPARE t_stmt FROM @t_sql;
  EXECUTE t_stmt;
  DEALLOCATE PREPARE t_stmt;
  INSERT INTO t_results (label, passed, detail)
  VALUES (p_label, v_errno = 0,
          IF(v_errno = 0, NULL, LEFT(CONCAT(v_errno, ' ', v_msg), 300)));
END $$

CREATE PROCEDURE t_assert(IN p_label VARCHAR(200), IN p_cond BOOLEAN, IN p_detail VARCHAR(300))
BEGIN
  INSERT INTO t_results (label, passed, detail) VALUES (p_label, COALESCE(p_cond, 0), p_detail);
END $$

DELIMITER ;

-- ---------------------------------------------------------------------------
-- Fixtures
-- ---------------------------------------------------------------------------
INSERT INTO categories (category_id, name, slug, display_order) VALUES
  (1, 'Test Electronics', 'test-electronics', 1),
  (2, 'Test Books',       'test-books',       2);

INSERT INTO products (product_id, category_id, name, slug, brand, description, price, is_active) VALUES
  (1, 1, 'Test Headphones', 'test-headphones', 'Acme',    'Over-ear test headphones.', 999.00, 1),
  (2, 1, 'Old Iron',        'old-iron',        'Acme',    'Discontinued test iron.',   499.00, 0),
  (3, 2, 'Test Novel',      'test-novel',      'Inkwell', 'A test novel.',             299.00, 1),
  (4, 2, 'Test Cookbook',   'test-cookbook',   'Inkwell', 'A test cookbook.',          549.00, 1),
  (5, 2, 'Test Thriller',   'test-thriller',   'Inkwell', 'A test thriller.',          349.00, 1);

INSERT INTO users (user_id, full_name, email, password_hash, role, status) VALUES
  (1, 'Test Admin',      'admin@constraint.test', REPEAT('h', 60), 'ADMIN',    'ACTIVE'),
  (2, 'Customer Two',    'two@constraint.test',   REPEAT('h', 60), 'CUSTOMER', 'ACTIVE'),
  (3, 'Customer Three',  'three@constraint.test', REPEAT('h', 60), 'CUSTOMER', 'ACTIVE'),
  (4, 'Customer Four',   'four@constraint.test',  REPEAT('h', 60), 'CUSTOMER', 'SUSPENDED');

INSERT INTO aspects (aspect_id, slug, display_name, category_id) VALUES
  (1, 'sound-quality', 'Sound quality', 1);

-- ---------------------------------------------------------------------------
-- Ratings: uniqueness, range, FK
-- ---------------------------------------------------------------------------
CALL t_expect_ok   ('ratings: valid rating inserts',
  'INSERT INTO ratings (rating_id, user_id, product_id, stars) VALUES (1, 2, 1, 4)');
CALL t_expect_ok   ('ratings: second valid rating (user 2, product 3)',
  'INSERT INTO ratings (rating_id, user_id, product_id, stars) VALUES (2, 2, 3, 5)');
CALL t_expect_error('ratings: duplicate (user, product) rejected', '1062',
  'INSERT INTO ratings (user_id, product_id, stars) VALUES (2, 1, 5)');
CALL t_expect_error('ratings: stars = 0 rejected', '3819',
  'INSERT INTO ratings (user_id, product_id, stars) VALUES (3, 1, 0)');
CALL t_expect_error('ratings: stars = 6 rejected', '3819',
  'INSERT INTO ratings (user_id, product_id, stars) VALUES (3, 1, 6)');
CALL t_expect_error('ratings: unknown product rejected (FK)', '1452',
  'INSERT INTO ratings (user_id, product_id, stars) VALUES (3, 999, 3)');

-- ---------------------------------------------------------------------------
-- Products: price CHECK
-- ---------------------------------------------------------------------------
CALL t_expect_error('products: price = 0 rejected', '3819',
  'INSERT INTO products (category_id, name, slug, brand, description, price) VALUES (1, "Free", "free", "Acme", "x", 0)');
CALL t_expect_error('products: negative price rejected', '3819',
  'INSERT INTO products (category_id, name, slug, brand, description, price) VALUES (1, "Neg", "neg", "Acme", "x", -5)');

-- ---------------------------------------------------------------------------
-- user_interactions: shape CHECK
-- ---------------------------------------------------------------------------
CALL t_expect_error('interactions: PRODUCT_VIEW without product rejected', '3819',
  'INSERT INTO user_interactions (user_id, interaction_type) VALUES (2, "PRODUCT_VIEW")');
CALL t_expect_error('interactions: SEARCH without query rejected', '3819',
  'INSERT INTO user_interactions (user_id, interaction_type) VALUES (2, "SEARCH")');
CALL t_expect_error('interactions: PRODUCT_VIEW carrying category_id rejected', '3819',
  'INSERT INTO user_interactions (user_id, interaction_type, product_id, category_id) VALUES (2, "PRODUCT_VIEW", 1, 1)');
CALL t_expect_error('interactions: CATEGORY_VIEW without category rejected', '3819',
  'INSERT INTO user_interactions (user_id, interaction_type) VALUES (2, "CATEGORY_VIEW")');
CALL t_expect_ok   ('interactions: valid PRODUCT_VIEW, CATEGORY_VIEW and SEARCH insert',
  'INSERT INTO user_interactions (user_id, interaction_type, product_id, category_id, search_query) VALUES (2, "PRODUCT_VIEW", 1, NULL, NULL), (2, "CATEGORY_VIEW", NULL, 1, NULL), (2, "SEARCH", NULL, NULL, "headphones"), (3, "PRODUCT_VIEW", 5, NULL, NULL)');

-- ---------------------------------------------------------------------------
-- Deletion rules (RESTRICT)
-- ---------------------------------------------------------------------------
-- Category 2 is referenced only by products (category 1 also has an aspect).
CALL t_expect_error('delete: category with products is RESTRICTed', '1451',
  'DELETE FROM categories WHERE category_id = 2');
CALL t_expect_error('delete: category with category-specific aspects is RESTRICTed', '1451',
  'DELETE FROM categories WHERE category_id = 1');
CALL t_expect_error('delete: product with ratings is RESTRICTed', '1451',
  'DELETE FROM products WHERE product_id = 1');
CALL t_expect_error('delete: product with interactions only is RESTRICTed', '1451',
  'DELETE FROM products WHERE product_id = 5');

-- ---------------------------------------------------------------------------
-- Feedback + analysis triggers
-- ---------------------------------------------------------------------------
CALL t_expect_ok   ('feedback: valid review inserts',
  'INSERT INTO feedback (feedback_id, rating_id, title, body) VALUES (1, 1, "Great", "Sound quality is great.")');
CALL t_assert('trigger: new feedback gets exactly one PENDING analysis row',
  (SELECT COUNT(*) = 1 AND MIN(status) = 'PENDING' FROM sentiment_analysis WHERE feedback_id = 1),
  (SELECT CONCAT(COUNT(*), ' row(s), status ', COALESCE(MIN(status), 'none')) FROM sentiment_analysis WHERE feedback_id = 1));
CALL t_expect_ok   ('ratings: rating for the short-body test inserts',
  'INSERT INTO ratings (rating_id, user_id, product_id, stars) VALUES (3, 3, 1, 3)');
CALL t_expect_error('feedback: body shorter than 10 characters rejected', '3819',
  'INSERT INTO feedback (rating_id, body) VALUES (3, "meh")');
CALL t_expect_error('feedback: second review for the same rating rejected', '1062',
  'INSERT INTO feedback (rating_id, body) VALUES (1, "Another review for one rating.")');
CALL t_expect_error('analysis: COMPLETED without label/scores rejected', '3819',
  'UPDATE sentiment_analysis SET status = "COMPLETED" WHERE feedback_id = 1');
CALL t_expect_ok   ('analysis: a complete COMPLETED result is accepted',
  'UPDATE sentiment_analysis SET status = "COMPLETED", label = "POSITIVE", score_positive = 0.9000, score_neutral = 0.0800, score_negative = 0.0200, model_name = "test-model", model_version = "test-1", text_sha256 = REPEAT("a", 64), attempt_count = 1, analyzed_at = UTC_TIMESTAMP() WHERE feedback_id = 1');
CALL t_expect_error('analysis: score above 1 rejected', '3819',
  'UPDATE sentiment_analysis SET score_neutral = 1.5 WHERE feedback_id = 1');
CALL t_expect_ok   ('aspects: aspect sentiment row inserts',
  'INSERT INTO aspect_sentiments (analysis_id, aspect_id, polarity, score, evidence) SELECT analysis_id, 1, "POSITIVE", 0.9100, "Sound quality is great" FROM sentiment_analysis WHERE feedback_id = 1');
CALL t_assert('view: confidence is derived from the stored label score',
  (SELECT confidence = 0.9000 AND sentiment_label = 'POSITIVE' FROM v_feedback_details WHERE feedback_id = 1),
  (SELECT CONCAT('confidence=', COALESCE(confidence, 'NULL')) FROM v_feedback_details WHERE feedback_id = 1));

-- Case-only edit must still invalidate the analysis (byte comparison).
UPDATE feedback SET body = 'SOUND quality is great.' WHERE feedback_id = 1;
CALL t_assert('trigger: case-only body edit resets analysis to PENDING',
  (SELECT status = 'PENDING' AND label IS NULL AND score_positive IS NULL AND attempt_count = 0
     FROM sentiment_analysis WHERE feedback_id = 1),
  (SELECT CONCAT('status=', status, ', label=', COALESCE(label, 'NULL')) FROM sentiment_analysis WHERE feedback_id = 1));
CALL t_assert('trigger: body edit deletes the stale aspect rows',
  (SELECT COUNT(*) = 0 FROM aspect_sentiments asp
     JOIN sentiment_analysis sa ON sa.analysis_id = asp.analysis_id WHERE sa.feedback_id = 1),
  NULL);

-- A title-only edit must NOT reset the analysis.
UPDATE sentiment_analysis
   SET status = 'COMPLETED', label = 'POSITIVE', score_positive = 0.9, score_neutral = 0.08,
       score_negative = 0.02, analyzed_at = UTC_TIMESTAMP()
 WHERE feedback_id = 1;
UPDATE feedback SET title = 'Great sound' WHERE feedback_id = 1;
CALL t_assert('trigger: title-only edit keeps the completed analysis',
  (SELECT status = 'COMPLETED' FROM sentiment_analysis WHERE feedback_id = 1), NULL);

-- Moderation status change is audited with the actor from @app_actor_id.
SET @app_actor_id = 1;
UPDATE feedback SET status = 'HIDDEN', moderated_by = 1, moderated_at = UTC_TIMESTAMP(),
                    moderation_note = 'off-topic' WHERE feedback_id = 1;
SET @app_actor_id = NULL;
CALL t_assert('trigger: status change writes an audit_log row with the actor',
  (SELECT COUNT(*) = 1 FROM audit_log
    WHERE actor_user_id = 1 AND action = 'FEEDBACK_STATUS_CHANGED' AND entity_type = 'feedback'
      AND entity_id = 1 AND details = 'PUBLISHED -> HIDDEN: off-topic'),
  (SELECT GROUP_CONCAT(details) FROM audit_log));

-- ---------------------------------------------------------------------------
-- Rating business-rule triggers
-- ---------------------------------------------------------------------------
CALL t_expect_error('trigger: rating an archived product rejected', '1644',
  'INSERT INTO ratings (user_id, product_id, stars) VALUES (3, 2, 4)');
CALL t_expect_error('trigger: rating by a suspended user rejected', '1644',
  'INSERT INTO ratings (user_id, product_id, stars) VALUES (4, 1, 4)');
UPDATE products SET is_active = 0 WHERE product_id = 3;
CALL t_expect_ok   ('trigger: no-op update of a rating on a now-archived product allowed',
  'UPDATE ratings SET stars = stars WHERE rating_id = 2');
CALL t_expect_error('trigger: changing stars on an archived product rejected', '1644',
  'UPDATE ratings SET stars = 2 WHERE rating_id = 2');
UPDATE products SET is_active = 1 WHERE product_id = 3;

-- ---------------------------------------------------------------------------
-- Last active administrator
-- ---------------------------------------------------------------------------
CALL t_expect_error('trigger: deleting the last active admin rejected', '1644',
  'DELETE FROM users WHERE user_id = 1');
CALL t_expect_error('trigger: demoting the last active admin rejected', '1644',
  'UPDATE users SET role = "CUSTOMER" WHERE user_id = 1');
CALL t_expect_error('trigger: suspending the last active admin rejected', '1644',
  'UPDATE users SET status = "SUSPENDED" WHERE user_id = 1');
CALL t_expect_ok   ('users: a second admin inserts',
  'INSERT INTO users (user_id, full_name, email, password_hash, role) VALUES (5, "Second Admin", "admin2@constraint.test", REPEAT("h", 60), "ADMIN")');
CALL t_expect_ok   ('trigger: an admin who is not the last one can be deleted',
  'DELETE FROM users WHERE user_id = 5');

-- ---------------------------------------------------------------------------
-- sp_submit_review: happy path, upsert, rollback
-- ---------------------------------------------------------------------------
SET @fid = NULL;
CALL t_expect_ok   ('sp_submit_review: happy path (new rating + review)',
  'CALL sp_submit_review(3, 4, 5, "Lovely", "A genuinely lovely cookbook, cooked from it all week.", @fid)');
CALL t_assert('sp_submit_review: returns the feedback id; rating and PENDING analysis exist',
  @fid IS NOT NULL
  AND (SELECT stars FROM ratings WHERE user_id = 3 AND product_id = 4) = 5
  AND (SELECT status FROM sentiment_analysis WHERE feedback_id = @fid) = 'PENDING',
  CONCAT('feedback_id=', COALESCE(@fid, 'NULL')));
SET @fid_first = @fid;
CALL t_expect_ok   ('sp_submit_review: second submit updates instead of duplicating',
  'CALL sp_submit_review(3, 4, 3, NULL, "Changed my mind, a few recipes did not work for me.", @fid)');
CALL t_assert('sp_submit_review: same feedback id, stars updated, one rating row',
  @fid = @fid_first
  AND (SELECT stars FROM ratings WHERE user_id = 3 AND product_id = 4) = 3
  AND (SELECT COUNT(*) FROM ratings WHERE user_id = 3 AND product_id = 4) = 1,
  CONCAT('first=', COALESCE(@fid_first, 'NULL'), ' second=', COALESCE(@fid, 'NULL')));
CALL t_expect_error('sp_submit_review: too-short body fails (CHECK 3819)', '3819',
  'CALL sp_submit_review(3, 5, 4, "t", "short", @fid2)');
CALL t_assert('sp_submit_review: failed submit rolled back the rating upsert',
  (SELECT COUNT(*) = 0 FROM ratings WHERE user_id = 3 AND product_id = 5), NULL);
CALL t_expect_error('sp_submit_review: archived product rejected', '1644',
  'CALL sp_submit_review(3, 2, 4, NULL, "Ten characters or more.", @fid2)');
CALL t_expect_error('sp_submit_review: suspended user rejected', '1644',
  'CALL sp_submit_review(4, 4, 4, NULL, "Ten characters or more.", @fid2)');
CALL t_expect_error('sp_submit_review: stars out of range rejected', '1644',
  'CALL sp_submit_review(3, 5, 9, NULL, "Ten characters or more.", @fid2)');
CALL t_expect_ok   ('sp_submit_review: rating-only submit (NULL body) allowed',
  'CALL sp_submit_review(3, 5, 4, NULL, NULL, @fid3)');
CALL t_assert('sp_submit_review: rating-only submit creates no feedback',
  @fid3 IS NULL AND (SELECT COUNT(*) FROM ratings WHERE user_id = 3 AND product_id = 5) = 1, NULL);

-- ---------------------------------------------------------------------------
-- Read procedures run (their result sets are ignored by the runner)
-- ---------------------------------------------------------------------------
CALL t_expect_ok   ('sp_products_above_threshold runs', 'CALL sp_products_above_threshold(1.00, 1)');
CALL t_expect_error('sp_products_above_threshold: invalid threshold rejected', '1644',
  'CALL sp_products_above_threshold(7.00, 1)');
CALL t_expect_ok   ('sp_category_sentiment runs',       'CALL sp_category_sentiment(NULL, NULL)');
CALL t_expect_error('sp_category_sentiment: reversed date range rejected', '1644',
  'CALL sp_category_sentiment("2026-02-01", "2026-01-01")');
CALL t_expect_ok   ('sp_top_reviewers runs',            'CALL sp_top_reviewers(5)');
CALL t_expect_ok   ('sp_monthly_trend runs',            'CALL sp_monthly_trend(12)');

-- ---------------------------------------------------------------------------
-- User deletion: cascades + the double path to user_interactions
--   user 2 -> ratings -> feedback -> sentiment_analysis -> aspect_sentiments
--   user 2 -> user_interactions (CASCADE)
--   user 2 -> recommendation_runs -> recommendations -> user_interactions.recommendation_id (SET NULL)
-- ---------------------------------------------------------------------------
INSERT INTO recommendation_runs (run_id, user_id, algorithm_version, strategy) VALUES (1, 2, 'cb-1.0', 'PERSONALIZED');
INSERT INTO recommendations (recommendation_id, run_id, product_id, rank_position, score, reason_code, reason_text)
VALUES (1, 1, 5, 1, 0.8123, 'SIMILAR_TO_RATED', 'Because you rated Test Novel 5 stars');
-- user 2 clicks their own recommendation (deleted via both paths) ...
INSERT INTO user_interactions (user_id, interaction_type, product_id, recommendation_id) VALUES (2, 'RECOMMENDATION_CLICK', 5, 1);
-- ... and an interaction of user 3 references it too (must survive with NULL).
INSERT INTO user_interactions (interaction_id, user_id, interaction_type, product_id, recommendation_id)
VALUES (900, 3, 'RECOMMENDATION_CLICK', 5, 1);

CALL t_expect_ok   ('delete: customer with ratings, review, interactions and recommendations deletes',
  'DELETE FROM users WHERE user_id = 2');
CALL t_assert('cascade: ratings, feedback and analysis of the deleted user are gone',
  (SELECT COUNT(*) FROM ratings WHERE user_id = 2) = 0
  AND (SELECT COUNT(*) FROM feedback WHERE feedback_id = 1) = 0
  AND (SELECT COUNT(*) FROM sentiment_analysis WHERE feedback_id = 1) = 0,
  NULL);
CALL t_assert('cascade: interactions, runs and recommendations of the deleted user are gone',
  (SELECT COUNT(*) FROM user_interactions WHERE user_id = 2) = 0
  AND (SELECT COUNT(*) FROM recommendation_runs WHERE user_id = 2) = 0
  AND (SELECT COUNT(*) FROM recommendations WHERE run_id = 1) = 0,
  NULL);
CALL t_assert('set null: another user''s click keeps its row with recommendation_id NULL',
  (SELECT COUNT(*) = 1 AND MAX(recommendation_id) IS NULL FROM user_interactions WHERE interaction_id = 900),
  NULL);
CALL t_assert('set null: audit rows keep their history (actor admin untouched)',
  (SELECT COUNT(*) = 1 FROM audit_log WHERE actor_user_id = 1), NULL);

-- ---------------------------------------------------------------------------
-- Every view selects without error
-- ---------------------------------------------------------------------------
CALL t_expect_ok('view selects: v_product_rating_stats',   'SELECT COUNT(*) INTO @n FROM v_product_rating_stats');
CALL t_expect_ok('view selects: v_feedback_details',       'SELECT COUNT(*) INTO @n FROM v_feedback_details');
CALL t_expect_ok('view selects: v_category_sentiment',     'SELECT COUNT(*) INTO @n FROM v_category_sentiment');
CALL t_expect_ok('view selects: v_monthly_feedback_trend', 'SELECT COUNT(*) INTO @n FROM v_monthly_feedback_trend');
CALL t_expect_ok('view selects: v_aspect_summary',         'SELECT COUNT(*) INTO @n FROM v_aspect_summary');
CALL t_expect_ok('view selects: v_product_performance',    'SELECT COUNT(*) INTO @n FROM v_product_performance');
CALL t_expect_ok('view selects: v_user_activity',          'SELECT COUNT(*) INTO @n FROM v_user_activity');

-- ---------------------------------------------------------------------------
-- Results
-- ---------------------------------------------------------------------------
SELECT CONCAT(IF(passed, 'PASS', 'FAIL'), ' | ', label, IF(detail IS NULL, '', CONCAT(' | ', detail)))
  FROM t_results ORDER BY id;
