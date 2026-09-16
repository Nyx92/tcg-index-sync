# tcg-index-sync

Scrapes and indexes the Riftbound and Pokémon card catalogs, producing
additive delta files under `output/` that are consumed by the sibling
`pokemon-mvp` project.

## Prerequisites

- A sibling clone of `cards-database` at `../cards-database` (relative to
  this project) — the Pokémon sync reads card data from it directly.
- `pnpm install`
- `pnpm exec playwright install chromium` — needed for the Riftbound
  scraper, which drives a real Chromium browser via Playwright.

## Running

```
pnpm sync:riftbound
pnpm sync:pokemon
```

### Riftbound: Cloudflare challenge on a fresh run

`api.riftcodex.com` sits behind a Cloudflare managed JS challenge. The
scraper solves it automatically and caches the session in a local browser
profile directory, but on a completely fresh profile (first run, or a
deleted profile) it may not clear within 30 seconds. If that happens, set
`RIFTBOUND_HEADED=1` to run with a visible browser window, solve the
challenge manually, and re-run — the solved session is then cached for
future runs.

## Notes

Both syncs are additive and safe to re-run: each only processes what
changed since its last run, using state tracked under `state/` (gitignored).
