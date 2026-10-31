-- =============================================================================
-- FeedbackAI — tests/reset_test_db.sql
-- Empties every table of feedback_ai_test_db and drops the test helper
-- procedures. Used before and after the constraint tests. TRUNCATE does not
-- fire DELETE triggers, so the last-admin rule cannot block the cleanup.
-- =============================================================================

-- Abort unless connected to the test database: when the name differs, the
-- scalar subquery returns two rows and the client stops with ERROR 1242.
SELECT IF(DATABASE() = 'feedback_ai_test_db', 1, (SELECT 1 UNION ALL SELECT 2)) INTO @fa_guard;

SET FOREIGN_KEY_CHECKS = 0;
TRUNCATE TABLE audit_log;
TRUNCATE TABLE reports;
TRUNCATE TABLE user_interactions;
TRUNCATE TABLE recommendations;
TRUNCATE TABLE recommendation_runs;
TRUNCATE TABLE aspect_sentiments;
TRUNCATE TABLE sentiment_analysis;
TRUNCATE TABLE feedback;
TRUNCATE TABLE ratings;
TRUNCATE TABLE aspects;
TRUNCATE TABLE user_category_preferences;
TRUNCATE TABLE product_tags;
TRUNCATE TABLE products;
TRUNCATE TABLE tags;
TRUNCATE TABLE categories;
TRUNCATE TABLE users;
TRUNCATE TABLE seed_batches;
SET FOREIGN_KEY_CHECKS = 1;

DROP PROCEDURE IF EXISTS t_expect_error;
DROP PROCEDURE IF EXISTS t_expect_ok;
DROP PROCEDURE IF EXISTS t_assert;
DROP TEMPORARY TABLE IF EXISTS t_results;
