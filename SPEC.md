# Card Lookup + Prioritized JustTCG Pricing — Design

**Date:** 2026-09-16
**Status:** Approved, pending implementation plan

## Problem

`PokemonCardCatalog`/`RiftboundCardCatalog` are meant to be a stable, deduplicated "what card is this" reference, independent of any listing. Three things stop that from being true today:

1. **Pokémon has no bulk source at all** — only 11 hand-typed seed rows, versus Riftbound's 1,304 real cards already bulk-imported from a full index.
2. **No real dedup guarantee.** `tcgPlayerId` has no database unique constraint, and the find-or-create used at listing-creation time does a `findFirst` then a separate `.create()` — a race between two concurrent uploads for the same card can, and based on existing code comments already has, produced duplicate catalog rows.
3. **Pricing eligibility is tied to "has a listing"**, so a new listing waits for the next scheduled cron to notice it exists, and a card nobody's listed yet gets no price data even if it's a real, known card.

## Goals

- A real, periodically-refreshable source for the full Pokémon card index (name, set, rarity, `tcgPlayerId`, image), matching what Riftbound already has.
- Every refresh of either source is additive — re-running it does not reprocess cards it already saw; it only picks up what's new or changed.
- Close the duplicate-catalog-row gap with a real database constraint, not just careful code.
- Decouple price-tracking from listing existence, while keeping listed cards prioritized over the rest of the catalog when JustTCG's daily budget is the limiting factor.

## Non-goals

- Reusing `MXYYC-TCG-IDENTIFIER`. Confirmed with the user: that project is for something else (OCR identification). This gets its own, new, dedicated project.
- A live, automatic trigger for re-scraping. The Riftbound source needs a real browser to get past Cloudflare; this stays a manual/scheduled run on a real machine, not a Vercel serverless cron.
- A network bridge between the new project and `pokemon-mvp`. Both live on the same machine; the new project writes a delta file, and a small import script in `pokemon-mvp` reads it — the same shape the existing Riftbound index already uses, just automated on the diffing side.

## Design

### 1. New project: card index sync

A new, standalone TypeScript/Node project (sibling to `pokemon-mvp`, e.g. `tcg-index-sync`), with two independent pipelines and one shared output shape.

**Common output shape**, one file per run per game:
```ts
type CatalogDelta = {
  game: "POKEMON" | "RIFTBOUND";
  generatedAt: string;
  cards: Array<{
    externalId: string;      // stable id from the source (e.g. "sv3pt5-016", "unl-176-219")
    tcgPlayerId: string | null;
    name: string;
    language?: "English" | "Japanese"; // Pokemon only
    imageUrl: string | null;
    // ...the rest of each game's existing catalog fields (rarity, set info, hp/types for
    // Pokemon; domain/energy/power for Riftbound) — same fields already in each Prisma model.
  }>;
};
```
This is deliberately the same shape for both games at the top level (only the inner card fields differ, matching each existing Prisma model) — one import script handles both.

**Riftbound pipeline** — ports the existing `riftbound_script.py` + `build_riftbound_index.py` approach (Playwright against `api.riftcodex.com`, since it's behind a Cloudflare challenge; a persisted browser profile caches the solved session so it isn't re-solved every run) into this new project, in TypeScript (Playwright has a first-class Node API — no need to keep this in Python). Additive part: keep the full previous pull as a local snapshot (`state/riftbound-snapshot.json`); each run re-pulls the current full list (cheap — it's paginated API reads, not per-card work) and diffs by `riftbound_id` + `updated_on` against the snapshot, emitting only new-or-changed cards to the delta file, then overwrites the snapshot for next time.

**Pokémon pipeline** — the source is a git clone of `tcgdex/cards-database` (34,368 EN+JP cards, one file per card, no API, no rate limit). Additive part maps naturally onto git itself: store the last-processed commit SHA (`state/pokemon-last-commit.txt`); each run does `git pull`, then `git diff --name-only <lastSha> HEAD` to get exactly the changed/added card files, parses only those, and updates the stored SHA on success. Two things the existing Python indexer didn't do, both needed here:
  - **Extract `tcgPlayerId`** — present in each source file's third-party-ids block; the old indexer skipped it as "too large for the compact index." We need it, so it's included.
  - **Resolve an image URL** — verified live: `assets.tcgdex.net/en/<series>/<set>/<card-number>/high.webp` resolves real images. The source files carry a `set` id but not the `series` segment tcgdex also needs; a one-time fetch of tcgdex's public set list gives the `set → series` mapping, cached locally.
  - Parsing itself: since these source files are real TypeScript, use a real TS parser (`ts-morph` or the TypeScript compiler API) rather than the old indexer's regex approach — more robust against the source format changing.

### 2. Import script in `pokemon-mvp`

`prisma/importCatalogDelta.ts`, run via `pnpm import:catalog-delta <path-to-delta-file.json>`. For each card in the delta: upsert (see below) into the matching catalog table, keyed by `tcgPlayerId` — creates new rows, updates existing ones (a card can legitimately change: errata text, a corrected image, etc.), never touches or deletes anything else. This script is additive by construction — it only ever processes what's in the delta file it's given, which is already just the new-or-changed set.

### 3. Close the duplicate-row gap

Add a real unique constraint:
```prisma
model PokemonCardCatalog {
  // ...
  tcgPlayerId String? @unique
}
model RiftboundCardCatalog {
  // ...
  tcgPlayerId String? @unique
}
```
Postgres allows any number of `NULL`s under a single-column unique constraint — this only enforces uniqueness among rows that actually have a `tcgPlayerId`, which is exactly what's needed. Change `findOrCreatePokemonCatalogEntry`/`findOrCreateRiftboundCatalogEntry` (`src/lib/listingDisplay.ts`) from `findFirst` + separate `.create()` to a single atomic `prisma.pokemonCardCatalog.upsert({ where: { tcgPlayerId }, ... })` — the database now rejects a concurrent duplicate instead of code needing to race-guard it.

### 4. Backfill, made priority-aware and decoupled from listings

`GET /api/cron/backfill-prices` currently requires `listings: { some: {} }` to even consider a card. Change to two ordered passes within the same `limit` budget:
1. Pending cards (`priceBackfilledAt: null`) **with** a listing — filled first.
2. If budget remains, pending cards **without** a listing — the rest of the catalog, filled in whatever's left.

No new state needed — this is the same `priceBackfilledAt` resumability already built, just queried in listed-first order instead of gated by listing existence.

**Budget note:** at full catalog size (~35,000 cards), the daily refresh alone needs roughly 360-400 calls (see below). Since JustTCG's daily cap is shared across both jobs, the backfill's default `limit` drops from 900 to **500**, leaving headroom for the refresh job to run the same day without risk of hitting the cap. Still overridable per-call via the existing `?limit=` param.

### 5. Refresh, widened to the full catalog

`GET /api/cron/refresh-prices` drops its `listings: { some: {} }` filter for the raw-price pass too — every catalog card with a `tcgPlayerId` gets its "today" price kept current, not just listed ones. At 35,000 cards this is ~350 batch calls (100/call) plus one call per card with an actual graded listing (small, grows slowly) — comfortably inside the daily budget on its own.

## Testing

- New project: unit tests for the diffing logic (Riftbound snapshot-diff, Pokémon changed-files-since-SHA) with fixture data — no real network/git calls in tests.
- `importCatalogDelta.ts`: upserts a new card, updates an existing one, leaves unrelated rows untouched — mocked Prisma.
- The `tcgPlayerId` unique constraint + upsert change: a test confirming a second create-attempt for the same `tcgPlayerId` updates rather than duplicates.
- `backfill-prices`: listed-pending cards are always filled before unlisted-pending ones, within one `limit` budget.
- `refresh-prices`: no longer filters out cards without a listing.

## Out of scope for this design (candidate follow-ups, not required now)

- Automatically triggering the new project's scrape/pull on a schedule — it stays a manual/occasional run for now, given the Riftbound side needs a real browser.
- Backfilling images for cards that already have `PriceHistory` but predate this change — the import script will update their `imageUrl` the next time either source pipeline sees them, nothing retroactive is needed.
