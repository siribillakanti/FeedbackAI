#!/usr/bin/env python3
"""FeedbackAI seed generator (Python 3.9, standard library only).

    python3 -I database/seed/generate.py --lint            # validate the corpus
    python3 -I database/seed/generate.py                   # lint, then build generated/demo-v1.json

The generator never invents review text. It assigns every hand-authored corpus
entry to a customer and a date, adds a small number of star-only ratings drawn
from each product's own corpus star distribution, and builds the browsing
history (views, category views, searches) that precedes those ratings.
Output is deterministic for a given catalog, corpus, lexicon, seed and anchor.
"""

import argparse
import hashlib
import json
import random
import re
import statistics
import sys
from collections import Counter, defaultdict
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
ROOT = HERE.parent.parent
DEFAULT_CATALOG = HERE / "catalog.json"
DEFAULT_CORPUS = HERE / "corpus"
DEFAULT_LEXICON = ROOT / "ai-service" / "lexicon" / "aspects.json"
DEFAULT_OUT_DIR = HERE / "generated"

SENTIMENTS = ("POSITIVE", "NEGATIVE", "NEUTRAL", "MIXED")
POLARITIES = ("POSITIVE", "NEGATIVE", "NEUTRAL")
GENERAL_ASPECT_MIN = ("delivery", "packaging", "value-for-money", "customer-service", "durability")
NO_REVIEW_ACTIVITIES = ("admin", "lurker", "warm-cold-start", "cold-start")
BROWSE_SESSIONS = {"very-high": 6, "medium": 3, "low": 2, "suspended": 2,
                   "lurker": 14, "warm-cold-start": 7, "cold-start": 0, "admin": 0}

TOKEN_RE = re.compile(r"\w+", re.UNICODE)
DEVANAGARI_RE = re.compile(r"[ऀ-ॿ]")
EMOJI_RE = re.compile("[\U0001F300-\U0001FAFF☀-➿]")


class SeedError(Exception):
    pass


# ── helpers ───────────────────────────────────────────────────────────────────

def load_json(path):
    with open(path, encoding="utf-8") as fh:
        return json.load(fh)


def parse_utc(value):
    return datetime.strptime(value, "%Y-%m-%dT%H:%M:%SZ").replace(tzinfo=timezone.utc)


def fmt(dt):
    return dt.astimezone(timezone.utc).strftime("%Y-%m-%d %H:%M:%S")


def canonical_bytes(obj):
    return json.dumps(obj, sort_keys=True, separators=(",", ":"), ensure_ascii=False).encode("utf-8")


def tokens(text):
    return TOKEN_RE.findall(text.lower())


def trigrams(toks):
    return {tuple(toks[i:i + 3]) for i in range(len(toks) - 2)}


def pct(part, whole):
    return 100.0 * part / whole if whole else 0.0


def load_corpus(corpus_dir):
    corpus_dir = Path(corpus_dir)
    if not corpus_dir.is_dir():
        raise SeedError("corpus directory not found: %s" % corpus_dir)
    entries = []
    for path in sorted(corpus_dir.glob("*.json")):
        data = load_json(path)
        if not isinstance(data, list):
            raise SeedError("%s: top level must be a JSON array" % path.name)
        for index, entry in enumerate(data):
            entries.append((path.stem, index, entry))
    return entries


# ── lint ──────────────────────────────────────────────────────────────────────

def lint(catalog, lexicon, raw_entries):
    """Return (errors, warnings, valid_entries)."""
    errors, warnings = [], []
    products = {p["slug"]: p for p in catalog["products"]}
    categories = {c["slug"] for c in catalog["categories"]}
    aspects = {a["slug"]: a for a in lexicon["aspects"]}
    seen_ids = {}
    valid = []

    for stem, index, e in raw_entries:
        where = "%s.json[%d]" % (stem, index)
        if not isinstance(e, dict):
            errors.append("%s: entry must be an object" % where)
            continue
        cid = e.get("corpus_id")
        if not isinstance(cid, str) or not cid.strip():
            errors.append("%s: corpus_id must be a non-empty string" % where)
            continue
        where = "%s (%s)" % (where, cid)
        if cid in seen_ids:
            errors.append("%s: duplicate corpus_id (also in %s)" % (where, seen_ids[cid]))
        seen_ids[cid] = where
        ok = True
        if stem not in categories:
            errors.append("%s: file name '%s' is not a category slug" % (where, stem))
            ok = False
        slug = e.get("product_slug")
        product = products.get(slug)
        if product is None:
            errors.append("%s: unknown product_slug %r" % (where, slug))
            ok = False
        elif product["category"] != stem:
            errors.append("%s: product %s belongs to %s, not %s" % (where, slug, product["category"], stem))
            ok = False
        elif product.get("quality_profile") == "none":
            errors.append("%s: product %s is meant to have no reviews" % (where, slug))
            ok = False
        text = e.get("text")
        if not isinstance(text, str) or not (10 <= len(text.strip()) <= 4000):
            errors.append("%s: text must be a string of 10-4000 characters" % where)
            ok = False
        title = e.get("title")
        if title is not None and (not isinstance(title, str) or not title.strip() or len(title) > 120):
            errors.append("%s: title must be null or 1-120 characters" % where)
            ok = False
        stars = e.get("intended_stars")
        if not isinstance(stars, int) or isinstance(stars, bool) or not 1 <= stars <= 5:
            errors.append("%s: intended_stars must be an integer 1-5" % where)
            ok = False
        if e.get("intended_sentiment") not in SENTIMENTS:
            errors.append("%s: intended_sentiment must be one of %s" % (where, ", ".join(SENTIMENTS)))
            ok = False
        style = e.get("style", [])
        if not isinstance(style, list) or not all(isinstance(s, str) for s in style):
            errors.append("%s: style must be a list of strings" % where)
            ok = False
        asp = e.get("aspects")
        if not isinstance(asp, list):
            errors.append("%s: aspects must be a list" % where)
            ok = False
        else:
            names = []
            for a in asp:
                if not isinstance(a, dict) or a.get("polarity") not in POLARITIES:
                    errors.append("%s: each aspect needs {aspect, polarity in %s}" % (where, "/".join(POLARITIES)))
                    ok = False
                    continue
                lex = aspects.get(a.get("aspect"))
                if lex is None:
                    errors.append("%s: aspect %r is not in the lexicon" % (where, a.get("aspect")))
                    ok = False
                elif product is not None and lex["category"] not in (None, product["category"]):
                    errors.append("%s: aspect %s applies to %s only" % (where, lex["slug"], lex["category"]))
                    ok = False
                names.append(a.get("aspect"))
            dupes = [n for n, c in Counter(names).items() if c > 1]
            if dupes:
                warnings.append("%s: aspect listed twice: %s" % (where, ", ".join(dupes)))
        if ok:
            valid.append(e)

    # Anti-template guardrails.
    toks = {e["corpus_id"]: tokens(e["text"]) for e in valid}
    grams = {cid: trigrams(t) for cid, t in toks.items()}
    ids = sorted(grams)
    for i, a in enumerate(ids):
        ga = grams[a]
        if not ga:
            continue
        for b in ids[i + 1:]:
            gb = grams[b]
            if not gb:
                continue
            jac = len(ga & gb) / len(ga | gb)
            if jac >= 0.6:
                errors.append("template-like pair %s / %s: trigram Jaccard %.2f" % (a, b, jac))
    openers = Counter(tuple(t[:5]) for t in toks.values() if len(t) >= 5)
    for opener, count in openers.items():
        if count > 3:
            errors.append("%d entries open with the same five words: '%s'" % (count, " ".join(opener)))

    return errors, warnings, valid


def corpus_report(catalog, lexicon, entries):
    """Style-mix, coherence and coverage figures. Everything here is a warning."""
    warnings, lines = [], []
    n = len(entries)
    if n == 0:
        return ["corpus is empty"], lines
    products = {p["slug"]: p for p in catalog["products"]}
    profiles = catalog["quality_profiles"]

    def check(label, actual, target, tol=5.0):
        flag = "" if abs(actual - target) <= tol else "   <-- outside ±%.0f of %.0f%%" % (tol, target)
        lines.append("  %-26s %5.1f%%%s" % (label, actual, flag))
        if flag:
            warnings.append("%s is %.1f%% (target %.0f%% ±%.0f)" % (label, actual, target, tol))

    lengths = [len(e["text"].strip()) for e in entries]
    lines.append("Style mix (%d entries):" % n)
    check("short (<60 chars)", pct(sum(1 for l in lengths if l < 60), n), 25)
    check("medium (60-250)", pct(sum(1 for l in lengths if 60 <= l <= 250), n), 50)
    check("detailed (>250)", pct(sum(1 for l in lengths if l > 250), n), 25)
    sent = Counter(e["intended_sentiment"] for e in entries)
    for label, target in (("POSITIVE", 50), ("NEGATIVE", 22), ("NEUTRAL", 10), ("MIXED", 18)):
        check("sentiment " + label, pct(sent[label], n), target)
    check("title present", pct(sum(1 for e in entries if e.get("title")), n), 60)
    check("typo style tag", pct(sum(1 for e in entries if "typo" in e.get("style", [])), n), 8)
    check("idiom style tag", pct(sum(1 for e in entries if "idiom" in e.get("style", [])), n), 12)
    check("emoji", pct(sum(1 for e in entries if EMOJI_RE.search(e["text"])), n), 3, tol=3)
    named = sum(1 for e in entries
                if products[e["product_slug"]]["brand"].lower() in e["text"].lower()
                or products[e["product_slug"]]["name"].lower() in e["text"].lower())
    lines.append("  %-26s %5.1f%%" % ("mentions product/brand", pct(named, n)))
    if pct(named, n) > 15:
        warnings.append("%.1f%% of entries mention the product or brand (limit 15%%)" % pct(named, n))

    lines.append("Stars x intended sentiment (row %):")
    lines.append("        " + "".join("%10s" % s for s in ("POSITIVE", "MIXED", "NEUTRAL", "NEGATIVE")) + "      n")
    for star in range(5, 0, -1):
        row = [e for e in entries if e["intended_stars"] == star]
        c = Counter(e["intended_sentiment"] for e in row)
        lines.append("   %d★   " % star + "".join("%9.0f%%" % pct(c[s], len(row))
                                                     for s in ("POSITIVE", "MIXED", "NEUTRAL", "NEGATIVE"))
                     + "%7d" % len(row))

    with_aspect = sum(1 for e in entries if e["aspects"])
    with_two = sum(1 for e in entries if len({a["aspect"] for a in e["aspects"]}) >= 2)
    lines.append("Aspect coverage: >=1 aspect %.0f%% (target >=60), >=2 aspects %.0f%% (target >=25)"
                 % (pct(with_aspect, n), pct(with_two, n)))
    if pct(with_aspect, n) < 60:
        warnings.append("only %.0f%% of entries mention an aspect" % pct(with_aspect, n))
    if pct(with_two, n) < 25:
        warnings.append("only %.0f%% of entries mention two or more aspects" % pct(with_two, n))
    counts = Counter(a["aspect"] for e in entries for a in e["aspects"])
    for a in lexicon["aspects"]:
        need = 8 if a["category"] else (10 if a["slug"] in GENERAL_ASPECT_MIN else 0)
        if need and counts[a["slug"]] < need:
            warnings.append("aspect %s appears %d times (target >= %d)" % (a["slug"], counts[a["slug"]], need))
    lines.append("Aspect mentions: " + ", ".join("%s %d" % (k, v) for k, v in sorted(counts.items())))

    by_product = defaultdict(list)
    for e in entries:
        by_product[e["product_slug"]].append(e["intended_stars"])
    lines.append("Per-product reviews and mean stars:")
    for p in catalog["products"]:
        stars = by_product.get(p["slug"], [])
        mean = statistics.mean(stars) if stars else 0.0
        lines.append("  %-34s %-10s n=%-3d mean=%.2f" % (p["slug"], p["quality_profile"], len(stars), mean))
        prof = profiles[p["quality_profile"]]
        if len(stars) >= 4 and not (prof["mean_min"] - 0.3 <= mean <= prof["mean_max"] + 0.3):
            warnings.append("%s mean %.2f is outside its '%s' profile (%.1f-%.1f)"
                            % (p["slug"], mean, p["quality_profile"], prof["mean_min"], prof["mean_max"]))
        if prof.get("bimodal") and len(stars) >= 4 and statistics.pstdev(stars) < 1.2:
            warnings.append("%s is 'polarising' but its stars are not spread out" % p["slug"])
        if p["quality_profile"] != "none" and not stars:
            warnings.append("%s has no corpus entries" % p["slug"])

    if not any(DEVANAGARI_RE.search(e["text"]) for e in entries):
        warnings.append("no Devanagari (unsupported-language) entry")
    if not any(any(s.startswith("sarcasm") for s in e.get("style", [])) for e in entries):
        warnings.append("no entry tagged sarcasm")
    if not any(len(e["text"]) >= 800 for e in entries):
        warnings.append("no entry of ~900 characters")
    return warnings, lines


# ── generation ────────────────────────────────────────────────────────────────

class World:
    def __init__(self, catalog, rng):
        b = catalog["batch"]
        self.rng = rng
        self.start = parse_utc(b["window_start"])
        self.anchor = parse_utc(b["anchor"])
        self.categories = {c["slug"]: c for c in catalog["categories"]}
        self.products = {p["slug"]: dict(p) for p in catalog["products"]}
        self.users = {u["email"]: dict(u) for u in catalog["users"]}
        self.seasonality = catalog.get("seasonality", [])
        for p in sorted(self.products.values(), key=lambda x: x["slug"]):
            if "launch_days_before_anchor" in p:
                launch = self.anchor - timedelta(days=p["launch_days_before_anchor"])
            else:
                launch = self.start + timedelta(days=rng.uniform(0, 110))
            p["launch"] = launch.replace(microsecond=0)
            p["archived"] = parse_utc(p["archive_on"] + "T10:00:00Z") if p.get("archive_on") else None
            p["end"] = min(self.anchor, p["archived"]) if p["archived"] else self.anchor
        for u in sorted(self.users.values(), key=lambda x: x["email"]):
            if "joined_days_before_anchor" in u:
                day = self.anchor - timedelta(days=u["joined_days_before_anchor"])
            else:
                day = self.start + timedelta(days=u["joined_day"])
            u["joined"] = day.replace(hour=0, minute=0, second=0) + timedelta(seconds=rng.randint(4 * 3600, 16 * 3600))
            u["end"] = self.anchor
            if "activity_end_day" in u:
                u["end"] = self.start + timedelta(days=u["activity_end_day"])
            u["suspended_at"] = None

    def season_weight(self, day, product=None, category=None):
        weight = 1.0
        for s in self.seasonality:
            if not (s["from"] <= day.strftime("%Y-%m-%d") <= s["to"]):
                continue
            target = s["applies_to"]
            if target == "all":
                weight *= s["weight"]
            elif product and product["slug"] in target.get("products", []):
                weight *= s["weight"]
            elif (product and product["category"] in target.get("categories", [])) or \
                    (category and category in target.get("categories", [])):
                weight *= s["weight"]
        return weight

    def sample_time(self, lo, hi, product=None, category=None):
        """Seasonally weighted instant in [lo, hi], preferring daytime IST (03:30-17:30 UTC)."""
        if hi <= lo:
            raise SeedError("empty time window %s .. %s" % (fmt(lo), fmt(hi)))
        days, weights = [], []
        d = lo.replace(hour=0, minute=0, second=0)
        while d <= hi:
            days.append(d)
            weights.append(self.season_weight(d, product, category))
            d += timedelta(days=1)
        day = self.rng.choices(days, weights=weights)[0]
        band_lo = max(lo, day + timedelta(hours=3, minutes=30))
        band_hi = min(hi, day + timedelta(hours=17, minutes=30))
        if band_hi <= band_lo:
            band_lo, band_hi = max(lo, day), min(hi, day + timedelta(days=1))
        span = int((band_hi - band_lo).total_seconds())
        return band_lo + timedelta(seconds=self.rng.randint(0, max(span, 0)))

    def rating_window(self, user, product):
        lo = max(user["joined"], product["launch"]) + timedelta(days=11)
        hi = min(user["end"], product["end"]) - timedelta(days=1)
        return lo, hi

    def active_at(self, product, when):
        return product["launch"] < when and (product["archived"] is None or when < product["archived"])


def build(catalog, lexicon, entries, seed):
    rng = random.Random(seed)
    w = World(catalog, rng)
    customers = [u for u in sorted(w.users.values(), key=lambda x: x["email"]) if u["role"] == "CUSTOMER"]
    writers = [u for u in customers if u["activity"] not in NO_REVIEW_ACTIVITIES and u["text_ratio"] > 0]
    suspended = [u for u in customers if u["status"] == "SUSPENDED"]
    moderator = next((u for u in w.users.values() if u.get("moderator")), None)
    if moderator is None:
        raise SeedError("catalog has no user with moderator: true")

    rated = defaultdict(set)              # email -> product slugs
    text_count = Counter()
    cap = {u["email"]: round(u["rating_target"] * u["text_ratio"]) for u in customers}
    ratings = []                          # dicts with user, product, stars, review entry or None

    def feasible(user, product):
        lo, hi = w.rating_window(user, product)
        return hi - lo >= timedelta(days=1)

    def assign(user, product_slug, stars, entry):
        rated[user["email"]].add(product_slug)
        if entry is not None:
            text_count[user["email"]] += 1
        ratings.append({"user": user, "product": w.products[product_slug], "stars": stars, "entry": entry})

    entries = sorted(entries, key=lambda e: e["corpus_id"])
    remaining = list(entries)

    # The suspended account gets its text reviews first, from its preferred categories.
    for su in suspended:
        pool = [e for e in remaining
                if w.products[e["product_slug"]]["category"] in su["preferred_categories"]
                and feasible(su, w.products[e["product_slug"]])
                and not any(s.startswith("sarcasm") for s in e.get("style", []))
                and not DEVANAGARI_RE.search(e["text"])]
        pool.sort(key=lambda e: (e["intended_stars"] not in (1, 5), e["corpus_id"]))
        picked = []
        for e in pool:
            if len(picked) >= cap[su["email"]]:
                break
            if e["product_slug"] not in rated[su["email"]]:
                picked.append(e)
                assign(su, e["product_slug"], e["intended_stars"], e)
        remaining = [e for e in remaining if e not in picked]

    by_product = defaultdict(list)
    for e in remaining:
        by_product[e["product_slug"]].append(e)
    order = sorted(by_product, key=lambda s: (-len(by_product[s]), s))
    for slug in order:
        product = w.products[slug]
        group = list(by_product[slug])
        rng.shuffle(group)
        for e in group:
            best, best_score = None, None
            for u in writers:
                if u in suspended or slug in rated[u["email"]] or not feasible(u, product):
                    continue
                room = cap[u["email"]] - text_count[u["email"]]
                score = 4.5 * (product["category"] in u["preferred_categories"])
                score += 2.0 * room / max(1, cap[u["email"]])
                if room <= 0:
                    score -= 6.0
                bias, s = u["star_bias"], e["intended_stars"]
                if bias < 0:
                    score += -bias * (3 - s)
                elif bias > 0:
                    score += bias * (s - 3) * 1.5
                length = len(e["text"])
                if u.get("style_pref") == "short":
                    score += 1.0 if length < 60 else (-1.0 if length > 250 else 0.0)
                elif u.get("style_pref") == "detailed" and length > 250:
                    score += 0.8
                score += rng.random()
                if best_score is None or score > best_score:
                    best, best_score = u, score
            if best is None:
                raise SeedError("no eligible customer left for %s (%s)" % (e["corpus_id"], slug))
            assign(best, slug, e["intended_stars"], e)

    # Star-only ratings, drawn from each product's own corpus star distribution.
    corpus_stars = defaultdict(list)
    for e in entries:
        corpus_stars[e["product_slug"]].append(e["intended_stars"])
    for u in customers:
        need = u["rating_target"] - len(rated[u["email"]])
        for _ in range(max(0, need)):
            pool = [p for p in w.products.values()
                    if len(corpus_stars[p["slug"]]) >= 3 and p["slug"] not in rated[u["email"]] and feasible(u, p)]
            if not pool:
                break
            preferred = [p for p in pool if p["category"] in u["preferred_categories"]]
            if preferred and rng.random() < 0.7:
                pool = preferred
            pool.sort(key=lambda p: p["slug"])
            product = rng.choices(pool, weights=[len(corpus_stars[p["slug"]]) for p in pool])[0]
            stars = rng.choice(corpus_stars[product["slug"]])
            if u["star_bias"] and rng.random() < abs(u["star_bias"]):
                stars += 1 if u["star_bias"] > 0 else -1
            assign(u, product["slug"], min(5, max(1, stars)), None)

    # Dates.
    for r in ratings:
        lo, hi = w.rating_window(r["user"], r["product"])
        r["created"] = w.sample_time(lo, hi, product=r["product"])
        r["updated"] = r["created"]
        r["hi"] = hi
        if r["entry"] is not None:
            r["fb_created"] = r["created"] + timedelta(seconds=rng.randint(0, 180))
            r["fb_updated"] = r["fb_created"]
            if rng.random() < 0.05:
                edited = r["fb_created"] + timedelta(days=rng.uniform(1, 14))
                if edited < hi:
                    r["fb_updated"] = edited.replace(microsecond=0)
                    r["updated"] = r["fb_updated"]

    for su in suspended:
        mine = [r["created"] for r in ratings if r["user"] is su]
        if mine:
            su["suspended_at"] = max(mine) + timedelta(days=rng.uniform(2, 5))
            su["end"] = su["suspended_at"]

    # Moderation: hide the suspended account's reviews, flag one tone/stars mismatch.
    moderation = []
    for r in ratings:
        if r["user"] in suspended and r["entry"] is not None:
            moderation.append((r, "HIDDEN", "Hidden after the posting account was suspended for review spam.",
                               r["user"]["suspended_at"] - timedelta(hours=6)))
    flag_pool = [r for r in ratings if r["entry"] is not None and r["user"] not in suspended]
    flag_pool.sort(key=lambda r: (not any(s.startswith("sarcasm") for s in r["entry"].get("style", [])),
                                  not any(s.startswith("exception") for s in r["entry"].get("style", [])),
                                  r["entry"]["corpus_id"]))
    if flag_pool:
        r = flag_pool[0]
        when = min(r["fb_created"] + timedelta(days=2), w.anchor - timedelta(hours=1))
        moderation.append((r, "FLAGGED", "Flagged for review: the text tone and the star rating may disagree.", when))

    # Interactions.
    interactions = []

    def add(user, kind, when, product=None, category=None, query=None):
        interactions.append({"user": user["email"], "type": kind, "at": when.replace(microsecond=0),
                             "product": product["slug"] if product else None,
                             "category": category, "query": query})

    by_category = defaultdict(list)
    for p in sorted(w.products.values(), key=lambda x: x["slug"]):
        by_category[p["category"]].append(p)

    for r in sorted(ratings, key=lambda x: (x["user"]["email"], x["product"]["slug"])):
        u, p = r["user"], r["product"]
        first = r["created"] - timedelta(days=rng.uniform(2, 10))
        if rng.random() < 0.35:
            add(u, "CATEGORY_VIEW", first - timedelta(seconds=rng.randint(150, 300)), category=p["category"])
        if rng.random() < 0.35:
            add(u, "SEARCH", first - timedelta(seconds=rng.randint(20, 120)), query=rng.choice(p["search_terms"]))
        add(u, "PRODUCT_VIEW", first, product=p)
        if rng.random() < 0.30:
            when = first + timedelta(seconds=rng.randint(60, 360))
            others = [q for q in by_category[p["category"]] if q is not p and w.active_at(q, when)]
            if others:
                add(u, "PRODUCT_VIEW", when, product=rng.choice(others))
        extra = rng.choices((0, 1, 2), weights=(60, 30, 10))[0]
        for _ in range(extra):
            lo, hi = first + timedelta(hours=1), r["created"] - timedelta(hours=1)
            if hi > lo:
                add(u, "PRODUCT_VIEW", lo + (hi - lo) * rng.random(), product=p)

    category_slugs = sorted(w.categories)
    for u in customers:
        sessions = BROWSE_SESSIONS.get(u["activity"], 0)
        done = 0
        while True:
            views = sum(1 for i in interactions if i["user"] == u["email"] and i["type"] == "PRODUCT_VIEW")
            if done >= sessions and not (u["activity"] == "lurker" and views < 40):
                break
            done += 1
            prefs = u["preferred_categories"]
            focus = rng.choice(prefs) if prefs and rng.random() < 0.7 else rng.choice(category_slugs)
            lo, hi = u["joined"] + timedelta(days=1), u["end"] - timedelta(hours=1)
            if hi <= lo:
                break
            t = w.sample_time(lo, hi, category=focus)
            if rng.random() < 0.70:
                add(u, "CATEGORY_VIEW", t, category=focus)
            t += timedelta(seconds=rng.randint(20, 90))
            live = [p for p in by_category[focus] if w.active_at(p, t)]
            first_pick = None
            if rng.random() < 0.45:
                if live and rng.random() < 0.5:
                    first_pick = rng.choice(live)
                    add(u, "SEARCH", t, query=rng.choice(first_pick["search_terms"]))
                else:
                    add(u, "SEARCH", t, query=rng.choice(w.categories[focus]["search_queries"]))
            n = rng.randint(3, 5) if u["activity"] == "lurker" else rng.randint(2, 4)
            picks = [first_pick] if first_pick else []
            rest = [p for p in live if p is not first_pick]
            rng.shuffle(rest)
            picks += rest[: max(0, n - len(picks))]
            for p in picks:
                t += timedelta(seconds=rng.randint(60, 360))
                if w.active_at(p, t) and t < hi:
                    add(u, "PRODUCT_VIEW", t, product=p)

    return w, ratings, moderation, interactions, moderator


def validate_build(w, ratings, interactions):
    problems = []
    keys = Counter((r["user"]["email"], r["product"]["slug"]) for r in ratings)
    problems += ["duplicate rating %s/%s" % k for k, c in keys.items() if c > 1]
    views = defaultdict(list)
    for i in interactions:
        u = w.users[i["user"]]
        if i["at"] <= u["joined"]:
            problems.append("interaction before sign-up: %s %s" % (i["user"], fmt(i["at"])))
        if i["at"] >= w.anchor:
            problems.append("interaction after anchor: %s" % fmt(i["at"]))
        if u["suspended_at"] and i["at"] >= u["suspended_at"]:
            problems.append("interaction after suspension: %s" % i["user"])
        if i["product"]:
            p = w.products[i["product"]]
            if not w.active_at(p, i["at"]):
                problems.append("view of inactive product %s at %s" % (p["slug"], fmt(i["at"])))
            if i["type"] == "PRODUCT_VIEW":
                views[(i["user"], i["product"])].append(i["at"])
    for r in ratings:
        u, p = r["user"], r["product"]
        if r["created"] <= u["joined"] or r["created"] <= p["launch"]:
            problems.append("rating before sign-up/launch: %s %s" % (u["email"], p["slug"]))
        last = r.get("fb_updated", r["updated"])
        if last >= w.anchor or (p["archived"] and r["created"] >= p["archived"]):
            problems.append("rating outside product/anchor window: %s %s" % (u["email"], p["slug"]))
        if u["suspended_at"] and r["created"] >= u["suspended_at"]:
            problems.append("rating after suspension: %s" % u["email"])
        prior = [t for t in views[(u["email"], p["slug"])] if t < r["created"]]
        if not any(timedelta(days=2) <= r["created"] - t <= timedelta(days=10) for t in prior):
            problems.append("rating without a view 2-10 days earlier: %s %s" % (u["email"], p["slug"]))
        if u["role"] != "CUSTOMER":
            problems.append("admin rating: %s" % u["email"])
    lurkers = [u for u in w.users.values() if u["activity"] == "lurker"]
    for u in lurkers:
        n = sum(1 for i in interactions if i["user"] == u["email"] and i["type"] == "PRODUCT_VIEW")
        if n < 40:
            problems.append("lurker %s has only %d views" % (u["email"], n))
    for u in w.users.values():
        if u["activity"] == "cold-start" and any(i["user"] == u["email"] for i in interactions):
            problems.append("cold-start user %s has activity" % u["email"])
    return problems


def to_output(catalog, lexicon, w, ratings, moderation, interactions, moderator, seed):
    b = catalog["batch"]
    rng = w.rng
    users_out = []
    for u in sorted(w.users.values(), key=lambda x: x["email"]):
        prefs = [{"category": c, "created_at": fmt(u["joined"] + timedelta(seconds=rng.randint(120, 1200)))}
                 for c in sorted(u["preferred_categories"])]
        users_out.append({"email": u["email"], "full_name": u["full_name"], "role": u["role"],
                          "status": u["status"], "created_at": fmt(u["joined"]),
                          "suspended_at": fmt(u["suspended_at"]) if u["suspended_at"] else None,
                          "preferences": prefs})
    products_out = [{"slug": p["slug"], "category": p["category"], "name": p["name"], "brand": p["brand"],
                     "description": p["description"], "price": p["price"], "image_url": p.get("image_url"),
                     "tags": sorted(p["tags"]), "created_at": fmt(p["launch"]),
                     "archived_at": fmt(p["archived"]) if p["archived"] else None}
                    for p in sorted(w.products.values(), key=lambda x: x["slug"])]
    ratings_out = []
    for r in sorted(ratings, key=lambda x: (x["created"], x["user"]["email"], x["product"]["slug"])):
        e = r["entry"]
        review = None
        if e is not None:
            review = {"corpus_id": e["corpus_id"], "title": e.get("title"), "body": e["text"].strip(),
                      "created_at": fmt(r["fb_created"]), "updated_at": fmt(r["fb_updated"])}
        ratings_out.append({"user": r["user"]["email"], "product": r["product"]["slug"], "stars": r["stars"],
                            "created_at": fmt(r["created"]), "updated_at": fmt(r["updated"]), "review": review})
    moderation_out = [{"user": r["user"]["email"], "product": r["product"]["slug"], "status": status,
                       "note": note, "moderated_at": fmt(when), "actor": moderator["email"]}
                      for r, status, note, when in moderation]
    interactions_out = [{"user": i["user"], "type": i["type"], "product": i["product"], "category": i["category"],
                         "query": i["query"], "at": fmt(i["at"])}
                        for i in sorted(interactions, key=lambda x: (x["at"], x["user"], x["type"]))]
    out = {
        "format": "feedbackai-seed/1",
        "batch": {"label": b["label"], "generator_version": b["generator_version"], "rng_seed": seed,
                  "window_start": b["window_start"], "anchor": b["anchor"],
                  "description": "%s Anchor %s, seed %d." % (b["description"], b["anchor"], seed),
                  "lexicon_version": lexicon["version"]},
        "categories": [{"slug": c["slug"], "name": c["name"], "description": c["description"],
                        "display_order": c["display_order"]} for c in catalog["categories"]],
        "tags": sorted(catalog["tags"], key=lambda t: t["slug"]),
        "products": products_out,
        "users": users_out,
        "ratings": ratings_out,
        "moderation": moderation_out,
        "interactions": interactions_out,
    }
    out["content_sha256"] = hashlib.sha256(canonical_bytes(out)).hexdigest()
    return out


def summarize(out, catalog):
    ratings = out["ratings"]
    reviews = [r for r in ratings if r["review"]]
    users = {u["email"]: u for u in catalog["users"]}
    cats = {p["slug"]: p["category"] for p in catalog["products"]}
    in_pref = sum(1 for r in ratings if cats[r["product"]] in users[r["user"]]["preferred_categories"])
    stars = Counter(r["stars"] for r in ratings)
    kinds = Counter(i["type"] for i in out["interactions"])
    print("ratings %d (with text %d, star-only %d); preferred-category share %.0f%%"
          % (len(ratings), len(reviews), len(ratings) - len(reviews), pct(in_pref, len(ratings))))
    print("stars: " + ", ".join("%d★ %.0f%%" % (s, pct(stars[s], len(ratings))) for s in range(5, 0, -1)))
    print("interactions %d: %s" % (len(out["interactions"]), ", ".join("%s %d" % kv for kv in sorted(kinds.items()))))
    per_user = Counter(r["user"] for r in ratings)
    print("per-user ratings (actual/target): " + ", ".join(
        "%s %d/%d" % (u["email"].split("@")[0], per_user[u["email"]], u["rating_target"])
        for u in catalog["users"] if u["role"] == "CUSTOMER"))
    print("moderation actions %d; content_sha256 %s" % (len(out["moderation"]), out["content_sha256"]))


def main(argv=None):
    ap = argparse.ArgumentParser(description=__doc__.splitlines()[0])
    ap.add_argument("--lint", action="store_true", help="validate the corpus and exit")
    ap.add_argument("--catalog", default=str(DEFAULT_CATALOG))
    ap.add_argument("--corpus", default=str(DEFAULT_CORPUS), help="directory of <category-slug>.json files")
    ap.add_argument("--lexicon", default=str(DEFAULT_LEXICON))
    ap.add_argument("--out", default=None, help="output file (default generated/<label>.json)")
    ap.add_argument("--seed", type=int, default=None, help="RNG seed (default from catalog)")
    ap.add_argument("--strict", action="store_true", help="treat style-mix warnings as errors")
    args = ap.parse_args(argv)

    try:
        catalog = load_json(args.catalog)
        lexicon = load_json(args.lexicon)
        raw = load_corpus(args.corpus)
        errors, warnings, entries = lint(catalog, lexicon, raw)
        report_warnings, lines = corpus_report(catalog, lexicon, entries)
        warnings += report_warnings
        print("\n".join(lines))
        for msg in warnings:
            print("WARNING: " + msg)
        for msg in errors:
            print("ERROR: " + msg)
        print("lint: %d entries, %d errors, %d warnings" % (len(raw), len(errors), len(warnings)))
        if errors or (args.strict and warnings):
            return 1
        if args.lint:
            return 0

        seed = args.seed if args.seed is not None else catalog["batch"]["rng_seed"]
        w, ratings, moderation, interactions, moderator = build(catalog, lexicon, entries, seed)
        problems = validate_build(w, ratings, interactions)
        if problems:
            for msg in problems[:50]:
                print("INVARIANT: " + msg)
            print("generation failed: %d invariant violations" % len(problems))
            return 1
        out = to_output(catalog, lexicon, w, ratings, moderation, interactions, moderator, seed)
        out_path = Path(args.out) if args.out else DEFAULT_OUT_DIR / ("%s.json" % catalog["batch"]["label"])
        out_path.parent.mkdir(parents=True, exist_ok=True)
        with open(out_path, "w", encoding="utf-8") as fh:
            json.dump(out, fh, ensure_ascii=False, indent=1, sort_keys=True)
            fh.write("\n")
        summarize(out, catalog)
        print("wrote %s" % out_path)
        return 0
    except SeedError as exc:
        print("ERROR: %s" % exc, file=sys.stderr)
        return 1


if __name__ == "__main__":
    sys.exit(main())
