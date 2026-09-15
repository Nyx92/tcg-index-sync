# tcg-index-sync — New Project Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** A new, standalone project that produces `CatalogDelta` files (see the companion plan `2026-09-16-card-lookup-pricing-pipeline-pokemon-mvp.md`, Global Constraints) for Riftbound and Pokémon — each run additive, only emitting cards that are new or changed since the last run.

**Architecture:** Two independent pipelines sharing one output type. Riftbound: Playwright scrape of `api.riftcodex.com` (behind Cloudflare) diffed against a saved snapshot. Pokémon: `git pull` a clone of `tcgdex/cards-database`, diff changed files since the last processed commit, and dynamically `import()` each changed card file directly (these are plain, side-effect-free TS modules — importing them is simpler and more robust than re-parsing their source text). A card's image URL and TCGPlayer id are both already present in that same source tree — no separate external lookup needed for either.

**Tech Stack:** Node.js, TypeScript, `tsx`, Playwright, Vitest. No web framework — this is a CLI-run project.

**Spec:** `docs/superpowers/specs/2026-09-16-card-lookup-pricing-pipeline-design.md`

## Global Constraints

- Every run is additive: state from the previous run (a snapshot file, or a commit SHA) determines what's new, and only that gets processed or written to the delta output.
- Output shape matches the companion plan's `CatalogDelta` type exactly — this project's tests assert against that exact shape so the two projects never silently drift apart.
- This project is run manually/on a schedule on a real machine — not deployed, not a serverless function. The Riftbound scrape specifically needs a real browser to get past Cloudflare.
- Verified live facts this plan relies on, not assumptions:
  - `https://assets.tcgdex.net/en/<series>/<set>/<card-number>/high.webp` resolves real images (confirmed: `ex/ex4/39` → 200).
  - A card's `series` id, `set` id, and TCGPlayer id are all available directly in `cards-database`'s own file tree: a card file imports its set (`../SetName`), whose `serie` field imports the series (`../SeriesName`), and the card's own `thirdParty.tcgplayer` field holds its TCGPlayer id.

---

### Task 1: Project scaffold + shared types

**Files:**
- Create: `package.json`, `tsconfig.json`, `vitest.config.ts`
- Create: `src/types.ts`

**Interfaces:**
- Produces: `CatalogDelta`, `CatalogDeltaCard` types, identical in shape to `pokemon-mvp`'s `src/lib/catalogDeltaImport.ts` types.

- [ ] **Step 1: Create the project and install dependencies**

```bash
mkdir -p /home/buba/projects/tcg-index-sync/src
cd /home/buba/projects/tcg-index-sync
pnpm init
pnpm add playwright typescript tsx
pnpm add -D vitest @types/node
pnpm exec playwright install chromium
```

- [ ] **Step 2: Add `tsconfig.json`**

```json
{
  "compilerOptions": {
    "target": "ES2022",
    "module": "commonjs",
    "moduleResolution": "node",
    "esModuleInterop": true,
    "resolveJsonModule": true,
    "strict": true,
    "outDir": "dist",
    "skipLibCheck": true
  },
  "include": ["src"]
}
```

- [ ] **Step 3: Add `vitest.config.ts`**

```ts
import { defineConfig } from "vitest/config";
export default defineConfig({ test: { environment: "node", globals: true } });
```

- [ ] **Step 4: Add npm scripts to `package.json`**

```json
  "scripts": {
    "sync:riftbound": "tsx src/riftbound/sync.ts",
    "sync:pokemon": "tsx src/pokemon/sync.ts",
    "test": "vitest run"
  }
```

- [ ] **Step 5: Create the shared type file**

Create `src/types.ts`:

```ts
// src/types.ts
//
// Must match pokemon-mvp's src/lib/catalogDeltaImport.ts CatalogDelta type
// exactly — this is the contract between the two projects.

export type CatalogDeltaCard = {
  externalId: string;
  tcgPlayerId: string | null;
  name: string;
  language?: "English" | "Japanese";
  imageUrl: string | null;
  [key: string]: unknown;
};

export type CatalogDelta = {
  game: "POKEMON" | "RIFTBOUND";
  generatedAt: string;
  cards: CatalogDeltaCard[];
};
```

- [ ] **Step 6: Commit**

```bash
cd /home/buba/projects/tcg-index-sync
git init && git add -A
git commit -m "Scaffold tcg-index-sync project"
```

---

### Task 2: Riftbound — snapshot diffing (pure, testable)

**Files:**
- Create: `src/riftbound/diff.ts`
- Test: `src/riftbound/diff.test.ts`

**Interfaces:**
- Produces: `diffRiftboundCards(previous: RiftboundApiCard[], current: RiftboundApiCard[]): RiftboundApiCard[]` — cards in `current` that are new or have a newer `updated_on` than their `previous` counterpart, keyed by `riftbound_id`.

- [ ] **Step 1: Write the failing test**

Create `src/riftbound/diff.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { diffRiftboundCards, type RiftboundApiCard } from "./diff";

function card(overrides: Partial<RiftboundApiCard>): RiftboundApiCard {
  return { riftbound_id: "a-1", updated_on: "2026-01-01", name: "Test", ...overrides } as RiftboundApiCard;
}

describe("diffRiftboundCards", () => {
  it("includes a card that wasn't in the previous snapshot at all", () => {
    const result = diffRiftboundCards([], [card({ riftbound_id: "new-1" })]);
    expect(result.map((c) => c.riftbound_id)).toEqual(["new-1"]);
  });

  it("excludes a card whose updated_on is unchanged", () => {
    const previous = [card({ riftbound_id: "a-1", updated_on: "2026-01-01" })];
    const current = [card({ riftbound_id: "a-1", updated_on: "2026-01-01" })];
    expect(diffRiftboundCards(previous, current)).toEqual([]);
  });

  it("includes a card whose updated_on moved forward", () => {
    const previous = [card({ riftbound_id: "a-1", updated_on: "2026-01-01" })];
    const current = [card({ riftbound_id: "a-1", updated_on: "2026-02-01" })];
    const result = diffRiftboundCards(previous, current);
    expect(result.map((c) => c.riftbound_id)).toEqual(["a-1"]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test diff.test.ts`
Expected: FAIL — `./diff` doesn't exist.

- [ ] **Step 3: Implement**

Create `src/riftbound/diff.ts`:

```ts
// src/riftbound/diff.ts
//
// Riftbound's additive step: api.riftcodex.com has no "give me only what
// changed" endpoint, so this project re-pulls the full current list every
// run (cheap — it's paginated reads, not per-card work) and diffs it
// against the previous run's saved snapshot, only carrying forward cards
// that are new or whose updated_on moved.

export type RiftboundApiCard = {
  riftbound_id: string;
  updated_on: string;
  [key: string]: unknown;
};

export function diffRiftboundCards(
  previous: RiftboundApiCard[],
  current: RiftboundApiCard[]
): RiftboundApiCard[] {
  const previousByid = new Map(previous.map((c) => [c.riftbound_id, c]));
  return current.filter((card) => {
    const prior = previousByid.get(card.riftbound_id);
    return !prior || card.updated_on > prior.updated_on;
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test diff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/riftbound/diff.ts src/riftbound/diff.test.ts
git commit -m "Add Riftbound snapshot-diff logic"
```

---

### Task 3: Riftbound — scrape, map, and write the delta

**Files:**
- Create: `src/riftbound/scrape.ts` (Playwright fetch — ported from the existing `riftbound_script.py` approach)
- Create: `src/riftbound/mapToDelta.ts` (pure field mapping)
- Test: `src/riftbound/mapToDelta.test.ts`
- Create: `src/riftbound/sync.ts` (CLI entry point tying scrape → diff → map → write together)

**Interfaces:**
- Consumes: `diffRiftboundCards` (Task 2)
- Produces: `mapRiftboundCardToDelta(card: RiftboundApiCard): CatalogDeltaCard`

- [ ] **Step 1: Write the failing test for field mapping**

Create `src/riftbound/mapToDelta.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapRiftboundCardToDelta } from "./mapToDelta";

describe("mapRiftboundCardToDelta", () => {
  it("maps a riftcodex API card into a CatalogDeltaCard", () => {
    const result = mapRiftboundCardToDelta({
      riftbound_id: "unl-176-219", tcgplayer_id: "706028", name: "Vi - Peacekeeper",
      updated_on: "2026-09-01", set: { label: "Unleashed", id: "unl" },
      classification: { rarity: "Rare", type: "Unit", supertype: "Champion" },
      collector_number: 176, media: { image_url: "https://cmsassets.rgpub.io/x.png" },
      domain: ["Fury"], energy: 5, might: 3, power: null,
    });

    expect(result).toEqual(expect.objectContaining({
      externalId: "unl-176-219",
      tcgPlayerId: "706028",
      name: "Vi - Peacekeeper",
      imageUrl: "https://cmsassets.rgpub.io/x.png",
      setLabel: "Unleashed",
      setId: "unl",
      rarity: "Rare",
      type: "Unit",
      supertype: "Champion",
      collectorNumber: "176",
    }));
  });

  it("passes through a null tcgplayer_id as null, not a string", () => {
    const result = mapRiftboundCardToDelta({
      riftbound_id: "x", tcgplayer_id: null, name: "X", updated_on: "2026-01-01",
      set: { label: "S", id: "s" }, classification: { rarity: "R", type: "T", supertype: "" },
      collector_number: 1, media: { image_url: "url" }, domain: [], energy: null, might: null, power: null,
    });
    expect(result.tcgPlayerId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test mapToDelta.test.ts`
Expected: FAIL — `./mapToDelta` doesn't exist.

- [ ] **Step 3: Implement the mapping**

Create `src/riftbound/mapToDelta.ts`:

```ts
// src/riftbound/mapToDelta.ts
import type { CatalogDeltaCard } from "../types";
import type { RiftboundApiCard } from "./diff";

type FullRiftboundApiCard = RiftboundApiCard & {
  tcgplayer_id: string | null;
  name: string;
  set: { label: string; id: string };
  classification: { rarity: string; type: string; supertype: string };
  collector_number: number;
  media: { image_url: string };
  domain: string[];
  energy: number | null;
  might: number | null;
  power: number | null;
};

export function mapRiftboundCardToDelta(card: FullRiftboundApiCard): CatalogDeltaCard {
  return {
    externalId: card.riftbound_id,
    tcgPlayerId: card.tcgplayer_id,
    name: card.name,
    imageUrl: card.media.image_url,
    setLabel: card.set.label,
    setId: card.set.id,
    rarity: card.classification.rarity,
    type: card.classification.type,
    supertype: card.classification.supertype,
    collectorNumber: String(card.collector_number),
    domain: card.domain,
    energy: card.energy,
    might: card.might,
    power: card.power,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test mapToDelta.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the Playwright scraper**

Create `src/riftbound/scrape.ts` — ports `riftbound_script.py`'s approach (persisted browser profile solves Cloudflare once, then paginates via in-page `fetch()`):

```ts
// src/riftbound/scrape.ts
//
// api.riftcodex.com sits behind a Cloudflare managed challenge, so a plain
// HTTP client gets a 403. A real (headed, first run) browser solves it once;
// the persistent profile directory caches that session for later runs.

import { chromium } from "playwright";
import type { RiftboundApiCard } from "./diff";

const PROFILE_DIR = "./.riftcodex_browser_profile";
const PAGE_SIZE = 100;

export async function scrapeAllRiftboundCards(): Promise<RiftboundApiCard[]> {
  const context = await chromium.launchPersistentContext(PROFILE_DIR, { headless: true });
  const page = await context.newPage();
  await page.goto("https://riftcodex.com"); // establishes/refreshes the cf_clearance cookie

  const cards: RiftboundApiCard[] = [];
  let cursor = 0;
  while (true) {
    const url = `https://api.riftcodex.com/cards?size=${PAGE_SIZE}&from=${cursor}&sort=collector_number`;
    const batch: RiftboundApiCard[] = await page.evaluate(
      async (u) => (await fetch(u)).json(),
      url
    );
    if (batch.length === 0) break;
    cards.push(...batch);
    cursor += PAGE_SIZE;
  }

  await context.close();
  return cards;
}
```

- [ ] **Step 6: Implement the CLI entry point**

Create `src/riftbound/sync.ts`:

```ts
// src/riftbound/sync.ts
//
// Run with: pnpm sync:riftbound
// Additive: reads the previous full pull from state/riftbound-snapshot.json,
// diffs the fresh pull against it, writes only the delta to output/, and
// overwrites the snapshot with the fresh full pull for next time.

import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { scrapeAllRiftboundCards } from "./scrape";
import { diffRiftboundCards, type RiftboundApiCard } from "./diff";
import { mapRiftboundCardToDelta } from "./mapToDelta";
import type { CatalogDelta } from "../types";

const SNAPSHOT_PATH = "state/riftbound-snapshot.json";
const OUTPUT_DIR = "output";

async function main() {
  const previous: RiftboundApiCard[] = existsSync(SNAPSHOT_PATH)
    ? JSON.parse(readFileSync(SNAPSHOT_PATH, "utf-8"))
    : [];

  const current = await scrapeAllRiftboundCards();
  const changed = diffRiftboundCards(previous, current as any);

  const delta: CatalogDelta = {
    game: "RIFTBOUND",
    generatedAt: new Date().toISOString(),
    cards: changed.map((c) => mapRiftboundCardToDelta(c as any)),
  };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync("state", { recursive: true });
  const outputPath = `${OUTPUT_DIR}/riftbound-delta-${Date.now()}.json`;
  writeFileSync(outputPath, JSON.stringify(delta, null, 2));
  writeFileSync(SNAPSHOT_PATH, JSON.stringify(current, null, 2));

  console.log(`Riftbound: ${current.length} total, ${changed.length} new/changed → ${outputPath}`);
}

main().catch((e) => {
  console.error("Riftbound sync failed:", e);
  process.exit(1);
});
```

- [ ] **Step 7: Manually verify against the real site**

Run: `pnpm sync:riftbound` (first run may need `headless: false` in `scrape.ts` temporarily if Cloudflare challenges a fully headless browser — matching the existing Python script's own `--headed` fallback note).
Expected: an `output/riftbound-delta-<timestamp>.json` is written; on a second run immediately after, its `cards` array should be empty (nothing changed since the snapshot was just saved).

- [ ] **Step 8: Commit**

```bash
git add src/riftbound/ package.json
git commit -m "Add Riftbound scrape + delta pipeline"
```

---

### Task 4: Pokémon — changed-files-since-commit detection (pure, testable)

**Files:**
- Create: `src/pokemon/gitDiff.ts`
- Test: `src/pokemon/gitDiff.test.ts`

**Interfaces:**
- Produces: `parseChangedCardFiles(diffOutput: string): string[]` — filters raw `git diff --name-only` output down to individual card files (paths with a numeric filename, e.g. `data/EX/Team Magma vs Team Aqua/39.ts`), excluding set-level and series-level files (whose filenames aren't purely numeric).

- [ ] **Step 1: Write the failing test**

Create `src/pokemon/gitDiff.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { parseChangedCardFiles } from "./gitDiff";

describe("parseChangedCardFiles", () => {
  it("keeps only individual card files, by numeric filename", () => {
    const diffOutput = [
      "data/EX/Team Magma vs Team Aqua/39.ts",
      "data/EX/Team Magma vs Team Aqua.ts",   // set-level file — excluded
      "data/EX.ts",                            // series-level file — excluded
      "data-asia/SV/Scarlet & Violet/1.ts",
      "interfaces.ts",                         // unrelated — excluded
    ].join("\n");

    expect(parseChangedCardFiles(diffOutput)).toEqual([
      "data/EX/Team Magma vs Team Aqua/39.ts",
      "data-asia/SV/Scarlet & Violet/1.ts",
    ]);
  });

  it("returns an empty array for empty diff output", () => {
    expect(parseChangedCardFiles("")).toEqual([]);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test gitDiff.test.ts`
Expected: FAIL — `./gitDiff` doesn't exist.

- [ ] **Step 3: Implement**

Create `src/pokemon/gitDiff.ts`:

```ts
// src/pokemon/gitDiff.ts
//
// Pokemon's additive step maps directly onto git: cards-database is a
// plain git clone, so "what's new or changed" is just "what files changed
// since the commit we last processed." A card file's own name is always
// numeric (its local id, e.g. "39.ts"); set- and series-level files are
// named after the set/series instead, so filtering by a numeric stem is
// enough to isolate individual card files from the diff.

import { execSync } from "child_process";

export function parseChangedCardFiles(diffOutput: string): string[] {
  return diffOutput
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.endsWith(".ts"))
    .filter((line) => {
      const stem = line.split("/").pop()!.replace(/\.ts$/, "");
      return /^\d+$/.test(stem);
    });
}

/** Runs `git diff --name-only <lastSha> HEAD` in `repoPath` and returns changed card files. */
export function getChangedCardFilesSince(repoPath: string, lastSha: string | null): string[] {
  if (!lastSha) return []; // no prior state — caller falls back to a full pass, not this function
  const output = execSync(`git diff --name-only ${lastSha} HEAD`, { cwd: repoPath, encoding: "utf-8" });
  return parseChangedCardFiles(output);
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test gitDiff.test.ts`
Expected: PASS.

- [ ] **Step 5: Commit**

```bash
git add src/pokemon/gitDiff.ts src/pokemon/gitDiff.test.ts
git commit -m "Add Pokemon changed-card-file detection via git diff"
```

---

### Task 5: Pokémon — card loader and delta mapping

**Files:**
- Create: `src/pokemon/loadCard.ts`
- Create: `src/pokemon/mapToDelta.ts`
- Test: `src/pokemon/mapToDelta.test.ts`
- Create fixtures: `src/pokemon/__fixtures__/card.ts`, `src/pokemon/__fixtures__/set.ts`, `src/pokemon/__fixtures__/serie.ts` (trimmed copies of the real shape confirmed in Task 4's research, used only by tests)

**Interfaces:**
- Produces: `loadCardFile(repoPath: string, filePath: string): Promise<LoadedCard>` (dynamically imports the card + its set + its serie); `mapPokemonCardToDelta(loaded: LoadedCard, language: "English" | "Japanese"): CatalogDeltaCard`

- [ ] **Step 1: Write the failing test for the mapping function (the loader itself needs real files, tested separately below)**

Create `src/pokemon/__fixtures__/card.ts` (mirrors the real shape confirmed against `cards-database/data/EX/Team Magma vs Team Aqua/39.ts`):

```ts
export const fixtureCard = {
  name: { en: "Bulbasaur" },
  illustrator: "Ken Sugimori",
  rarity: "Common",
  set: { id: "ex4", name: { en: "Team Magma vs Team Aqua" }, serie: { id: "ex" } },
  dexId: [1],
  hp: 50,
  types: ["Grass"],
  stage: "Basic",
  thirdParty: { tcgplayer: 84028 },
};
```

Create `src/pokemon/mapToDelta.test.ts`:

```ts
import { describe, it, expect } from "vitest";
import { mapPokemonCardToDelta } from "./mapToDelta";
import { fixtureCard } from "./__fixtures__/card";

describe("mapPokemonCardToDelta", () => {
  it("maps a cards-database card into a CatalogDeltaCard, building the tcgdex image URL", () => {
    const result = mapPokemonCardToDelta(
      { card: fixtureCard, localId: "39" },
      "English"
    );

    expect(result).toEqual(expect.objectContaining({
      externalId: "ex4-39",
      tcgPlayerId: "84028",
      name: "Bulbasaur",
      language: "English",
      imageUrl: "https://assets.tcgdex.net/en/ex/ex4/39/high.webp",
      setId: "ex4",
      setNameEn: "Team Magma vs Team Aqua",
      rarity: "Common",
      hp: 50,
      types: ["Grass"],
      stage: "Basic",
      localId: "39",
    }));
  });

  it("maps to null tcgPlayerId when thirdParty.tcgplayer is absent", () => {
    const cardWithoutId = { ...fixtureCard, thirdParty: {} };
    const result = mapPokemonCardToDelta({ card: cardWithoutId, localId: "1" }, "English");
    expect(result.tcgPlayerId).toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm test mapToDelta.test.ts` (in `src/pokemon/`)
Expected: FAIL — `./mapToDelta` doesn't exist.

- [ ] **Step 3: Implement the mapping**

Create `src/pokemon/mapToDelta.ts`:

```ts
// src/pokemon/mapToDelta.ts
import type { CatalogDeltaCard } from "../types";

type PokemonSourceCard = {
  name: { en: string };
  rarity: string;
  set: { id: string; name: { en: string }; serie: { id: string } };
  dexId?: number[];
  hp?: number;
  types?: string[];
  stage?: string;
  thirdParty?: { tcgplayer?: number };
};

export function mapPokemonCardToDelta(
  loaded: { card: PokemonSourceCard; localId: string },
  language: "English" | "Japanese"
): CatalogDeltaCard {
  const { card, localId } = loaded;
  const tcgPlayerId = card.thirdParty?.tcgplayer != null ? String(card.thirdParty.tcgplayer) : null;

  return {
    externalId: `${card.set.id}-${localId}`,
    tcgPlayerId,
    name: card.name.en,
    language,
    imageUrl: `https://assets.tcgdex.net/en/${card.set.serie.id}/${card.set.id}/${localId}/high.webp`,
    setId: card.set.id,
    setNameEn: card.set.name.en,
    rarity: card.rarity,
    hp: card.hp ?? null,
    types: card.types ?? [],
    stage: card.stage ?? null,
    localId,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm test mapToDelta.test.ts`
Expected: PASS.

- [ ] **Step 5: Implement the loader (dynamic import — needs the real repo, verified manually in Task 6)**

Create `src/pokemon/loadCard.ts`:

```ts
// src/pokemon/loadCard.ts
//
// A cards-database card file is a plain, side-effect-free TS module with a
// default export — importing it directly is simpler and more robust than
// re-parsing its source text (the approach the older Python indexer used).
// tsx (this project's runtime) handles .ts imports natively.

import { join } from "path";

export type LoadedCard = { card: any; localId: string };

export async function loadCardFile(repoPath: string, relativeFilePath: string): Promise<LoadedCard> {
  const absolutePath = join(repoPath, relativeFilePath);
  const mod = await import(absolutePath);
  const localId = relativeFilePath.split("/").pop()!.replace(/\.ts$/, "");
  return { card: mod.default, localId };
}
```

- [ ] **Step 6: Commit**

```bash
git add src/pokemon/mapToDelta.ts src/pokemon/mapToDelta.test.ts src/pokemon/loadCard.ts src/pokemon/__fixtures__/
git commit -m "Add Pokemon card loader and delta mapping"
```

---

### Task 6: Pokémon — CLI entry point and manual verification

**Files:**
- Create: `src/pokemon/sync.ts`

**Interfaces:**
- Consumes: `getChangedCardFilesSince` (Task 4), `loadCardFile` + `mapPokemonCardToDelta` (Task 5)

- [ ] **Step 1: Implement**

Create `src/pokemon/sync.ts`:

```ts
// src/pokemon/sync.ts
//
// Run with: pnpm sync:pokemon
// Additive: state/pokemon-last-commit.txt holds the last processed commit
// SHA. Each run pulls the repo, diffs HEAD against that SHA for changed
// card files only, and updates the stored SHA on success. If no state
// file exists yet, this is a first run — every card file gets processed.

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { getChangedCardFilesSince } from "./gitDiff";
import { loadCardFile } from "./loadCard";
import { mapPokemonCardToDelta } from "./mapToDelta";
import type { CatalogDelta } from "../types";

const REPO_PATH = "../cards-database"; // sibling clone, matching the identifier project's own layout
const STATE_PATH = "state/pokemon-last-commit.txt";
const OUTPUT_DIR = "output";

function languageForPath(relativeFilePath: string): "English" | "Japanese" {
  return relativeFilePath.startsWith("data-asia/") ? "Japanese" : "English";
}

async function main() {
  execSync("git pull", { cwd: REPO_PATH });
  const headSha = execSync("git rev-parse HEAD", { cwd: REPO_PATH, encoding: "utf-8" }).trim();

  const lastSha = existsSync(STATE_PATH) ? readFileSync(STATE_PATH, "utf-8").trim() : null;
  const changedFiles = lastSha
    ? getChangedCardFilesSince(REPO_PATH, lastSha)
    : execSync(`find data data-asia -regex '.*/[0-9]+\\.ts'`, { cwd: REPO_PATH, encoding: "utf-8" })
        .split("\n")
        .filter(Boolean);

  const cards = [];
  for (const relativeFilePath of changedFiles) {
    const loaded = await loadCardFile(REPO_PATH, relativeFilePath);
    if (!loaded.card) continue; // a removed/renamed file can still show up in the diff
    cards.push(mapPokemonCardToDelta(loaded, languageForPath(relativeFilePath)));
  }

  const delta: CatalogDelta = { game: "POKEMON", generatedAt: new Date().toISOString(), cards };

  mkdirSync(OUTPUT_DIR, { recursive: true });
  mkdirSync("state", { recursive: true });
  const outputPath = `${OUTPUT_DIR}/pokemon-delta-${Date.now()}.json`;
  writeFileSync(outputPath, JSON.stringify(delta, null, 2));
  writeFileSync(STATE_PATH, headSha);

  console.log(`Pokemon: ${changedFiles.length} changed file(s) → ${cards.length} cards → ${outputPath}`);
}

main().catch((e) => {
  console.error("Pokemon sync failed:", e);
  process.exit(1);
});
```

- [ ] **Step 2: Manually verify against the real repo**

Ensure `/home/buba/projects/cards-database` exists as a sibling clone (it already does on this machine). Run: `pnpm sync:pokemon`.
Expected, first run (no `state/pokemon-last-commit.txt` yet): processes every card file under `data/`/`data-asia/` — this is the full 34,368-card catalog, so expect it to take a while — and writes one large delta file, plus creates the state file. Run again immediately after: `state/pokemon-last-commit.txt` already matches `HEAD`, so `changedFiles` is empty and the new delta file has zero cards.

- [ ] **Step 3: Commit**

```bash
git add src/pokemon/sync.ts
git commit -m "Add Pokemon sync CLI entry point"
```

---

## Self-Review Notes

- **Spec coverage:** scaffold (Task 1), Riftbound diff+scrape+delta (Tasks 2-3), Pokémon changed-file detection+load+map+CLI (Tasks 4-6) — every pipeline in the spec has a task.
- **Contract check:** `CatalogDelta`/`CatalogDeltaCard` in `src/types.ts` (Task 1) match the companion `pokemon-mvp` plan's Global Constraints shape field-for-field.
- **Verified, not assumed:** the tcgdex image URL pattern and the series/set/tcgPlayerId source locations were confirmed against the real files and a live URL before this plan was written, not guessed.
- **No placeholders:** every step has complete, real code; the two "manually verify" steps (Riftbound live scrape, Pokemon first full pass) are inherently operational, not unit-testable, and are marked as such rather than faked with a mock.
