// src/pokemon/sync.ts
//
// Run with: pnpm sync:pokemon
// Additive: state/pokemon-last-commit.txt holds the last processed commit
// SHA. Each run pulls the repo, diffs HEAD against that SHA for changed
// card files only, and updates the stored SHA on success. If no state
// file exists yet, this is a first run — every card file gets processed.

import { execSync } from "child_process";
import { readFileSync, writeFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { getChangedCardFilesSince } from "./gitDiff";
import { loadCardFile } from "./loadCard";
import { mapPokemonCardToDelta } from "./mapToDelta";
import type { CatalogDelta } from "../types";

const REPO_PATH = "../cards-database"; // sibling clone, matching the identifier project's own layout
// loadCardFile dynamically `import()`s the card file; a relative repoPath
// (as above) makes Node resolve that import relative to loadCard.ts's own
// location (src/pokemon/), not this process's cwd, so every single load
// fails with "Cannot find module" against a nonexistent src/cards-database
// path. Resolving to an absolute path before it reaches loadCardFile side-
// steps that ESM relative-specifier quirk entirely. execSync calls above
// are unaffected — child_process cwd resolves relative to process.cwd() on
// its own — so only the loadCardFile call site needs the absolute form.
const ABSOLUTE_REPO_PATH = resolve(REPO_PATH);
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
    : execSync(`find data data-asia -regex '.*/[0-9]+\\.ts'`, {
        cwd: REPO_PATH,
        encoding: "utf-8",
        // Default execSync maxBuffer (1MB) is exceeded by the full-catalog
        // file listing (~34,368 paths) on a first run, surfacing as a
        // confusing ENOBUFS rather than a clear "maxBuffer exceeded" error.
        maxBuffer: 1024 * 1024 * 100,
      })
        .split("\n")
        .filter(Boolean);

  const cards = [];
  for (const relativeFilePath of changedFiles) {
    // loadCardFile never returns a falsy `card` — it either succeeds with a
    // fully valid LoadedCard, or throws (malformed default export, or the
    // file no longer exists because it was removed/renamed in the diff).
    // Skip and keep going on any such failure rather than crashing the run.
    try {
      const loaded = await loadCardFile(ABSOLUTE_REPO_PATH, relativeFilePath);
      cards.push(mapPokemonCardToDelta(loaded, languageForPath(relativeFilePath)));
    } catch (e) {
      console.warn(`Pokemon: skipping ${relativeFilePath}: ${(e as Error).message}`);
      continue;
    }
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
