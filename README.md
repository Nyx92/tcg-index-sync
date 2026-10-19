# tcg-index-sync

Builds the full card catalogs for **Pokémon** and **Riftbound** and writes
them as JSON "delta" files. The MXYYC-WEB app imports those files into its
catalog tables, which it uses for card lookup and as the list of cards whose
prices are tracked through JustTCG.

This is a **manual CLI tool**. Nothing runs automatically: you run a sync,
then you run the import in MXYYC-WEB.

---

## The whole pipeline at a glance

```
 Sources                       tcg-index-sync (this repo)              MXYYC-WEB
 ───────                       ──────────────────────────              ─────────
 tcgdex cards-database  ──►  pnpm sync:pokemon    ──► output/pokemon-delta-*.json  ─┐
 (git clone)                  + TCGPlayer id matching (tcgcsv.com)                  │
                                                                                    ├─► pnpm import:catalog-delta <file>
 api.riftcodex.com      ──►  pnpm sync:riftbound  ──► output/riftbound-delta-*.json ─┘        │
 (Playwright scrape)                                                                          ▼
                                                              PokemonCardCatalog / RiftboundCardCatalog (Supabase)
                                                                                              │
                                                       cron: /api/cron/backfill-prices  (once per card: ~1 year of history)
                                                       cron: /api/cron/refresh-prices   (daily: today's price)
                                                                                              ▼
                                                                                PriceHistory (Supabase)
```

1. **Sync** (this repo) collects cards from the sources and writes a delta file.
2. **Import** (MXYYC-WEB) upserts the delta into the catalog tables.
3. **Price jobs** (MXYYC-WEB crons) fetch prices from JustTCG for every catalog
   card that has a TCGPlayer id.

**A card can only be priced if it has a TCGPlayer product id (`tcgPlayerId`).**
JustTCG looks cards up by that id, and the importer skips cards without one.
Much of this repo exists to fill in that id where the source lacks it.

---

## Prerequisites

- A clone of `https://github.com/tcgdex/cards-database` at `../cards-database`
  (next to this repo). The Pokémon sync runs `git pull` in it.
- `pnpm install`
- `pnpm exec playwright install chromium` (for the Riftbound scraper).
- Network access to `github.com`, `tcgcsv.com` and `api.riftcodex.com`.
  No API keys are needed here. **This repo uses no JustTCG quota.**

---

## Step 1 — Run the syncs

```
pnpm sync:pokemon
pnpm sync:riftbound
```

Each prints a summary and writes a new file under `output/`, for example
`output/pokemon-delta-1792319573729.json`. The number is a millisecond
timestamp, so the newest file has the largest number.

Both syncs are **incremental**: they emit only cards that are new or changed
since the last run (see [State files](#state-files)). A run with nothing new
writes a delta with `"cards": []`. That is normal.

Both use a lock file (`state/*.lock`), so two copies of the same sync cannot
run at once. If a run is killed, delete the stale lock file by hand.

### Pokémon (`src/pokemon/`)

Source: the tcgdex `cards-database` repo. `data/` holds English cards and
`data-asia/` holds Asian-market cards.

What a run does:

1. `git pull` in `../cards-database`, then lists the card files that changed
   since the commit in `state/pokemon-last-commit.txt` (all files on a first
   run).
2. **Adds the retry list:** card files in `state/pokemon-unmatched.json` (cards
   that could get a TCGPlayer id but did not on an earlier run).
3. Loads each card file and maps it to a delta card (`mapToDelta.ts`).
4. **English id matching** (`tcgplayerMatch.ts`) — see below.
5. **Japanese id matching** (`tcgplayerMatchJapan.ts`) — see below.
6. Writes the delta (changed cards, plus retried cards that now have an id),
   then updates the state files.

A full run takes about 3 minutes. An incremental run takes about 20 seconds.

#### English TCGPlayer id matching

tcgdex records a card-level TCGPlayer id for many older sets, but most modern
sets (Sword & Shield, Scarlet & Violet, Mega Evolution) have only the
**set-level** TCGPlayer group id. For a card without an id:

1. Take its set's group id (`set.thirdParty.tcgplayer`).
2. Download that group's products from `https://tcgcsv.com/tcgplayer/3/<groupId>/products`
   (tcgcsv.com is a free public mirror of TCGPlayer's catalog).
3. Accept a product only if the **printed card number** and the **name** both
   match (name rules handle `Unown Y` = `Unown (Y)`, `Nidoran ♀` = `Nidoran F`,
   `Electrode` = `Electrode (Prime)`).
4. If several products share the number (staff, prerelease or exclusive
   stamps), take the single plain product with no `(…)`/`[…]` in its name.
   Otherwise leave the card without an id.

#### Japanese TCGPlayer id matching

Japanese set files have **no** TCGPlayer group id, and Japanese card names
have no English version, so the English method cannot work. TCGPlayer's
Japanese catalog (category 85) lists each card's number, HP and type, so:

1. **Set → group by fingerprint.** For each set, compare its Pokémon cards'
   `(number, HP, type)` triples with every Japanese group's products. Accept
   the best group only if it matches **≥ 80 %** of the set's Pokémon cards and
   leads the runner-up by **≥ 20 points**. (Set abbreviations are unreliable:
   tcgdex `MC` is TCGPlayer's "Start Deck 100 Battle Collection".)
2. **Card → product inside that group:**
   - Pokémon: same number, HP and type. If the card has a `dexId` (National
     Pokédex number, the same in every language), the English species name
     must also appear in the product name — e.g. `dexId 357` → "Tropius";
     "Mega Darkrai ex - 046/081" contains "Darkrai". The dexId → English name
     table is built from the English cards in `data/` (Pokémon cards only;
     some Trainer cards also carry a dexId).
   - Trainer / Energy: same number, and the product is a Trainer / Energy card.
   - Same "single plain product" rule for stamped variants.

3. **English names.** A matched card takes the TCGPlayer product name
   without the number suffix as its `name` ("Tropius - 001/080" → "Tropius"),
   and its set takes the group name without the code prefix as `setNameEn`
   ("M5: Abyss Eye" → "Abyss Eye"). The Japanese originals go to `nameJa` and
   `setNameJa`, so MXYYC shows English names for every language.

#### Printed card number (`printedNumber`)

Every delta card carries the number as printed on the card, which MXYYC shows
next to the language chip:

| Cards | Rule | Example |
|---|---|---|
| English, Sword & Shield / Scarlet & Violet / Mega Evolution | both padded to 3 digits | `001/073` |
| English, older series | as-is | `2/102` |
| Japanese | padded to 3 digits | `054/165` |
| Number with letters, or set with no `cardCount.official` | number only | `TG01` |
| Riftbound | number and total from `riftbound_id` | `002/219`, `309*/298` |

Riftbound ids without a total (some promos, e.g. `ven-r01`) give `null`, and
MXYYC shows `collectorNumber` instead. See `printedNumber()` in
`src/pokemon/mapToDelta.ts` and `src/riftbound/mapToDelta.ts`.

Only cards with a Japanese (`ja`) name are looked up. `data-asia/` also holds
Chinese, Thai and Indonesian prints; TCGPlayer does not sell them, so they
never get an id. (They are still labelled `"Japanese"` in the delta — a known
limitation. The importer skips them because they have no id.)

Every matcher is **strict**: a wrong id would show another card's prices, so
anything short of one clear match stays empty. An id that is already used by
another card is never assigned twice. An id that tcgdex itself provides is
never changed.

#### Retries for cards that did not match

A new set is often synced before TCGPlayer lists it. Because the sync is
incremental, such a card would never be looked at again, so:

- After each run, `state/pokemon-unmatched.json` lists every card that *could*
  match but did not (English cards in a set with a group id, and Japanese-named
  cards). Pocket cards and Chinese/Thai/Indonesian prints are not listed,
  because they can never match.
- Every run retries those cards. Retried cards appear in the delta only once
  they have an id.
- A Japanese set that does not fingerprint is recorded in
  `state/japan-unmapped-sets.json` and re-fingerprinted **at most once every
  7 days** (each attempt downloads all ~460 Japanese groups, ~2.5 minutes).
  This means: the next sync you run at least 7 days after the last attempt.
  Nothing happens if you do not run a sync.

### Riftbound (`src/riftbound/`)

Source: `api.riftcodex.com`, which sits behind a Cloudflare challenge, so the
scraper drives a real Chromium browser (Playwright).

1. Scrapes every page of `https://api.riftcodex.com/cards`.
2. Compares the result with the previous full pull in
   `state/riftbound-snapshot.json`.
3. Writes only new or changed cards to the delta, then saves the new snapshot.

The API returns each card's TCGPlayer id itself, so there is no matching step.
Note: riftcodex lists 147 cards twice (one copy without a TCGPlayer id); the
importer skips the copy without an id, so this is harmless.

**Cloudflare on a fresh run:** the scraper solves the challenge automatically
and caches the session in a local browser profile. On a brand-new profile it
may not clear within 30 seconds. Then run with `RIFTBOUND_HEADED=1`, solve the
challenge in the visible browser window, and run again.

---

## Step 2 — Import into MXYYC-WEB (Supabase)

**Normal use:** run `pnpm update-catalog` in MXYYC-WEB. It runs both syncs
here and imports the new delta files, so you do not need to switch repos.
See "Update the catalog" in MXYYC-WEB's README.

To import one file by hand, from the MXYYC-WEB repo:

```
pnpm import:catalog-delta /home/buba/projects/tcg-index-sync/output/<delta-file>.json
```

Run it once per delta file (Pokémon and Riftbound are separate files).

What the importer (`src/lib/catalogDeltaImport.ts`) does:

- **Skips cards with no `tcgPlayerId`.**
- **Upserts by the stable source id**: `externalId` for Pokémon
  (e.g. `sv08-123`), `riftboundId` for Riftbound. Re-importing the same or an
  overlapping delta is safe.
- `tcgPlayerId` is unique: if another row holds the incoming id, that row's id
  is cleared first (the newest source wins).
- Per-card errors are collected and printed; the run exits with code 1 if any
  card failed. Re-running is safe.

It writes to whatever database `DATABASE_URL` in MXYYC-WEB's `.env` points to.

---

## Step 3 — Prices (automatic, MXYYC-WEB crons)

After an import, no extra step is needed. Cron endpoints in MXYYC-WEB
(scheduled on cron-job.org) handle prices for every catalog card that has a
`tcgPlayerId`, whether or not anyone has listed it. They run in short slices
(cron-job.org closes requests after 30 s) within JustTCG's Starter plan
(10,000 calls a month, 1,000 a day):

| Job | Schedule | What it does |
|---|---|---|
| `/api/cron/refresh-prices` | every 30 min | **Today's price**: listed cards daily, every other catalog card weekly. |
| `/api/cron/backfill-prices` | every hour | **Up to one year of history**, once per card, ~15 cards per call, listed cards first. Pauses when fewer than 2,000 monthly calls remain. |
| `/api/cron/report-prices` | daily | Health report on Discord: progress, warnings, quota. |

After a large import the backfill takes a while: at the Starter plan's pace,
~7,000–8,000 cards a month (~4 months for the full ~32k catalog). See
MXYYC-WEB's README, "Cron jobs (card pricing)", for details.

---

## State files

All under `state/` (gitignored). Deleting a file resets that part to "first run".

| File | Used by | Meaning |
|---|---|---|
| `pokemon-last-commit.txt` | Pokémon sync | Last processed `cards-database` commit. Delete it to force a **full** Pokémon run. |
| `pokemon-unmatched.json` | Pokémon sync | Card files to retry for a TCGPlayer id on every run. |
| `japan-set-groups.json` | Pokémon sync | tcgdex Japanese set id → TCGPlayer group id (found by fingerprint). |
| `japan-unmapped-sets.json` | Pokémon sync | Japanese sets with no group yet, and when each was last tried. |
| `riftbound-snapshot.json` | Riftbound sync | Last full Riftbound pull. Delete it to make the next delta contain **all** cards. |
| `pokemon-pending-deltas.txt`, `riftbound-pending-deltas.txt` | both syncs, MXYYC-WEB `pnpm update-catalog` | Delta files (one path per line) not yet imported. Each sync adds its delta before it moves its state forward; `update-catalog` removes a line only after that import succeeds. Do not delete it while it has lines — those cards would be skipped. |
| `*.lock` | both | Present only while a sync runs. Delete it by hand if a run was killed. |

---

## Common tasks

A failed, interrupted or skipped import is retried on the next
`pnpm update-catalog`: every delta stays in `state/<game>-pending-deltas.txt`
until it is imported. You can also run `pnpm sync:pokemon` or
`pnpm sync:riftbound` here on its own; the next `update-catalog` imports
those deltas too.

**Routine update (new sets released):** in MXYYC-WEB, run
```
pnpm update-catalog
```

**Rebuild the full catalog from scratch** (e.g. the database was reset):
```
cp state/pokemon-last-commit.txt state/pokemon-last-commit.txt.bak-$(date +%Y%m%d)
cp state/riftbound-snapshot.json state/riftbound-snapshot.json.bak-$(date +%Y%m%d)
rm state/pokemon-last-commit.txt state/riftbound-snapshot.json
# then, in MXYYC-WEB:
pnpm update-catalog
```

**Retry an unmapped Japanese set now** instead of waiting 7 days: remove its
entry from `state/japan-unmapped-sets.json` (or delete the file) and run
`pnpm sync:pokemon`.

**Check what a delta contains** before importing:
```
node -e 'const d=require("./output/<file>.json");const t=d.cards.filter(c=>c.tcgPlayerId).length;console.log(d.game,d.cards.length,"cards,",t,"importable")'
```

---

## Coverage (full run, 18 October 2026)

| | Cards in source | With a TCGPlayer id (importable) |
|---|---|---|
| Pokémon, English (physical) | 19,772 | 19,243 (97 %) |
| Pokémon, Japanese-language | 13,421 | 12,264 (91 %) |
| Pokémon, other Asian prints | ~4,900 | 0 (not sold on TCGPlayer) |
| Pokémon TCG Pocket (digital) | 2,480 | 0 (no physical product) |
| Riftbound | 1,304 | 1,208 |

Known gaps: vintage Japanese sets (`neo`, `PMCG`) have no printed card numbers,
so they cannot be matched safely; English promo/sample sets without a
TCGPlayer group id.

---

## Development

```
pnpm test
```

Tests cover the delta mapping, the git diff, the card loader, the English and
Japanese matchers, and the retry bookkeeping. The output shape must match
MXYYC-WEB's `CatalogDelta` type in `src/lib/catalogDeltaImport.ts` exactly —
that type is the contract between the two projects.
