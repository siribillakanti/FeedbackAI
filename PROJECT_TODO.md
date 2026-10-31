# FeedbackAI — Project TODO

**Scope:** presentation and demo build. See [docs/00_DECISIONS.md §0](docs/00_DECISIONS.md) for what was simplified.
**Last updated:** 2026-10-31
**Current phase:** Phase 8, AI sentiment analysis (next). Customer frontend (Phase 6) complete.

**Statuses:** NOT STARTED · IN PROGRESS · BLOCKED · COMPLETED. A task is COMPLETED only when its acceptance check was actually run and passed.
**Priority:** P0 needed for the demo · P1 asked for in the brief · P2 nice to have

## Progress

| Phase | Name | Tasks | Done | Notes |
|---|---|---:|---:|---|
| 1 | Existing project audit | 4 | 3 | Clutter deletion is waiting on the user |
| 2 | Architecture and ER diagram | 3 | 3 | |
| 3 | Database schema and seed dataset | 7 | 7 | 83/83 constraint tests pass; seed runs are idempotent |
| 4 | Backend APIs | 5 | 5 | Combined smoke check: 17/17 expected statuses |
| 5 | Authentication and authorization | 3 | 3 | Frontend auth checked in the browser |
| 6 | Customer frontend | 6 | 6 | All customer pages checked at desktop and 375 px |
| 7 | Feedback and rating management | 3 | 2 | Customer side done; admin moderation page is with Phase 10 |
| 8 | AI sentiment analysis | 4 | 0 | |
| 9 | Personalised recommendations | 2 | 0 | |
| 10 | Admin analytics and reports | 5 | 0 | |
| 11 | DBMS procedures, triggers and views | 4 | 3 | Built together with Phase 3 |
| 12 | Testing and debugging | 3 | 0 | |
| 13 | Documentation and demonstration | 3 | 0 | |

Estimated remaining effort: **about 28 hours**.

---

## PHASE 1 — Existing project audit

| ID | Task | Description | Pri | Status | Deps | Files | Acceptance |
|---|---|---|---|---|---|---|---|
| P1-T01 | Audit InventoryOS | Frontend, backend, auth, DB config, schema, dependencies, ports | P0 | COMPLETED | — | `docs/01_TECHNICAL_ASSESSMENT.md` | Assessment written. Frontend build checked (passed). |
| P1-T02 | Bugs and security list | Debt, bugs and weaknesses, with file:line | P1 | COMPLETED | P1-T01 | `docs/01_TECHNICAL_ASSESSMENT.md` | 25 findings with fixes |
| P1-T03 | Baseline tag | Tag InventoryOS before changes | P0 | COMPLETED | — | git tag `inventoryos-baseline` | `git tag -n1` shows it on e92f6ed |
| P1-T04 | Clean workspace clutter | Remove the copied `mysql_data/` (197 MB), `Archive.zip`, `mysql.log`, `mysql.sock.lock`, `backend/.env.backup`, the root `package-lock.json` stub, and the InventoryOS `schema.sql`/`seed_data.sql` | P2 | BLOCKED | — | repo root | **Waiting for the user to confirm the list.** The copied `mysql_data` is never started. |

## PHASE 2 — Architecture and ER diagram

| ID | Task | Description | Pri | Status | Deps | Files | Acceptance |
|---|---|---|---|---|---|---|---|
| P2-T01 | Decisions and scope | Binding decisions plus the simplified presentation scope | P0 | COMPLETED | P1-T01 | `docs/00_DECISIONS.md` | Approved by the user 2026-10-31. Scope simplified at the user's request. |
| P2-T02 | Architecture | Containers, flows, folder layout, API list | P1 | COMPLETED | P2-T01 | `docs/02_ARCHITECTURE.md` | Written. Where it conflicts with 00 §0, §0 wins. |
| P2-T03 | ER diagram and schema design | Mermaid ER, data dictionary, FKs, normalization, DBMS objects, seed plan | P0 | COMPLETED | P2-T01 | `docs/03_DATABASE_DESIGN.md`, `docs/04_DBMS_OBJECTS_AND_QUERIES.md`, `docs/05_SEED_DATA_STRATEGY.md` | Written |

## PHASE 3 — Database schema and seed dataset

| ID | Task | Description | Pri | Status | Deps | Files | Acceptance |
|---|---|---|---|---|---|---|---|
| P3-T01 | Databases and app account | `feedback_ai_db`, `feedback_ai_test_db`, `feedbackai_app` with DML and EXECUTE grants on those two DBs only. DDL runs as root because of binlog settings. | P0 | COMPLETED | P2-T03 | `database/setup.sh`, `backend/.env` | Setup ran twice without errors. The app account cannot read `inventory_warehouse_db` or run DDL (tested). |
| P3-T02 | Schema DDL | 17 tables with PK, FK, UNIQUE, CHECK, ENUM, indexes and FULLTEXT | P0 | COMPLETED | P3-T01 | `database/01_schema.sql` | Applied to both DBs; 17 tables present |
| P3-T03 | Constraint tests | Duplicates, ranges, shapes, RESTRICT and CASCADE, triggers, procedures, views | P0 | COMPLETED | P3-T02 | `database/tests/run_constraint_tests.sh` | **83 passed, 0 failed** (run 2026-10-31). The test DB is left empty. |
| P3-T04 | Catalogue and lexicon | 6 categories, 36 fictional-brand products, 97 tags (4–6 per product, every product shares at least one), 20 aspects | P0 | COMPLETED | P3-T02 | `database/seed/catalog.json`, `ai-service/lexicon/aspects.json` | The seeder loads it. 0 products without a shared tag. |
| P3-T05 | Review corpus | 200 hand-written reviews: 50% positive, 20% negative, 20% mixed, 10% neutral; short, medium and detailed; typos; one Hindi; one sarcastic | P0 | COMPLETED | P3-T04 | `database/seed/corpus/*.json` | Lint reports 0 errors and 7 warnings. 4 aspects are under 8 mentions, and 3 products sit outside their quality profile. Both are accepted. |
| P3-T06 | Generator and seeder | Deterministic generator, idempotent seeder, reset that touches demo rows only | P0 | COMPLETED | P3-T05 | `database/seed/generate.py`, `backend/scripts/seed.js`, `database/seed/README.md` | Tested: generation is byte-identical; a re-run is a no-op; seed → reset → seed gives identical counts; genuine rows survive a reset. Two bugs were found and fixed (reset left the checksum; reseed duplicated audit rows). |
| P3-T07 | Seed validation | 18 checks: duplicates, date order, archived and suspended rules, moderation | P1 | COMPLETED | P3-T06 | `database/seed/validate.sql` | All "expect 0 rows" checks are empty. The DB has 25 users, 36 products, 229 ratings, 200 reviews (all PENDING analysis) and 920 interactions. InventoryOS still has 25 users. |

## PHASE 4 — Backend APIs

| ID | Task | Description | Pri | Status | Deps | Files | Acceptance |
|---|---|---|---|---|---|---|---|
| P4-T01 | Backend skeleton | Remove the InventoryOS controllers (kept in the git tag); add app setup, error handler, the `{success, data}` response shape, and DB error mapping (45000 to 422, duplicate to 409) | P0 | COMPLETED | P3-T02 | `backend/src/app.js`, `server.js`, `middleware/`, `utils/` | Server on 5002, `/api/health` OK, error mapping incl. 1216/1217 (tested 2026-10-31) |
| P4-T02 | Auth middleware | `requireAuth` (verifies the Bearer JWT) and `requireRole('ADMIN')` | P0 | COMPLETED | P4-T01 | `backend/src/middleware/auth.js` | 401 without token, 403 with wrong role, 401 on a bad token (tested) |
| P4-T03 | Catalogue API | Categories and products: list, filter, search (FULLTEXT, with LIKE for short terms), product detail with rating stats and reviews | P0 | COMPLETED | P4-T01 | `routes/catalog.js` | 90/90 JSON checks against SQL; FULLTEXT and short LIKE search; interactions logged for customers only (tested) |
| P4-T04 | Customer "me" API | Submit or edit a review (`sp_submit_review`), my reviews, activity (`v_user_activity`), profile and preferences | P0 | COMPLETED | P4-T02 | `routes/me.js` | 201 create / 200 update via `sp_submit_review`, PENDING analysis, no duplicate rating, 422 on archived product (tested) |
| P4-T05 | Admin CRUD API | Users (suspend or delete), products (archive when they have history), categories, feedback moderation | P0 | COMPLETED | P4-T02 | `routes/admin/*.js` | Product/category RESTRICT gives 409, FA_LAST_ADMIN gives 422, moderation writes audit row with actor (tested) |

## PHASE 5 — Authentication and authorization

| ID | Task | Description | Pri | Status | Deps | Files | Acceptance |
|---|---|---|---|---|---|---|---|
| P5-T01 | Register and login API | bcrypt (cost from env), JWT for 8 hours, zod validation; suspended users cannot log in | P0 | COMPLETED | P4-T02 | `routes/auth.js` | Register 201 / duplicate 409, login 200 / 401, suspended 403, 72-byte password cap, constant-time unknown email (tested) |
| P5-T02 | Frontend auth | AuthContext, token in localStorage, protected routes per role, logout | P0 | COMPLETED | P5-T01, P6-T01 | `frontend/src/context/AuthContext.jsx`, `lib/api.js`, `components/layout/Layouts.jsx` | Tested 2026-10-31: a customer opening `/admin/users` lands on `/account`, an admin opening `/account/*` lands on `/admin`, a guest goes to `/login?next=…`, a reload keeps the session, and a rejected token is cleared |
| P5-T03 | Login and register pages | Labelled forms with validation messages | P0 | COMPLETED | P5-T02 | `pages/customer/Login.jsx`, `Register.jsx` | Tested: inline errors for empty fields, wrong password ("Incorrect email or password.") and duplicate email; register saves the chosen categories and follows `?next=` |

## PHASE 6 — Customer frontend

| ID | Task | Description | Pri | Status | Deps | Files | Acceptance |
|---|---|---|---|---|---|---|---|
| P6-T01 | Frontend foundation | Tailwind, React Router, Chart.js; design tokens (ivory, ink, spruce; serif titles); shared UI components (Button, Input, Table, Modal, Toast, Empty, Error, Skeleton, StarRating, SentimentTag) | P0 | COMPLETED | — | `frontend/` | `vite build` passes. Tokens as RGB channels in `styles/index.css` (mapped in `tailwind.config.js`), IBM Plex and Source Serif 4, no gradients or glass. Shared UI in `components/ui/`. Port 5174, proxy to 5002 |
| P6-T02 | Landing, Explore, Category | Landing page, product grid with filters and search, category pages | P0 | COMPLETED | P6-T01, P4-T03 | `pages/customer/` | Category, rating, tag and text filters plus sort and page live in the URL; loading, empty ("No products match these filters") and error states shown (tested) |
| P6-T03 | Product details | Rating summary, star distribution, aspect highlights, reviews (demo reviews labelled) | P0 | COMPLETED | P6-T02 | `pages/customer/ProductDetail.jsx` | Star histogram, weighted (Bayesian) score explained, aspect and sentiment panels with empty states until Phase 8 runs, paginated reviews with "Demo data" and "Analysis pending" labels, archived notice (tested) |
| P6-T04 | Customer dashboard and Activity | Recent activity, my stats, top recommendations | P1 | COMPLETED | P4-T04 | `pages/customer/Dashboard.jsx`, `Activity.jsx` | Figures and timeline match `/api/me/summary` and `v_user_activity` (which now also returns product and category slugs). Recommendations are added in P9-T02 |
| P6-T05 | Profile | Edit name and preferred categories | P1 | COMPLETED | P4-T04 | `pages/customer/Profile.jsx` | Name and preferred categories persist after a reload; a wrong current password shows "Incorrect password" (tested) |
| P6-T06 | Responsive pass | Layouts checked at phone width | P1 | COMPLETED | P6-T02…T05 | — | At 375 px every customer page has `scrollWidth` 375 (no horizontal scroll); the header collapses into a menu |

## PHASE 7 — Feedback and rating management

| ID | Task | Description | Pri | Status | Deps | Files | Acceptance |
|---|---|---|---|---|---|---|---|
| P7-T01 | Write review | Star rating, title, text with character limits; edit an existing review | P0 | COMPLETED | P4-T04, P6-T03 | `pages/customer/WriteReview.jsx` | Tested: rating required, body 10–4000 or empty, a second submit edits (prefilled), an existing text cannot be blanked, toast says analysis is pending while the AI service is down |
| P7-T02 | My feedback | List of my reviews with sentiment tags; edit or delete | P0 | COMPLETED | P7-T01 | `pages/customer/MyFeedback.jsx` | Lists ratings with sentiment status and aspects; delete asks for confirmation (Escape cancels) and shows an empty state afterwards (tested) |
| P7-T03 | Admin feedback management | Table with filters (sentiment, status, product, date) and hide/flag/publish actions | P0 | NOT STARTED | P4-T05 | `pages/admin/Feedback.jsx` | A moderation action writes an audit row via the trigger |

## PHASE 8 — AI sentiment analysis

| ID | Task | Description | Pri | Status | Deps | Files | Acceptance |
|---|---|---|---|---|---|---|---|
| P8-T01 | Python environment | Try system Python 3.9 with pinned fastapi/transformers/torch versions; if that fails, install 3.11 (needs the user) | P0 | NOT STARTED | — | `ai-service/requirements.txt`, `.venv` | Imports succeed and the model downloads once |
| P8-T02 | Sentiment service | FastAPI `/health` and `/v1/analyze`. The model loads once at startup. 3-class label plus scores; neutral threshold; truncation; unsupported-script check | P0 | NOT STARTED | P8-T01 | `ai-service/app/` | Sample reviews give sensible labels; Hindi returns UNSUPPORTED |
| P8-T03 | Aspect module | Clause split plus lexicon match plus per-clause sentiment | P0 | NOT STARTED | P8-T02 | `ai-service/app/aspects.py` | "great sound, battery drains fast" gives sound-quality POSITIVE and battery-life NEGATIVE |
| P8-T04 | Express integration and seed analysis | Call the service after saving a review (5 s timeout; PENDING on failure); `analyze-pending.js` runs over all 200 seed reviews; admin "Analyse pending" button | P0 | NOT STARTED | P8-T03, P4-T04 | `backend/src/services/sentimentClient.js`, `backend/scripts/analyze-pending.js` | All seed reviews are COMPLETED (Hindi UNSUPPORTED); stopping the AI service doesn't break review submission |

## PHASE 9 — Personalised recommendations

| ID | Task | Description | Pri | Status | Deps | Files | Acceptance |
|---|---|---|---|---|---|---|---|
| P9-T01 | Recommendation engine | Content-based: tag similarity, category affinity, search match and quality prior; excludes rated and inactive products; at most 3 per category; a reason for each item; cold-start fallback; each run stored | P0 | NOT STARTED | P4-T04 | `backend/src/services/recommendations/` | Ananya gets electronics and books with reasons; Zoya gets the top-rated fallback |
| P9-T02 | Recommendations page | Cards with an explanation line; a click logs RECOMMENDATION_CLICK | P0 | NOT STARTED | P9-T01, P6-T01 | `pages/customer/Recommendations.jsx` | Reasons shown; clicks recorded |

## PHASE 10 — Admin analytics and reports

| ID | Task | Description | Pri | Status | Deps | Files | Acceptance |
|---|---|---|---|---|---|---|---|
| P10-T01 | Admin dashboard | Totals, average rating, positive/negative/neutral %, volume over time, top and bottom products, category satisfaction, common complaints and praised features, with date/category/product/sentiment filters | P0 | NOT STARTED | P8-T04 | `pages/admin/Dashboard.jsx`, `routes/admin/analytics.js` | Every number matches a hand-run SQL query |
| P10-T02 | Sentiment analysis page | Label distribution, confidence spread, aspect breakdown, rating-vs-sentiment disagreements | P1 | NOT STARTED | P10-T01 | `pages/admin/Sentiment.jsx` | Charts use real data |
| P10-T03 | Product performance | Sortable table from `v_product_performance` | P1 | NOT STARTED | P10-T01 | `pages/admin/ProductPerformance.jsx` | Sorting and filtering work |
| P10-T04 | Users, products and categories management pages | CRUD tables with confirmations | P0 | NOT STARTED | P4-T05 | `pages/admin/` | Archive and suspend work; delete asks for confirmation |
| P10-T05 | Reports | Pick a report type and filters, view it on screen, download CSV, keep a history row | P1 | NOT STARTED | P10-T01 | `pages/admin/Reports.jsx` | The CSV row count matches the screen |

## PHASE 11 — DBMS procedures, triggers and views

| ID | Task | Description | Pri | Status | Deps | Files | Acceptance |
|---|---|---|---|---|---|---|---|
| P11-T01 | Views | 7 views (rating stats with Bayesian average, feedback details, category sentiment, monthly trend, aspect summary, product performance, user activity) | P0 | COMPLETED | P3-T02 | `database/02_views.sql` | All select without error under ONLY_FULL_GROUP_BY (constraint tests). Rating stats checked on real data. |
| P11-T02 | Stored procedures | `sp_submit_review` (transaction plus SIGNAL) and 4 reporting procedures | P0 | COMPLETED | P3-T02 | `database/03_procedures.sql` | The happy path and the rollback path are both tested |
| P11-T03 | Triggers | PENDING analysis on insert, reset on edit, moderation audit, rating guards, last-admin guard | P0 | COMPLETED | P3-T02 | `database/04_triggers.sql` | Positive and negative tests pass |
| P11-T04 | Showcase SQL script | DDL/DML samples, joins, GROUP BY/HAVING, subqueries, window function, and the 7 required queries, run against the real data | P1 | NOT STARTED | P8-T04 | `database/queries/dbms_showcase.sql` | Every query runs and returns sensible rows after the seed analysis |

## PHASE 12 — Testing and debugging

| ID | Task | Description | Pri | Status | Deps | Files | Acceptance |
|---|---|---|---|---|---|---|---|
| P12-T01 | API smoke script | One script covering register, login, role 403, product CRUD, category CRUD, review submit, duplicate rating, AI down/up, recommendations, analytics, report filter | P0 | NOT STARTED | P10-T05 | `backend/scripts/smoke-test.js` | All checks pass; output saved |
| P12-T02 | Click-through test | Every page in the browser: loading, empty and error states; phone width | P0 | NOT STARTED | P10-T05 | — | No console errors and no broken routes |
| P12-T03 | InventoryOS independence | The original project still runs against its own DB | P0 | NOT STARTED | P12-T01 | — | `inventory_warehouse_db` row counts unchanged (25 users today) |

## PHASE 13 — Documentation and demonstration

| ID | Task | Description | Pri | Status | Deps | Files | Acceptance |
|---|---|---|---|---|---|---|---|
| P13-T01 | README | Setup in order: DB, seed, AI service, backend, frontend; demo accounts | P0 | NOT STARTED | P12-T01 | `README.md` | Someone else can follow it |
| P13-T02 | Demo script | 10-minute walkthrough: customer flow, live review, sentiment and aspects, recommendation reasons, admin analytics, DBMS objects | P0 | NOT STARTED | P12-T02 | `docs/DEMO_SCRIPT.md` | Rehearsed once end to end |
| P13-T03 | Docs touch-up | Keep 03 (ER, normalization) and 04 (DBMS objects) in line with the final SQL | P1 | NOT STARTED | P11-T04 | `docs/03_*.md`, `docs/04_*.md` | No mismatches with `database/*.sql` |
