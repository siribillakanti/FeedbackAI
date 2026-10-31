# FeedbackAI demo seed (`demo-v1`)

Everything here is **demo data**: the users, brands, products and reviews are fictional. Reviews were written by hand for this project and assigned to demo accounts by a generator. They are **not** real customer purchases. Every seeded row carries `seed_batch_id`; genuine submissions have `seed_batch_id IS NULL`. The UI labels seeded rows as demo data.

The full design is in [docs/05_SEED_DATA_STRATEGY.md](../../docs/05_SEED_DATA_STRATEGY.md).

## Files

| Path | What it is |
|---|---|
| `catalog.json` | Batch settings (label, RNG seed, anchor date), 6 categories, 36 products, tags, the 25 demo users and their personas, and seasonality |
| `corpus/<category-slug>.json` | The hand-authored reviews. Each entry is used exactly once. |
| `../../ai-service/lexicon/aspects.json` | Aspect lexicon (`lexicon-1`): the single source of truth for the `aspects` table and the AI service |
| `generate.py` | Lints the corpus and builds `generated/demo-v1.json` deterministically |
| `generated/demo-v1.json` | Generated, committed and reviewable. It carries a `content_sha256` of its own content. |
| `../../backend/scripts/seed.js` | Applies the generated file to MySQL idempotently, in one transaction |
| `validate.sql` | Post-seed checks (row counts and ordering invariants) |

## Commands

Run from the project root. `generate.py` uses only the Python standard library, so the system Python 3.9 is enough.

```bash
python3 -I database/seed/generate.py --lint
```

```bash
python3 -I database/seed/generate.py
```

```bash
cd backend && node scripts/seed.js --db feedback_ai_db
```

```bash
mysql -h127.0.0.1 -P3307 -u feedbackai_app -p feedback_ai_db < database/seed/validate.sql
```

### Generator options
- `--corpus DIR`
- `--catalog FILE`
- `--lexicon FILE`
- `--out FILE`
- `--seed N`, which overrides `catalog.batch.rng_seed`
- `--strict`, which turns style-mix warnings into errors

`--lint` exits 1 on errors. It **errors** on any of:
- bad JSON shape
- a duplicate `corpus_id`
- an unknown product
- an entry in the wrong category file
- an aspect not in the lexicon, or one that belongs to another category
- text outside 10–4000 characters
- stars outside 1–5
- two entries with word-trigram Jaccard ≥ 0.6
- more than 3 entries opening with the same five words

Style mix, sentiment mix, star/sentiment coherence, aspect coverage and quality profiles are reported as **warnings**.

### Seeder options

`--db` is required and accepts only `feedback_ai_db` or `feedback_ai_test_db`.

| Command | Effect |
|---|---|
| `node scripts/seed.js --db feedback_ai_db` | Applies the batch. If the same checksum is already applied, it prints "already applied", writes nothing and exits 0. |
| `… --reseed` | Use when `generated/demo-v1.json` changed. It removes the batch's demo rows and re-applies them, in the same transaction. |
| `… --reset demo-v1` | Deletes only rows with this batch's `seed_batch_id`, in FK-safe order. Seeded admins are kept (the last-admin trigger). `--include-admins` removes them only when a genuine active admin exists. |
| `… --sync-aspects` | Upserts `aspects` from the lexicon without touching the batch |

The seeder never inserts or updates rows that belong to genuine users. If a natural key (email, product slug, or user and product) already belongs to a row with `seed_batch_id IS NULL`, the whole run is rolled back and it exits with code 3.

Deleting demo **customers** during `--reset` or `--reseed` cascades to anything those accounts did live during a demo, such as a review submitted while logged in as a demo user. This is by design.

Exit codes:
- 0: success, or already applied
- 1: error (rolled back)
- 2: checksum changed and `--reseed` was not given
- 3: a genuine-row conflict

### Order inside one apply transaction
1. The batch row is checked with a `FOR UPDATE` lock.
2. Categories, tags and aspects are written.
3. Products are written, all active.
4. Users are written, all active, along with their preferences.
5. Ratings and reviews are written. The trigger creates PENDING analysis rows.
6. Interactions are deleted and re-inserted for the batch.
7. Three moderation UPDATEs run with `@app_actor_id` set, then reset to NULL. The trigger writes their audit rows.
8. The discontinued product is archived and the suspended user is suspended.
9. COMMIT.

Archiving and suspension come last because the rating triggers reject ratings on inactive products and from suspended users. Audit rows get the real seeding time as `created_at`, while `feedback.moderated_at` holds the generated moderation date.

## Demo accounts and password

All accounts use `@demo.feedbackai.test` addresses (RFC 2606 `.test`, so they can never reach a real inbox). The full list with personas is in `catalog.json`. Useful ones for a demo:

| Account | Role | Why it is interesting |
|---|---|---|
| `meera.krishnan@demo.feedbackai.test` | ADMIN | Did the seeded moderation actions |
| `arvind.rao@demo.feedbackai.test` | ADMIN | Analytics admin |
| `ananya.iyer@demo.feedbackai.test` | CUSTOMER | Power reviewer with a rich history, for personalised recommendations |
| `farhan.qureshi@demo.feedbackai.test` | CUSTOMER | Harsh critic |
| `kavya.nair@demo.feedbackai.test` | CUSTOMER | Warm cold-start: preferences and views, no ratings |
| `zoya.ahmed@demo.feedbackai.test` | CUSTOMER | True cold-start: no history at all |
| `aman.sethi@demo.feedbackai.test` | CUSTOMER | Suspended, so login must be refused |

**Password.** Every demo account uses the same password, taken from `SEED_DEMO_PASSWORD` in `backend/.env` (gitignored). If it is missing when the seeder first creates users, the seeder generates one, appends it to `backend/.env` and does not print it. To see it:

```bash
grep '^SEED_DEMO_PASSWORD=' backend/.env
```

The database stores only bcrypt hashes. Cost 12 is the default, and `BCRYPT_COST` overrides it (use 4 in tests). Re-runs never re-hash existing users, so changing `SEED_DEMO_PASSWORD` later only affects accounts created after the change.

## After seeding

1. Every review now has a `PENDING` row in `sentiment_analysis`.
2. Phase 8's `backend/scripts/analyze-pending.js` sends those reviews through the real AI service in batches.
3. Recommendation runs are produced by the real engine (Phase 9).

No sentiment is ever written by the seeder.
