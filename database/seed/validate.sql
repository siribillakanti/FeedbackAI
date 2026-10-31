-- FeedbackAI seed validation (docs/05_SEED_DATA_STRATEGY.md §11).
-- Run after seeding (and again after analysis):
--   mysql -h127.0.0.1 -P3307 -u feedbackai_app -p feedback_ai_db < database/seed/validate.sql
-- Queries marked "expect 0 rows" are assertions; any row returned is a defect.

SET @b      := (SELECT seed_batch_id FROM seed_batches WHERE label = 'demo-v1');
SET @anchor := '2026-10-25 12:00:00';

-- V1. Row counts for the demo batch
SELECT 'users' AS entity, COUNT(*) AS n FROM users WHERE seed_batch_id = @b
UNION ALL SELECT 'products',     COUNT(*) FROM products          WHERE seed_batch_id = @b
UNION ALL SELECT 'ratings',      COUNT(*) FROM ratings           WHERE seed_batch_id = @b
UNION ALL SELECT 'feedback',     COUNT(*) FROM feedback          WHERE seed_batch_id = @b
UNION ALL SELECT 'interactions', COUNT(*) FROM user_interactions WHERE seed_batch_id = @b
UNION ALL SELECT 'preferences',  COUNT(*) FROM user_category_preferences ucp
                                  JOIN users u ON u.user_id = ucp.user_id WHERE u.seed_batch_id = @b
UNION ALL SELECT 'aspects',      COUNT(*) FROM aspects
UNION ALL SELECT 'audit_log',    COUNT(*) FROM audit_log;

-- V2. No duplicate ratings (expect 0 rows; UNIQUE(user_id, product_id) makes this a sanity check)
SELECT user_id, product_id, COUNT(*) AS n FROM ratings GROUP BY user_id, product_id HAVING COUNT(*) > 1;

-- V3. Identical review text (expect 0 rows)
SELECT LEFT(body, 60) AS body_start, COUNT(*) AS n FROM feedback WHERE seed_batch_id = @b
GROUP BY body HAVING COUNT(*) > 1;

-- V4. Every feedback row has exactly one analysis row (expect 0 rows)
SELECT f.feedback_id FROM feedback f
LEFT JOIN sentiment_analysis sa ON sa.feedback_id = f.feedback_id
WHERE sa.analysis_id IS NULL;

-- V5. Analysis status distribution (before analysis: all PENDING; after: ~all COMPLETED, 1 UNSUPPORTED)
SELECT status, COUNT(*) AS n FROM sentiment_analysis GROUP BY status;

-- V6. Activity before the user signed up (expect 0 rows from each)
SELECT r.rating_id FROM ratings r JOIN users u ON u.user_id = r.user_id WHERE r.created_at < u.created_at;
SELECT i.interaction_id FROM user_interactions i JOIN users u ON u.user_id = i.user_id WHERE i.occurred_at < u.created_at;

-- V7. Activity before the product launched (expect 0 rows from each)
SELECT r.rating_id FROM ratings r JOIN products p ON p.product_id = r.product_id WHERE r.created_at < p.created_at;
SELECT i.interaction_id FROM user_interactions i JOIN products p ON p.product_id = i.product_id WHERE i.occurred_at < p.created_at;

-- V8. Every seeded rating has a view by the same user 2-10 days earlier (expect 0 rows)
SELECT r.rating_id FROM ratings r
WHERE r.seed_batch_id = @b AND NOT EXISTS (
  SELECT 1 FROM user_interactions i
  WHERE i.user_id = r.user_id AND i.product_id = r.product_id AND i.interaction_type = 'PRODUCT_VIEW'
    AND i.occurred_at BETWEEN r.created_at - INTERVAL 10 DAY AND r.created_at - INTERVAL 2 DAY);

-- V9. Nothing dated after the anchor (expect 0 rows from each)
SELECT feedback_id FROM feedback WHERE seed_batch_id = @b AND GREATEST(created_at, updated_at) > @anchor;
SELECT rating_id FROM ratings WHERE seed_batch_id = @b AND GREATEST(created_at, updated_at) > @anchor;
SELECT interaction_id FROM user_interactions WHERE seed_batch_id = @b AND occurred_at > @anchor;

-- V10. Admins have no ratings (expect 0 rows)
SELECT r.rating_id FROM ratings r JOIN users u ON u.user_id = r.user_id WHERE u.role = 'ADMIN';

-- V11. Catalogue shape: 6 products per category
SELECT c.slug, COUNT(p.product_id) AS products FROM categories c
LEFT JOIN products p ON p.category_id = c.category_id GROUP BY c.slug ORDER BY c.slug;

-- V12. Star distribution, and stars vs model label once analysis has run
SELECT stars, COUNT(*) AS n FROM ratings WHERE seed_batch_id = @b GROUP BY stars ORDER BY stars;
SELECT r.stars, sa.label, COUNT(*) AS n FROM feedback f
JOIN ratings r ON r.rating_id = f.rating_id
JOIN sentiment_analysis sa ON sa.feedback_id = f.feedback_id
WHERE sa.status = 'COMPLETED' GROUP BY r.stars, sa.label ORDER BY r.stars, sa.label;

-- V13. Genuine rows: run before and after a reseed/reset; the numbers must not change
SELECT (SELECT COUNT(*) FROM users    WHERE seed_batch_id IS NULL) AS genuine_users,
       (SELECT COUNT(*) FROM ratings  WHERE seed_batch_id IS NULL) AS genuine_ratings,
       (SELECT COUNT(*) FROM feedback WHERE seed_batch_id IS NULL) AS genuine_feedback;

-- V14. Review created 0-3 minutes after its rating (expect 0 rows)
SELECT f.feedback_id FROM feedback f JOIN ratings r ON r.rating_id = f.rating_id
WHERE f.seed_batch_id = @b AND TIMESTAMPDIFF(SECOND, r.created_at, f.created_at) NOT BETWEEN 0 AND 180;

-- V15. Archived product: no ratings or views after it was archived (expect 0 rows)
SELECT p.slug, i.occurred_at FROM products p JOIN user_interactions i ON i.product_id = p.product_id
WHERE p.is_active = 0 AND i.occurred_at >= p.updated_at
UNION ALL
SELECT p.slug, r.created_at FROM products p JOIN ratings r ON r.product_id = p.product_id
WHERE p.is_active = 0 AND r.created_at >= p.updated_at;

-- V16. Suspended user: no activity after the suspension (expect 0 rows)
SELECT u.email, i.occurred_at FROM users u JOIN user_interactions i ON i.user_id = u.user_id
WHERE u.status = 'SUSPENDED' AND i.occurred_at >= u.updated_at;

-- V17. Moderation: 2 HIDDEN and 1 FLAGGED, each with an audit row written by the trigger
SELECT f.status, COUNT(*) AS n FROM feedback f WHERE f.seed_batch_id = @b AND f.status <> 'PUBLISHED' GROUP BY f.status;
SELECT a.action, a.entity_type, a.entity_id, u.email AS actor
FROM audit_log a LEFT JOIN users u ON u.user_id = a.actor_user_id
WHERE a.entity_type = 'feedback' ORDER BY a.audit_id;

-- V18. Cold-start users have no ratings; the true cold-start user has no activity at all
SELECT u.email,
       (SELECT COUNT(*) FROM ratings r WHERE r.user_id = u.user_id) AS ratings,
       (SELECT COUNT(*) FROM user_interactions i WHERE i.user_id = u.user_id) AS interactions,
       (SELECT COUNT(*) FROM user_category_preferences p WHERE p.user_id = u.user_id) AS preferences
FROM users u WHERE u.email IN ('kavya.nair@demo.feedbackai.test', 'zoya.ahmed@demo.feedbackai.test');
