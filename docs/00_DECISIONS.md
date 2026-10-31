# 00 — Binding Design Decisions (planning stage)

This file records the decisions that every other planning document must follow. If a later document needs to change a decision, it changes it here first. Status: **approved 2026-10-31 (defaults)**, then **simplified the same day to presentation scope (§0)**.

## 0. Presentation scope (overrides everything below where they conflict)

FeedbackAI is a university DBMS demonstration, not a production system. Section 0 takes precedence over this file and over docs 02, 06 and 07.

**Kept:**
- all 12 customer and 8 admin pages;
- the full database: 17 tables, constraints, views, procedures, triggers and seed data, all already built and tested;
- 3-class sentiment with confidence and lexicon-based aspects;
- explainable content-based recommendations;
- admin analytics with filters;
- bcrypt passwords, role checks on backend routes, parameterized SQL and input validation;
- loading, empty and error states.

**Removed or simplified:**

| Area | Was | Now |
|---|---|---|
| Auth | JWT in httpOnly cookie, cookie-parser, status re-check on every request | JWT in the `Authorization: Bearer` header, stored in localStorage. Status and role are checked at login only. |
| Hardening | helmet, express-rate-limit, CORS allowlist | Not used; the Vite proxy makes the app same-origin |
| AI calls | Async worker, claim/PROCESSING state, stale-claim reclaim, retries, text_sha256 guard, internal token | The review is saved first, then Express calls the AI service once with a 5 s timeout. On failure the analysis stays PENDING. An admin "Analyse pending" button and `scripts/analyze-pending.js` process PENDING rows one by one. The PROCESSING, FAILED and attempt columns stay in the schema but are unused. |
| AI service | Batch endpoint, langdetect, shared-secret header, evaluation script | Only `/health` and `/v1/analyze`. Unsupported language is a simple non-Latin-script check. Evaluation against the seed labels is optional. |
| Python | Python 3.11+ required | Try the system Python 3.9 with pinned compatible versions first. Install 3.11 only if that fails. |
| Recommendations | Recency decay, anti-repetition over 3 runs, dismissals, staleness rules, locking | Score = tag similarity + category affinity + search match + quality prior. Exclude already-rated and inactive products. At most 3 per category. Regenerate on every page visit and store the run. |
| Audit | App-level audit for every admin action and a USER_DELETED row | Only the existing trigger (feedback moderation) |
| Pagination | Every list endpoint | Admin users and feedback tables only. Other lists are small. |
| Reports | Stored report metadata plus CSV | On-screen report with filters plus CSV download. Insert into `reports` only to show history. |
| Testing | supertest suites, vitest, full TEST_REPORT | DB constraint tests (done, 83/83) plus one API smoke script, run for real before the demo |
| Docs | EXPLAIN index study, viva Q&A, ER image export | Demo script and README. The ER diagram stays as Mermaid. EXPLAIN is optional. |

## 1. Audit facts (verified 2026-10-31, read-only)

| Area | Finding |
|---|---|
| Repo | 35 tracked files. Express API (9 controllers, 1 router), React SPA (4 components, 1 API module), `schema.sql`, `seed_data.sql`. No tests, no lint config. |
| Frontend deps | react 18.3, react-dom, axios, lucide-react, vite 5.3, @vitejs/plugin-react. **No Tailwind, no Chart.js, no react-router** (the brief assumes they exist). Styling is 807 lines of plain CSS in `frontend/src/index.css` (indigo `#4f46e5` accent, Plus Jakarta Sans). Navigation is `useState` tab switching; `WarehousePortal.jsx` is 981 lines. |
| Backend deps | express 4.19, mysql2 3.9 (promise pool), cors, dotenv. No auth, hashing or validation libraries. |
| Auth | None. The role is a client-side toggle. Every endpoint is public. `customer_id` comes from the request body (defaults to 1). `CustomerPortal` hard-codes customer 1. |
| Passwords | Stored in plaintext in a column named `password_hash` (`'admin123'`, `'customer123'`). |
| Errors | Controllers and the global handler return `error.message` to clients. `cors()` is fully open. |
| Schema | `products.category` is free text (no categories table). Only one CHECK constraint. `stock_movements.transfer_id/purchase_order_id` have no FK. `orders.customer_id ON DELETE CASCADE` deletes order history. |
| Scripts | `schema.sql` runs DROP TABLE and `seed_data.sql` runs TRUNCATE with `FOREIGN_KEY_CHECKS=0`. Destructive and not idempotent. |
| Performance | N+1 queries (`getCustomerOrders`, warehouse allocation loop, `createProduct` inserts). No pagination on any list endpoint. |
| Async errors | `await db.getConnection()` runs outside try/catch. Express 4 does not catch rejected promises, so a pool failure is an unhandled rejection. |
| MySQL server | MySQL 8.0.46 is running on `127.0.0.1:3307` with **datadir `/Users/siribillakanti/Desktop/InventoryOS/mysql_data/`** (the original project's folder). Root has an **empty password**. `sql_mode` includes `ONLY_FULL_GROUP_BY,STRICT_TRANS_TABLES`. `lower_case_table_names=2`. Only `inventory_warehouse_db` exists (25 users, 50 products, 39 orders). |
| Copied data dir | `FeedbackAI/mysql_data/` (197 MB, gitignored) is a stale copy of the live InventoryOS datadir, with the same `auto.cnf` server UUID and a `.pid` file. It must **never** be started on 3307. FeedbackAI will not use it. |
| Clutter | `Archive.zip` (30 MB, older snapshot with node_modules and a `.env`, gitignored), `mysql.log`, `mysql.sock.lock`, `backend/.env.backup`, root `package-lock.json` (empty stub named InventoryOS), `DBMS PRESENTATION.pdf` (InventoryOS presentation, tracked). |
| `.env.example` | Points `DB_SOCKET` at another tool's scratch path (`~/.gemini/antigravity/scratch/mysql.sock`) and says `PORT=5000`, while the real `.env` uses 5001. |
| Toolchain | Node v26.8.2, npm 11.19.1. Python: only the Apple CLT **Python 3.9.6** (no Homebrew Python). `/usr/local/mysql/bin/mysql` client is available. |
| Ports in use | 3307 MySQL. 5000 macOS ControlCenter (AirPlay). 5173 another project's Vite (CustomerPurchasePrediction). 8000 another project's uvicorn. 5001 is the InventoryOS backend's configured port. |

## 2. Environment decisions

- **Database:** `feedback_ai_db` on the **existing MySQL 8.0.46 server at 127.0.0.1:3307**, with a dedicated least-privilege account `feedbackai_app` (SELECT, INSERT, UPDATE, DELETE, EXECUTE on `feedback_ai_db.*` only). DDL is run by a separate `feedbackai_owner` account limited to `feedback_ai_db.*`. `inventory_warehouse_db` is never touched.
  - *Caveat for the user:* the new database's files will physically live under `InventoryOS/mysql_data/feedback_ai_db/`. Option B (a separate, freshly initialised mysqld on port 3308 with its datadir inside FeedbackAI) gives full physical isolation at the cost of a second server to start. **Default: Option A. The user confirms at approval.**
- **Test database:** `feedback_ai_test_db` on the same server, with the same grants. Automated tests create and drop data only there and never touch `feedback_ai_db`.
- **Phase ordering note:** the views, procedures and triggers the app depends on (trigger-created PENDING analysis, `sp_submit_review`, rating views) are built right after Phase 3 as **"P11a"**. Phase 11 then completes the showcase queries and documentation.
- **Ports:** frontend Vite **5174**, Express **5002**, AI service **8001** (bound to 127.0.0.1 only).
- **Python:** the AI service needs **Python 3.11 or 3.12** in `ai-service/.venv`. Current torch/transformers wheels are not guaranteed on 3.9. The user installs it (python.org or Homebrew) at the start of Phase 8.
- **Git safety:** tag `inventoryos-baseline` on the current commit before structural changes. InventoryOS-only code is removed from this workspace in Phase 4 (git history and the original `~/Desktop/InventoryOS` keep it). Workspace clutter is removed only with user approval.

## 3. Stack additions (minimum necessary)

- **Backend:** `bcryptjs` (pure JS, no native build), `jsonwebtoken`, `cookie-parser`, `helmet`, `express-rate-limit`, `zod`. Dev: `supertest` plus built-in `node:test`.
- **Frontend:** `react-router-dom@6`, `tailwindcss@3.4` + `autoprefixer` (postcss is already present), `chart.js@4`, `react-chartjs-2@5`. Keep axios and lucide-react. Dev: `vitest` for utility tests only.
- **AI service:** FastAPI, uvicorn, pydantic v2, transformers, torch (CPU), `langdetect`, pytest, httpx.
- **Auth model:** JWT in an **httpOnly, SameSite=Strict cookie** (same origin through the Vite proxy), 8-hour expiry, user status and role re-checked against the DB on every authenticated request (see 5a.3). bcrypt cost 12. Login is rate-limited.
- **API envelope:** `{ success: true, data, meta? }` / `{ success: false, error: { code, message, fields? } }`. Internal error text is never sent to clients. List endpoints take `page` and `pageSize` (max 100) and return `meta.total`.

## 4. Database schema (17 tables, all lowercase snake_case)

`seed_batch_id` (nullable FK → `seed_batches`, ON DELETE RESTRICT) appears on users, products, ratings, feedback and user_interactions. **NULL means a genuine submission.** All tables use InnoDB and utf8mb4 (`utf8mb4_0900_ai_ci`). Timestamps are `created_at` / `updated_at` DATETIME with defaults.

1. **seed_batches**(seed_batch_id PK, label VARCHAR(60) UNIQUE NN, generator_version VARCHAR(20) NN, rng_seed INT NN, content_sha256 CHAR(64) NN (checksum of the generated seed file, used by the idempotency guard), description VARCHAR(255), created_at)
2. **users**(user_id PK, full_name VARCHAR(100) NN, email VARCHAR(150) UNIQUE NN, password_hash CHAR(60) NN, role ENUM('CUSTOMER','ADMIN') NN DEFAULT 'CUSTOMER', status ENUM('ACTIVE','SUSPENDED') NN DEFAULT 'ACTIVE', seed_batch_id, last_login_at NULL, created_at, updated_at). CHECK email LIKE '%_@_%._%'.
3. **categories**(category_id PK, name VARCHAR(60) UNIQUE NN, slug VARCHAR(70) UNIQUE NN, description VARCHAR(255), display_order SMALLINT NN DEFAULT 0, created_at, updated_at). CHECK slug REGEXP '^[a-z0-9-]+$'.
4. **products**(product_id PK, category_id FK NN **RESTRICT**, name VARCHAR(150) NN, slug VARCHAR(170) UNIQUE NN, brand VARCHAR(80) NN, description TEXT NN, price DECIMAL(10,2) NN CHECK > 0, image_url VARCHAR(255) NULL, is_active TINYINT(1) NN DEFAULT 1, seed_batch_id, created_at, updated_at). UNIQUE(brand, name). INDEX(category_id, is_active). FULLTEXT(name, brand, description).
5. **tags**(tag_id PK, name VARCHAR(40) UNIQUE NN, slug VARCHAR(50) UNIQUE NN): product attributes for content-based recommendations, e.g. `wireless`, `noise-cancelling`, `budget`, `long-battery`.
6. **product_tags**(product_id FK CASCADE, tag_id FK CASCADE, PK(product_id, tag_id), INDEX(tag_id))
7. **user_category_preferences**(user_id FK CASCADE, category_id FK CASCADE, created_at, PK(user_id, category_id)): explicit preferred categories.
8. **ratings**(rating_id PK, user_id FK NN CASCADE, product_id FK NN **RESTRICT**, stars TINYINT NN CHECK BETWEEN 1 AND 5, seed_batch_id, created_at, updated_at). **UNIQUE(user_id, product_id)** means one rating per user per product (it can be updated). INDEX(product_id, stars).
9. **feedback**(feedback_id PK, rating_id FK NN **UNIQUE** CASCADE, title VARCHAR(120) NULL, body TEXT NN CHECK CHAR_LENGTH(body) BETWEEN 10 AND 4000, status ENUM('PUBLISHED','HIDDEN','FLAGGED') NN DEFAULT 'PUBLISHED', moderated_by FK users NULL SET NULL, moderated_at NULL, moderation_note VARCHAR(255) NULL, seed_batch_id, created_at, updated_at). INDEX(status, created_at). INDEX(created_at). A written review always belongs to exactly one rating (1 : 0..1). The user and product come from the rating, so they are not duplicated here (3NF).
10. **sentiment_analysis**(analysis_id PK, feedback_id FK NN **UNIQUE** CASCADE, status ENUM('PENDING','PROCESSING','COMPLETED','FAILED','UNSUPPORTED') NN DEFAULT 'PENDING', label ENUM('POSITIVE','NEUTRAL','NEGATIVE') NULL, score_positive / score_neutral / score_negative DECIMAL(5,4) NULL (each CHECK 0–1), detected_language VARCHAR(10) NULL, model_name VARCHAR(120) NULL, model_version VARCHAR(40) NULL, text_sha256 CHAR(64) NULL, was_truncated TINYINT(1) NN DEFAULT 0, attempt_count TINYINT UNSIGNED NN DEFAULT 0, last_error VARCHAR(255) NULL, analyzed_at NULL, created_at, updated_at). CHECK (status <> 'COMPLETED' OR (label IS NOT NULL AND score_positive IS NOT NULL AND analyzed_at IS NOT NULL)). INDEX(status). INDEX(label). **Confidence is not stored.** It is derived as the score of the stored label (in a view). Original feedback text lives only in `feedback`.
11. **aspects**(aspect_id PK, slug VARCHAR(40) UNIQUE NN, display_name VARCHAR(60) NN, category_id FK NULL RESTRICT; NULL means a general aspect such as delivery or price). Seeded from the same lexicon file the AI service uses.
12. **aspect_sentiments**(aspect_sentiment_id PK, analysis_id FK NN CASCADE, aspect_id FK NN RESTRICT, polarity ENUM('POSITIVE','NEUTRAL','NEGATIVE') NN, score DECIMAL(5,4) NN CHECK 0–1, evidence VARCHAR(300) NN, UNIQUE(analysis_id, aspect_id), INDEX(aspect_id, polarity)). **MIXED** overall sentiment is derived (an analysis with both positive and negative aspects) and is not stored.
13. **user_interactions**(interaction_id BIGINT PK, user_id FK NN CASCADE, interaction_type ENUM('PRODUCT_VIEW','CATEGORY_VIEW','SEARCH','RECOMMENDATION_CLICK') NN, product_id FK NULL **RESTRICT**, category_id FK NULL **RESTRICT**, search_query VARCHAR(120) NULL, recommendation_id FK NULL SET NULL, seed_batch_id, occurred_at DATETIME NN). CHECK shape: views and clicks need product_id, CATEGORY_VIEW needs category_id, SEARCH needs search_query. INDEX(user_id, occurred_at). INDEX(product_id, interaction_type, occurred_at). Ratings and reviews are **not** duplicated here; activity history is a UNION view.
14. **recommendation_runs**(run_id PK, user_id FK NN CASCADE, algorithm_version VARCHAR(20) NN e.g. 'cb-1.0', strategy ENUM('PERSONALIZED','COLD_START') NN, generated_at DATETIME NN, INDEX(user_id, generated_at))
15. **recommendations**(recommendation_id PK, run_id FK NN CASCADE, product_id FK NN CASCADE, rank_position TINYINT NN CHECK 1–50, score DECIMAL(6,4) NN, reason_code ENUM('SIMILAR_TO_RATED','PREFERRED_CATEGORY','SIMILAR_TO_VIEWED','SEARCH_MATCH','TOP_RATED_FALLBACK','POPULAR_FALLBACK') NN, reason_text VARCHAR(255) NN, anchor_product_id FK NULL SET NULL, dismissed_at DATETIME NULL). UNIQUE(run_id, product_id). UNIQUE(run_id, rank_position).
16. **reports**(report_id PK, report_type ENUM('SENTIMENT_SUMMARY','PRODUCT_PERFORMANCE','CATEGORY_SATISFACTION','ASPECT_INSIGHTS','FEEDBACK_EXPORT') NN, generated_by FK users NULL SET NULL, date_from DATE NULL, date_to DATE NULL, category_id FK NULL SET NULL, product_id FK NULL SET NULL, sentiment_filter ENUM('POSITIVE','NEUTRAL','NEGATIVE','MIXED') NULL, row_count INT UNSIGNED NN, created_at). CHECK date_from <= date_to. **Only parameters and metadata are stored.** Report rows are regenerated from SQL and exported as CSV.
17. **audit_log**(audit_id BIGINT PK, actor_user_id FK NULL SET NULL, action VARCHAR(40) NN, entity_type VARCHAR(30) NN, entity_id INT NN, details VARCHAR(255) NULL, created_at). Written by the app for admin actions and by a trigger for feedback status changes. The actor comes from the session variable `@app_actor_id`, which Express sets inside the transaction.

**Deletion policy.** Categories with products cannot be deleted (RESTRICT). Products with any ratings or interactions cannot be deleted (RESTRICT); admins **archive** them with `is_active=0`. Deleting a user cascades to that user's ratings, feedback, analysis, interactions and recommendations. Suspension is the default admin action and deletion needs typed confirmation.

**MySQL gotchas these rules respect:**
- MySQL 8 forbids CHECK constraints on columns used in FK referential actions (error 3823). This is why `user_interactions.product_id` and `category_id` use RESTRICT.
- Triggers do **not** fire for rows changed by FK cascades.
- ONLY_FULL_GROUP_BY is on.

### Views
- `v_product_rating_stats`: count, avg, a Bayesian average with C=5 against the global mean, and the star distribution.
- `v_feedback_details`: feedback with rating, user, product, category, sentiment, derived confidence, `is_mixed` and `is_demo`.
- `v_category_sentiment`
- `v_monthly_feedback_trend`
- `v_aspect_summary`
- `v_product_performance`
- `v_user_activity`: UNION ALL of interactions, ratings and feedback.

### Stored procedures
- `sp_submit_review(user, product, stars, title, body, OUT feedback_id)`: one transaction that upserts the rating and feedback. It uses SIGNAL on business-rule violations.
- `sp_products_above_threshold(min_avg, min_reviews)`
- `sp_category_sentiment(date_from, date_to)`
- `sp_top_reviewers(limit)`
- `sp_monthly_trend(months)`

### Triggers
- `trg_feedback_after_insert`: creates the PENDING `sentiment_analysis` row.
- `trg_feedback_after_update`: when the body changes, resets the analysis to PENDING and deletes its aspect rows. When the status changes, writes to `audit_log`.
- `trg_ratings_before_insert` / `trg_ratings_before_update`: reject an inactive product or a suspended user.
- `trg_users_before_delete` / `trg_users_before_update`: block removing or demoting the last active admin.

## 5. AI sentiment service (Python, `ai-service/`, 127.0.0.1:8001)

- **Model:** `cardiffnlp/twitter-roberta-base-sentiment-latest` (3-class, about 500 MB). It is loaded **once** at startup through FastAPI lifespan and runs on CPU in eval mode. It was trained on tweets, so it is a domain mismatch for reviews. Phase 8 measures accuracy and macro-F1 against the seed corpus's intended labels and may switch to a review-domain model, recording the reason.
- **Label policy:** the label is the argmax. If the top probability is below 0.55, the label becomes NEUTRAL (configurable). The policy version is part of `model_version`.
- **Aspect-based analysis (a separate module, `aspects.py`):**
  1. Split the review into clauses at sentence boundaries and contrast markers (but, though, however, although, except).
  2. Match each clause against a versioned aspect lexicon `lexicon/aspects.json` with general and per-category keyword lists, for example battery life, sound quality, build quality, comfort, display, performance, fit/size, fragrance/skin feel, writing/story, delivery, packaging, price/value, customer service, durability.
  3. Classify each matched clause with the same loaded model, which gives per-aspect polarity, a score and the evidence text.
  
  This is **lexicon-based aspect extraction plus clause-level sentiment**, not a trained ABSA model, and the docs must say so.
- **Endpoints:**
  - `GET /health` returns `{status, model_loaded, model_name, model_version}`.
  - `POST /v1/analyze` takes `{text, category_slug?}` and returns `{label, scores{positive,neutral,negative}, language, was_truncated, aspects[{aspect, polarity, score, evidence}], model_name, model_version}`.
  - `POST /v1/analyze/batch` takes `{items:[{id,text,category_slug?}]}` with at most 32 items.
  - Every request needs the `X-Internal-Token` header (a shared secret from `.env`).
- **Edge cases:**
  - Empty or whitespace text: 422.
  - More than 4000 characters: 413 (Express already enforces this limit).
  - Text over the 512-token limit: truncated, with `was_truncated` set to true.
  - Language other than English (via langdetect, with a minimum length): `UNSUPPORTED` status and no label.
  - Model load failure: `/health` returns 503 and analyze returns 503.
- **Express integration:**
  1. The review is committed first and the user gets 201 immediately.
  2. Analysis then runs asynchronously with a 8-second timeout.
  3. On timeout, connection error or invalid response (validated with zod), the row goes to FAILED, `attempt_count` increments and `last_error` is recorded.
  4. A retry worker runs every 60 seconds, picks up PENDING or FAILED rows with `attempt_count < 5` in batches of 20, and claims them with `UPDATE … SET status='PROCESSING'`. Each claim is guarded by a status check so two workers never process the same row.
  5. If the stored `text_sha256` already matches, the analysis is skipped.
  6. The app keeps working without the AI service: reviews still save and show "Analysis pending".

## 5a. Clarifications added after the risk review

1. **Stale claims:** a row stuck in PROCESSING for more than 5 minutes (e.g. after a crash) can be claimed again by the worker.
2. **Repeated aspects:** if one review mentions the same aspect in several clauses, the clause with the highest score is kept (one row per aspect, per `UNIQUE(analysis_id, aspect_id)`). Its evidence text is stored.
3. **Suspended users:** `requireAuth` re-reads `users.status` and `role` on **every** request (an indexed PK lookup), so a suspended user or demoted admin loses access immediately.
4. **Option A wording:** "Option A" does not touch `inventory_warehouse_db`. It does add two accounts (`feedbackai_app`, `feedbackai_owner`) to the shared server's `mysql` system schema.
5. **Short searches:** search uses FULLTEXT (natural-language mode) for terms of 3 or more characters, with a parameterized `LIKE` prefix fallback for shorter terms (e.g. "tv").
6. **DB errors to HTTP:**
   - SIGNAL SQLSTATE '45000' from triggers and procedures maps to **422** with the SIGNAL message.
   - `ER_DUP_ENTRY` maps to **409**.
   - FK violations `ER_ROW_IS_REFERENCED_2` and `ER_NO_REFERENCED_ROW_2` map to **409** and **422**.
   - Anything else is a 500 with a generic message.
7. **Phase order:** the auth middleware (`requireAuth`, `requireRole`) is built at the **start of Phase 4**. No route ships without its guard. Phase 5 then completes the auth pages, profile and account flows.

8. **Actor variable:** `@app_actor_id` is set inside the transaction and **reset to NULL in `finally`** before the connection goes back to the pool, so a stale actor id cannot leak into the next request.
9. **bcrypt cost in tests:** cost is 12 in production (about 200–400 ms with bcryptjs) and 4 in the test environment through `BCRYPT_COST`.
10. **AI response status:** `/v1/analyze` responses include `status: "OK" | "UNSUPPORTED_LANGUAGE"`. Batch responses report per-item failures as `{id, error}`.
11. **Review endpoint codes:** the review endpoint is an idempotent `PUT /api/me/reviews/:productId` upsert. It returns **201** when it creates the review and **200** when it updates one.
12. **Repetition rule fallback:** if fewer than 10 candidates remain after the anti-repetition exclusion, that rule is relaxed. Exclusions for already-rated, inactive and dismissed products stay in force.
14. **Time zone:** all DATETIME values are stored in **UTC**. The pool sets `timezone: 'Z'` and each session runs `SET time_zone = '+00:00'`. The UI displays times in IST (Asia/Kolkata). Monthly trend grouping uses UTC months, which is documented.
15. **Seeder order and reset:**
    - The rating triggers reject archived products and suspended users, so the seeder inserts ratings first and only then archives products or suspends users.
    - `user_interactions` has no natural key. Its idempotency comes from the `content_sha256` guard plus delete-and-reinsert of that batch's interactions inside the seeding transaction.
    - Reset removes demo rows only, by `seed_batch_id`. It keeps the seeded admins so the last-admin trigger is never hit.
16. **Extra aspects:** the lexicon also includes `camera`, `ease-of-use`, `noise-level`, `installation` and `material-quality`.
17. **Key types:** every PK is `INT UNSIGNED AUTO_INCREMENT`, except `user_interactions` and `audit_log`, which use `BIGINT UNSIGNED`. FK columns match the parent's type and sign exactly. Every FK is declared `ON UPDATE RESTRICT`.
18. **Interaction shape:** the CHECK also requires `category_id IS NULL` on PRODUCT_VIEW and RECOMMENDATION_CLICK rows, so the category is never stored twice. "Only clicks carry `recommendation_id`" is enforced by the API, not a CHECK, because of rule 3823.
19. **Hidden reviews:** moderation hides the written text only. The star rating still counts toward product averages. Abusive ratings are removed by deleting the rating, which cascades to its feedback.
20. **Audit on user delete:** before deleting a user, the API writes one `USER_DELETED` audit row, because the trigger cannot see cascaded deletes. Extra indexes: `audit_log(entity_type, entity_id)` and `reports(created_at)`.
21. **Body comparison:** the feedback update trigger compares bodies with `CAST(... AS BINARY)`, because the `_ai_ci` collation would treat a case-only edit as "unchanged".
22. **Rating trigger scope:** `trg_ratings_before_update` validates only when `stars`, `user_id` or `product_id` actually change, so a no-op seed upsert on a product archived later doesn't fail.
23. **Calling the procedure:** `sp_submit_review` owns its transaction. Express calls it with **no** transaction open on that connection, because a nested `START TRANSACTION` would implicitly commit the caller's work.
24. **Worker write guard:** the worker's final write is `UPDATE … WHERE analysis_id=? AND status='PROCESSING' AND text_sha256=?`. A result for text edited mid-analysis is discarded.
25. **Privileges for DDL:** binary logging is likely on. Creating triggers and procedures as `feedbackai_owner` may need `log_bin_trust_function_creators=1` or running that DDL as root. Phase 3 checks this. Changing a global server variable on the shared server needs user approval.
26. **Constraint test:** the double cascade path from user delete (user → interactions, and user → recommendation runs → recommendations → interactions.recommendation_id SET NULL) gets an explicit constraint test in Phase 3.
27. **DDL account (resolves item 25):** the server has `log_bin=1` and `log_bin_trust_function_creators=0` (checked 2026-10-31). `database/setup.sh` therefore applies all DDL as the server admin account (root). No global variable is changed, and the `feedbackai_owner` account is **dropped from the design**. Procedures are declared `SQL SECURITY INVOKER`. The runtime account `feedbackai_app` stays least-privilege.
28. **Aspect list and category mapping (20 aspects):** `aspects.category_id` allows a single category, so any aspect used in several categories is general (NULL).
    - **General:** delivery, packaging, value-for-money, customer-service, durability, ease-of-use, performance, build-quality, comfort, battery-life, noise-level
    - **Electronics:** sound-quality, display, camera
    - **Fashion:** fit-size, material-quality
    - **Home Appliances:** installation
    - **Beauty and Personal Care:** skin-feel, fragrance
    - **Books:** story-writing
    
    The corpus linter accepts an aspect only if it is general or matches the product's category.
13. **Do not run the copied backend:** `backend/.env` currently points at the live `inventory_warehouse_db`. It must not be run until Phase 4 repoints it at `feedback_ai_db`.

## 6. Recommendation engine (Node, `backend/src/services/recommendations/`, algorithm `cb-1.0`)

This is content-based and explainable. It is **not** collaborative filtering.

- **User profile:** a weighted tag vector built from:
  - rated products, weighted by (stars − 3), so 4–5 stars count positive and 1–2 negative;
  - viewed products at weight 0.3 with a 14-day recency half-life;
  - explicit preferred categories;
  - recent search terms, matched against product FULLTEXT.
- **Score:** `0.40·tag_similarity (cosine) + 0.25·category_affinity + 0.15·search_match + 0.20·quality_prior`, where `quality_prior` is the Bayesian average rating normalised to 0–1.
- **Exclusions:** products the user already rated, inactive products, products dismissed in the last 30 days, and products shown in the user's last 3 runs without a click (anti-repetition).
- **Diversity:** at most 3 products per category in the top 10.
- **Explanation:** each item's reason_code and reason_text come from its strongest contributing term, with an anchor product where one applies, e.g. "Because you rated *Sony WH-1000XM5* 5★".
- **Cold start:** with no ratings or views, use preferred categories plus top Bayesian-rated products. With nothing at all, use popular products (reviews in the last 90 days) plus top rated, requiring at least 3 reviews.
- **Regeneration:** results are regenerated lazily when the latest run is older than 24 hours or the user has rated or reviewed since. Each run is stored in `recommendation_runs` / `recommendations`.

## 7. Seed data

Seed data is defined in `docs/05_SEED_DATA_STRATEGY.md`. In outline:

- 1 batch label `demo-v1`, 25 users (2 admins, 23 customers), 6 categories, 36 products, about 200 reviews, about 230 ratings (some without text), about 900 interactions, spread over 14 months.
- The review text is a **hand-authored corpus**: written per product type, with no template substitution, and committed as JSON with an intended sentiment and aspects for each review.
- A deterministic generator (fixed RNG seed) assigns reviews to users and dates. An idempotent Node seeder upserts on natural keys (email, slug, (user_id, product_id)) in a transaction.
- Sentiment for the seed data comes from the **real AI pipeline** in batch mode (`backend/scripts/analyze-pending.js`).
- Seed rows carry `seed_batch_id` and the UI labels them "Demo data". Nothing is ever labelled a verified purchase.

## 8. UI direction

- **Palette:** ivory paper `#FAF7F0` background, white `#FFFFFF` surfaces, ink `#1C2333`, secondary ink `#4A5163`, rule lines `#E4DED2`, one restrained accent (deep spruce `#2F5D50`).
- **Sentiment colours:** positive `#3B7A57`, neutral `#8A8577`, negative `#B5452F`, mixed `#B9852E`.
- **Fonts:** Source Serif 4 for selected page titles only, IBM Plex Sans for the UI, IBM Plex Mono (tabular numerals) for figures.
- **Shape:** 4px radius, 1px rules, shadows only on popovers and modals. No gradients, glass, glow or "AI" badges.
- **Pages:** tables are the primary admin pattern, with sorting, filters and pagination. All colours are verified for WCAG AA contrast in Phase 6.

## 9. Folder structure (target)

```
FeedbackAI/
  PROJECT_TODO.md
  README.md
  docs/            00–07 planning docs, later ER image, API reference, demo script
  database/        00_create_database.sql, 01_schema.sql, 02_views.sql, 03_procedures.sql,
                   04_triggers.sql, queries/dbms_showcase.sql, tests/constraint_tests.sql,
                   seed/{corpus/*.json, catalog.json, generate.py, generated/demo-v1.json}
  backend/         src/{app.js, server.js, config/, middleware/, routes/, controllers/,
                   services/{sentimentClient.js, analysisWorker.js, recommendations/, reports/},
                   validators/, utils/}, scripts/{migrate.js, seed.js, analyze-pending.js}, tests/
  ai-service/      app/{main.py, config.py, model.py, aspects.py, language.py, schemas.py},
                   lexicon/aspects.json, scripts/evaluate.py, tests/, requirements.txt
  frontend/        src/{main.jsx, App.jsx (routes), styles/, lib/, context/AuthContext.jsx,
                   components/{ui/, layout/, charts/}, pages/{customer/, admin/}}
```

## 10. Planning document ownership

| File | Covers |
|---|---|
| 01_TECHNICAL_ASSESSMENT.md | Reuse, modify, retire, build new; debt, bugs and security; migration risks; dependency conflicts; bottlenecks |
| 02_ARCHITECTURE.md | System architecture, folder structure, API surface, AI service, recommendation engine, frontend and UI system |
| 03_DATABASE_DESIGN.md | ER diagram, relational schema, data dictionary, FKs and deletion rules, normalization, constraints, indexes |
| 04_DBMS_OBJECTS_AND_QUERIES.md | Views, procedures, triggers, transactions, the required analytical queries |
| 05_SEED_DATA_STRATEGY.md | Seed dataset design, realism rules, idempotency, provenance, seed analysis |
| 06_RISKS_AND_BOTTLENECKS.md | Cause, impact and solution for each risk |
| 07_IMPLEMENTATION_PLAN.md | Phased plan, gates, test plan |
| ../PROJECT_TODO.md | Task tracker |
