# FeedbackAI

**AI-Based Feedback Analysis & Product Recommendation System**

FeedbackAI is a full-stack DBMS project that provides a product-discovery and customer-feedback platform. Customers can browse products and categories, create accounts, submit ratings and written reviews, and view their activity and feedback. The application stores this information in a relational MySQL database and is designed to support sentiment analysis, product recommendations, and administrator reporting.

> **Project status:** This README describes the code and implementation status in the supplied project archive. The database, seed-data workflow, customer-facing application, authentication, and core API are implemented. The Python AI inference service, completed sentiment-processing workflow, recommendation engine, and full admin analytics/reporting interface are not yet complete in the supplied source snapshot. The admin page currently acts as a placeholder. Do not describe those items as finished until they are implemented and tested.

## Contents

- [Project overview](#project-overview)
- [Features](#features)
- [Technology stack](#technology-stack)
- [Architecture](#architecture)
- [Database design](#database-design)
- [Demo data](#demo-data)
- [Project structure](#project-structure)
- [Prerequisites](#prerequisites)
- [Local setup](#local-setup)
- [Run the application](#run-the-application)
- [DBMS concepts demonstrated](#dbms-concepts-demonstrated)
- [Security and data safety](#security-and-data-safety)
- [Current implementation status](#current-implementation-status)
- [Future work](#future-work)

## Project overview

Online platforms can receive many product ratings and written reviews. Reading every review manually makes it difficult to identify customer satisfaction trends and recurring product issues.

FeedbackAI is intended to address this by bringing product discovery, customer ratings, written feedback, sentiment analysis, and product recommendations into one platform.

The system has two main user roles:

- **Customer:** registers, browses products, views product details, submits ratings and reviews, and views personal feedback and activity.
- **Administrator:** is intended to manage catalogue information, moderate feedback, and review platform analytics and reports. The complete admin interface is still under development in this source snapshot.

## Features

### Implemented in the supplied source

- Customer registration and login.
- Role-protected customer and administrator routes on the backend.
- Product and category discovery.
- Product detail pages.
- Star ratings and written review submission.
- Customer feedback history.
- Customer activity history.
- Profile and category-preference support.
- MySQL-backed REST API.
- Input validation and parameterized SQL queries.
- Demo-data generation and idempotent database seeding.
- Database views, stored procedures, triggers, constraints, and indexes.

### Planned / not complete in the supplied source

- A working Python NLP inference service.
- End-to-end automated sentiment analysis. The current backend sentiment service is a stub, so pending analysis records should not be presented as completed AI results.
- A complete personalised recommendation engine.
- Full admin product/user management screens, feedback moderation screens, analytics dashboards, and report generation.

These features are part of the intended project scope and should be marked complete only after implementation and testing.

## Technology stack

| Layer | Technology |
|---|---|
| Frontend | React 18, Vite |
| Styling | Tailwind CSS |
| Routing | React Router |
| HTTP client | Axios |
| Icons | Lucide React |
| Backend | Node.js, Express |
| Database | MySQL 8 |
| Database driver | mysql2 |
| Validation | Zod |
| Authentication | bcryptjs, JSON Web Tokens |
| Charts | Chart.js dependencies are present in the frontend package; verify the analytics UI before claiming it is complete |
| AI/NLP | Planned Python service; not implemented in the supplied source snapshot |

## Architecture

The application is organised into three main code areas:

1. **React frontend** — renders the customer-facing interface and communicates with the backend through `/api`.
2. **Express backend** — handles authentication, authorization, validation, business logic, and MySQL queries.
3. **MySQL database** — stores users, products, categories, ratings, feedback, interactions, analysis metadata, and related records.

The intended AI design adds a separate Python service for NLP inference. That service is not yet present as a runnable service in the supplied source snapshot.

### Request flow (implemented customer review path)

```text
Customer browser
      |
      v
React + Vite frontend
      |
      | /api requests
      v
Express REST API
      |
      | validated, parameterized SQL
      v
MySQL database
```

The planned AI extension is:

```text
Written feedback
      |
      v
Express API
      |
      v
Python NLP service
      |
      v
Sentiment / aspect results
      |
      v
MySQL analysis records
```

## Database design

The project uses a separate MySQL database named `feedback_ai_db`. The schema is defined in `database/01_schema.sql`.

The relational model includes entities for:

- Users and roles.
- Categories, products, tags, and product-tag relationships.
- User category preferences.
- Ratings and written feedback.
- Sentiment-analysis metadata and aspect-level sentiment.
- User interactions.
- Recommendation runs and recommendation records.
- Reports and audit history.
- Seed batches, which identify generated demonstration records.

The database scripts are organised as follows:

| File | Purpose |
|---|---|
| `database/01_schema.sql` | Creates the relational tables, keys, constraints, and indexes |
| `database/02_views.sql` | Defines derived views, including product rating and feedback-detail views |
| `database/03_procedures.sql` | Defines stored procedures for review and reporting queries |
| `database/04_triggers.sql` | Defines data-integrity and audit triggers |
| `database/99_reset_dev.sql` | Development reset script |
| `database/setup.sh` | Creates the FeedbackAI databases and applies the schema objects |
| `database/tests/` | SQL constraint and database tests |
| `database/queries/` | Supporting SQL queries |

The schema is designed for MySQL 8 and uses InnoDB and `utf8mb4`.

## Demo data

The project includes a reproducible demonstration dataset. It uses fictional users, fictional brands/products, and generated review assignments. These records are demonstration data, not verified purchases or genuine customer testimonials.

The seed workflow is designed to be deterministic and idempotent:

1. Review corpus and catalogue data are stored under `database/seed/`.
2. `generate.py` validates the corpus and produces `generated/demo-v1.json`.
3. The backend seeder inserts the generated batch into the selected FeedbackAI database.
4. Seeded records are marked separately from genuine user submissions.

Generate and lint the dataset from the project root:

```bash
python3 -I database/seed/generate.py --lint
python3 -I database/seed/generate.py
```

Apply the seed batch:

```bash
cd backend
node scripts/seed.js --db feedback_ai_db
```

The seeder accepts only the FeedbackAI database names documented in `database/seed/README.md`. Read that file before using `--reseed` or `--reset`.

## Project structure

```text
FeedbackAI/
├── frontend/                 # React + Vite application
│   └── src/
│       ├── components/       # Shared layout, product and UI components
│       ├── context/          # Authentication and toast contexts
│       ├── lib/              # API client and shared utilities
│       └── pages/            # Customer and admin pages
├── backend/                  # Express REST API
│   ├── scripts/              # Seed and maintenance scripts
│   └── src/
│       ├── config/           # Environment and MySQL configuration
│       ├── middleware/       # Authentication, validation and errors
│       ├── routes/           # Auth, customer, catalogue and admin routes
│       └── services/         # Business services
├── database/
│   ├── seed/                 # Catalogue, review corpus and generator
│   ├── tests/                # SQL tests
│   ├── queries/               # Utility queries
│   └── *.sql                 # Schema, views, procedures and triggers
├── ai-service/
│   └── lexicon/              # Aspect lexicon used by the planned NLP component
├── docs/                     # Architecture, schema, decisions and risk notes
└── PROJECT_TODO.md           # Development checklist and status
```

## Prerequisites

Install the following before running the application:

- Node.js (a current LTS release is recommended).
- npm.
- MySQL 8.0.
- Python 3 for the seed-data generator.

The supplied backend configuration uses MySQL on `127.0.0.1:3307`, Express on port `5002`, and Vite on port `5174`. Adjust these only if your local setup differs, and keep the backend and Vite proxy ports consistent.

## Local setup

### 1. Clone the repository

```bash
git clone https://github.com/siribillakanti/FeedbackAI.git
cd FeedbackAI
```

### 2. Configure the backend environment

Copy the example environment file:

```bash
cp backend/.env.example backend/.env
```

Edit `backend/.env` and set your local MySQL credentials and a long, random JWT secret. Do not commit this file.

The important settings are:

```dotenv
NODE_ENV=development
PORT=5002

DB_HOST=127.0.0.1
DB_PORT=3307
DB_USER=feedbackai_app
DB_PASSWORD=your-local-database-password
DB_NAME=feedback_ai_db
DB_NAME_TEST=feedback_ai_test_db

JWT_SECRET=replace-with-a-long-random-secret
BCRYPT_COST=12
CORS_ORIGIN=http://localhost:5174

AI_SERVICE_URL=http://127.0.0.1:8001
AI_INTERNAL_TOKEN=replace-with-a-random-secret
```

The AI settings are reserved for the planned AI service; they do not mean that the inference service is already available.

### 3. Create the database and apply database objects

Review `database/setup.sh` before running it. It creates `feedback_ai_db` and `feedback_ai_test_db` and applies the schema objects. It uses MySQL administrator credentials supplied through environment variables or its documented defaults.

Example:

```bash
bash database/setup.sh
```

For a non-default MySQL installation, set the `MYSQL_BIN`, `DB_HOST`, and `DB_PORT` variables as described at the top of the script.

**Data safety:** Do not point this project at the InventoryOS database. Use only `feedback_ai_db` and `feedback_ai_test_db`. Do not run development reset scripts against any other database.

### 4. Install backend dependencies

```bash
cd backend
npm install
cd ..
```

### 5. Generate and load demo data

```bash
python3 -I database/seed/generate.py --lint
python3 -I database/seed/generate.py

cd backend
node scripts/seed.js --db feedback_ai_db
cd ..
```

### 6. Install frontend dependencies

```bash
cd frontend
npm install
cd ..
```

## Run the application

Open two terminal windows from the project root.

**Terminal 1 — Backend**

```bash
cd backend
npm run dev
```

The API is configured for:

```text
http://localhost:5002
```

**Terminal 2 — Frontend**

```bash
cd frontend
npm run dev
```

Open:

```text
http://localhost:5174
```

Vite proxies `/api` requests to the Express backend on port `5002`.

## DBMS concepts demonstrated

The database implementation is intended to demonstrate practical relational database concepts:

- Entity–Relationship modelling and relational mapping.
- Primary keys and foreign keys.
- One-to-many and many-to-many relationships.
- Normalization.
- `NOT NULL`, `UNIQUE`, `CHECK`, and referential-integrity constraints.
- SQL joins and aggregate functions.
- `GROUP BY` and `HAVING`.
- Subqueries.
- Views.
- Stored procedures.
- Triggers.
- Transactions.
- Indexes.
- Seed-data provenance and idempotent data loading.

See `docs/03_DATABASE_DESIGN.md` and `docs/04_DBMS_OBJECTS_AND_QUERIES.md` for the detailed schema and query rationale.

## Security and data safety

- Keep `backend/.env` private; it contains local credentials and secrets.
- Never commit `.env`, backup environment files, database data directories, private keys, or `node_modules`.
- Use the provided `.env.example` as a template only.
- The setup and seed scripts are scoped to the FeedbackAI databases. Do not change their target to `inventory_warehouse_db`.
- Demo users and reviews are fictional. Do not describe them as real customers or verified purchases.
- Use parameterized SQL and backend validation for database operations.

## Current implementation status

The supplied `PROJECT_TODO.md` is the source of truth for task status. In the archive reviewed for this README:

| Area | Status in supplied source |
|---|---|
| Database schema, seed generator and seed validation | Implemented; TODO records 83/83 constraint tests passing |
| Backend API foundation, authentication and authorization | Implemented according to the project TODO |
| Customer-facing React pages | Implemented according to the project TODO |
| Feedback and rating submission | Customer-side flow implemented |
| Sentiment inference service | Not complete; backend sentiment function is currently a stub |
| Personalised recommendation engine | Not complete |
| Full admin analytics and reports | Not complete; admin landing page is a placeholder |
| Full end-to-end testing and final documentation | Remaining work is listed in `PROJECT_TODO.md` |

Update this table whenever implementation changes. Only mark a feature complete after it has been run and verified.

## Future work

1. Implement and integrate the Python sentiment-analysis service.
2. Process pending feedback and persist real analysis results.
3. Implement and test content-based product recommendations.
4. Complete admin management, feedback moderation, analytics, and report screens.
5. Run end-to-end tests and document the actual results.
6. Complete the project demonstration guide and viva preparation.

---

**Author:** Siri Billakanti  
**Project:** DBMS — AI-Based Feedback Analysis System  
**Repository:** https://github.com/siribillakanti/FeedbackAI
