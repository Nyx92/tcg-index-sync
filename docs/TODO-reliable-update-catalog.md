# TODO — make `pnpm update-catalog` safe in every case

Status: **not implemented yet** (written 2026-10-20 as a hand-off).

## Goal

One command — `pnpm update-catalog` in MXYYC-WEB — must always leave the
catalog complete, whatever happened before:

| Case | Required behavior |
|---|---|
| Normal run, new/changed cards | Sync, then import them. |
| Previous import failed (network, DB) | Next run imports the leftover delta first, then syncs. |
| Someone ran `pnpm sync:pokemon` / `sync:riftbound` here without importing | Next run imports those deltas too. |
| Run interrupted mid-import | Next run imports that delta again (the importer upserts, so re-running is safe). |
| Nothing changed | Imports nothing, exits cleanly. |

## The problem today

The sync writes `state/pokemon-last-commit.txt` / `state/riftbound-snapshot.json`
as soon as it writes a delta file. If that delta is never imported, the next
sync starts after it, so those cards are skipped for good. Only the person
remembering `pnpm import:catalog-delta <file>` prevents this.

## Design (small, two files)

1. **Ledger of pending deltas** — `state/pending-deltas.json`, a list of delta
   file paths not yet imported.
   - `src/pokemon/sync.ts` and `src/riftbound/sync.ts`: after writing a delta
     with cards, append its path to the ledger (same `writeFileAtomic` as the
     other state files; skip deltas with 0 cards).
2. **MXYYC-WEB `script/update-catalog.sh`**:
   1. First import every path in the ledger, oldest first
      (`pnpm import:catalog-delta <file>`). After each **successful** import,
      remove that path from the ledger. On failure: stop, keep it in the
      ledger, print the error (the next run retries it).
   2. Then run the syncs (as now) — each new delta lands in the ledger.
   3. Import the ledger again (same loop as step 1).
   - Replace the current "newest file in output/" detection with the ledger.
3. **Tests** (tcg-index-sync, vitest): sync appends to the ledger; a 0-card
   delta is not added. Script: dry run with a fake sync dir (see how
   update-catalog.sh was checked: a fake package.json whose sync scripts
   write a delta file).
4. **Docs**: update the "Update the catalog (one command)" section in
   MXYYC-WEB's README and "Common tasks" in this README — remove the
   "don't run the sync again" warning; the ledger handles it.

## Notes

- The importer (`MXYYC-WEB/src/lib/catalogDeltaImport.ts`) upserts by
  externalId / riftboundId, so importing the same delta twice is harmless.
- Full re-syncs (deleting `state/pokemon-last-commit.txt`) produce a full
  delta (~40k cards); importing it through the normal importer takes 1–2 h
  because existing rows are updated 5 at a time. If that matters, batch the
  updates in `catalogDeltaImport.ts` (e.g. `unnest` bulk UPDATE per batch).
- Never import a delta into the database without the ledger knowing — that
  is what caused the manual fix-up on 2026-10-20 (149 Japanese updates found
  by a full sync run only for image URLs; imported by hand).
