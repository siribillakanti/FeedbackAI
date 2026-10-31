-- FeedbackAI: the tables that store only ids, joined so they show names.
-- Names are stored once (users.full_name, products.name, categories.name, tags.name) and
-- every other table refers to them by id; that is normalisation (docs/03_DATABASE_DESIGN.md).
-- Run the whole file with Ctrl+Shift+Enter (Cmd+Shift+Return on a Mac); one result tab each.
-- DATETIME values are UTC.

USE feedback_ai_db;

-- 1. Ratings: who rated what.
SELECT r.rating_id,
       u.full_name AS customer,
       p.name      AS product,
       c.name      AS category,
       r.stars,
       r.created_at
  FROM ratings r
  JOIN users u      ON u.user_id = r.user_id
  JOIN products p   ON p.product_id = r.product_id
  JOIN categories c ON c.category_id = p.category_id
 ORDER BY r.rating_id;

-- 2. Written reviews with who wrote them, the product, the stars and the sentiment status.
SELECT f.feedback_id,
       u.full_name AS customer,
       p.name      AS product,
       r.stars,
       f.title,
       f.body,
       f.status    AS review_status,
       sa.status   AS analysis_status,
       sa.label    AS sentiment,
       f.created_at
  FROM feedback f
  JOIN ratings r   ON r.rating_id = f.rating_id
  JOIN users u     ON u.user_id = r.user_id
  JOIN products p  ON p.product_id = r.product_id
  LEFT JOIN sentiment_analysis sa ON sa.feedback_id = f.feedback_id
 ORDER BY f.feedback_id;

-- 3. Products with their category name and tags.
SELECT p.product_id,
       p.name,
       p.brand,
       c.name AS category,
       p.price,
       IF(p.is_active, 'active', 'archived') AS state,
       GROUP_CONCAT(t.name ORDER BY t.name SEPARATOR ', ') AS tags
  FROM products p
  JOIN categories c        ON c.category_id = p.category_id
  LEFT JOIN product_tags pt ON pt.product_id = p.product_id
  LEFT JOIN tags t          ON t.tag_id = pt.tag_id
 GROUP BY p.product_id, p.name, p.brand, c.name, p.price, p.is_active
 ORDER BY p.product_id;

-- 4. Preferred categories per user.
SELECT u.user_id,
       u.full_name AS customer,
       GROUP_CONCAT(c.name ORDER BY c.display_order SEPARATOR ', ') AS preferred_categories
  FROM user_category_preferences ucp
  JOIN users u      ON u.user_id = ucp.user_id
  JOIN categories c ON c.category_id = ucp.category_id
 GROUP BY u.user_id, u.full_name
 ORDER BY u.user_id;

-- 5. Views and searches: who looked at what.
SELECT ui.interaction_id,
       u.full_name AS customer,
       ui.interaction_type,
       p.name      AS product,
       c.name      AS category,
       ui.search_query,
       ui.occurred_at
  FROM user_interactions ui
  JOIN users u           ON u.user_id = ui.user_id
  LEFT JOIN products p   ON p.product_id = ui.product_id
  LEFT JOIN categories c ON c.category_id = COALESCE(ui.category_id, p.category_id)
 ORDER BY ui.occurred_at DESC, ui.interaction_id DESC;

-- 6. Audit log with the admin's name.
SELECT al.audit_id,
       actor.full_name AS done_by,
       al.action,
       al.entity_type,
       al.entity_id,
       al.details,
       al.created_at
  FROM audit_log al
  LEFT JOIN users actor ON actor.user_id = al.actor_user_id
 ORDER BY al.audit_id DESC;
