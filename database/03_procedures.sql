-- =============================================================================
-- FeedbackAI — 03_procedures.sql
-- Five stored procedures, all SQL SECURITY INVOKER (they run with the caller's
-- privileges; feedbackai_app has EXECUTE plus DML on this database only).
-- Business-rule violations raise SIGNAL SQLSTATE '45000' with an FA_* code,
-- which the API maps to HTTP 422 (docs/00_DECISIONS.md §5a.6).
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;

DELIMITER $$

-- Atomic rating + review upsert. Owns its transaction: call it with NO
-- transaction open on the connection (a nested START TRANSACTION would
-- implicitly commit the caller's work). p_body NULL = rating only.
DROP PROCEDURE IF EXISTS sp_submit_review $$
CREATE PROCEDURE sp_submit_review(
  IN  p_user_id     INT UNSIGNED,
  IN  p_product_id  INT UNSIGNED,
  IN  p_stars       TINYINT,
  IN  p_title       VARCHAR(120),
  IN  p_body        TEXT,
  OUT p_feedback_id INT UNSIGNED
)
MODIFIES SQL DATA
SQL SECURITY INVOKER
BEGIN
  DECLARE v_user_status VARCHAR(10)  DEFAULT NULL;
  DECLARE v_is_active   TINYINT      DEFAULT NULL;
  DECLARE v_rating_id   INT UNSIGNED DEFAULT NULL;

  -- Any error (SIGNAL, CHECK 3819, duplicate 1062, deadlock 1213 ...) undoes
  -- the whole unit, then is re-raised to the caller unchanged.
  DECLARE EXIT HANDLER FOR SQLEXCEPTION
  BEGIN
    ROLLBACK;
    RESIGNAL;
  END;

  SET p_feedback_id = NULL;
  SET p_title = NULLIF(TRIM(p_title), '');
  SET p_body  = NULLIF(TRIM(p_body), '');

  IF p_stars IS NULL OR p_stars NOT BETWEEN 1 AND 5 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FA_INVALID_STARS: stars must be between 1 and 5';
  END IF;

  START TRANSACTION;

  -- FOR SHARE: a concurrent suspend/archive waits for this review (or vice versa).
  SELECT status INTO v_user_status
    FROM users WHERE user_id = p_user_id FOR SHARE;
  IF v_user_status IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FA_USER_NOT_FOUND: user does not exist';
  ELSEIF v_user_status = 'SUSPENDED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FA_USER_SUSPENDED: suspended users cannot submit reviews';
  END IF;

  SELECT is_active INTO v_is_active
    FROM products WHERE product_id = p_product_id FOR SHARE;
  IF v_is_active IS NULL THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FA_PRODUCT_NOT_FOUND: product does not exist';
  ELSEIF v_is_active = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FA_PRODUCT_ARCHIVED: archived products cannot be reviewed';
  END IF;

  -- One rating per (user, product): UNIQUE(user_id, product_id) makes the
  -- upsert race-free (two concurrent submits serialise on the unique key).
  INSERT INTO ratings (user_id, product_id, stars)
  VALUES (p_user_id, p_product_id, p_stars) AS new
  ON DUPLICATE KEY UPDATE stars = new.stars;

  SELECT rating_id INTO v_rating_id
    FROM ratings WHERE user_id = p_user_id AND product_id = p_product_id;

  IF p_body IS NOT NULL THEN
    -- Body length (10–4000) is left to chk_feedback_body on purpose: a
    -- violation raises 3819 and the handler rolls back the rating upsert too.
    INSERT INTO feedback (rating_id, title, body)
    VALUES (v_rating_id, p_title, p_body) AS new
    ON DUPLICATE KEY UPDATE title = new.title, body = new.body;
    -- trg_feedback_after_insert / _after_update create or reset the analysis row.

    SELECT feedback_id INTO p_feedback_id
      FROM feedback WHERE rating_id = v_rating_id;
  END IF;

  COMMIT;
END $$

-- Products whose average rating is at least p_min_avg with at least
-- p_min_reviews ratings (GROUP BY + HAVING with parameters).
DROP PROCEDURE IF EXISTS sp_products_above_threshold $$
CREATE PROCEDURE sp_products_above_threshold(
  IN p_min_avg     DECIMAL(3,2),
  IN p_min_reviews INT
)
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
  IF p_min_avg IS NULL OR p_min_avg NOT BETWEEN 1 AND 5 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FA_INVALID_THRESHOLD: min_avg must be between 1 and 5';
  END IF;
  IF p_min_reviews IS NULL OR p_min_reviews < 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FA_INVALID_THRESHOLD: min_reviews must be at least 1';
  END IF;

  SELECT p.product_id,
         p.name                 AS product_name,
         p.brand,
         c.name                 AS category_name,
         COUNT(r.rating_id)     AS rating_count,
         ROUND(AVG(r.stars), 2) AS avg_rating
  FROM products p
  JOIN categories c ON c.category_id = p.category_id
  JOIN ratings    r ON r.product_id  = p.product_id
  WHERE p.is_active = 1
  GROUP BY p.product_id, p.name, p.brand, c.name
  HAVING AVG(r.stars) >= p_min_avg
     AND COUNT(r.rating_id) >= p_min_reviews
  ORDER BY avg_rating DESC, rating_count DESC, product_name;
END $$

-- Category-wise sentiment distribution for an optional, inclusive date range.
DROP PROCEDURE IF EXISTS sp_category_sentiment $$
CREATE PROCEDURE sp_category_sentiment(
  IN p_from DATE,
  IN p_to   DATE
)
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
  IF p_from IS NOT NULL AND p_to IS NOT NULL AND p_from > p_to THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FA_INVALID_DATE_RANGE: date_from is after date_to';
  END IF;

  SELECT c.category_id,
         c.name                                                        AS category_name,
         COUNT(fd.feedback_id)                                         AS review_count,
         COALESCE(SUM(fd.analysis_status = 'COMPLETED'), 0)            AS analysed_count,
         COALESCE(SUM(fd.sentiment_label = 'POSITIVE'), 0)             AS positive_count,
         COALESCE(SUM(fd.sentiment_label = 'NEUTRAL'), 0)              AS neutral_count,
         COALESCE(SUM(fd.sentiment_label = 'NEGATIVE'), 0)             AS negative_count,
         COALESCE(SUM(fd.overall_sentiment = 'MIXED'), 0)              AS mixed_count,
         ROUND(100 * SUM(fd.sentiment_label = 'POSITIVE')
               / NULLIF(SUM(fd.analysis_status = 'COMPLETED'), 0), 1)  AS positive_pct,
         ROUND(100 * SUM(fd.sentiment_label = 'NEGATIVE')
               / NULLIF(SUM(fd.analysis_status = 'COMPLETED'), 0), 1)  AS negative_pct,
         ROUND(AVG(fd.stars), 2)                                       AS avg_rating_of_reviews
  FROM categories c
  LEFT JOIN v_feedback_details fd
         ON fd.category_id = c.category_id
        AND fd.feedback_status <> 'HIDDEN'
        AND (p_from IS NULL OR fd.created_at >= p_from)
        AND (p_to   IS NULL OR fd.created_at <  p_to + INTERVAL 1 DAY)
  GROUP BY c.category_id, c.name, c.display_order
  ORDER BY c.display_order, c.name;
END $$

-- Users with the most feedback submissions.
DROP PROCEDURE IF EXISTS sp_top_reviewers $$
CREATE PROCEDURE sp_top_reviewers(IN p_limit INT)
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FA_INVALID_LIMIT: limit must be between 1 and 100';
  END IF;

  SELECT u.user_id,
         u.full_name,
         COUNT(f.feedback_id)                         AS feedback_count,
         CAST(SUM(f.status = 'PUBLISHED') AS UNSIGNED) AS published_count,
         ROUND(AVG(r.stars), 2)                       AS avg_stars_given,
         MAX(f.created_at)                            AS last_feedback_at,
         (u.seed_batch_id IS NOT NULL)                AS is_demo
  FROM users u
  JOIN ratings  r ON r.user_id   = u.user_id
  JOIN feedback f ON f.rating_id = r.rating_id
  GROUP BY u.user_id, u.full_name, u.seed_batch_id
  ORDER BY feedback_count DESC, last_feedback_at DESC
  LIMIT p_limit;
END $$

-- Zero-filled monthly series for the last p_months UTC months (recursive CTE).
DROP PROCEDURE IF EXISTS sp_monthly_trend $$
CREATE PROCEDURE sp_monthly_trend(IN p_months INT)
READS SQL DATA
SQL SECURITY INVOKER
BEGIN
  DECLARE v_this_month DATE;
  DECLARE v_start      DATE;

  IF p_months IS NULL OR p_months NOT BETWEEN 1 AND 36 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FA_INVALID_MONTHS: months must be between 1 and 36';
  END IF;

  SET v_this_month = CURRENT_DATE - INTERVAL (DAYOFMONTH(CURRENT_DATE) - 1) DAY;
  SET v_start      = v_this_month - INTERVAL (p_months - 1) MONTH;

  WITH RECURSIVE months (month_start) AS (
    SELECT v_start
    UNION ALL
    SELECT month_start + INTERVAL 1 MONTH FROM months WHERE month_start < v_this_month
  )
  SELECT m.month_start,
         COUNT(fd.feedback_id)                              AS feedback_count,
         ROUND(AVG(fd.stars), 2)                            AS avg_rating,
         COALESCE(SUM(fd.sentiment_label = 'POSITIVE'), 0)  AS positive_count,
         COALESCE(SUM(fd.sentiment_label = 'NEUTRAL'), 0)   AS neutral_count,
         COALESCE(SUM(fd.sentiment_label = 'NEGATIVE'), 0)  AS negative_count,
         COALESCE(SUM(fd.overall_sentiment = 'MIXED'), 0)   AS mixed_count
  FROM months m
  LEFT JOIN v_feedback_details fd
         ON fd.created_at >= m.month_start
        AND fd.created_at <  m.month_start + INTERVAL 1 MONTH
        AND fd.feedback_status <> 'HIDDEN'
  GROUP BY m.month_start
  ORDER BY m.month_start;
END $$

DELIMITER ;
