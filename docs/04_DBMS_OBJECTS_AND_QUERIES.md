# 04 — DBMS Objects and Analytical Queries

> **Status: DRAFT.** None of the SQL here has been run yet. It is written against the schema in `docs/00_DECISIONS.md` §4. It will be executed and verified on MySQL 8.0.46 (`sql_mode` includes `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES`) in three steps: Phase 3 (schema), **P11a** right after Phase 3 (the views, triggers and `sp_submit_review` the app depends on), and Phase 11 (the remaining report procedures, showcase queries and the transaction demo), following the phase-ordering note in 00_DECISIONS. The final versions will live in `database/02_views.sql`, `database/03_procedures.sql`, `database/04_triggers.sql` and `database/queries/dbms_showcase.sql`. Any change made during verification is copied back into this document.

Conventions used throughout:

- **Analytics exclude moderated-away content.** All analytics use `feedback.status <> 'HIDDEN'`. FLAGGED reviews still count until an admin hides them.
- **Sentiment counts only use completed analyses.** PENDING, FAILED and UNSUPPORTED rows count as "not analysed", never as neutral.
- **Business-rule errors carry a code prefix.** They use `SIGNAL SQLSTATE '45000'` with a `MESSAGE_TEXT` that starts with a stable code (`FA_USER_SUSPENDED: …`). Express maps the prefix to an API error code and never forwards the raw text.
- **SUM() results arrive as strings in Node.** `SUM()` over booleans returns DECIMAL, which mysql2 returns as a string. The API layer either CASTs or enables `decimalNumbers` (see §7).

---

## 1. DBMS concept coverage matrix

| Concept (brief §13) | Where FeedbackAI demonstrates it | File / object |
|---|---|---|
| **DDL** | 17 `CREATE TABLE` statements with PK/FK/UNIQUE/CHECK, plus `CREATE VIEW`, `CREATE PROCEDURE`, `CREATE TRIGGER`, `CREATE INDEX` / `FULLTEXT` | `database/01_schema.sql` … `04_triggers.sql` |
| **DML** | Idempotent seeding (`INSERT … ON DUPLICATE KEY UPDATE` with a row alias); review upsert; moderation `UPDATE feedback SET status`; product archive `UPDATE products SET is_active = 0`; user `DELETE` with cascades | `backend/scripts/seed.js`, `sp_submit_review`, admin controllers |
| **Joins** | INNER chains feedback → ratings → products → categories; LEFT JOINs that keep products with no ratings; CROSS JOIN for the global mean; self-referencing correlated join (category average) | `v_feedback_details`, `v_product_rating_stats`, Q1, E1 |
| **Aggregate functions** | `COUNT`, `AVG`, `SUM` (conditional), `MIN`, `MAX`, Bayesian average | Q1–Q7, `v_product_rating_stats` |
| **GROUP BY** | By product, category, month, aspect × polarity, user, reason_code | every view except `v_feedback_details` / `v_user_activity` |
| **HAVING** | Rating threshold with minimum review count; products with at least one negative review | Q3, Q6, `sp_products_above_threshold` |
| **Subqueries** | Derived tables in views; correlated scalar subqueries (`top_complaint`, category average); `EXISTS` / `NOT EXISTS` | `v_product_performance`, E1, E2, `trg_users_*` |
| **CTEs and window functions** (extra) | `WITH RECURSIVE` month generator; `RANK() OVER (PARTITION BY …)`; `LAG()`; `SUM(COUNT(*)) OVER (…)` | `sp_monthly_trend`, Q2, Q5, Q7, E3 |
| **Views** | 7 views. Admin dashboards and reports read them, and they stand in for stored aggregates (no `avg_rating` column is stored anywhere) | `database/02_views.sql` |
| **Stored procedures** | 5 procedures: 1 transactional write with EXIT HANDLER + ROLLBACK + SIGNAL, and 4 parameterised reports | `database/03_procedures.sql` |
| **Triggers** | 6 triggers: auto-create the PENDING analysis row, invalidate the analysis on edit, audit moderation, block ratings on archived products or by suspended users, protect the last admin | `database/04_triggers.sql` |
| **Transactions** | Review submission (rating + feedback + analysis row is atomic); `FOR SHARE` locking against concurrent archive or suspension; analysis-worker claim with a guarded `UPDATE`; rollback demonstration | `sp_submit_review`, §6, `backend/src/services/analysisWorker.js` |
| **Indexes** | Composite `(product_id, stars)`, `(user_id, occurred_at)`, `(status, created_at)`, `(aspect_id, polarity)`; `FULLTEXT(name, brand, description)` for search and recommendations; UNIQUE keys that double as business rules | `01_schema.sql`; see `03_DATABASE_DESIGN.md` |
| **Constraints** | NOT NULL, UNIQUE (one rating per user per product, one feedback per rating, one analysis per feedback), CHECK (stars 1–5, body length, score ranges, completed-analysis shape, interaction shape, date range), FK with RESTRICT / CASCADE / SET NULL | `01_schema.sql`, `database/tests/constraint_tests.sql` |
| **Normalization** | 1NF/2NF/3NF argued per table. Feedback does not repeat user or product (it reaches them through `rating_id`). Confidence and MIXED are derived, not stored. Tags are a separate M:N table. | `03_DATABASE_DESIGN.md` |

---

## 2. Views (DRAFT)

Every view is ONLY_FULL_GROUP_BY safe. Either everything is aggregated inside a derived table keyed by a PK, or every non-aggregated column appears in `GROUP BY`. Views that contain `GROUP BY`, `UNION` or derived tables are not updatable. They are read-only by design.

### 2.1 `v_product_rating_stats`: per-product rating summary (replaces a stored average)

```sql
CREATE OR REPLACE VIEW v_product_rating_stats AS
SELECT
  p.product_id,
  p.name                                   AS product_name,
  p.category_id,
  p.is_active,
  COALESCE(rs.rating_count, 0)             AS rating_count,
  ROUND(rs.avg_rating, 2)                  AS avg_rating,          -- NULL when unrated
  -- Bayesian average: (C*m + sum) / (C + n), C = 5, m = global mean rating
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
```

**Why Bayesian.** A product with a single 5★ rating would otherwise outrank one with forty 4.7★ ratings. With C = 5, a product needs about five ratings before its own mean dominates the global prior. The recommendation engine's `quality_prior` and E3 both use `bayes_rating`.

### 2.2 `v_feedback_details`: one row per written review, fully enriched

```sql
CREATE OR REPLACE VIEW v_feedback_details AS
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
  -- expose a label only for completed analyses
  CASE WHEN sa.status = 'COMPLETED' THEN sa.label END AS sentiment_label,
  -- confidence is derived: the probability of the stored label (not a stored column)
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
```

**How the sentiment fields relate.**
- `sentiment_label` is the model's 3-class output.
- `overall_sentiment` adds the derived **MIXED** state: an analysis with at least one positive and one negative aspect.
- A MIXED review still carries its 3-class label. In distributions, MIXED is reported as an overlay count. It is not a fourth slice, so positive, neutral and negative always sum to 100% of analysed reviews.

### 2.3 `v_category_sentiment`: category-wise satisfaction

```sql
CREATE OR REPLACE VIEW v_category_sentiment AS
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
         COUNT(*)                                       AS review_count,
         CAST(SUM(analysis_status = 'COMPLETED') AS UNSIGNED) AS analysed_count,
         CAST(SUM(sentiment_label = 'POSITIVE')  AS UNSIGNED) AS positive_count,
         CAST(SUM(sentiment_label = 'NEUTRAL')   AS UNSIGNED) AS neutral_count,
         CAST(SUM(sentiment_label = 'NEGATIVE')  AS UNSIGNED) AS negative_count,
         CAST(SUM(overall_sentiment = 'MIXED')   AS UNSIGNED) AS mixed_count
  FROM v_feedback_details
  WHERE feedback_status <> 'HIDDEN'
  GROUP BY category_id
) fs ON fs.category_id = c.category_id;
```

### 2.4 `v_monthly_feedback_trend`: feedback volume over time

```sql
CREATE OR REPLACE VIEW v_monthly_feedback_trend AS
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
```

This view only returns months that have feedback. For a continuous axis with zero-filled months, use `sp_monthly_trend` (recursive CTE, §3.5).

### 2.5 `v_aspect_summary`: appreciated features and common complaints, per category

```sql
CREATE OR REPLACE VIEW v_aspect_summary AS
SELECT
  a.aspect_id,
  a.slug                                         AS aspect_slug,
  a.display_name                                 AS aspect_name,
  c.category_id,
  c.name                                         AS category_name,
  COUNT(*)                                       AS mention_count,
  CAST(SUM(asp.polarity = 'POSITIVE') AS UNSIGNED) AS positive_mentions,
  CAST(SUM(asp.polarity = 'NEUTRAL')  AS UNSIGNED) AS neutral_mentions,
  CAST(SUM(asp.polarity = 'NEGATIVE') AS UNSIGNED) AS negative_mentions,
  ROUND(AVG(asp.score), 4)                       AS avg_score
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
```

### 2.6 `v_product_performance`: admin "Product performance" page

```sql
CREATE OR REPLACE VIEW v_product_performance AS
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
  -- correlated scalar subqueries: most frequent negative / positive aspect for this product
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
JOIN categories c              ON c.category_id = p.category_id
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
```

### 2.7 `v_user_activity`: customer "Activity history" (UNION ALL, so nothing is duplicated)

```sql
CREATE OR REPLACE VIEW v_user_activity AS
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
```

**Performance note.** The UNION derived table is materialised. That is fine at demo scale (about 1,300 rows). If activity pages slow down, the API can query the three tables separately with `WHERE user_id = ?` (each has a user-leading index) and merge them. See `06_RISKS_AND_BOTTLENECKS.md`.

---

## 3. Stored procedures (DRAFT)

Read-only procedures do not open transactions, so they have no rollback handler. They validate their parameters with `SIGNAL`. `sp_submit_review` is the transactional write path.

```sql
DELIMITER $$
```

### 3.1 `sp_submit_review`: atomic rating + review upsert

```sql
DROP PROCEDURE IF EXISTS sp_submit_review $$
CREATE PROCEDURE sp_submit_review(
  IN  p_user_id     INT,
  IN  p_product_id  INT,
  IN  p_stars       TINYINT,
  IN  p_title       VARCHAR(120),
  IN  p_body        TEXT,          -- NULL = rating only, no written review
  OUT p_feedback_id INT
)
MODIFIES SQL DATA
BEGIN
  DECLARE v_user_status VARCHAR(10) DEFAULT NULL;
  DECLARE v_is_active   TINYINT     DEFAULT NULL;
  DECLARE v_rating_id   INT         DEFAULT NULL;

  -- Any error (SIGNAL, CHECK 3819, duplicate 1062, deadlock 1213 …) undoes the whole unit.
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

  -- FOR SHARE: a concurrent suspend/archive waits until this review commits (or vice versa)
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

  -- One rating per (user, product): insert or update the existing one (row alias syntax, 8.0.19+)
  INSERT INTO ratings (user_id, product_id, stars)
  VALUES (p_user_id, p_product_id, p_stars) AS new
  ON DUPLICATE KEY UPDATE stars = new.stars;

  SELECT rating_id INTO v_rating_id
    FROM ratings WHERE user_id = p_user_id AND product_id = p_product_id;

  IF p_body IS NOT NULL THEN
    -- One feedback per rating. Body length (10–4000) is enforced by the CHECK constraint;
    -- a violation raises 3819, the handler rolls back the rating upsert too.
    INSERT INTO feedback (rating_id, title, body)
    VALUES (v_rating_id, p_title, p_body) AS new
    ON DUPLICATE KEY UPDATE title = new.title, body = new.body;
    -- trg_feedback_after_insert / _after_update create or reset the PENDING analysis row

    SELECT feedback_id INTO p_feedback_id
      FROM feedback WHERE rating_id = v_rating_id;
  END IF;

  COMMIT;
END $$
```

Notes:
- **Do not call it inside an open transaction.** `START TRANSACTION` inside a procedure **implicitly commits** any transaction the caller already has open, so Express calls this procedure on a connection with no open transaction. Express validates input with zod first, so users see friendly messages. The SIGNALs and CHECKs are the integrity backstop.
- **Body length is left to the CHECK constraint on purpose.** It is not pre-validated in the procedure, which makes the EXIT HANDLER's rollback demonstrable (§6, demo C).

### 3.2 `sp_products_above_threshold`: HAVING with parameters

```sql
DROP PROCEDURE IF EXISTS sp_products_above_threshold $$
CREATE PROCEDURE sp_products_above_threshold(
  IN p_min_avg     DECIMAL(3,2),
  IN p_min_reviews INT
)
READS SQL DATA
BEGIN
  IF p_min_avg IS NULL OR p_min_avg NOT BETWEEN 1 AND 5 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FA_INVALID_THRESHOLD: min_avg must be between 1 and 5';
  END IF;
  IF p_min_reviews IS NULL OR p_min_reviews < 1 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FA_INVALID_THRESHOLD: min_reviews must be at least 1';
  END IF;

  SELECT p.product_id,
         p.name               AS product_name,
         p.brand,
         c.name               AS category_name,
         COUNT(r.rating_id)   AS rating_count,
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
```

### 3.3 `sp_category_sentiment`: date-filtered category distribution

```sql
DROP PROCEDURE IF EXISTS sp_category_sentiment $$
CREATE PROCEDURE sp_category_sentiment(
  IN p_from DATE,   -- NULL = unbounded
  IN p_to   DATE    -- inclusive; NULL = unbounded
)
READS SQL DATA
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
        AND (p_to   IS NULL OR fd.created_at <  p_to + INTERVAL 1 DAY)  -- inclusive end, index-friendly
  GROUP BY c.category_id, c.name, c.display_order
  ORDER BY c.display_order, c.name;
END $$
```

### 3.4 `sp_top_reviewers`: users with the most feedback submissions

```sql
DROP PROCEDURE IF EXISTS sp_top_reviewers $$
CREATE PROCEDURE sp_top_reviewers(IN p_limit INT)
READS SQL DATA
BEGIN
  IF p_limit IS NULL OR p_limit NOT BETWEEN 1 AND 100 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FA_INVALID_LIMIT: limit must be between 1 and 100';
  END IF;

  SELECT u.user_id,
         u.full_name,
         COUNT(f.feedback_id)              AS feedback_count,
         SUM(f.status = 'PUBLISHED')       AS published_count,
         ROUND(AVG(r.stars), 2)            AS avg_stars_given,
         MAX(f.created_at)                 AS last_feedback_at,
         (u.seed_batch_id IS NOT NULL)     AS is_demo
  FROM users u
  JOIN ratings  r ON r.user_id   = u.user_id
  JOIN feedback f ON f.rating_id = r.rating_id
  GROUP BY u.user_id, u.full_name, u.seed_batch_id
  ORDER BY feedback_count DESC, last_feedback_at DESC
  LIMIT p_limit;            -- routine parameters are allowed in LIMIT inside stored programs
END $$
```

### 3.5 `sp_monthly_trend`: zero-filled monthly series (recursive CTE)

```sql
DROP PROCEDURE IF EXISTS sp_monthly_trend $$
CREATE PROCEDURE sp_monthly_trend(IN p_months INT)
READS SQL DATA
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
```

---

## 4. Triggers (DRAFT)

> **MySQL rule to remember:** triggers do **not** fire for rows changed by foreign-key cascade actions. Some consequences:
> - Deleting a user cascades to ratings → feedback → sentiment_analysis → aspect_sentiments, and **no** trigger on those tables runs, so nothing is written to `audit_log`.
> - Any audit of a user deletion is written by the application (or by `trg_users_before_delete`, which does fire because the DELETE targets `users` directly).
> - A trigger may read the table that fired it, but may not modify it.

```sql
DELIMITER $$
```

### 4.1 `trg_feedback_after_insert`: every review gets a PENDING analysis row

```sql
DROP TRIGGER IF EXISTS trg_feedback_after_insert $$
CREATE TRIGGER trg_feedback_after_insert
AFTER INSERT ON feedback
FOR EACH ROW
BEGIN
  INSERT INTO sentiment_analysis (feedback_id, status)
  VALUES (NEW.feedback_id, 'PENDING');
END $$
```

This guarantees the invariant "every feedback row has exactly one analysis row" (UNIQUE `feedback_id` stops duplicates). The worker therefore only ever *updates*. The original text stays in `feedback` and the analysis stays separate.

### 4.2 `trg_feedback_after_update`: invalidate stale analysis and audit moderation

```sql
DROP TRIGGER IF EXISTS trg_feedback_after_update $$
CREATE TRIGGER trg_feedback_after_update
AFTER UPDATE ON feedback
FOR EACH ROW
BEGIN
  -- Byte comparison: the column collation utf8mb4_0900_ai_ci treats 'great' = 'Great',
  -- so a plain <> would miss case/accent-only edits.
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
    -- @app_actor_id is set by Express inside the same transaction (see §7)
    INSERT INTO audit_log (actor_user_id, action, entity_type, entity_id, details)
    VALUES (@app_actor_id, 'FEEDBACK_STATUS_CHANGED', 'feedback', NEW.feedback_id,
            LEFT(CONCAT(OLD.status, ' -> ', NEW.status,
                        COALESCE(CONCAT(': ', NEW.moderation_note), '')), 255));
  END IF;
END $$
```

The upsert form also repairs a missing analysis row, for example feedback inserted before the trigger existed.

### 4.3 `trg_ratings_before_insert` / `trg_ratings_before_update`: no ratings on archived products or by suspended users

```sql
DROP TRIGGER IF EXISTS trg_ratings_before_insert $$
CREATE TRIGGER trg_ratings_before_insert
BEFORE INSERT ON ratings
FOR EACH ROW
BEGIN
  DECLARE v_is_active TINYINT     DEFAULT NULL;
  DECLARE v_status    VARCHAR(10) DEFAULT NULL;

  SELECT is_active INTO v_is_active FROM products WHERE product_id = NEW.product_id;
  SELECT status    INTO v_status    FROM users    WHERE user_id    = NEW.user_id;
  -- unknown ids leave the variables NULL; the FK constraint rejects them afterwards

  IF v_is_active = 0 THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FA_PRODUCT_ARCHIVED: archived products cannot be rated';
  END IF;
  IF v_status = 'SUSPENDED' THEN
    SIGNAL SQLSTATE '45000' SET MESSAGE_TEXT = 'FA_USER_SUSPENDED: suspended users cannot rate products';
  END IF;
END $$

DROP TRIGGER IF EXISTS trg_ratings_before_update $$
CREATE TRIGGER trg_ratings_before_update
BEFORE UPDATE ON ratings
FOR EACH ROW
BEGIN
  DECLARE v_is_active TINYINT     DEFAULT NULL;
  DECLARE v_status    VARCHAR(10) DEFAULT NULL;

  -- Only check real changes, so idempotent seed re-runs (no-op ON DUPLICATE KEY UPDATE)
  -- on products archived *after* seeding do not fail.
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
```

### 4.4 `trg_users_before_delete` / `trg_users_before_update`: keep at least one active admin

```sql
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
```

**Race note.** Two concurrent transactions, each removing a *different* admin, could both pass the `NOT EXISTS` check. The admin API therefore runs `SELECT … FROM users WHERE role = 'ADMIN' AND status = 'ACTIVE' FOR UPDATE` first in the same transaction. A single multi-row `DELETE` is already safe, because InnoDB evaluates the trigger row by row and rolls back the whole statement on SIGNAL.

---

## 5. Analytical queries (DRAFT)

These go in `database/queries/dbms_showcase.sql`. The admin API runs the same logic as parameterised queries (with `?` placeholders), adding date, category, product and sentiment filters.

### Q1. Product-wise average rating
Every product with its rating count and mean, including products nobody has rated yet.
*Concepts: INNER + LEFT JOIN, COUNT, AVG, GROUP BY, ordering on aggregates.*

```sql
SELECT p.product_id,
       p.name                   AS product_name,
       c.name                   AS category_name,
       COUNT(r.rating_id)       AS rating_count,
       ROUND(AVG(r.stars), 2)   AS avg_rating       -- NULL for unrated products
FROM products p
JOIN categories c   ON c.category_id = p.category_id
LEFT JOIN ratings r ON r.product_id  = p.product_id
WHERE p.is_active = 1
GROUP BY p.product_id, p.name, c.name
ORDER BY (COUNT(r.rating_id) = 0), avg_rating DESC, rating_count DESC;
```

### Q2. Category-wise sentiment distribution
The share of positive, neutral and negative reviews within each category.
*Concepts: 5-table join, GROUP BY two columns, window function over an aggregate for the percentage.*

```sql
SELECT c.name                                                   AS category_name,
       sa.label                                                 AS sentiment,
       COUNT(*)                                                 AS review_count,
       ROUND(100 * COUNT(*) / SUM(COUNT(*)) OVER (PARTITION BY c.category_id), 1) AS pct_of_category
FROM feedback f
JOIN ratings            r  ON r.rating_id   = f.rating_id
JOIN products           p  ON p.product_id  = r.product_id
JOIN categories         c  ON c.category_id = p.category_id
JOIN sentiment_analysis sa ON sa.feedback_id = f.feedback_id
WHERE sa.status = 'COMPLETED'
  AND f.status <> 'HIDDEN'
GROUP BY c.category_id, c.name, sa.label
ORDER BY c.name, sa.label;       -- ENUM order: POSITIVE, NEUTRAL, NEGATIVE
```

The pivoted form, one row per category, is `SELECT * FROM v_category_sentiment ORDER BY display_order;`.

### Q3. Products with the highest negative feedback
The top 10 products by number of negative reviews, with their negative share.
*Concepts: conditional aggregation, HAVING on an aggregate alias, LIMIT.*

```sql
SELECT p.product_id,
       p.name                                                 AS product_name,
       c.name                                                 AS category_name,
       COUNT(*)                                               AS analysed_reviews,
       SUM(sa.label = 'NEGATIVE')                             AS negative_reviews,
       ROUND(100 * SUM(sa.label = 'NEGATIVE') / COUNT(*), 1)  AS negative_pct
FROM feedback f
JOIN ratings            r  ON r.rating_id    = f.rating_id
JOIN products           p  ON p.product_id   = r.product_id
JOIN categories         c  ON c.category_id  = p.category_id
JOIN sentiment_analysis sa ON sa.feedback_id = f.feedback_id
WHERE sa.status = 'COMPLETED'
  AND f.status <> 'HIDDEN'
GROUP BY p.product_id, p.name, c.name
HAVING negative_reviews > 0
ORDER BY negative_reviews DESC, negative_pct DESC
LIMIT 10;
```

### Q4. Users with the most feedback submissions
The most active reviewers, their average stars given, and when they were active.
*Concepts: join through the rating bridge, COUNT, AVG, MIN, MAX, GROUP BY.*

```sql
SELECT u.user_id,
       u.full_name,
       COUNT(f.feedback_id)     AS feedback_count,
       ROUND(AVG(r.stars), 2)   AS avg_stars_given,
       MIN(f.created_at)        AS first_feedback_at,
       MAX(f.created_at)        AS latest_feedback_at
FROM users u
JOIN ratings  r ON r.user_id   = u.user_id
JOIN feedback f ON f.rating_id = r.rating_id
WHERE u.role = 'CUSTOMER'
GROUP BY u.user_id, u.full_name
ORDER BY feedback_count DESC, latest_feedback_at DESC
LIMIT 10;
```

`CALL sp_top_reviewers(10);` returns the same ranking.

### Q5. Monthly feedback trends (last 12 months, with month-over-month change)
Volume, average rating and sentiment counts per month, plus the change from the previous month.
*Concepts: date bucketing with DATE_FORMAT, GROUP BY on an expression, derived table, `LAG()` window function.*

```sql
SELECT month_start,
       feedback_count,
       avg_rating,
       positive_count,
       negative_count,
       feedback_count - LAG(feedback_count) OVER (ORDER BY month_start) AS change_vs_prev_month
FROM (
  SELECT CAST(DATE_FORMAT(f.created_at, '%Y-%m-01') AS DATE) AS month_start,
         COUNT(*)                                            AS feedback_count,
         ROUND(AVG(r.stars), 2)                              AS avg_rating,
         COALESCE(SUM(sa.label = 'POSITIVE'), 0)             AS positive_count,
         COALESCE(SUM(sa.label = 'NEGATIVE'), 0)             AS negative_count
  FROM feedback f
  JOIN ratings r ON r.rating_id = f.rating_id
  LEFT JOIN sentiment_analysis sa
         ON sa.feedback_id = f.feedback_id AND sa.status = 'COMPLETED'
  WHERE f.status <> 'HIDDEN'
    AND f.created_at >= CURRENT_DATE - INTERVAL (DAYOFMONTH(CURRENT_DATE) - 1) DAY - INTERVAL 11 MONTH
  GROUP BY month_start
) m
ORDER BY month_start;
```

Months with zero feedback do not appear here. `CALL sp_monthly_trend(12);` returns a zero-filled series.

### Q6. Products with ratings above a specified threshold
Products whose average rating is at or above a threshold, among those with enough ratings.
*Concepts: HAVING versus WHERE. WHERE filters rows before grouping (only active products), HAVING filters groups after aggregation (average and count).*

```sql
SET @threshold = 4.00, @min_ratings = 3;

SELECT p.product_id,
       p.name                   AS product_name,
       c.name                   AS category_name,
       COUNT(*)                 AS rating_count,
       ROUND(AVG(r.stars), 2)   AS avg_rating
FROM products p
JOIN categories c ON c.category_id = p.category_id
JOIN ratings    r ON r.product_id  = p.product_id
WHERE p.is_active = 1
GROUP BY p.product_id, p.name, c.name
HAVING AVG(r.stars) >= @threshold
   AND COUNT(*)     >= @min_ratings
ORDER BY avg_rating DESC, rating_count DESC;
```

The same logic is available as `CALL sp_products_above_threshold(4.00, 3);`.

### Q7. Most frequently mentioned positive and negative aspects
The top 5 aspects by mentions for each polarity. Positive aspects are the frequently appreciated features. Negative aspects are the common complaints.
*Concepts: CTE chain, GROUP BY two columns, `RANK() OVER (PARTITION BY polarity …)`.*

```sql
WITH aspect_counts AS (
  SELECT a.aspect_id,
         a.display_name AS aspect,
         asp.polarity,
         COUNT(*)       AS mentions
  FROM aspect_sentiments asp
  JOIN aspects            a  ON a.aspect_id    = asp.aspect_id
  JOIN sentiment_analysis sa ON sa.analysis_id = asp.analysis_id
  JOIN feedback           f  ON f.feedback_id  = sa.feedback_id
  WHERE sa.status = 'COMPLETED'
    AND f.status <> 'HIDDEN'
    AND asp.polarity IN ('POSITIVE', 'NEGATIVE')
  GROUP BY a.aspect_id, a.display_name, asp.polarity
),
ranked AS (
  SELECT aspect, polarity, mentions,
         RANK() OVER (PARTITION BY polarity ORDER BY mentions DESC) AS rnk
  FROM aspect_counts
)
SELECT polarity, rnk, aspect, mentions
FROM ranked
WHERE rnk <= 5
ORDER BY polarity, rnk, aspect;
```

For a per-category breakdown, filter `v_aspect_summary`:
```sql
SELECT * FROM v_aspect_summary WHERE category_id = ? ORDER BY negative_mentions DESC;
```

### Extra queries

**E1. Products rated above their own category's average (correlated subqueries).**
The inner queries reference the outer `p`, so they are re-evaluated for each product.

```sql
SELECT p.product_id,
       p.name  AS product_name,
       c.name  AS category_name,
       ROUND((SELECT AVG(r.stars) FROM ratings r WHERE r.product_id = p.product_id), 2) AS product_avg,
       ROUND((SELECT AVG(r2.stars)
                FROM ratings r2 JOIN products p2 ON p2.product_id = r2.product_id
               WHERE p2.category_id = p.category_id), 2)                              AS category_avg
FROM products p
JOIN categories c ON c.category_id = p.category_id
WHERE (SELECT AVG(r.stars) FROM ratings r WHERE r.product_id = p.product_id)
    > (SELECT AVG(r2.stars)
         FROM ratings r2 JOIN products p2 ON p2.product_id = r2.product_id
        WHERE p2.category_id = p.category_id)
ORDER BY category_name, product_avg DESC;
```

**E2. Products people look at but don't review (`NOT EXISTS`).**
Active products with views in the last 90 days and no ratings in that window. These are candidates for review prompts.

```sql
SELECT p.product_id,
       p.name                    AS product_name,
       COUNT(ui.interaction_id)  AS views_90d
FROM products p
JOIN user_interactions ui
  ON ui.product_id = p.product_id
 AND ui.interaction_type = 'PRODUCT_VIEW'
 AND ui.occurred_at >= NOW() - INTERVAL 90 DAY
WHERE p.is_active = 1
  AND NOT EXISTS (SELECT 1 FROM ratings r
                   WHERE r.product_id = p.product_id
                     AND r.created_at >= NOW() - INTERVAL 90 DAY)
GROUP BY p.product_id, p.name
ORDER BY views_90d DESC;
```

**E3. Best product per category (`RANK()` window over the Bayesian rating).**
This shows why a raw average is misleading for products with few ratings.

```sql
SELECT category_name, product_name, rating_count, avg_rating, bayes_rating
FROM (
  SELECT c.name AS category_name,
         s.product_name, s.rating_count, s.avg_rating, s.bayes_rating,
         RANK() OVER (PARTITION BY s.category_id ORDER BY s.bayes_rating DESC) AS rnk
  FROM v_product_rating_stats s
  JOIN categories c ON c.category_id = s.category_id
  WHERE s.is_active = 1 AND s.rating_count >= 3
) t
WHERE rnk = 1
ORDER BY category_name;
```

**E4. Rating versus sentiment disagreement.**
Reviews where the stars and the model disagree strongly, plus a stars × label confusion table. These feed the Phase 8 model evaluation and surface sarcasm or mixed reviews.

```sql
SELECT feedback_id, product_name, stars, sentiment_label,
       ROUND(confidence, 3) AS confidence, LEFT(body, 120) AS excerpt, is_demo
FROM v_feedback_details
WHERE analysis_status = 'COMPLETED'
  AND ((stars >= 4 AND sentiment_label = 'NEGATIVE')
    OR (stars <= 2 AND sentiment_label = 'POSITIVE'))
ORDER BY confidence DESC;

SELECT stars,
       SUM(sentiment_label = 'POSITIVE') AS positive,
       SUM(sentiment_label = 'NEUTRAL')  AS neutral,
       SUM(sentiment_label = 'NEGATIVE') AS negative
FROM v_feedback_details
WHERE analysis_status = 'COMPLETED'
GROUP BY stars
ORDER BY stars;
```

**E5. Recommendation click-through by reason (LEFT JOIN + COUNT DISTINCT).**
This shows which explanation types actually lead to clicks.

```sql
SELECT rec.reason_code,
       COUNT(DISTINCT rec.recommendation_id)                                  AS shown,
       COUNT(DISTINCT ui.recommendation_id)                                   AS clicked,
       ROUND(100 * COUNT(DISTINCT ui.recommendation_id)
                 / COUNT(DISTINCT rec.recommendation_id), 1)                  AS click_through_pct
FROM recommendations rec
LEFT JOIN user_interactions ui
       ON ui.recommendation_id = rec.recommendation_id
      AND ui.interaction_type  = 'RECOMMENDATION_CLICK'
GROUP BY rec.reason_code
ORDER BY click_through_pct DESC;
```

---

## 6. Transaction demonstration script (DRAFT)

This becomes `database/queries/transaction_demo.sql`. Run it **interactively** in the `mysql` client, or with `mysql --force`, because the batch client stops at the first error and some steps are *meant* to fail. The script cleans up after itself, so the demo database is left unchanged.

```sql
USE feedback_ai_db;

-- Pick two (customer, active product) pairs that have no rating yet
SELECT u.user_id, p.product_id
FROM users u CROSS JOIN products p
WHERE u.role = 'CUSTOMER' AND u.status = 'ACTIVE' AND p.is_active = 1
  AND NOT EXISTS (SELECT 1 FROM ratings r WHERE r.user_id = u.user_id AND r.product_id = p.product_id)
ORDER BY u.user_id, p.product_id
LIMIT 1 INTO @uid, @pid;

SELECT u.user_id, p.product_id
FROM users u CROSS JOIN products p
WHERE u.role = 'CUSTOMER' AND u.status = 'ACTIVE' AND p.is_active = 1
  AND NOT EXISTS (SELECT 1 FROM ratings r WHERE r.user_id = u.user_id AND r.product_id = p.product_id)
  AND NOT (u.user_id = @uid AND p.product_id = @pid)
ORDER BY u.user_id DESC, p.product_id DESC
LIMIT 1 INTO @uid2, @pid2;

-- ── DEMO A: atomic success (what Express does for a review) ─────────────────
START TRANSACTION;
  INSERT INTO ratings (user_id, product_id, stars) VALUES (@uid, @pid, 4);
  SET @rid = LAST_INSERT_ID();
  INSERT INTO feedback (rating_id, title, body)
  VALUES (@rid, 'Does the job', 'Setup took five minutes and it has worked fine every day since.');
  SELECT feedback_id FROM feedback WHERE rating_id = @rid INTO @fid;
  -- trg_feedback_after_insert already created the PENDING analysis row, inside this transaction:
  SELECT feedback_id, status FROM sentiment_analysis WHERE feedback_id = @fid;   -- expect PENDING
COMMIT;

-- ── DEMO B: a failed statement does NOT roll back the transaction by itself ─
START TRANSACTION;
  INSERT INTO ratings (user_id, product_id, stars) VALUES (@uid2, @pid2, 2);   -- succeeds
  INSERT INTO feedback (rating_id, body) VALUES (LAST_INSERT_ID(), 'too short'); -- ERROR 3819 (CHECK body length)
  -- Only the failing statement was undone; the rating is still pending in this session:
  SELECT COUNT(*) AS pending_rating FROM ratings WHERE user_id = @uid2 AND product_id = @pid2;  -- 1
ROLLBACK;
SELECT COUNT(*) AS after_rollback FROM ratings WHERE user_id = @uid2 AND product_id = @pid2;    -- 0

-- ── DEMO C: the same failure through the procedure: its EXIT HANDLER rolls back
CALL sp_submit_review(@uid2, @pid2, 2, NULL, 'too short', @fid2);               -- ERROR 3819, re-signalled
SELECT COUNT(*) AS after_failed_call FROM ratings WHERE user_id = @uid2 AND product_id = @pid2; -- 0

CALL sp_submit_review(@uid2, @pid2, 2, 'Not for me',
     'The strap broke within a week and support never replied to my emails.', @fid2);
SELECT feedback_id, product_name, stars, analysis_status FROM v_feedback_details WHERE feedback_id = @fid2;

-- ── DEMO D: constraints reject bad data ──────────────────────────────────────
INSERT INTO ratings (user_id, product_id, stars) VALUES (@uid, @pid, 5);   -- ERROR 1062: one rating per user/product
UPDATE ratings SET stars = 6 WHERE user_id = @uid AND product_id = @pid;    -- ERROR 3819: stars BETWEEN 1 AND 5

-- ── DEMO E: business-rule trigger, rolled back so nothing changes ────────────
START TRANSACTION;
  UPDATE products SET is_active = 0 WHERE product_id = @pid2;
  UPDATE ratings  SET stars = 3     WHERE user_id = @uid2 AND product_id = @pid2;  -- ERROR 45000 FA_PRODUCT_ARCHIVED
ROLLBACK;

-- ── CLEANUP: remove the two demo reviews (cascades to feedback, sentiment_analysis) ─
DELETE FROM ratings WHERE (user_id, product_id) IN ((@uid, @pid), (@uid2, @pid2));
```

**Optional two-terminal concurrency demo.**
1. Session 1: `START TRANSACTION; SELECT is_active FROM products WHERE product_id = @pid FOR SHARE;`
2. Session 2: `UPDATE products SET is_active = 0 WHERE product_id = <same id>;` blocks.
3. Session 1: `COMMIT;` and session 2 proceeds.

This is the lock `sp_submit_review` relies on, so a product cannot be archived halfway through a review submission.

---

## 7. Integration notes for the Express layer

1. **Reset the actor variable on every transaction.** Set `@app_actor_id` inside every write transaction that can change `feedback.status`, and reset it afterwards: `SET @app_actor_id = ?` … `COMMIT` … `SET @app_actor_id = NULL`. mysql2 pool connections **keep session variables between requests**, so a stale value would attribute an audit entry to the wrong admin.
2. **Call `sp_submit_review` outside any open transaction.** See §3.1.
3. **Map SIGNAL messages to API errors.** Map the `FA_*` prefix of `err.sqlMessage` (errno 1644, SQLSTATE 45000) to `{ error: { code } }`. Map 1062 to `409 DUPLICATE`, 3819 to `422 CONSTRAINT_VIOLATION` and 1451 (RESTRICT) to `409 IN_USE`. Never forward the raw message.
4. **Guard the worker's completion write as well as its claim.** Use `UPDATE sentiment_analysis SET … status = 'COMPLETED' WHERE analysis_id = ? AND status = 'PROCESSING'`. If the user edited the review mid-analysis, the trigger has reset the row to PENDING, the guarded write affects 0 rows, and the stale result is discarded.
5. **Expect DECIMAL values as strings.** `AVG()`, `ROUND()` and `SUM()` return DECIMAL, which mysql2 returns as strings. Either enable `decimalNumbers: true` on the pool or convert in the repository layer, and do it consistently.
6. **Use the views for analytics and parameterised base-table queries for filtered dashboards.** MySQL 8.0.22+ can push some outer conditions into materialised views and derived tables, but not all. The filtered admin endpoints (date, category, product, sentiment) therefore query base tables with indexed predicates such as `f.created_at >= ? AND f.created_at < ?`.

## 8. Open questions about `00_DECISIONS.md`

These were raised while drafting. None of them changes a table or column name.

| # | Finding | Proposed resolution |
|---|---|---|
| 1 | Pooled connections keep `@app_actor_id`, so audit entries could be attributed to the wrong admin. | Set and reset it per transaction (§7.1). Add a test. |
| 2 | "When the body changes" is case- and accent-insensitive under `utf8mb4_0900_ai_ci`. | The trigger compares with `CAST(… AS BINARY)` (§4.2). |
| 3 | `trg_ratings_before_update` would break idempotent seed re-runs if a seeded product is later archived, because a no-op upsert still fires BEFORE UPDATE. | The trigger only checks when stars or keys actually change (§4.3). The seeder inserts ratings before archiving any demo product. |
| 4 | `START TRANSACTION` inside `sp_submit_review` implicitly commits any caller transaction. | Express calls it on a connection with no open transaction (§3.1). |
| 5 | §5 of 00_DECISIONS mentions a guarded *claim* only. The *completion* write also needs `AND status = 'PROCESSING'` to drop results for text that was edited mid-analysis. | Add this to the worker spec in 02_ARCHITECTURE (§7.4). |
| 6 | MySQL 8 enables binary logging by default (`binlog.*` files exist in the datadir). Creating triggers or routines as the limited `feedbackai_owner` account may require `log_bin_trust_function_creators=1` or running DDL as root. | Verify in Phase 3. Choose between granting `TRIGGER`/`CREATE ROUTINE` (and, if needed, the server variable) or running DDL as root. |
| 7 | Deleting a user reaches `user_interactions` by two cascade paths: directly (CASCADE) and via recommendation_runs → recommendations → `user_interactions.recommendation_id` (SET NULL). InnoDB should handle this, but it is unverified. | Add an explicit test to `database/tests/constraint_tests.sql`. |
