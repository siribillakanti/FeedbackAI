# 05 — Seed Data Strategy

Status: **proposed, awaiting approval**. Implemented in Phase 3, with sentiment results filled in during Phase 8.
Binding inputs: `docs/00_DECISIONS.md`, sections 4 (schema) and 7 (seed outline).

---

## 1. Goals and non-goals

**Goals**

- **Realistic.** Reviews read as if different people wrote them, with varied length, tone, idiom, structure and the occasional typo. The writing is not templated.
- **Coherent.** Review text, star rating, product, reviewer persona and date all agree with one another. A complaint about battery life is attached to a product that has a battery, written by a user who viewed that product first.
- **Analysable.** Every seeded review goes through the **real** AI sentiment pipeline. No sentiment value is hard-coded anywhere, whether in the dataset, the SQL or the UI.
- **Idempotent.** Running the seeder N times produces the same database state as running it once.
- **Provenance-marked.** Every seeded user, product, rating, review and interaction carries `seed_batch_id` → `seed_batches.label = 'demo-v1'`. `seed_batch_id IS NULL` means a genuine submission.
- **Reversible.** Demo data can be removed through its `seed_batch_id`, and that removal never touches genuine rows.

**Non-goals and hard rules**

- Seed reviews are **never** presented as verified purchases. The schema has no "verified purchase" concept at all, and the UI tags seeded reviews as **Demo data**.
- The dataset does not imitate real brands, real people or real customers (see section 3.1).
- No product photos are scraped or copied. `image_url` stays NULL and the UI shows a typographic placeholder.
- Seed data is not tuned to make the model look good. The corpus is frozen *before* the model is evaluated (section 9.4).

---

## 2. Dataset sizing

| Entity | Planned count | Notes |
|---|---|---|
| `seed_batches` | 1 | `demo-v1` |
| `users` | 25 | 2 ADMIN and 23 CUSTOMER. One customer is SUSPENDED for the user-management demo. |
| `categories` | 6 | Reference data. Kept on reset. |
| `products` | 36 | 6 per category: 35 active and 1 archived (discontinued) |
| `tags` | ~45 | Product attributes used for content-based recommendations |
| `product_tags` | ~140 | 3–5 tags per product |
| `aspects` | ~19 | Loaded from the AI service lexicon (section 5.6) |
| `user_category_preferences` | ~45 | 0–3 per customer |
| `ratings` | ~229 | One per (user, product). Distribution in section 4. |
| `feedback` | ~200 | About 87% of ratings have text. Each comes from the hand-authored corpus. |
| `sentiment_analysis` | ~200 | Created PENDING by trigger and filled by the real pipeline |
| `aspect_sentiments` | ~250–300 | Whatever the pipeline finds. This number is **not** fixed in advance. |
| `user_interactions` | ~900 | ~600 PRODUCT_VIEW, ~150 CATEGORY_VIEW, ~150 SEARCH, 0 RECOMMENDATION_CLICK |
| `recommendation_runs` | 23 | Produced by running the **real** engine for each customer after seeding. These are not fabricated rows. |
| `recommendations` | ≤ 230 | Up to 10 per run |
| `audit_log` | 3 | Moderation actions carried out as real UPDATEs after insert, so the trigger writes them |
| `reports` | 0 | Created live during the demo |

Per product, the number of reviews ranges from **0** (one newly listed product, to show empty states) to **12**, with a median of about 5–6. Two products deliberately have only 1–2 reviews so the Bayesian-average behaviour can be demonstrated.

---

## 3. Planned catalogue

### 3.1 Why fictional brands

The reviews are generated. Attaching invented praise or complaints to real brands such as Sony, Samsung or Philips would make false statements about real products, could mislead anyone viewing the demo, and raises trademark concerns. Fictional brands keep the realism (believable specifications, INR prices, feature vocabulary) without implying real customer experiences. Book titles, authors and publishers are fictional for the same reason, which also avoids reviewing real copyrighted works.

### 3.2 Products (prices in INR)

**Electronics** (`electronics`)

| Slug | Product | Brand | Price | Tags |
|---|---|---|---|---|
| auralis-wave-anc-headphones | Wave ANC Wireless Headphones | Auralis | 7,999 | wireless, noise-cancelling, long-battery, over-ear |
| novaphone-8-lite | Novaphone 8 Lite Smartphone (8/128 GB) | Novaphone | 18,999 | 5g, amoled, fast-charging, mid-range |
| kestrel-book-14 | Kestrel Book 14 Laptop (i5, 16 GB) | Kestrel | 54,990 | lightweight, long-battery, student, ssd |
| pulsefit-s2-smartwatch | PulseFit S2 Smartwatch | PulseFit | 4,499 | fitness-tracking, bluetooth-calling, budget |
| boomtube-mini-speaker | Boomtube Mini Bluetooth Speaker | Boomtube | 2,299 | wireless, portable, waterproof, budget |
| auralis-buds-air | Buds Air True Wireless Earbuds | Auralis | 2,999 | wireless, in-ear, long-battery, budget |

**Fashion** (`fashion`)

| Slug | Product | Brand | Price | Tags |
|---|---|---|---|---|
| stridewell-pace-running-shoes | Pace Running Shoes | Stridewell | 3,499 | running, cushioned, lightweight |
| loomline-oxford-shirt | Cotton Oxford Shirt | Loomline | 1,299 | cotton, formal, slim-fit |
| northbay-denim-jacket | Classic Denim Jacket | Northbay | 2,799 | denim, casual, layering |
| kaari-handloom-kurta | Handloom Cotton Kurta | Kaari | 1,599 | ethnic, cotton, handloom |
| carryall-canvas-backpack | Canvas Backpack 25L | Carryall | 1,899 | travel, water-resistant, laptop-sleeve |
| timbre-classic-analog-watch | Classic Analog Watch | Timbre | 3,999 | analog, leather-strap, gift |

**Home Appliances** (`home-appliances`)

| Slug | Product | Brand | Price | Tags |
|---|---|---|---|---|
| brewmate-electric-kettle | 1.5L Electric Kettle | Brewmate | 1,199 | kitchen, stainless-steel, auto-shutoff, budget |
| crispo-air-fryer | 4.2L Digital Air Fryer | Crispo | 6,499 | kitchen, oil-free, digital-controls |
| blendrix-mixer-grinder | 750W Mixer Grinder (3 jars) | Blendrix | 3,799 | kitchen, high-power, multi-jar |
| purebreeze-air-purifier | HEPA Air Purifier | PureBreeze | 9,999 | hepa, low-noise, bedroom |
| steamline-dry-iron | 1000W Dry Iron | Steamline | 899 | budget, non-stick, lightweight (**archived**) |
| aquafresh-ro-purifier | RO+UV Water Purifier | AquaFresh | 12,499 | ro-uv, wall-mount, installation-required |

**Beauty and Personal Care** (`beauty-personal-care`)

| Slug | Product | Brand | Price | Tags |
|---|---|---|---|---|
| dewleaf-vitamin-c-serum | Vitamin C Face Serum 30ml | Dewleaf | 649 | skincare, vitamin-c, brightening |
| dewleaf-gel-moisturiser | Oil-Free Gel Moisturiser | Dewleaf | 449 | skincare, oily-skin, fragrance-free |
| sunveil-spf50-sunscreen | SPF 50 Matte Sunscreen | Sunveil | 399 | sunscreen, matte, non-greasy |
| groomwell-beard-trimmer | Cordless Beard Trimmer | Groomwell | 1,499 | grooming, cordless, long-battery |
| herbalaya-onion-hair-oil | Onion Hair Oil 200ml | Herbalaya | 349 | haircare, ayurvedic, strong-fragrance |
| ionic-pro-hair-dryer | Ionic Pro Hair Dryer 1600W | Ionic Pro | 1,999 | haircare, heat-control, foldable |

**Books** (`books`; brand = fictional publisher)

| Slug | Title | Publisher | Price | Tags |
|---|---|---|---|---|
| the-monsoon-ledger | The Monsoon Ledger (novel) | Banyan Books | 399 | fiction, literary, paperback |
| code-habits | Code Habits: Writing Software That Lasts | Inkwell Press | 699 | programming, non-fiction, self-study |
| ninety-days-to-calm | Ninety Days to Calm | Banyan Books | 299 | self-help, mindfulness |
| spice-routes-of-the-south | Spice Routes of the South (cookbook) | Saffron House | 549 | cooking, illustrated, hardcover |
| shadows-over-hampi | Shadows over Hampi (thriller) | Inkwell Press | 349 | thriller, mystery, page-turner |
| little-stars-science | Little Stars Science Book | Saffron House | 449 | children, illustrated, educational (**0 reviews, newly listed**) |

**Sports and Fitness** (`sports-fitness`)

| Slug | Product | Brand | Price | Tags |
|---|---|---|---|---|
| coreflex-yoga-mat | 6mm Anti-Slip Yoga Mat | CoreFlex | 999 | yoga, anti-slip, home-workout |
| irongrip-adjustable-dumbbells | Adjustable Dumbbell Set 20kg | IronGrip | 4,999 | strength, adjustable, home-workout |
| velocita-cycling-helmet | Ventilated Cycling Helmet | Velocita | 2,499 | cycling, safety, ventilated |
| flexband-resistance-set | Resistance Band Set (5 levels) | FlexBand | 799 | strength, portable, budget |
| hydrasteel-insulated-bottle | Insulated Steel Bottle 1L | HydraSteel | 899 | hydration, stainless-steel, leak-proof |
| smash-pro-badminton-racket | Smash Pro Graphite Racket | Smash | 2,199 | badminton, lightweight, graphite |

### 3.3 Product quality profiles

Each product gets a latent profile that shapes its star histogram, so the analytics have something real to find:

| Profile | Products (examples) | Expected avg |
|---|---|---|
| Strong | Crispo air fryer, The Monsoon Ledger, CoreFlex yoga mat, Sunveil sunscreen | 4.3–4.7 |
| Good | Auralis headphones, Kestrel laptop, Stridewell shoes, Groomwell trimmer | 3.8–4.2 |
| Average | Loomline shirt, Brewmate kettle, PulseFit watch, FlexBand set | 3.2–3.7 |
| Polarising | Herbalaya hair oil (fragrance), IronGrip dumbbells, Novaphone 8 Lite | bimodal |
| Weak | AquaFresh RO purifier (installation/service), Boomtube speaker (connectivity) | 2.2–2.8 |

These profiles make it possible to demonstrate "most negatively reviewed products", "common complaints" and category satisfaction with results that can be explained. Overall star mix target: 5★ 34%, 4★ 28%, 3★ 15%, 2★ 9%, 1★ 14%. This is the J-shape typical of real review sites.

---

## 4. User cohort

All emails use the reserved `.test` TLD (RFC 2606), for example `ananya.iyer@demo.feedbackai.test`, so they can never reach a real person. The names are fictional.

| # | Name | Role | Persona | Preferred categories | Activity | ≈Ratings |
|---|---|---|---|---|---|---|
| 1 | Meera Krishnan | ADMIN | Catalogue and moderation admin | – | Performs 3 moderation actions | 0 |
| 2 | Arvind Rao | ADMIN | Analytics admin | – | – | 0 |
| 3 | Ananya Iyer | CUSTOMER | Power reviewer, tech enthusiast, detailed writer | Electronics, Books | Very high | 25 |
| 4 | Rohit Malhotra | CUSTOMER | Power reviewer, fitness | Sports & Fitness, Electronics, Fashion | Very high | 24 |
| 5 | Sneha Kulkarni | CUSTOMER | Power reviewer, home cook | Home Appliances, Books | Very high | 24 |
| 6 | Farhan Qureshi | CUSTOMER | Power reviewer, harsh critic (bias −0.7★) | Electronics, Home Appliances | Very high | 23 |
| 7 | Divya Menon | CUSTOMER | Regular, skincare-focused | Beauty | Medium | 11 |
| 8 | Karthik Subramanian | CUSTOMER | Regular, student on a budget | Electronics, Books | Medium | 12 |
| 9 | Priya Deshpande | CUSTOMER | Regular, fashion | Fashion, Beauty | Medium | 11 |
| 10 | Aditya Joshi | CUSTOMER | Regular, runner | Sports & Fitness, Fashion | Medium | 10 |
| 11 | Lakshmi Narayanan | CUSTOMER | Regular, homemaker | Home Appliances, Beauty | Medium | 11 |
| 12 | Nikhil Bansal | CUSTOMER | Regular, generous rater (bias +0.3★) | Electronics, Sports & Fitness | Medium | 11 |
| 13 | Pooja Reddy | CUSTOMER | Regular, avid reader | Books, Fashion | Medium | 12 |
| 14 | Sameer Khan | CUSTOMER | Regular, critical (bias −0.5★) | Home Appliances, Electronics | Medium | 10 |
| 15 | Tanvi Shah | CUSTOMER | Regular | Beauty, Fashion | Medium | 11 |
| 16 | Harish Gowda | CUSTOMER | Occasional, short reviews | Sports & Fitness | Low | 5 |
| 17 | Ishita Banerjee | CUSTOMER | Occasional | Books | Low | 4 |
| 18 | Varun Chopra | CUSTOMER | Occasional | Electronics | Low | 6 |
| 19 | Neha Pillai | CUSTOMER | Occasional | Beauty | Low | 5 |
| 20 | Manoj Tiwari | CUSTOMER | Occasional, mostly stars without text | Home Appliances | Low | 5 |
| 21 | Shruti Agarwal | CUSTOMER | Occasional | Fashion, Sports & Fitness | Low | 5 |
| 22 | Rahul Verma | CUSTOMER | **Lurker**: 40+ views, many searches | Electronics | Views only | 1 |
| 23 | Kavya Nair | CUSTOMER | **Warm cold-start**: has preferences and views, no ratings | Beauty, Books | Views only | 0 |
| 24 | Aman Sethi | CUSTOMER | **Suspended** after posting 3 ratings (user-management demo) | Electronics | Low | 3 |
| 25 | Zoya Ahmed | CUSTOMER | **True cold-start**: joined 3 days before the anchor date, no preferences, no history | – | None | 0 |

Total ≈ 229 ratings. Admins never rate or review, which keeps the customer analytics clean. About 70% of each persona's ratings fall in that persona's preferred categories and the rest are spread across others, so profiles are not perfectly siloed.

---

## 5. Review corpus authoring

### 5.1 Method

- The corpus is **hand-authored**. Each review is written for one specific product (`product_slug`), using that product's real feature vocabulary, such as ANC and ear cushions for headphones, or jar lids and motor noise for a mixer grinder.
- There are **no name-substitution templates**. No sentence pattern may be reused across products with only the noun swapped.
- **The corpus is the review set.** About 200 entries become about 200 `feedback` rows, and each entry is used exactly once. The generator does not invent text. It only assigns each entry to a user and a date. The roughly 30 ratings without text are star-only rows drawn from the product's quality profile.
- Files: `database/seed/corpus/<category-slug>.json`, one file per category, reviewed by a human before freezing.

### 5.2 Style mix targets (enforced by the corpus linter)

| Dimension | Target |
|---|---|
| Length | Short (10–60 chars) 25%, medium (60–250) 50%, detailed (250–900) 25%. The minimum is 10 chars because of the `feedback.body` CHECK. |
| Intended sentiment | POSITIVE ~50%, NEGATIVE ~22%, NEUTRAL ~10%, MIXED ~18% |
| Title present | ~60% |
| Typos or grammar slips | ~8% (e.g. "recieved", "alot", "worth for money", "cant") |
| Indian English idioms | In moderation, ~12% ("battery backup", "value for money", "go for it", "superb", one "paisa vasool") |
| Mentions the product name | ≤ 15%. Real reviewers rarely type the full name. |
| Emoji | ~3% |
| Pipeline edge cases | 1 Devanagari Hindi review (expected UNSUPPORTED), 1 sarcastic review (known model weakness), 1 review of ~900 chars, 2 reviews about delivery or service only |

### 5.3 Star-to-sentiment coherence matrix

The star rating and the text's intended sentiment are authored together. Rows give, for each star value, the share of entries with each intended sentiment:

| Stars | POSITIVE | MIXED | NEUTRAL | NEGATIVE |
|---|---|---|---|---|
| 5★ | 85% | 12% | 3% | 0% |
| 4★ | 60% | 30% | 8% | 2% |
| 3★ | 8% | 40% | 45% | 7% |
| 2★ | 0% | 35% | 10% | 55% |
| 1★ | 0% | 5% | 3% | 92% |

About 10% of entries are **realistic exceptions**:
- A 1★ review driven by delivery or installation, where the product itself is "fine".
- A 4★ review that is mostly complaints but "still worth it".
- A 2★ review with positive text about the product and a complaint about the seller.
- A 5★ review that is terse and neutral in tone ("does the job").

These exceptions are deliberate. They make the gap between star rating and sentiment a talking point in the demo.

### 5.4 Aspect coverage targets

- ≥ 60% of reviews mention at least one aspect, and ≥ 25% mention two or more.
- Each category-specific aspect appears ≥ 8 times in the corpus. Each general aspect (delivery, packaging, value-for-money, customer-service, durability) appears ≥ 10 times across categories.
- Mixed reviews pair a positive aspect with a negative one inside the same review, for example "sound great / battery weak". This is what the aspect module is designed to separate.

### 5.5 Corpus entry format and samples

```json
[
  {
    "corpus_id": "elec-hp-007",
    "product_slug": "auralis-wave-anc-headphones",
    "title": "Great sound, battery not so much",
    "text": "The sound quality is honestly great for the price, bass is punchy without getting muddy. Battery backup is the weak point though, with ANC on I'm charging it every second day.",
    "intended_stars": 4,
    "intended_sentiment": "MIXED",
    "aspects": [
      { "aspect": "sound-quality", "polarity": "POSITIVE" },
      { "aspect": "battery-life", "polarity": "NEGATIVE" }
    ],
    "style": ["medium", "idiom"]
  },
  {
    "corpus_id": "elec-ph-003",
    "product_slug": "novaphone-8-lite",
    "title": "Heats up alot",
    "text": "Phone heats up alot while charging and even on long video calls. Camera is ok in daylight but night shots come out grainy. Expected better at this price.",
    "intended_stars": 2,
    "intended_sentiment": "NEGATIVE",
    "aspects": [
      { "aspect": "performance", "polarity": "NEGATIVE" },
      { "aspect": "camera", "polarity": "NEGATIVE" },
      { "aspect": "value-for-money", "polarity": "NEGATIVE" }
    ],
    "style": ["medium", "typo"]
  },
  {
    "corpus_id": "home-kt-002",
    "product_slug": "brewmate-electric-kettle",
    "title": null,
    "text": "Boils water in like 3 mins. Does the job.",
    "intended_stars": 5,
    "intended_sentiment": "NEUTRAL",
    "aspects": [{ "aspect": "performance", "polarity": "POSITIVE" }],
    "style": ["short", "exception-terse-5star"]
  },
  {
    "corpus_id": "home-af-001",
    "product_slug": "crispo-air-fryer",
    "title": "Replaced half my deep frying",
    "text": "Been using it daily for about two months now. Fries, paneer tikka, even reheating samosas, everything comes out crisp with maybe a teaspoon of oil. The basket coating has held up so far and it cleans easily with warm water. Preheat is quick. Only small gripe is the beep is loud and you can't turn it off, my kid wakes up if I use it late. The 4.2L size is enough for a family of four if you do two batches. Honestly one of the better kitchen purchases I've made.",
    "intended_stars": 5,
    "intended_sentiment": "POSITIVE",
    "aspects": [
      { "aspect": "performance", "polarity": "POSITIVE" },
      { "aspect": "ease-of-use", "polarity": "POSITIVE" },
      { "aspect": "noise-level", "polarity": "NEGATIVE" }
    ],
    "style": ["detailed"]
  },
  {
    "corpus_id": "fash-rs-009",
    "product_slug": "stridewell-pace-running-shoes",
    "title": "Sole peeled in 3 weeks",
    "text": "Sole started peeling off near the toe after just three weeks of evening runs. Really disappointed, these are not cheap.",
    "intended_stars": 1,
    "intended_sentiment": "NEGATIVE",
    "aspects": [{ "aspect": "durability", "polarity": "NEGATIVE" }],
    "style": ["short"]
  },
  {
    "corpus_id": "fash-sh-004",
    "product_slug": "loomline-oxford-shirt",
    "title": "Decent office shirt",
    "text": "Fabric is okay, fitting is regular. Nothing special but fine for office wear. Colour hasn't faded after 5-6 washes.",
    "intended_stars": 3,
    "intended_sentiment": "NEUTRAL",
    "aspects": [
      { "aspect": "fit-size", "polarity": "NEUTRAL" },
      { "aspect": "durability", "polarity": "POSITIVE" }
    ],
    "style": ["short"]
  },
  {
    "corpus_id": "beau-vc-006",
    "product_slug": "dewleaf-vitamin-c-serum",
    "title": "Works, but that smell",
    "text": "My skin does look brighter after a month and it absorbs quickly without any stickiness. But the smell is really strong, kind of metallic, and it lingers for a while. Using it only at night now.",
    "intended_stars": 3,
    "intended_sentiment": "MIXED",
    "aspects": [
      { "aspect": "skin-feel", "polarity": "POSITIVE" },
      { "aspect": "fragrance", "polarity": "NEGATIVE" }
    ],
    "style": ["medium"]
  },
  {
    "corpus_id": "book-ml-002",
    "product_slug": "the-monsoon-ledger",
    "title": "Couldn't put it down",
    "text": "Read it in two sittings. The way the author moves between the grandmother's diary and the present day is beautifully done, and the ending stayed with me for days.",
    "intended_stars": 5,
    "intended_sentiment": "POSITIVE",
    "aspects": [{ "aspect": "story-writing", "polarity": "POSITIVE" }],
    "style": ["medium"]
  },
  {
    "corpus_id": "home-ro-005",
    "product_slug": "aquafresh-ro-purifier",
    "title": "Installation was a nightmare",
    "text": "Installation guy came 6 days late and left the inlet pipe leaking. Called customer care three times, no proper response. Cant comment on the water taste yet because I'm still waiting for someone to fix it.",
    "intended_stars": 1,
    "intended_sentiment": "NEGATIVE",
    "aspects": [
      { "aspect": "installation", "polarity": "NEGATIVE" },
      { "aspect": "customer-service", "polarity": "NEGATIVE" }
    ],
    "style": ["medium", "typo", "exception-service-not-product"]
  },
  {
    "corpus_id": "sport-db-004",
    "product_slug": "irongrip-adjustable-dumbbells",
    "title": "Good set, wrong plates shipped",
    "text": "Solid build and the locking collar feels safe even for overhead presses. Giving 2 stars only because the 20kg set arrived with 17.5kg worth of plates. Seller did replace it but took almost two weeks.",
    "intended_stars": 2,
    "intended_sentiment": "MIXED",
    "aspects": [
      { "aspect": "build-quality", "polarity": "POSITIVE" },
      { "aspect": "delivery", "polarity": "NEGATIVE" },
      { "aspect": "customer-service", "polarity": "NEGATIVE" }
    ],
    "style": ["medium", "exception-positive-text-low-stars"]
  },
  {
    "corpus_id": "elec-sp-008",
    "product_slug": "boomtube-mini-speaker",
    "title": "Fantastic.",
    "text": "Wow, a speaker that disconnects every ten minutes. Exactly what I wanted for a house party.",
    "intended_stars": 1,
    "intended_sentiment": "NEGATIVE",
    "aspects": [{ "aspect": "performance", "polarity": "NEGATIVE" }],
    "style": ["short", "sarcasm-known-model-weakness"]
  },
  {
    "corpus_id": "beau-ho-011",
    "product_slug": "herbalaya-onion-hair-oil",
    "title": null,
    "text": "बहुत अच्छा तेल है, दो हफ्ते में बाल झड़ना कम हो गया। खुशबू थोड़ी तेज़ है।",
    "intended_stars": 4,
    "intended_sentiment": "MIXED",
    "aspects": [],
    "style": ["short", "non-english-expected-unsupported"]
  }
]
```

### 5.6 Aspect slugs used by the corpus

These slugs must match `ai-service/lexicon/aspects.json`, which is the single source of truth. The seeder loads the `aspects` table from that file.

- **General:** delivery, packaging, value-for-money, customer-service, durability, ease-of-use
- **Electronics:** battery-life, sound-quality, display, performance, camera, build-quality
- **Fashion:** fit-size, comfort, material-quality
- **Home Appliances:** noise-level, installation
- **Beauty and Personal Care:** skin-feel, fragrance
- **Books:** story-writing
- **Sports and Fitness:** reuse comfort, build-quality and durability. There are no unique aspects here, which keeps the lexicon small.

### 5.7 Anti-template guardrails (`generate.py --lint`)

The linter rejects the corpus if any of these hold:
- Two entries have word-trigram Jaccard similarity ≥ 0.6.
- The same first five words open more than 3 entries.
- An entry's aspects reference an aspect not in the lexicon, or one that does not apply to the product's category.
- The per-product star histogram contradicts that product's quality profile.
- The style-mix percentages fall outside ±5 points of the targets.

---

## 6. Temporal model

- **Anchor date.** The generator takes `--anchor 2026-10-31T12:00:00Z` (a fixed value stored in `seed_batches.description`) instead of `NOW()`, so output is reproducible.
- **Window.** 14 months, from 2025-09-01 to the anchor. All DATETIME values are stored in **UTC** and the UI renders them in IST.
- **Product launch dates.** Most products launch in the first 4 months. `little-stars-science` launches 3 weeks before the anchor, which explains why it has 0 reviews.
- **User sign-up dates.** Spread across the window. Power reviewers join early, three users join in the final month, and Zoya Ahmed joins 3 days before the anchor.
- **Seasonality.** Monthly weights for review volume:
  - Diwali sale (October to mid-November 2025): ×1.8 across categories
  - New Year (January 2026): ×1.5 for Sports & Fitness
  - Summer (April–May 2026): ×1.4 for sunscreen, air purifier and bottles
  - Back-to-college (July 2026): ×1.3 for laptops, earbuds and backpacks
  - All other months: ×1.0
- **Ordering invariants.** The generator enforces these and the validation queries check them:
  1. `users.created_at < every interaction / rating of that user`
  2. `products.created_at < every interaction / rating on that product`
  3. Every rating is preceded by ≥ 1 PRODUCT_VIEW of that product by that user, 2–10 days earlier. This models the delivery lag.
  4. `feedback.created_at` = the rating's `created_at` + 0–3 minutes.
  5. ~5% of reviews have `updated_at` later than `created_at` (edited later). Every other row has `updated_at = created_at`.
  6. Nothing is dated after the anchor.
  7. A suspended user has no activity after the suspension date. The archived product has no activity after its archive date.

---

## 7. Interaction generation

For each customer, driven by persona:

- **PRODUCT_VIEW.**
  - 1–4 views precede each rated product.
  - Additional browsing views on products that were never rated, at a view-to-rating ratio of about 4:1. Lurkers go up to about 10:1.
  - 70% of views fall in the persona's preferred categories.
  - Views cluster into sessions: 2–6 views within 30 minutes.
- **CATEGORY_VIEW.** Usually opens a session, mostly for the persona's preferred categories.
- **SEARCH.**
  - Drawn from a per-category query bank, for example "noise cancelling headphones under 10000", "air fryer 4 litre", "sunscreen for oily skin", "beginner yoga mat", "thriller books".
  - About 5% contain misspellings ("hedphones", "moisturizer gel") to test search tolerance.
  - The product a user views after a search usually matches that search.
- **RECOMMENDATION_CLICK.** Not seeded. Clicks only arise during the live demo against real recommendation rows, because fabricating clicks on runs that never existed would be fake data.
- Kavya Nair (warm cold-start) has views and preferences but no ratings. Zoya Ahmed has nothing at all. Together they demonstrate both cold-start paths of the engine.

---

## 8. Idempotency and reset

### 8.1 Pipeline

```
corpus/*.json + catalog.json + personas.json
        │  database/seed/generate.py --seed 20261031 --anchor 2026-10-31T12:00:00Z
        ▼
database/seed/generated/demo-v1.json   (committed and reviewable; SHA-256 = content checksum)
        │  node backend/scripts/seed.js --batch demo-v1
        ▼
feedback_ai_db   (triggers create PENDING sentiment_analysis rows)
        │  node backend/scripts/analyze-pending.js   (real AI service)
        ▼
sentiment_analysis + aspect_sentiments filled
        │  node backend/scripts/seed.js --recommendations   (real engine, one run per customer)
        ▼
recommendation_runs + recommendations
```

### 8.2 Apply algorithm (`seed.js`)

1. Refuse to run when `NODE_ENV=production` or `SEED_ALLOW` is not `true`.
2. Compute the SHA-256 of `demo-v1.json`.
3. `START TRANSACTION`, then `SELECT … FROM seed_batches WHERE label='demo-v1' FOR UPDATE`.
   - **Exists with the same checksum:** log "demo-v1 already applied", COMMIT, and exit 0. Nothing is written.
   - **Exists with a different checksum:** abort with a clear message unless `--reseed` is passed. Reseed runs the reset (8.3), then a fresh apply.
   - **Missing:** insert the `seed_batches` row.
4. Upsert reference data by natural key using `INSERT … ON DUPLICATE KEY UPDATE`:
   - categories by `slug`
   - tags by `slug`
   - aspects by `slug`
   - products by `slug`
   - `product_tags` and `user_category_preferences` with `INSERT IGNORE`, because their composite primary keys are their natural keys
5. Upsert users by `email`, ratings by `(user_id, product_id)` and feedback by `rating_id`.
   - Foreign-key IDs are always resolved by looking up natural keys. **Auto-increment IDs are never hard-coded.**
   - **Genuine-row guard:** if a natural key already belongs to a row whose `seed_batch_id IS NULL` (for example, a real user registered that email), abort the whole transaction. Seed data never overwrites genuine data.
   - `password_hash` is excluded from the UPDATE clause, so a re-run never re-hashes passwords.
6. Insert `user_interactions`. They have no natural key, so they are inserted **only** when the batch row was created in this transaction. The checksum guard in step 3 is what makes this safe.
7. Post-insert state changes, run as real statements so the triggers and audit log behave as they would in production:
   - `SET @app_actor_id = <Meera's id>`, then three feedback status UPDATEs (2 HIDDEN, 1 FLAGGED, with notes).
   - Archive `steamline-dry-iron` (`is_active = 0`) **after** its ratings exist, because `trg_ratings_before_insert` rejects inactive products.
   - Suspend Aman Sethi **after** his ratings exist, for the same reason.
8. COMMIT. Any error rolls back the entire batch, so a partial seed is impossible.

**Proving idempotency (Phase 3 test):**
1. Run `seed.js` twice and capture `SELECT COUNT(*)` for every table after each run. The counts must be identical, and the second run must log "already applied".
2. Edit one corpus entry, regenerate and run without `--reseed`. The run must abort with no changes.
3. Register a genuine user and review, then run `--reseed`. That user's rows must survive with identical counts.

### 8.3 Reset demo data (`seed.js --reset demo-v1`)

Reset runs in one transaction, in FK-safe order. Every DELETE filters on `seed_batch_id = :batch` and never on anything broader.

1. `DELETE FROM user_interactions WHERE seed_batch_id = :b`
2. `DELETE FROM ratings WHERE seed_batch_id = :b`. This cascades to feedback, then sentiment_analysis, then aspect_sentiments.
3. `DELETE FROM users WHERE seed_batch_id = :b AND role = 'CUSTOMER'`. This cascades to preferences, recommendation runs and any remaining activity.
   - Activity that demo accounts created live during a demo is deleted with those accounts. This is documented behaviour.
   - Seeded **admins are kept** by default, because `trg_users_before_delete` blocks removing the last active admin. `--include-admins` removes them only when a genuine admin exists.
4. `DELETE FROM products WHERE seed_batch_id = :b`, **only for products that no genuine rating or interaction references**. RESTRICT foreign keys enforce this anyway. Products that are kept are listed in the output.
5. Delete the `seed_batches` row, but only if no rows reference it any more. Otherwise keep it, so provenance survives.
6. Categories, tags and aspects are **reference data** with no `seed_batch_id`, so they are kept.

Rows with `seed_batch_id IS NULL` are never selected by any statement in the reset. Phase 12 tests this explicitly.

---

## 9. Seed sentiment pipeline

### 9.1 Flow

1. `seed.js` inserts about 200 feedback rows. `trg_feedback_after_insert` creates about 200 `sentiment_analysis` rows with status `PENDING`.
2. Start the AI service. `GET /health` must report `model_loaded: true`.
3. `node backend/scripts/analyze-pending.js --batch-size 32` then:
   1. Claims rows with `UPDATE … SET status='PROCESSING' WHERE status IN ('PENDING','FAILED') AND attempt_count < 5 … LIMIT 32`.
   2. Sends them to `POST /v1/analyze/batch` along with `category_slug`.
   3. Validates the response with zod.
   4. Writes `sentiment_analysis` and `aspect_sentiments` in one transaction per batch, setting `text_sha256`, `model_name`, `model_version` and `analyzed_at = NOW()`.
   
   `analyzed_at` is deliberately the real analysis time and is never backdated. Trend charts use `feedback.created_at`.
4. The Hindi entry comes back as `UNSUPPORTED` with no label. This is expected and shown in admin as "Unsupported language".
5. Expected cost: the model loads once, about 200 short texts run in about 7 batches, and the whole run takes under 2 minutes on CPU.

### 9.2 Re-runs

Rows that are COMPLETED with a matching `text_sha256` and `model_version` are skipped. Passing `--force` re-analyses everything, for example after a model change, and overwrites rows in place. `feedback_id` is UNIQUE, so no duplicate analysis rows can appear.

### 9.3 Without the AI service

The seed still loads completely and analyses stay `PENDING`. Dashboards show "N reviews awaiting analysis" and compute percentages over analysed rows only. There is **no** fallback that writes guessed or hard-coded sentiment.

### 9.4 Evaluation against intended labels

`ai-service/scripts/evaluate.py` joins the stored results (through `corpus_id`, which the generated JSON maps to each review) with the corpus's `intended_sentiment` and `aspects`. It reports:

- **3-class metrics** (POSITIVE, NEUTRAL, NEGATIVE) on non-MIXED entries: accuracy, macro-F1 and a confusion matrix.
- **MIXED entries:**
  - the share where the aspect module found both a positive and a negative aspect (so the view `is_mixed = 1`)
  - aspect recall (intended aspects that were detected)
  - aspect polarity agreement
- **Star correlation:** a crosstab of stars against model label.
- **Known failure cases**, listed explicitly: sarcasm, and the service-only 1★ reviews.

The output is written to `docs/evaluation/sentiment_eval_demo-v1.md`. The corpus is **frozen** (its checksum recorded) before the first evaluation. Reviews are not edited afterwards to improve scores. If the model choice changes (`00_DECISIONS` section 5), both results are reported.

### 9.5 Reproducibility

- The generator uses a fixed RNG seed (`20261031`) and a fixed anchor date. `generator_version` is recorded in `seed_batches`.
- The corpus and generated JSON are committed, and the checksum ties the database batch to an exact file.
- In the AI service, the model is pinned to a Hugging Face **revision hash**, `requirements.txt` is pinned, and inference runs in eval mode on CPU. Scores are stored to 4 decimals, so re-runs match to that precision.
- One documented command sequence rebuilds everything: create DB → migrate → seed → analyse → recommendations.

---

## 10. Demo credentials policy

- The database stores only bcrypt hashes (cost 12). The plaintext never appears in `demo-v1.json`, the SQL files or the logs.
- `seed.js` hashes passwords at seed time from `SEED_DEMO_CUSTOMER_PASSWORD` and `SEED_DEMO_ADMIN_PASSWORD` in `backend/.env`, which is gitignored. Placeholder names are listed in `.env.example`.
- The demo account list and the demo passwords chosen for local use are documented in **`database/seed/README.md`** for the person running the demo. They are not repeated in chat or in commit messages.
- All demo accounts use `@demo.feedbackai.test` addresses. They are refused in production by the `NODE_ENV` guard in section 8.2, step 1.

---

## 11. Validation queries

These are run after seeding and analysis, and live in `database/tests/seed_validation.sql`. Every query that should return 0 rows is asserted by the Phase 12 test runner.

```sql
-- V1. Row counts for the demo batch
SELECT 'users' t, COUNT(*) n FROM users WHERE seed_batch_id = @b
UNION ALL SELECT 'products', COUNT(*) FROM products WHERE seed_batch_id = @b
UNION ALL SELECT 'ratings', COUNT(*) FROM ratings WHERE seed_batch_id = @b
UNION ALL SELECT 'feedback', COUNT(*) FROM feedback WHERE seed_batch_id = @b
UNION ALL SELECT 'interactions', COUNT(*) FROM user_interactions WHERE seed_batch_id = @b;

-- V2. No duplicate ratings (expect 0 rows; the UNIQUE key makes this a sanity check)
SELECT user_id, product_id, COUNT(*) FROM ratings GROUP BY user_id, product_id HAVING COUNT(*) > 1;

-- V3. Identical review text (expect 0 rows)
SELECT body, COUNT(*) FROM feedback WHERE seed_batch_id = @b GROUP BY body HAVING COUNT(*) > 1;

-- V4. Every feedback row has exactly one analysis row (expect 0 rows)
SELECT f.feedback_id FROM feedback f
LEFT JOIN sentiment_analysis sa ON sa.feedback_id = f.feedback_id
WHERE sa.analysis_id IS NULL;

-- V5. Analysis status distribution (after the pipeline: COMPLETED ≈ 199, UNSUPPORTED = 1)
SELECT status, COUNT(*) FROM sentiment_analysis GROUP BY status;

-- V6. Temporal: activity before the user signed up (expect 0 rows)
SELECT r.rating_id FROM ratings r JOIN users u ON u.user_id = r.user_id
WHERE r.created_at < u.created_at;
SELECT i.interaction_id FROM user_interactions i JOIN users u ON u.user_id = i.user_id
WHERE i.occurred_at < u.created_at;

-- V7. Temporal: activity before the product launched (expect 0 rows)
SELECT r.rating_id FROM ratings r JOIN products p ON p.product_id = r.product_id
WHERE r.created_at < p.created_at;

-- V8. Every seeded rating has a prior view by the same user (expect 0 rows)
SELECT r.rating_id FROM ratings r
WHERE r.seed_batch_id = @b AND NOT EXISTS (
  SELECT 1 FROM user_interactions i
  WHERE i.user_id = r.user_id AND i.product_id = r.product_id
    AND i.interaction_type = 'PRODUCT_VIEW' AND i.occurred_at < r.created_at);

-- V9. Nothing dated after the anchor (expect 0 rows)
SELECT feedback_id FROM feedback WHERE created_at > '2026-10-31 12:00:00';

-- V10. Admins have no ratings (expect 0 rows)
SELECT r.rating_id FROM ratings r JOIN users u ON u.user_id = r.user_id WHERE u.role = 'ADMIN';

-- V11. Catalogue shape: 6 products per category
SELECT c.slug, COUNT(p.product_id) FROM categories c
LEFT JOIN products p ON p.category_id = c.category_id GROUP BY c.slug;

-- V12. Star distribution, and stars vs model label crosstab (compare with sections 3.3 and 5.3)
SELECT stars, COUNT(*) FROM ratings WHERE seed_batch_id = @b GROUP BY stars ORDER BY stars;
SELECT r.stars, sa.label, COUNT(*) FROM feedback f
JOIN ratings r ON r.rating_id = f.rating_id
JOIN sentiment_analysis sa ON sa.feedback_id = f.feedback_id
WHERE sa.status = 'COMPLETED' GROUP BY r.stars, sa.label ORDER BY r.stars, sa.label;

-- V13. Genuine rows untouched by reseed/reset: run before and after, counts must match
SELECT (SELECT COUNT(*) FROM users WHERE seed_batch_id IS NULL) AS genuine_users,
       (SELECT COUNT(*) FROM ratings WHERE seed_batch_id IS NULL) AS genuine_ratings,
       (SELECT COUNT(*) FROM feedback WHERE seed_batch_id IS NULL) AS genuine_feedback;
```

---

## 12. Open questions and notes for `00_DECISIONS.md`

1. **`seed_batches` needs a checksum column.** Section 8.2 depends on `content_sha256 CHAR(64) NOT NULL`. Proposal: add it to the `seed_batches` definition.
2. **`user_interactions` has no natural key.** Idempotency for that table relies on the batch checksum guard plus delete-and-reinsert on reseed. The alternative is a nullable `seed_key VARCHAR(40) UNIQUE` column. The guard is recommended because it needs no schema change.
3. **Trigger interactions.** The rating triggers mean the seeder must archive products and suspend users *after* inserting their ratings. The last-admin trigger means reset keeps seeded admins by default. Both are handled above.
4. **Aspect list.** The example list in `00_DECISIONS` section 5 needs `camera`, `ease-of-use`, `noise-level`, `installation` and `material-quality` added. That list was illustrative. The canonical list is `ai-service/lexicon/aspects.json`.
5. **Timezone.** `00_DECISIONS` does not specify one. This document assumes DATETIME values are stored in UTC and shown in IST. That should be recorded in section 4.
6. **No `seed_batch_id` on some tables.** `recommendation_runs` and `audit_log` do not carry one. Recommendation runs are removed on reset through the user cascade. Audit rows keep `actor_user_id = NULL` after a reset, which is acceptable for an audit trail.
