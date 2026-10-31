-- =============================================================================
-- FeedbackAI — 99_reset_dev.sql
-- Drops every FeedbackAI table, view, procedure and trigger in the CURRENT
-- database so 01–04 can rebuild it. Only invoked by `setup.sh --reset <db>`,
-- which refuses any database other than feedback_ai_db / feedback_ai_test_db.
-- Dropping a table also drops its triggers.
-- =============================================================================

DROP VIEW IF EXISTS v_user_activity, v_product_performance, v_aspect_summary,
                    v_monthly_feedback_trend, v_category_sentiment,
                    v_feedback_details, v_product_rating_stats;

DROP PROCEDURE IF EXISTS sp_submit_review;
DROP PROCEDURE IF EXISTS sp_products_above_threshold;
DROP PROCEDURE IF EXISTS sp_category_sentiment;
DROP PROCEDURE IF EXISTS sp_top_reviewers;
DROP PROCEDURE IF EXISTS sp_monthly_trend;

-- Children before parents (reverse of the creation order in 01_schema.sql).
DROP TABLE IF EXISTS audit_log;
DROP TABLE IF EXISTS reports;
DROP TABLE IF EXISTS user_interactions;
DROP TABLE IF EXISTS recommendations;
DROP TABLE IF EXISTS recommendation_runs;
DROP TABLE IF EXISTS aspect_sentiments;
DROP TABLE IF EXISTS sentiment_analysis;
DROP TABLE IF EXISTS feedback;
DROP TABLE IF EXISTS ratings;
DROP TABLE IF EXISTS aspects;
DROP TABLE IF EXISTS user_category_preferences;
DROP TABLE IF EXISTS product_tags;
DROP TABLE IF EXISTS products;
DROP TABLE IF EXISTS tags;
DROP TABLE IF EXISTS categories;
DROP TABLE IF EXISTS users;
DROP TABLE IF EXISTS seed_batches;
