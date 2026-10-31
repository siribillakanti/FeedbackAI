-- FeedbackAI: every table in feedback_ai_db, one result tab each.
-- In MySQL Workbench run the whole file with Ctrl+Shift+Enter (Cmd+Shift+Return on a Mac);
-- each SELECT opens its own result tab at the bottom of the editor.
-- DATETIME values are UTC. Workbench adds LIMIT 1000 to each query by default.

USE feedback_ai_db;

-- Accounts
SELECT * FROM users ORDER BY user_id;                                       -- customers and admins (passwords are bcrypt hashes)
SELECT * FROM user_category_preferences ORDER BY user_id, category_id;      -- categories each user chose

-- Catalogue
SELECT * FROM categories ORDER BY display_order;
SELECT * FROM products ORDER BY product_id;                                 -- is_active = 0 means archived
SELECT * FROM tags ORDER BY tag_id;
SELECT * FROM product_tags ORDER BY product_id, tag_id;                     -- which tags each product has

-- Ratings and reviews
SELECT * FROM ratings ORDER BY rating_id;                                   -- one star rating per user per product
SELECT * FROM feedback ORDER BY feedback_id;                                -- the written review attached to a rating

-- Sentiment analysis (filled in by the AI service, Phase 8)
SELECT * FROM sentiment_analysis ORDER BY analysis_id;                      -- one row per review; PENDING until analysed
SELECT * FROM aspects ORDER BY aspect_id;                                   -- features the analyser looks for
SELECT * FROM aspect_sentiments ORDER BY aspect_sentiment_id;               -- features found in each review

-- Behaviour and recommendations
SELECT * FROM user_interactions ORDER BY interaction_id;                    -- product views, category views, searches
SELECT * FROM recommendation_runs ORDER BY run_id;                          -- filled in by Phase 9
SELECT * FROM recommendations ORDER BY recommendation_id;

-- Admin
SELECT * FROM reports ORDER BY report_id;                                   -- filled in by Phase 10
SELECT * FROM audit_log ORDER BY audit_id;                                  -- moderation and admin actions
SELECT * FROM seed_batches;                                                 -- the demo data batch
