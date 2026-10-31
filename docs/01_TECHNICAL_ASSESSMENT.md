# 01 — Technical Assessment of the InventoryOS Codebase

**Status:** planning stage. Every finding below comes from read-only inspection on 2026-10-31. No application code or database was changed. Binding decisions are in [00_DECISIONS.md](00_DECISIONS.md).

## 1. Executive summary

InventoryOS is a small, working, single-page inventory demo: an Express REST API with 9 controllers over 12 MySQL tables, and a React SPA with 4 components. Its strengths are the ones FeedbackAI can inherit:

- a clean `mysql2/promise` pool;
- consistently parameterised SQL;
- correct use of transactions with `SELECT … FOR UPDATE` for stock changes;
- a simple `{ success, data }` response shape.

It is **not** a foundation for a multi-user product as it stands:

- There is **no authentication or authorization**. The role is a client-side toggle and every endpoint is public.
- **Passwords are stored in plaintext.**
- Internal error messages leak to clients.
- There is no input validation layer, no pagination, no routing and no tests.
- The brief assumes Tailwind and Chart.js are present. **Neither is installed**, and there are no charts anywhere in the app.

The domain (warehouses, stock, orders, suppliers) does not overlap with FeedbackAI's domain (feedback, sentiment, recommendations). Only the infrastructure carries over: the DB pool, the Express skeleton, the Vite setup, the API client pattern and lucide-react. The domain code is retired from this workspace, not adapted.

**The most urgent risk:** the copied `backend/.env` still points at the **live InventoryOS database** (`inventory_warehouse_db` on 127.0.0.1:3307). Running this copy's backend before reconfiguring it would read and write the original project's data. See §5, risk M1.

**Baseline build check (executed):** `npx vite build` on Node v26.8.2 succeeded with Vite 5.4.21 (1565 modules, JS 249.94 kB / 76.34 kB gzip, CSS 12.15 kB). The output went to the session scratchpad, not the workspace. The backend was **not** started, because it would connect to the live InventoryOS database.

## 2. Current-state inventory

### 2.1 Frontend (`frontend/`)

| Item | State |
|---|---|
| Build | Vite 5 (`^5.3.1`, resolves to 5.4.21) and `@vitejs/plugin-react`. Dev server on 5173 with an `/api` proxy to `localhost:5001` (`vite.config.js:11`). |
| Entry | `main.jsx` renders `<App/>` in StrictMode. `App.jsx` (84 lines) holds the cart state and a `role` toggle. |
| Routing | **None.** `role` (`App.jsx:8`), `activeTab` (CustomerPortal) and `activeNav` (WarehousePortal) are `useState`. A refresh loses the page, there are no deep links and the back button does nothing. |
| Components | `Header.jsx` (52 lines, role toggle at `:34`/`:42`), `CustomerPortal.jsx` (266), `OrderModal.jsx` (198), `WarehousePortal.jsx` (981, a monolith with 8 views and 3 modal forms). |
| API client | `services/api.js` is a single axios instance with `baseURL: '/api'` and one exported function per endpoint. This is a good pattern to keep. |
| Styling | `index.css` has 807 lines of plain CSS with custom properties: indigo accent `#4f46e5`, slate palette, Plus Jakarta Sans and JetBrains Mono (Google Fonts in `index.html`). There are 116 inline `style={{…}}` objects (WarehousePortal 70, OrderModal 35, CustomerPortal 11). **No Tailwind.** |
| Charts / analytics | **None.** Chart.js and react-chartjs-2 are not dependencies. The dashboard shows number tiles and tables only. |
| Icons | `lucide-react ^0.395.0`, used consistently. |
| Assets | 3 JPGs in `public/images`. Product images are chosen by keyword-matching the product name (`CustomerPortal.jsx` `getProductImage`). |
| Feedback UX | `alert()` for errors in 5 places (`WarehousePortal.jsx:114,129,144,159,173`). A toast `notification` uses `setTimeout`. Load errors only go to `console.error`, so the user sees an empty page. |

### 2.2 Backend (`backend/`)

| Item | State |
|---|---|
| Runtime | Express 4.19 (CommonJS). `server.js` contains `cors()`, `express.json()`, a request logger, a health route `/`, a 404 handler and a global error handler. |
| DB layer | `config/db.js` is a `mysql2/promise` pool (`connectionLimit 10`). A connection probe at start-up logs failures but does not stop the app. The optional `DB_SOCKET` path is supported. |
| Structure | `routes/api.js` maps everything under `/api`, with 9 controller files. There are no services, middleware, validators or repositories. |
| SQL safety | All values go through `?` placeholders. Dynamic `WHERE` clauses are built from fixed strings (`inventoryController.js:24`, `purchaseOrderController.js:11`). **No SQL injection was found.** |
| Transactions | Used correctly for stock-in, stock-out, transfers, orders, product creation and PO receipt, with `FOR UPDATE` on stock rows. |
| Tests / lint | None. `package.json` has only `start` and `dev` scripts. |

### 2.3 API routes (all public; none require authentication)

| Method | Path | Controller | Notes |
|---|---|---|---|
| GET | `/api/products`, `/api/products/:id` | productController | Unpaginated. Stock is aggregated with a JOIN. |
| POST / PATCH | `/api/products`, `/api/products/:id` | productController | No validation on PATCH. Negative prices are accepted. |
| GET | `/api/inventory`, `/api/inventory/low-stock` | inventoryController | Filters: warehouse, category, search. |
| POST | `/api/inventory/stock-in`, `/stock-out` | inventoryController | Transactional. |
| GET / POST / PATCH | `/api/orders`, `/orders/:id`, `/orders/customer/:customerId`, `/orders/:id/status` | orderController | `customer_id` comes from the body. Any caller can read any customer's orders. |
| GET | `/api/warehouses`, `/api/warehouses/:id` | warehouseController | |
| GET | `/api/movements`, `/api/movements/product/:productId` | movementController | Full table, unpaginated. |
| GET / POST | `/api/transfers` | transferController | |
| GET | `/api/dashboard`, `/api/dashboard/summary` | dashboardController | 7 sequential queries. |
| GET / POST | `/api/suppliers`, `/api/suppliers/:id` | supplierController | |
| GET / POST / PATCH | `/api/purchase-orders`, `/:id`, `/:id/status` | purchaseOrderController | |

### 2.4 Authentication and authorization

There is none. `users.role` exists in the schema (CUSTOMER, WAREHOUSE_MANAGER, ADMIN), but nothing reads it: there is no login route, token, session or middleware. The "Warehouse WMS" view is one click away for anyone (`Header.jsx:42`). The checkout hard-codes `customer_id: 1` (`OrderModal.jsx:19`, `CustomerPortal.jsx:35`), and the server defaults to 1 as well (`orderController.js:7`).

### 2.5 Database configuration

| Item | State |
|---|---|
| Server | MySQL 8.0.46 on `127.0.0.1:3307`. The datadir is `~/Desktop/InventoryOS/mysql_data/`, i.e. the **original** project's folder. |
| Credentials | `root` with an **empty password**. |
| Modes | `sql_mode` has `ONLY_FULL_GROUP_BY` and `STRICT_TRANS_TABLES`. `lower_case_table_names=2`. |
| Database | `inventory_warehouse_db` is the only application schema: 12 tables, about 25 users, 50 products, 39 orders, 366 movements. |
| Workspace copy | `FeedbackAI/mysql_data/` (197 MB, gitignored) is a stale copy of the live datadir, with the same `auto.cnf` server UUID and a `.pid` file. **Do not start it.** |
| Env keys | `backend/.env`: `PORT`, `DB_HOST`, `DB_PORT`, `DB_USER`, `DB_PASSWORD`, `DB_NAME`. `backend/.env.example` and `backend/.env.backup` add `DB_SOCKET`. `.env` and `.env.*` are gitignored, except `.env.example`, which is tracked. |
| Env drift | `.env.example` says `PORT=5000` (`:1`), while the real `.env` uses 5001 and the Vite proxy expects 5001. Port 5000 is taken by macOS ControlCenter (AirPlay). `DB_SOCKET` points at another tool's scratch directory (`.env.example:7`). |

### 2.6 Schema (`schema.sql`, 12 tables)

| Table | Observations |
|---|---|
| `users` | `password_hash VARCHAR(255)` holds plaintext (`schema.sql:168` seeds `'admin123'`). Has `UNIQUE email`. No status column. |
| `products` | `category VARCHAR(100)` is free text (`:43`), with no categories table, which invites update anomalies. Price has no CHECK. |
| `inventory` | Composite UNIQUE(product, warehouse) is good. `quantity` has no CHECK ≥ 0 (`:55`). |
| `orders` | `customer_id … ON DELETE CASCADE` (`:90`), so deleting a user deletes their order history. |
| `order_items` / `purchase_order_items` | `quantity` has no CHECK > 0 (`:99`, `:122`). |
| `stock_movements` | `transfer_id` and `purchase_order_id` have **no FK** (`:136-137`), so orphans are possible. |
| `warehouse_transfers` | The schema's only CHECK (source ≠ destination). |

Indexes exist only on PK, UNIQUE and FK columns. There are no views, procedures or triggers.

`schema.sql` begins with `DROP TABLE IF EXISTS …` (`:6-17`). `seed_data.sql` runs `TRUNCATE` on every table with `FOREIGN_KEY_CHECKS=0` (`seed_data.sql:9-22`). Both scripts are destructive and non-idempotent.

### 2.7 Dependencies

| Package | Version | FeedbackAI fate |
|---|---|---|
| express | ^4.19.2 | Keep. Express 4 does not catch async errors, so add a wrapper. |
| mysql2 | ^3.9.7 | Keep. |
| cors | ^2.8.5 | Keep, but restrict to the Vite origin. With the same-origin proxy it is needed only for direct calls. |
| dotenv | ^16.4.5 | Keep, and add start-up validation of required keys. |
| react / react-dom | ^18.3.1 | Keep. |
| axios | ^1.7.2 | Keep. |
| lucide-react | ^0.395.0 | Keep. |
| vite / plugin-react | ^5.3.1 / ^4.3.1 | Keep. The build is verified on Node 26. |
| *(missing)* | | Add the libraries listed in 00_DECISIONS §3: auth, validation, security headers, rate limiting, routing, Tailwind, Chart.js. |
| root `package-lock.json` | | An empty stub named `InventoryOS`. Delete it once approved. |

## 3. Reuse / Modify / Retire / Build-new

### 3.1 Reuse (keep largely as is)

| File(s) | Reason |
|---|---|
| `backend/src/config/db.js` | The pool configuration is sound. Only the env defaults change (`DB_NAME=feedback_ai_db`, `DB_USER=feedbackai_app`, and the default must not be `inventory_warehouse_db`). |
| `backend/src/server.js` (skeleton) | The middleware order, 404 handler and global handler are the right shape. It will be split into `app.js` (testable with supertest) and `server.js` (listen). |
| `{ success, data }` response shape | Extended to the envelope in 00_DECISIONS §3, so the frontend parsing pattern carries over. |
| Transaction pattern (`getConnection → beginTransaction → commit/rollback → release`) | The proven pattern for review submission, admin moderation and seeding. It moves into a `withTransaction(fn)` helper. |
| Parameterised dynamic filters (`inventoryController.js:3-24`) | The template for the admin feedback and report filters (date, category, product, sentiment). |
| `frontend/src/services/api.js` pattern | One axios instance with named endpoint functions. The endpoints change, the pattern stays. |
| `frontend/vite.config.js` | Keep the proxy approach. Change the ports (5174 → 5002). |
| `lucide-react` | Already the icon set. Restrained use fits the editorial direction. |
| `.gitignore` | Already excludes `.env`, `mysql_data/`, sockets, logs and `Archive.zip`. Add `ai-service/.venv/`, `__pycache__/` and the Hugging Face cache, if local. |

### 3.2 Modify

| File(s) | Change |
|---|---|
| `backend/package.json` | Rename the package to `feedbackai-backend`. Add the dependencies and `test`, `migrate`, `seed` and `analyze` scripts. |
| `frontend/package.json` | Rename the package. Add the router, Tailwind, Chart.js and vitest. |
| `frontend/index.html` | New title. Replace Plus Jakarta Sans with Source Serif 4, IBM Plex Sans and IBM Plex Mono. New favicon (no emoji). |
| `backend/.env.example` | FeedbackAI keys: `PORT=5002`, `DB_*` for `feedbackai_app`, `JWT_SECRET`, `AI_SERVICE_URL`, `AI_INTERNAL_TOKEN`, `CORS_ORIGIN`. Remove the foreign `DB_SOCKET` path. Never commit values. |
| `backend/src/server.js` global error handler (`:41`) | Stop returning `err.message`. Log server-side with a request id and return `{ code: 'INTERNAL', message }`. |
| `backend/src/server.js` `cors()` (`:12`) | Restrict to `CORS_ORIGIN` with credentials. |
| `productController.js` | Becomes the FeedbackAI products controller: `category_id` FK, slug, brand, `is_active`, rating stats from `v_product_rating_stats`, pagination, FULLTEXT search, and admin-only writes behind validation. |
| `dashboardController.js` | Rewritten as the admin analytics service. It keeps the "real SQL behind every tile" principle but runs the queries in parallel and adds filters. |

### 3.3 Retire (remove from this workspace; preserved in git tag `inventoryos-baseline` and in `~/Desktop/InventoryOS`)

| File(s) | Reason |
|---|---|
| `inventoryController.js`, `movementController.js`, `transferController.js`, `warehouseController.js`, `supplierController.js`, `purchaseOrderController.js`, `orderController.js` | Warehouse, stock and ordering domain. FeedbackAI has no stock or orders. Keeping them would leave unauthenticated write endpoints mounted. |
| `routes/api.js` (current content) | Replaced by per-resource routers with auth middleware. |
| `frontend/src/components/WarehousePortal.jsx`, `OrderModal.jsx`, `CustomerPortal.jsx`, `Header.jsx` | Inventory UI, a 981-line monolith, `alert()` errors and a hard-coded customer. Superseded by routed pages and shared UI components. |
| `frontend/src/index.css` | Indigo/slate theme with heavy inline styles. Replaced by Tailwind layers and FeedbackAI tokens. Some table and form rules can inform the new base styles. |
| `frontend/public/images/*.jpg` | Three peripheral photos unrelated to the new catalogue. |
| `schema.sql`, `seed_data.sql` (root) | Inventory schema, plaintext passwords, destructive scripts. Replaced by `database/0*_*.sql` and the idempotent seeder. **Move or delete only with approval.** |
| Workspace clutter: `mysql_data/` (197 MB), `mysql.log`, `mysql.sock.lock`, `Archive.zip` (30 MB, includes a `.env`), `backend/.env.backup`, root `package-lock.json`, `DBMS PRESENTATION.pdf` (InventoryOS deck, tracked) | Not used by FeedbackAI, and a risk of confusion: the stale datadir and the old `.env` copies. **Remove only with explicit user approval.** |

### 3.4 Build new

| Area | Scope |
|---|---|
| Database | `feedback_ai_db`: 17 tables, 7 views, 5 procedures, the triggers, indexes and constraint tests (00_DECISIONS §4). |
| Auth | Register, login, logout, me, profile update, and password change. Cookie-based JWT plus bcryptjs. `requireAuth` and `requireRole('ADMIN')` middleware. Login rate limiting. |
| Validation and errors | zod schemas per route, a `validate()` middleware, an `asyncHandler`, typed error classes and a pagination helper. |
| Customer APIs | Categories, products (search, filter, sort), product detail with aspects summary, ratings and feedback upsert, my-feedback, interactions logging, activity history, recommendations (plus dismiss and click), and preferences. |
| Admin APIs | Users (suspend, role change, guarded delete), products, categories, feedback moderation, sentiment analytics, product performance, reports with CSV export, and re-run analysis. |
| AI service | The `ai-service/` FastAPI app: the model loaded once, label policy, aspect module, language check, batch endpoint, token auth, evaluation script. |
| Analysis pipeline | `sentimentClient.js` (timeout plus response validation), `analysisWorker.js` (retry claim loop) and `scripts/analyze-pending.js`. |
| Recommendations | The `services/recommendations/` content-based engine `cb-1.0` with explanations, cold start, anti-repetition and diversity. |
| Seed | Hand-authored review corpus, catalogue, deterministic generator, idempotent seeder, and seed-batch provenance. |
| Frontend | Router, `AuthContext`, protected routes, separate customer and admin layouts, a UI kit (button, input, select, table with sort, pagination, modal/confirm, toast, empty/error/skeleton states, star rating, sentiment tag), Chart.js wrappers, 12 customer pages and 8 admin pages. |
| Tests | Backend `node:test` plus supertest (auth, authorization, CRUD, duplicate rating, AI-down path), AI-service pytest, SQL constraint tests, and a documented manual demo walkthrough. |

## 4. Technical debt, bugs and security weaknesses

Severity: **C** = critical, **H** = high, **M** = medium, **L** = low.

| # | Sev | Finding | Location | Fix in FeedbackAI |
|---|---|---|---|---|
| S1 | C | No authentication or authorization. Every read and write endpoint is public, and the role is a UI toggle. | `routes/api.js` (all), `Header.jsx:34,42` | JWT httpOnly cookie, `requireAuth` / `requireRole`, and identity taken from the token only. |
| S2 | C | Plaintext passwords stored in `password_hash`. | `schema.sql:165-168`, `seed_data.sql:27-52` | bcryptjs cost 12, `CHAR(60)` column. Seed users get real hashes. |
| S3 | H | Insecure direct object reference: the customer identity comes from the request body or URL (`customer_id = 1` default), so anyone can read any customer's orders. | `orderController.js:7`, `/orders/customer/:customerId`, `OrderModal.jsx:19`, `CustomerPortal.jsx:35` | `req.user.user_id` from the token. "My" endpoints take no user id. |
| S4 | H | Internal error messages (SQL errors, table names) are returned to clients by every controller and by the global handler. | `server.js:41`, every `catch` (e.g. `transferController.js:94`) | A central error handler returns codes. Details are logged server-side only. |
| S5 | H | `cors()` with no options allows any origin. | `server.js:12` | Allow-list `CORS_ORIGIN` with `credentials: true`, plus helmet. |
| S6 | H | The local MySQL root account has an empty password, and the app connects as root. | `.env` (`DB_USER`), server config | A dedicated `feedbackai_app` least-privilege account. Recommend the user sets a root password; it belongs to the InventoryOS server, so it is not changed here. |
| S7 | M | No rate limiting or security headers. | `server.js` | `express-rate-limit` on `/auth/*` and helmet. |
| S8 | M | `.env.example` contains a machine-specific absolute path from another tool. `Archive.zip` contains an old `.env`. | `.env.example:7`, `Archive.zip` | Clean the example. Remove the archive with approval. Both are gitignored, so nothing has leaked into git history. |
| B1 | H | `await db.getConnection()` runs **outside** try/catch. If the pool is exhausted or the DB is down, the rejection is unhandled (Express 4 does not catch it) and the request hangs or the process warns. | `orderController.js:5`, `inventoryController.js:64,132`, `productController.js:75`, `transferController.js:5`, `purchaseOrderController.js:71,106` | `asyncHandler` wrapper plus a `withTransaction()` helper that acquires the connection inside the try. |
| B2 | H | Purchase-order RECEIVED race: the PO status is read **before** `beginTransaction` without a lock, so two concurrent "receive" requests both see `PENDING` and both add stock. There are also no state-transition rules (CANCELLED→RECEIVED and RECEIVED→PENDING are allowed). | `purchaseOrderController.js:115-122` | Pattern for FeedbackAI moderation and analysis claims: a guarded `UPDATE … WHERE status = ?` or `SELECT … FOR UPDATE` inside the transaction, plus explicit transitions. |
| B3 | M | Order placement reads stock without locks during allocation, then re-checks under `FOR UPDATE` and **throws**. The concurrency conflict comes back as a generic 500, not a 409. | `orderController.js:63-118` | Lesson applied: map expected conflicts to 409 with a code. Use unique constraints and `ON DUPLICATE KEY` for rating upserts. |
| B4 | M | No input validation beyond presence checks. PATCH product accepts any type or value. PO items accept negative or zero quantity and `unit_price || 0`. The DB has no CHECK to catch them. | `productController.js:121-133`, `purchaseOrderController.js:86-90` | zod at the API, plus DB CHECKs (price > 0, stars 1–5, body length). |
| B5 | M | Validation `return` statements inside the try block skip `beginTransaction`, but the `catch` block always calls `rollback()`. This is harmless in mysql2, but mixes responsibilities. A `res` sent before a later throw would cause "headers already sent". | All transactional controllers | `withTransaction()` validates before acquiring a connection. |
| B6 | M | `createProduct` invents a barcode `BAR-${Date.now()}`, which can collide on concurrent requests and then returns a misleading 409. | `productController.js:87` | Slugs are derived from brand and name, with a UNIQUE constraint and a clear 409 message. |
| B7 | M | Transfers do not validate that the destination warehouse exists, so the FK error surfaces as a 500. Only the source row is locked. | `transferController.js:45-51` | Validate references and return 404/422 before writing. |
| B8 | M | Destructive, non-idempotent SQL scripts (DROP and TRUNCATE with `FOREIGN_KEY_CHECKS=0`). | `schema.sql:6-17`, `seed_data.sql:9-22` | Migrations with `CREATE … IF NOT EXISTS` and a guarded reset script. The seeder upserts by natural keys. |
| D1 | M | Denormalised `products.category` free text. | `schema.sql:43` | `categories` table plus FK (3NF). |
| D2 | M | Missing FKs on `stock_movements.transfer_id/purchase_order_id`. | `schema.sql:136-137` | Every reference column in FeedbackAI has an FK with a deliberate ON DELETE rule. |
| D3 | M | `ON DELETE CASCADE` from users to orders destroys business history. | `schema.sql:90` | Explicit deletion policy: RESTRICT on products with history, archive instead of delete, cascade only for user-owned data (00_DECISIONS §4). |
| D4 | L | No CHECK constraints on quantities or prices (only one CHECK in the schema). | `schema.sql:55,99,122,134` | CHECKs on all bounded columns, respecting MySQL error 3823. |
| D5 | M | Unpaginated list endpoints return entire tables (orders, movements, inventory, purchase orders). | All `getAll*` | `page` / `pageSize` (max 100) and `meta.total`. |
| D6 | M | N+1 queries: per-order item fetch, a warehouse × item allocation loop, and per-warehouse inventory inserts. | `orderController.js:269-276`, `:64-80`, `productController.js:94-99` | Set-based SQL: JOINs, `IN (…)`, multi-row INSERT. |
| D7 | L | Dashboard runs 7 queries sequentially. | `dashboardController.js:6-48` | `Promise.all`, or consolidated views. |
| D8 | M | Frontend: a 981-line component, 116 inline style objects, no routing, `alert()` errors, failures shown as empty screens. `Promise.all` of 8 requests means one failure blanks the whole dashboard. | `WarehousePortal.jsx:64-101,114-173` | Routed pages, shared UI kit, per-panel loading, empty and error states, and toasts. |
| D9 | L | After every action, the warehouse view re-fetches all 8 endpoints. | `WarehousePortal.jsx:64-66` | Targeted re-fetch per resource. |
| D10 | L | No tests, no lint, no README run instructions. | — | Phase 12 test suites, plus `README.md` with setup steps. |
| D11 | L | Port drift: `.env.example` uses 5000 (taken by macOS AirPlay), `.env` uses 5001, and the Vite proxy is hard-coded to 5001. | `.env.example:1`, `vite.config.js:11` | Ports set in one place: Vite 5174, API 5002, AI 8001. |
| D12 | L | Product images are chosen by matching words in the name. | `CustomerPortal.jsx` `getProductImage` | `products.image_url`, with a typographic placeholder when it is NULL. |

**Not found:** SQL injection. All values are bound, and dynamic SQL is limited to fixed clause fragments.

## 5. Migration risks

| # | Risk | Impact | Mitigation |
|---|---|---|---|
| M1 | The copied `backend/.env` targets the **live** `inventory_warehouse_db` on 3307, and `db.js` defaults to it. | Running or testing the copy before Phase 3 would modify the original project's data. | Do not run the copied backend. The first Phase 4 commit changes `.env.example` and the `db.js` defaults to `feedback_ai_db` and fails fast if `DB_NAME` is missing. `feedbackai_app` has privileges on `feedback_ai_db.*` only, so the database itself enforces the boundary. |
| M2 | The stale `FeedbackAI/mysql_data/` copy shares the server UUID and could be started by mistake. | A second mysqld on the same port or socket, possible corruption, or confusion about which data is live. | Never point a mysqld at it. Remove it after the user approves. Document the active server in the README. |
| M3 | Option A puts the `feedback_ai_db` files under `InventoryOS/mysql_data/`, and `CREATE USER` writes to that server's `mysql` system schema. | The InventoryOS folder grows. Zipping or submitting InventoryOS carries FeedbackAI data, and the shared server is lightly modified (two new accounts). | The user confirms Option A or B at approval. Option B is a fresh mysqld on 3308 with its datadir in FeedbackAI. |
| M4 | Port collisions: 5173 (another project's Vite), 8000 (another project's uvicorn), 5000 (AirPlay), 5001 (InventoryOS API). | Services fail to start or talk to the wrong app. | Vite 5174 with `strictPort`, Express 5002, AI 8001 on 127.0.0.1. |
| M5 | Retiring InventoryOS code in place. | Losing working code the user may want to reference. | Tag `inventoryos-baseline` before any removal. The original folder is untouched. Removal is one reviewed commit. |
| M6 | Tailwind Preflight alongside the old `index.css`. | Base-style conflicts (`* {margin:0}` and button resets) while the two coexist. | Replace `index.css` wholesale in Phase 6 rather than mixing. No page uses both. |
| M7 | Shared MySQL server load. | Heavy seed or analysis batches slow InventoryOS if both are demoed together. | Batch inserts and paced analysis batches (32 items). Seeding is a one-off. |
| M8 | Session variable `@app_actor_id` used by the audit trigger on pooled connections. | A stale actor id leaks into a later request on the same connection. | Set it inside the same transaction and reset it to NULL in `finally` before release. Covered by a test. |

## 6. Dependency conflicts and compatibility

| Topic | Assessment |
|---|---|
| **Python 3.9.6** (Apple Command Line Tools, the only interpreter) | Too old for a comfortable AI stack. Recent `transformers` releases are moving to ≥3.10, and current torch CPU wheels target 3.10–3.13. **Use Python 3.11 or 3.12** in `ai-service/.venv`. The user installs it at the start of Phase 8. Never `pip install` into the system 3.9. |
| **Node v26.8.2 with Vite 5** | Verified working: `vite v5.4.21` built the current app successfully. Node 26 is newer than Vite 5's tested matrix, so watch for deprecation warnings. Do not upgrade to Vite 6 or 7 unless a concrete problem appears. |
| **Tailwind 3.4** | Works with Vite 5 through PostCSS (`postcss` is already installed transitively; add `autoprefixer`). It conflicts only with the old `index.css` (see M6). The design tokens in 00_DECISIONS §8 become the Tailwind theme (`colors`, `fontFamily`, `borderRadius`). `@tailwindcss/vite` (v4) is not needed. |
| **react-router-dom 6** | Compatible with React 18. No conflict. |
| **chart.js 4 + react-chartjs-2 5** | Compatible with React 18. Register only the components used (tree-shaking), to keep the bundle under about 400 kB gzip. |
| **bcryptjs** vs `bcrypt` | Pure JS, so there is no native build against Node 26's ABI. Cost 12 takes roughly 200–400 ms per hash, which is fine for login and acceptable for seeding 25 users once. |
| **mysql2 3.9 vs MySQL 8.0.46** | Compatible, including `caching_sha2_password` over TCP. Create the app accounts with the default plugin. |
| **Ports** | In use: 3307 (MySQL), 5000, 5173, 8000. Planned: 5174, 5002 and 8001, all confirmed free at inspection. |
| **Hugging Face model** | About 500 MB download, needed once, then cached. Load memory is about 1 GB RSS. Downloading needs internet the first time. Offline demo use relies on the warm cache, so verify it before the demo. |

## 7. Existing bottlenecks

| Bottleneck | Cause | Impact | Carry-forward lesson |
|---|---|---|---|
| Full-table list responses | No `LIMIT` or `OFFSET` on any list endpoint. | Payload and render time grow linearly with data, e.g. 366 movements and 300 inventory rows in one response. | Server-side pagination and filtering everywhere, including feedback and interactions tables that will hold thousands of rows. |
| N+1 queries | Per-row follow-up queries in loops (§4 D6). | Latency multiplies with row count. Order allocation is O(warehouses × items) round trips inside a transaction that holds locks. | Set-based SQL and views for aggregates. Keep transactions short. |
| Sequential dashboard queries | `await` chain of 7 queries. | Latency is the sum of all queries. | Run independent analytics queries in parallel. Use pre-aggregating views on indexed columns. |
| Whole-dashboard refetch | The frontend reloads 8 endpoints after any change. | Wasted DB load and visible flicker. | Fetch per page and per resource. Invalidate only what changed. |
| No indexes beyond keys | Filters on `category`, `status` and `created_at` have no secondary indexes. | Fine at this size, but scans as data grows. | Composite indexes aligned with filter and sort order (00_DECISIONS §4), checked with `EXPLAIN` in Phase 11. |
| Aggregates computed per request | Stock totals use `SUM` in every product query. | Acceptable at this size. | FeedbackAI derives averages in views instead of storing them, verified with `EXPLAIN`. Caching is added only if measurements justify it. |
