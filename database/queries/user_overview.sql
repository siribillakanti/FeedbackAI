-- FeedbackAI: users, logins and activity.
-- Open in MySQL Workbench (File > Open SQL Script) and run one statement at a time
-- with Ctrl+Enter (Cmd+Return on a Mac), or all of them with Ctrl+Shift+Enter.
--
-- Every DATETIME is stored in UTC (docs/00_DECISIONS.md 5a.14); the *_ist columns add 5:30.
-- Only the most recent login is stored (users.last_login_at); there is no login history table.
-- Passwords are stored as bcrypt hashes only and cannot be read back.

USE feedback_ai_db;

-- 1. Every account and when it last logged in (most recent first; never-logged-in last).
SELECT u.user_id,
       u.full_name,
       u.email,
       u.role,
       u.status,
       u.last_login_at + INTERVAL 330 MINUTE AS last_login_ist,
       u.created_at    + INTERVAL 330 MINUTE AS created_ist,
       IF(u.seed_batch_id IS NULL, 'genuine', 'demo') AS source
  FROM users u
 ORDER BY u.last_login_at IS NULL, u.last_login_at DESC, u.user_id;

-- 2. One row per user with how much they have done.
SELECT u.user_id,
       u.full_name,
       u.role,
       u.status,
       u.last_login_at + INTERVAL 330 MINUTE AS last_login_ist,
       (SELECT COUNT(*) FROM ratings r WHERE r.user_id = u.user_id) AS ratings,
       (SELECT COUNT(*) FROM feedback f JOIN ratings r ON r.rating_id = f.rating_id
         WHERE r.user_id = u.user_id) AS written_reviews,
       (SELECT COUNT(*) FROM user_interactions ui
         WHERE ui.user_id = u.user_id AND ui.interaction_type = 'PRODUCT_VIEW') AS product_views,
       (SELECT COUNT(*) FROM user_interactions ui
         WHERE ui.user_id = u.user_id AND ui.interaction_type = 'SEARCH') AS searches,
       (SELECT GROUP_CONCAT(c.name ORDER BY c.display_order SEPARATOR ', ')
          FROM user_category_preferences ucp
          JOIN categories c ON c.category_id = ucp.category_id
         WHERE ucp.user_id = u.user_id) AS preferred_categories
  FROM users u
 ORDER BY ratings DESC, u.user_id;

-- 3. Accounts per role and status.
SELECT role, status, COUNT(*) AS accounts, SUM(last_login_at IS NOT NULL) AS have_logged_in
  FROM users
 GROUP BY role, status
 ORDER BY role, status;

-- 4. One user's full timeline: views, searches, ratings and reviews (change the email).
SELECT a.activity_type,
       a.product_name,
       a.category_name,
       a.detail,
       a.occurred_at + INTERVAL 330 MINUTE AS occurred_ist,
       IF(a.is_demo, 'demo', 'genuine') AS source
  FROM v_user_activity a
  JOIN users u ON u.user_id = a.user_id
 WHERE u.email = 'ananya.iyer@demo.feedbackai.test'
 ORDER BY a.occurred_at DESC
 LIMIT 100;

-- 5. Admin actions: review moderation (written by a trigger) and user deletions.
SELECT al.audit_id,
       al.created_at + INTERVAL 330 MINUTE AS at_ist,
       actor.email AS done_by,
       al.action,
       al.entity_type,
       al.entity_id,
       al.details
  FROM audit_log al
  LEFT JOIN users actor ON actor.user_id = al.actor_user_id
 ORDER BY al.created_at DESC, al.audit_id DESC;
