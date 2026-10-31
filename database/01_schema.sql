-- =============================================================================
-- FeedbackAI — 01_schema.sql
-- 17 tables for feedback_ai_db / feedback_ai_test_db (MySQL 8.0.46, InnoDB, utf8mb4).
--
-- Applied by database/setup.sh with the target database on the command line.
-- This file never names a database, so it cannot touch inventory_warehouse_db.
-- It is idempotent: CREATE TABLE IF NOT EXISTS keeps existing data. Use
-- `setup.sh --reset <db>` (99_reset_dev.sql) to rebuild tables from scratch.
--
-- Conventions (docs/00_DECISIONS.md §4 and §5a):
--   * PKs INT UNSIGNED AUTO_INCREMENT; user_interactions/audit_log BIGINT UNSIGNED.
--   * Every FK declares ON UPDATE RESTRICT; ON DELETE is chosen per relationship.
--   * MySQL error 3823: a CHECK may not reference a column used by an FK with a
--     CASCADE / SET NULL action, so CHECKed FK columns use RESTRICT.
--   * seed_batch_id NULL = genuine submission; NOT NULL = generated demo data.
--   * All DATETIME values are UTC (sessions run SET time_zone = '+00:00').
-- =============================================================================

SET NAMES utf8mb4 COLLATE utf8mb4_0900_ai_ci;
SET time_zone = '+00:00';

-- 1. seed_batches — provenance of generated demo data ------------------------
CREATE TABLE IF NOT EXISTS seed_batches (
  seed_batch_id      INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  label              VARCHAR(60)   NOT NULL,
  generator_version  VARCHAR(20)   NOT NULL,
  rng_seed           INT           NOT NULL,
  content_sha256     CHAR(64)      NOT NULL,
  description        VARCHAR(255)  NULL,
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_seed_batches        PRIMARY KEY (seed_batch_id),
  CONSTRAINT uq_seed_batches_label  UNIQUE (label),
  CONSTRAINT chk_seed_batches_sha   CHECK (content_sha256 REGEXP '^[0-9a-f]{64}$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 2. users -------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS users (
  user_id        INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  full_name      VARCHAR(100)  NOT NULL,
  email          VARCHAR(150)  NOT NULL,
  password_hash  CHAR(60)      NOT NULL,
  role           ENUM('CUSTOMER','ADMIN')   NOT NULL DEFAULT 'CUSTOMER',
  status         ENUM('ACTIVE','SUSPENDED') NOT NULL DEFAULT 'ACTIVE',
  seed_batch_id  INT UNSIGNED  NULL,
  last_login_at  DATETIME      NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT pk_users          PRIMARY KEY (user_id),
  CONSTRAINT uq_users_email    UNIQUE (email),
  CONSTRAINT chk_users_email   CHECK (email LIKE '%_@_%._%'),
  CONSTRAINT chk_users_name    CHECK (CHAR_LENGTH(TRIM(full_name)) > 0),
  CONSTRAINT fk_users_seed     FOREIGN KEY (seed_batch_id) REFERENCES seed_batches (seed_batch_id)
                               ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 3. categories --------------------------------------------------------------
CREATE TABLE IF NOT EXISTS categories (
  category_id    INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  name           VARCHAR(60)   NOT NULL,
  slug           VARCHAR(70)   NOT NULL,
  description    VARCHAR(255)  NULL,
  display_order  SMALLINT      NOT NULL DEFAULT 0,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT pk_categories       PRIMARY KEY (category_id),
  CONSTRAINT uq_categories_name  UNIQUE (name),
  CONSTRAINT uq_categories_slug  UNIQUE (slug),
  CONSTRAINT chk_categories_slug CHECK (slug REGEXP '^[a-z0-9-]+$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 4. tags — product attributes for content-based recommendations ------------
CREATE TABLE IF NOT EXISTS tags (
  tag_id  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  name    VARCHAR(40)   NOT NULL,
  slug    VARCHAR(50)   NOT NULL,
  CONSTRAINT pk_tags        PRIMARY KEY (tag_id),
  CONSTRAINT uq_tags_name   UNIQUE (name),
  CONSTRAINT uq_tags_slug   UNIQUE (slug),
  CONSTRAINT chk_tags_slug  CHECK (slug REGEXP '^[a-z0-9-]+$')
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 5. products ----------------------------------------------------------------
CREATE TABLE IF NOT EXISTS products (
  product_id     INT UNSIGNED   NOT NULL AUTO_INCREMENT,
  category_id    INT UNSIGNED   NOT NULL,
  name           VARCHAR(150)   NOT NULL,
  slug           VARCHAR(170)   NOT NULL,
  brand          VARCHAR(80)    NOT NULL,
  description    TEXT           NOT NULL,
  price          DECIMAL(10,2)  NOT NULL,
  image_url      VARCHAR(255)   NULL,
  is_active      TINYINT(1)     NOT NULL DEFAULT 1,
  seed_batch_id  INT UNSIGNED   NULL,
  created_at     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT pk_products              PRIMARY KEY (product_id),
  CONSTRAINT uq_products_slug         UNIQUE (slug),
  CONSTRAINT uq_products_brand_name   UNIQUE (brand, name),
  CONSTRAINT chk_products_price       CHECK (price > 0),
  CONSTRAINT chk_products_slug        CHECK (slug REGEXP '^[a-z0-9-]+$'),
  CONSTRAINT chk_products_active      CHECK (is_active IN (0, 1)),
  INDEX idx_products_category_active (category_id, is_active),
  FULLTEXT INDEX ft_products_search (name, brand, description),
  CONSTRAINT fk_products_category FOREIGN KEY (category_id) REFERENCES categories (category_id)
                                  ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_products_seed     FOREIGN KEY (seed_batch_id) REFERENCES seed_batches (seed_batch_id)
                                  ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 6. product_tags (M:N products <-> tags) -----------------------------------
CREATE TABLE IF NOT EXISTS product_tags (
  product_id  INT UNSIGNED NOT NULL,
  tag_id      INT UNSIGNED NOT NULL,
  CONSTRAINT pk_product_tags PRIMARY KEY (product_id, tag_id),
  INDEX idx_product_tags_tag (tag_id),
  CONSTRAINT fk_pt_product FOREIGN KEY (product_id) REFERENCES products (product_id)
                           ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_pt_tag     FOREIGN KEY (tag_id) REFERENCES tags (tag_id)
                           ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 7. user_category_preferences (explicit preferred categories) --------------
CREATE TABLE IF NOT EXISTS user_category_preferences (
  user_id      INT UNSIGNED NOT NULL,
  category_id  INT UNSIGNED NOT NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_user_category_preferences PRIMARY KEY (user_id, category_id),
  INDEX idx_ucp_category (category_id),
  CONSTRAINT fk_ucp_user     FOREIGN KEY (user_id) REFERENCES users (user_id)
                             ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_ucp_category FOREIGN KEY (category_id) REFERENCES categories (category_id)
                             ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 8. aspects — lookup loaded from ai-service/lexicon/aspects.json -----------
--    category_id NULL = general aspect (delivery, price, durability, ...).
CREATE TABLE IF NOT EXISTS aspects (
  aspect_id     INT UNSIGNED NOT NULL AUTO_INCREMENT,
  slug          VARCHAR(40)  NOT NULL,
  display_name  VARCHAR(60)  NOT NULL,
  category_id   INT UNSIGNED NULL,
  CONSTRAINT pk_aspects       PRIMARY KEY (aspect_id),
  CONSTRAINT uq_aspects_slug  UNIQUE (slug),
  CONSTRAINT chk_aspects_slug CHECK (slug REGEXP '^[a-z0-9-]+$'),
  CONSTRAINT fk_aspects_category FOREIGN KEY (category_id) REFERENCES categories (category_id)
                                 ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 9. ratings — one per (user, product), updatable ---------------------------
CREATE TABLE IF NOT EXISTS ratings (
  rating_id      INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  user_id        INT UNSIGNED     NOT NULL,
  product_id     INT UNSIGNED     NOT NULL,
  stars          TINYINT UNSIGNED NOT NULL,
  seed_batch_id  INT UNSIGNED     NULL,
  created_at     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME         NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT pk_ratings              PRIMARY KEY (rating_id),
  CONSTRAINT uq_ratings_user_product UNIQUE (user_id, product_id),
  CONSTRAINT chk_ratings_stars       CHECK (stars BETWEEN 1 AND 5),
  INDEX idx_ratings_product_stars (product_id, stars),
  INDEX idx_ratings_created (created_at),
  CONSTRAINT fk_ratings_user    FOREIGN KEY (user_id) REFERENCES users (user_id)
                                ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_ratings_product FOREIGN KEY (product_id) REFERENCES products (product_id)
                                ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_ratings_seed    FOREIGN KEY (seed_batch_id) REFERENCES seed_batches (seed_batch_id)
                                ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 10. feedback — the written review attached to exactly one rating (1 : 0..1)
--     user and product are reached through rating_id (3NF: not repeated here).
CREATE TABLE IF NOT EXISTS feedback (
  feedback_id      INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  rating_id        INT UNSIGNED  NOT NULL,
  title            VARCHAR(120)  NULL,
  body             TEXT          NOT NULL,
  status           ENUM('PUBLISHED','HIDDEN','FLAGGED') NOT NULL DEFAULT 'PUBLISHED',
  moderated_by     INT UNSIGNED  NULL,
  moderated_at     DATETIME      NULL,
  moderation_note  VARCHAR(255)  NULL,
  seed_batch_id    INT UNSIGNED  NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT pk_feedback          PRIMARY KEY (feedback_id),
  CONSTRAINT uq_feedback_rating   UNIQUE (rating_id),
  CONSTRAINT chk_feedback_body    CHECK (CHAR_LENGTH(body) BETWEEN 10 AND 4000),
  INDEX idx_feedback_status_created (status, created_at),
  INDEX idx_feedback_created (created_at),
  CONSTRAINT fk_feedback_rating    FOREIGN KEY (rating_id) REFERENCES ratings (rating_id)
                                   ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_feedback_moderator FOREIGN KEY (moderated_by) REFERENCES users (user_id)
                                   ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_feedback_seed      FOREIGN KEY (seed_batch_id) REFERENCES seed_batches (seed_batch_id)
                                   ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 11. sentiment_analysis — AI output, stored separately from the original text
--     Confidence is NOT stored: it is the score of the stored label (see views).
CREATE TABLE IF NOT EXISTS sentiment_analysis (
  analysis_id        INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  feedback_id        INT UNSIGNED  NOT NULL,
  status             ENUM('PENDING','PROCESSING','COMPLETED','FAILED','UNSUPPORTED') NOT NULL DEFAULT 'PENDING',
  label              ENUM('POSITIVE','NEUTRAL','NEGATIVE') NULL,
  score_positive     DECIMAL(5,4)  NULL,
  score_neutral      DECIMAL(5,4)  NULL,
  score_negative     DECIMAL(5,4)  NULL,
  detected_language  VARCHAR(10)   NULL,
  model_name         VARCHAR(120)  NULL,
  model_version      VARCHAR(40)   NULL,
  text_sha256        CHAR(64)      NULL,
  was_truncated      TINYINT(1)    NOT NULL DEFAULT 0,
  attempt_count      TINYINT UNSIGNED NOT NULL DEFAULT 0,
  last_error         VARCHAR(255)  NULL,
  analyzed_at        DATETIME      NULL,
  created_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  CONSTRAINT pk_sentiment_analysis PRIMARY KEY (analysis_id),
  CONSTRAINT uq_sa_feedback        UNIQUE (feedback_id),
  CONSTRAINT chk_sa_score_pos  CHECK (score_positive IS NULL OR score_positive BETWEEN 0 AND 1),
  CONSTRAINT chk_sa_score_neu  CHECK (score_neutral  IS NULL OR score_neutral  BETWEEN 0 AND 1),
  CONSTRAINT chk_sa_score_neg  CHECK (score_negative IS NULL OR score_negative BETWEEN 0 AND 1),
  CONSTRAINT chk_sa_completed  CHECK (status <> 'COMPLETED'
                                      OR (label IS NOT NULL AND score_positive IS NOT NULL AND analyzed_at IS NOT NULL)),
  CONSTRAINT chk_sa_truncated  CHECK (was_truncated IN (0, 1)),
  INDEX idx_sa_status (status),
  INDEX idx_sa_label (label),
  CONSTRAINT fk_sa_feedback FOREIGN KEY (feedback_id) REFERENCES feedback (feedback_id)
                            ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 12. aspect_sentiments — one row per (analysis, aspect); MIXED is derived ---
CREATE TABLE IF NOT EXISTS aspect_sentiments (
  aspect_sentiment_id  INT UNSIGNED  NOT NULL AUTO_INCREMENT,
  analysis_id          INT UNSIGNED  NOT NULL,
  aspect_id            INT UNSIGNED  NOT NULL,
  polarity             ENUM('POSITIVE','NEUTRAL','NEGATIVE') NOT NULL,
  score                DECIMAL(5,4)  NOT NULL,
  evidence             VARCHAR(300)  NOT NULL,
  CONSTRAINT pk_aspect_sentiments    PRIMARY KEY (aspect_sentiment_id),
  CONSTRAINT uq_as_analysis_aspect   UNIQUE (analysis_id, aspect_id),
  CONSTRAINT chk_as_score            CHECK (score BETWEEN 0 AND 1),
  INDEX idx_as_aspect_polarity (aspect_id, polarity),
  CONSTRAINT fk_as_analysis FOREIGN KEY (analysis_id) REFERENCES sentiment_analysis (analysis_id)
                            ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_as_aspect   FOREIGN KEY (aspect_id) REFERENCES aspects (aspect_id)
                            ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 13. recommendation_runs — one generation of a user's list ------------------
CREATE TABLE IF NOT EXISTS recommendation_runs (
  run_id             INT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id            INT UNSIGNED NOT NULL,
  algorithm_version  VARCHAR(20)  NOT NULL,
  strategy           ENUM('PERSONALIZED','COLD_START') NOT NULL,
  generated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_recommendation_runs PRIMARY KEY (run_id),
  INDEX idx_rr_user_time (user_id, generated_at),
  CONSTRAINT fk_rr_user FOREIGN KEY (user_id) REFERENCES users (user_id)
                        ON DELETE CASCADE ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 14. recommendations — ranked, explained items of a run --------------------
CREATE TABLE IF NOT EXISTS recommendations (
  recommendation_id  INT UNSIGNED     NOT NULL AUTO_INCREMENT,
  run_id             INT UNSIGNED     NOT NULL,
  product_id         INT UNSIGNED     NOT NULL,
  rank_position      TINYINT UNSIGNED NOT NULL,
  score              DECIMAL(6,4)     NOT NULL,
  reason_code        ENUM('SIMILAR_TO_RATED','PREFERRED_CATEGORY','SIMILAR_TO_VIEWED',
                          'SEARCH_MATCH','TOP_RATED_FALLBACK','POPULAR_FALLBACK') NOT NULL,
  reason_text        VARCHAR(255)     NOT NULL,
  anchor_product_id  INT UNSIGNED     NULL,
  dismissed_at       DATETIME         NULL,
  CONSTRAINT pk_recommendations   PRIMARY KEY (recommendation_id),
  CONSTRAINT uq_rec_run_product   UNIQUE (run_id, product_id),
  CONSTRAINT uq_rec_run_rank      UNIQUE (run_id, rank_position),
  CONSTRAINT chk_rec_rank         CHECK (rank_position BETWEEN 1 AND 50),
  CONSTRAINT chk_rec_score        CHECK (score >= 0),
  INDEX idx_rec_product (product_id),
  CONSTRAINT fk_rec_run     FOREIGN KEY (run_id) REFERENCES recommendation_runs (run_id)
                            ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_rec_product FOREIGN KEY (product_id) REFERENCES products (product_id)
                            ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_rec_anchor  FOREIGN KEY (anchor_product_id) REFERENCES products (product_id)
                            ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 15. user_interactions — views, category browses, searches, rec clicks -----
--     Ratings/reviews are NOT duplicated here (activity history = UNION view).
--     product_id / category_id use RESTRICT so the shape CHECK is legal (3823).
CREATE TABLE IF NOT EXISTS user_interactions (
  interaction_id     BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id            INT UNSIGNED    NOT NULL,
  interaction_type   ENUM('PRODUCT_VIEW','CATEGORY_VIEW','SEARCH','RECOMMENDATION_CLICK') NOT NULL,
  product_id         INT UNSIGNED    NULL,
  category_id        INT UNSIGNED    NULL,
  search_query       VARCHAR(120)    NULL,
  recommendation_id  INT UNSIGNED    NULL,
  seed_batch_id      INT UNSIGNED    NULL,
  occurred_at        DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_user_interactions PRIMARY KEY (interaction_id),
  CONSTRAINT chk_ui_shape CHECK (
       (interaction_type IN ('PRODUCT_VIEW','RECOMMENDATION_CLICK')
          AND product_id IS NOT NULL AND category_id IS NULL AND search_query IS NULL)
    OR (interaction_type = 'CATEGORY_VIEW'
          AND category_id IS NOT NULL AND product_id IS NULL AND search_query IS NULL)
    OR (interaction_type = 'SEARCH'
          AND search_query IS NOT NULL AND CHAR_LENGTH(TRIM(search_query)) > 0
          AND product_id IS NULL)
  ),
  INDEX idx_ui_user_time (user_id, occurred_at),
  INDEX idx_ui_product_type_time (product_id, interaction_type, occurred_at),
  CONSTRAINT fk_ui_user     FOREIGN KEY (user_id) REFERENCES users (user_id)
                            ON DELETE CASCADE ON UPDATE RESTRICT,
  CONSTRAINT fk_ui_product  FOREIGN KEY (product_id) REFERENCES products (product_id)
                            ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_ui_category FOREIGN KEY (category_id) REFERENCES categories (category_id)
                            ON DELETE RESTRICT ON UPDATE RESTRICT,
  CONSTRAINT fk_ui_rec      FOREIGN KEY (recommendation_id) REFERENCES recommendations (recommendation_id)
                            ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_ui_seed     FOREIGN KEY (seed_batch_id) REFERENCES seed_batches (seed_batch_id)
                            ON DELETE RESTRICT ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 16. reports — parameters and metadata only; rows regenerate from SQL -------
CREATE TABLE IF NOT EXISTS reports (
  report_id         INT UNSIGNED NOT NULL AUTO_INCREMENT,
  report_type       ENUM('SENTIMENT_SUMMARY','PRODUCT_PERFORMANCE','CATEGORY_SATISFACTION',
                         'ASPECT_INSIGHTS','FEEDBACK_EXPORT') NOT NULL,
  generated_by      INT UNSIGNED NULL,
  date_from         DATE         NULL,
  date_to           DATE         NULL,
  category_id       INT UNSIGNED NULL,
  product_id        INT UNSIGNED NULL,
  sentiment_filter  ENUM('POSITIVE','NEUTRAL','NEGATIVE','MIXED') NULL,
  row_count         INT UNSIGNED NOT NULL,
  created_at        DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_reports         PRIMARY KEY (report_id),
  CONSTRAINT chk_reports_dates  CHECK (date_from IS NULL OR date_to IS NULL OR date_from <= date_to),
  INDEX idx_reports_created (created_at),
  CONSTRAINT fk_reports_user     FOREIGN KEY (generated_by) REFERENCES users (user_id)
                                 ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_reports_category FOREIGN KEY (category_id) REFERENCES categories (category_id)
                                 ON DELETE SET NULL ON UPDATE RESTRICT,
  CONSTRAINT fk_reports_product  FOREIGN KEY (product_id) REFERENCES products (product_id)
                                 ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;

-- 17. audit_log — admin actions (app) and feedback status changes (trigger) --
CREATE TABLE IF NOT EXISTS audit_log (
  audit_id       BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  actor_user_id  INT UNSIGNED    NULL,
  action         VARCHAR(40)     NOT NULL,
  entity_type    VARCHAR(30)     NOT NULL,
  entity_id      INT UNSIGNED    NOT NULL,
  details        VARCHAR(255)    NULL,
  created_at     DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT pk_audit_log PRIMARY KEY (audit_id),
  INDEX idx_audit_entity (entity_type, entity_id),
  INDEX idx_audit_created (created_at),
  CONSTRAINT fk_audit_actor FOREIGN KEY (actor_user_id) REFERENCES users (user_id)
                            ON DELETE SET NULL ON UPDATE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_ai_ci;
