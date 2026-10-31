-- =============================================================================
-- FeedbackAI — 02_views.sql
-- Derived data lives here instead of in stored columns: average and Bayesian
-- ratings, confidence, MIXED sentiment, activity history.
-- All views are SQL SECURITY INVOKER (they run with the caller's privileges,
-- not root's) and ONLY_FULL_GROUP_BY safe. Order matters: later views read
-- v_product_rating_stats and v_feedback_details.
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;

-- Per-product rating summary. Bayesian average: (C*m + sum) / (C + n), C = 5,
-- m = global mean, so a single 5-star rating cannot outrank forty 4.7s.
CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_product_rating_stats AS
SELECT
  p.product_id,
  p.name                                   AS product_name,
  p.category_id,
  p.is_active,
  COALESCE(rs.rating_count, 0)             AS rating_count,
  ROUND(rs.avg_rating, 2)                  AS avg_rating,
  ROUND((5 * g.global_mean + COALESCE(rs.sum_stars, 0))
        / (5 + COALESCE(rs.rating_count, 0)), 3) AS bayes_rating,
  COALESCE(rs.stars_1, 0) AS stars_1,
  COALESCE(rs.stars_2, 0) AS stars_2,
  COALESCE(rs.stars_3, 0) AS stars_3,
  COALESCE(rs.stars_4, 0) AS stars_4,
  COALESCE(rs.stars_5, 0) AS stars_5
FROM products p
CROSS JOIN (SELECT AVG(stars) AS global_mean FROM ratings) g
LEFT JOIN (
  SELECT product_id,
         COUNT(*)                         AS rating_count,
         SUM(stars)                       AS sum_stars,
         AVG(stars)                       AS avg_rating,
         CAST(SUM(stars = 1) AS UNSIGNED) AS stars_1,
         CAST(SUM(stars = 2) AS UNSIGNED) AS stars_2,
         CAST(SUM(stars = 3) AS UNSIGNED) AS stars_3,
         CAST(SUM(stars = 4) AS UNSIGNED) AS stars_4,
         CAST(SUM(stars = 5) AS UNSIGNED) AS stars_5
  FROM ratings
  GROUP BY product_id
) rs ON rs.product_id = p.product_id;

-- One row per written review with rating, user, product, category and the
-- current analysis. confidence = probability of the stored label (derived).
-- overall_sentiment adds MIXED = at least one positive and one negative aspect.
CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_feedback_details AS
SELECT
  f.feedback_id,
  f.rating_id,
  r.user_id,
  u.full_name                AS user_name,
  r.product_id,
  p.name                     AS product_name,
  p.brand,
  p.category_id,
  c.name                     AS category_name,
  c.slug                     AS category_slug,
  r.stars,
  f.title,
  f.body,
  f.status                   AS feedback_status,
  f.created_at,
  f.updated_at,
  sa.analysis_id,
  sa.status                  AS analysis_status,
  CASE WHEN sa.status = 'COMPLETED' THEN sa.label END AS sentiment_label,
  CASE WHEN sa.status = 'COMPLETED' THEN
    CASE sa.label
      WHEN 'POSITIVE' THEN sa.score_positive
      WHEN 'NEUTRAL'  THEN sa.score_neutral
      WHEN 'NEGATIVE' THEN sa.score_negative
    END
  END                        AS confidence,
  sa.score_positive,
  sa.score_neutral,
  sa.score_negative,
  sa.detected_language,
  sa.model_version,
  sa.analyzed_at,
  (COALESCE(ap.pos_aspects, 0) > 0 AND COALESCE(ap.neg_aspects, 0) > 0) AS is_mixed,
  CASE
    WHEN sa.status IS NULL OR sa.status <> 'COMPLETED' THEN NULL
    WHEN COALESCE(ap.pos_aspects, 0) > 0 AND COALESCE(ap.neg_aspects, 0) > 0 THEN 'MIXED'
    ELSE sa.label
  END                        AS overall_sentiment,
  (f.seed_batch_id IS NOT NULL) AS is_demo
FROM feedback f
JOIN ratings    r  ON r.rating_id   = f.rating_id
JOIN users      u  ON u.user_id     = r.user_id
JOIN products   p  ON p.product_id  = r.product_id
JOIN categories c  ON c.category_id = p.category_id
LEFT JOIN sentiment_analysis sa ON sa.feedback_id = f.feedback_id
LEFT JOIN (
  SELECT analysis_id,
         SUM(polarity = 'POSITIVE') AS pos_aspects,
         SUM(polarity = 'NEGATIVE') AS neg_aspects
  FROM aspect_sentiments
  GROUP BY analysis_id
) ap ON ap.analysis_id = sa.analysis_id;

-- Category-wise satisfaction: ratings (all) + sentiment of visible reviews.
-- Percentages are of analysed reviews; MIXED is an overlay, not a fourth slice.
CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_category_sentiment AS
SELECT
  c.category_id,
  c.name                                   AS category_name,
  c.display_order,
  COALESCE(rt.rating_count, 0)             AS rating_count,
  ROUND(rt.avg_rating, 2)                  AS avg_rating,
  COALESCE(fs.review_count, 0)             AS review_count,
  COALESCE(fs.analysed_count, 0)           AS analysed_count,
  COALESCE(fs.positive_count, 0)           AS positive_count,
  COALESCE(fs.neutral_count, 0)            AS neutral_count,
  COALESCE(fs.negative_count, 0)           AS negative_count,
  COALESCE(fs.mixed_count, 0)              AS mixed_count,
  ROUND(100 * fs.positive_count / NULLIF(fs.analysed_count, 0), 1) AS positive_pct,
  ROUND(100 * fs.neutral_count  / NULLIF(fs.analysed_count, 0), 1) AS neutral_pct,
  ROUND(100 * fs.negative_count / NULLIF(fs.analysed_count, 0), 1) AS negative_pct
FROM categories c
LEFT JOIN (
  SELECT p.category_id, COUNT(*) AS rating_count, AVG(r.stars) AS avg_rating
  FROM ratings r
  JOIN products p ON p.product_id = r.product_id
  GROUP BY p.category_id
) rt ON rt.category_id = c.category_id
LEFT JOIN (
  SELECT category_id,
         COUNT(*)                                             AS review_count,
         CAST(SUM(analysis_status = 'COMPLETED') AS UNSIGNED) AS analysed_count,
         CAST(SUM(sentiment_label = 'POSITIVE')  AS UNSIGNED) AS positive_count,
         CAST(SUM(sentiment_label = 'NEUTRAL')   AS UNSIGNED) AS neutral_count,
         CAST(SUM(sentiment_label = 'NEGATIVE')  AS UNSIGNED) AS negative_count,
         CAST(SUM(overall_sentiment = 'MIXED')   AS UNSIGNED) AS mixed_count
  FROM v_feedback_details
  WHERE feedback_status <> 'HIDDEN'
  GROUP BY category_id
) fs ON fs.category_id = c.category_id;

-- Feedback volume per UTC month (months with feedback only; sp_monthly_trend
-- zero-fills a continuous axis).
CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_monthly_feedback_trend AS
SELECT
  CAST(DATE_FORMAT(created_at, '%Y-%m-01') AS DATE)    AS month_start,
  COUNT(*)                                              AS feedback_count,
  ROUND(AVG(stars), 2)                                  AS avg_rating,
  CAST(SUM(sentiment_label = 'POSITIVE') AS UNSIGNED)   AS positive_count,
  CAST(SUM(sentiment_label = 'NEUTRAL')  AS UNSIGNED)   AS neutral_count,
  CAST(SUM(sentiment_label = 'NEGATIVE') AS UNSIGNED)   AS negative_count,
  CAST(SUM(overall_sentiment = 'MIXED')  AS UNSIGNED)   AS mixed_count,
  CAST(SUM(is_demo) AS UNSIGNED)                        AS demo_count
FROM v_feedback_details
WHERE feedback_status <> 'HIDDEN'
GROUP BY month_start;

-- Appreciated features and common complaints, per aspect and category.
CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_aspect_summary AS
SELECT
  a.aspect_id,
  a.slug                                           AS aspect_slug,
  a.display_name                                   AS aspect_name,
  c.category_id,
  c.name                                           AS category_name,
  COUNT(*)                                         AS mention_count,
  CAST(SUM(asp.polarity = 'POSITIVE') AS UNSIGNED) AS positive_mentions,
  CAST(SUM(asp.polarity = 'NEUTRAL')  AS UNSIGNED) AS neutral_mentions,
  CAST(SUM(asp.polarity = 'NEGATIVE') AS UNSIGNED) AS negative_mentions,
  ROUND(AVG(asp.score), 4)                         AS avg_score
FROM aspect_sentiments asp
JOIN aspects            a  ON a.aspect_id    = asp.aspect_id
JOIN sentiment_analysis sa ON sa.analysis_id = asp.analysis_id
JOIN feedback           f  ON f.feedback_id  = sa.feedback_id
JOIN ratings            r  ON r.rating_id    = f.rating_id
JOIN products           p  ON p.product_id   = r.product_id
JOIN categories         c  ON c.category_id  = p.category_id
WHERE sa.status = 'COMPLETED'
  AND f.status <> 'HIDDEN'
GROUP BY a.aspect_id, a.slug, a.display_name, c.category_id, c.name;

-- Admin "Product performance": ratings, sentiment split, recent volume and the
-- most frequent complaint / praise (correlated scalar subqueries).
CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_product_performance AS
SELECT
  p.product_id,
  p.name                     AS product_name,
  p.brand,
  p.category_id,
  c.name                     AS category_name,
  p.is_active,
  prs.rating_count,
  prs.avg_rating,
  prs.bayes_rating,
  COALESCE(fs.review_count, 0)      AS review_count,
  COALESCE(fs.analysed_count, 0)    AS analysed_count,
  COALESCE(fs.positive_count, 0)    AS positive_count,
  COALESCE(fs.negative_count, 0)    AS negative_count,
  COALESCE(fs.mixed_count, 0)       AS mixed_count,
  ROUND(100 * fs.positive_count / NULLIF(fs.analysed_count, 0), 1) AS positive_pct,
  ROUND(100 * fs.negative_count / NULLIF(fs.analysed_count, 0), 1) AS negative_pct,
  COALESCE(fs.reviews_last_30d, 0)  AS reviews_last_30d,
  (SELECT a.display_name
     FROM aspect_sentiments asp
     JOIN aspects a             ON a.aspect_id    = asp.aspect_id
     JOIN sentiment_analysis sa ON sa.analysis_id = asp.analysis_id
     JOIN feedback f2           ON f2.feedback_id = sa.feedback_id
     JOIN ratings r2            ON r2.rating_id   = f2.rating_id
    WHERE r2.product_id = p.product_id
      AND asp.polarity = 'NEGATIVE'
      AND sa.status = 'COMPLETED'
      AND f2.status <> 'HIDDEN'
    GROUP BY a.aspect_id, a.display_name
    ORDER BY COUNT(*) DESC, a.display_name
    LIMIT 1)                 AS top_complaint,
  (SELECT a.display_name
     FROM aspect_sentiments asp
     JOIN aspects a             ON a.aspect_id    = asp.aspect_id
     JOIN sentiment_analysis sa ON sa.analysis_id = asp.analysis_id
     JOIN feedback f2           ON f2.feedback_id = sa.feedback_id
     JOIN ratings r2            ON r2.rating_id   = f2.rating_id
    WHERE r2.product_id = p.product_id
      AND asp.polarity = 'POSITIVE'
      AND sa.status = 'COMPLETED'
      AND f2.status <> 'HIDDEN'
    GROUP BY a.aspect_id, a.display_name
    ORDER BY COUNT(*) DESC, a.display_name
    LIMIT 1)                 AS top_praise
FROM products p
JOIN categories c               ON c.category_id = p.category_id
JOIN v_product_rating_stats prs ON prs.product_id = p.product_id
LEFT JOIN (
  SELECT product_id,
         COUNT(*)                                              AS review_count,
         CAST(SUM(analysis_status = 'COMPLETED') AS UNSIGNED)  AS analysed_count,
         CAST(SUM(sentiment_label = 'POSITIVE')  AS UNSIGNED)  AS positive_count,
         CAST(SUM(sentiment_label = 'NEGATIVE')  AS UNSIGNED)  AS negative_count,
         CAST(SUM(overall_sentiment = 'MIXED')   AS UNSIGNED)  AS mixed_count,
         CAST(SUM(created_at >= CURRENT_DATE - INTERVAL 30 DAY) AS UNSIGNED) AS reviews_last_30d
  FROM v_feedback_details
  WHERE feedback_status <> 'HIDDEN'
  GROUP BY product_id
) fs ON fs.product_id = p.product_id;

-- Customer "Activity history": interactions + ratings + reviews (UNION ALL),
-- so rating/review events are never duplicated into user_interactions.
CREATE OR REPLACE SQL SECURITY INVOKER VIEW v_user_activity AS
SELECT
  act.user_id,
  act.activity_type,
  act.product_id,
  p.name                     AS product_name,
  COALESCE(act.category_id, p.category_id) AS category_id,
  c.name                     AS category_name,
  act.detail,
  act.occurred_at,
  act.source_table,
  act.source_id,
  act.is_demo
FROM (
  SELECT ui.user_id,
         CAST(ui.interaction_type AS CHAR(30))  AS activity_type,
         ui.product_id,
         ui.category_id,
         ui.search_query                        AS detail,
         ui.occurred_at,
         'user_interactions'                    AS source_table,
         ui.interaction_id                      AS source_id,
         (ui.seed_batch_id IS NOT NULL)         AS is_demo
  FROM user_interactions ui
  UNION ALL
  SELECT r.user_id, 'RATED', r.product_id, NULL,
         CONCAT(r.stars, ' stars'), r.created_at,
         'ratings', r.rating_id, (r.seed_batch_id IS NOT NULL)
  FROM ratings r
  UNION ALL
  SELECT r.user_id, 'REVIEWED', r.product_id, NULL,
         LEFT(COALESCE(f.title, f.body), 80), f.created_at,
         'feedback', f.feedback_id, (f.seed_batch_id IS NOT NULL)
  FROM feedback f
  JOIN ratings r ON r.rating_id = f.rating_id
) act
LEFT JOIN products   p ON p.product_id  = act.product_id
LEFT JOIN categories c ON c.category_id = COALESCE(act.category_id, p.category_id);
