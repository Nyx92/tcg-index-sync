// src/pokemon/sync.ts
//
// Run with: pnpm sync:pokemon
// Additive: state/pokemon-last-commit.txt holds the last processed commit
// SHA. Each run pulls the repo, diffs HEAD against that SHA for changed
// card files only, and updates the stored SHA on success. If no state
// file exists yet, this is a first run — every card file gets processed.

import { execSync } from "child_process";
import { readFileSync, existsSync, mkdirSync } from "fs";
import { resolve } from "path";
import { getChangedCardFilesSince } from "./gitDiff";
import { loadCardFile } from "./loadCard";
import { mapPokemonCardToDelta } from "./mapToDelta";
import { fetchGroupProducts, matchTcgplayerProduct } from "./tcgplayerMatch";
import {
  buildSpeciesMap,
  fetchJpGroups,
  englishCardName,
  englishSetName,
  fetchJpGroupProducts,
  fingerprintSetToGroup,
  matchJapaneseProduct,
  type JpCard,
  type JpProduct,
} from "./tcgplayerMatchJapan";
import type { CatalogDelta, CatalogDeltaCard } from "../types";
import type { LoadedCard } from "./loadCard";
import { isRetryEligible, planFiles, shouldEmit, shouldRetrySet } from "./unmatched";
import { writeFileAtomic, withLock } from "../fsSafety";

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
const LOCK_PATH = "state/pokemon.lock";
// tcgdex Japanese set id → TCGPlayer "Pokemon Japan" group id, found by
// fingerprint (see tcgplayerMatchJapan.ts). Saved so later runs fetch only
// the groups they need instead of all ~460.
const JAPAN_SET_GROUPS_PATH = "state/japan-set-groups.json";
// Japanese sets that didn't fingerprint, with when they were last tried.
const JAPAN_UNMAPPED_SETS_PATH = "state/japan-unmapped-sets.json";
// Card files that could get a TCGPlayer id but didn't yet — retried every run
// (see unmatched.ts).
const UNMATCHED_PATH = "state/pokemon-unmatched.json";

const readJson = <T>(path: string, fallback: T): T =>
  existsSync(path) ? (JSON.parse(readFileSync(path, "utf-8")) as T) : fallback;

function languageForPath(relativeFilePath: string): "English" | "Japanese" {
  return relativeFilePath.startsWith("data-asia/") ? "Japanese" : "English";
}

async function main() {
  mkdirSync("state", { recursive: true });

  await withLock(LOCK_PATH, async () => {
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

    const { files, retryOnly } = planFiles(changedFiles, readJson<string[]>(UNMATCHED_PATH, []));

    const cards: CatalogDeltaCard[] = [];
    const loadedCards: LoadedCard[] = [];
    const cardFiles: string[] = [];
    for (const relativeFilePath of files) {
      // loadCardFile never returns a falsy `card` — it either succeeds with a
      // fully valid LoadedCard, or throws (malformed default export, or the
      // file no longer exists because it was removed/renamed in the diff).
      // Skip and keep going on any such failure rather than crashing the run.
      try {
        const loaded = await loadCardFile(ABSOLUTE_REPO_PATH, relativeFilePath);
        cards.push(mapPokemonCardToDelta(loaded, languageForPath(relativeFilePath)));
        loadedCards.push(loaded);
        cardFiles.push(relativeFilePath);
      } catch (e) {
        console.warn(`Pokemon: skipping ${relativeFilePath}: ${(e as Error).message}`);
        continue;
      }
    }

    // Second pass, after every card is loaded so the "already used" set holds
    // all of cards-database's own ids: fill missing TCGPlayer ids from
    // TCGPlayer's product list for the card's set (see tcgplayerMatch.ts).
    // English only — Japanese sets carry no TCGPlayer group id.
    const usedIds = new Set(cards.map((c) => c.tcgPlayerId).filter((id): id is string => id != null));
    let filled = 0;
    const failedGroups = new Set<string>();
    for (let i = 0; i < cards.length; i++) {
      const card = cards[i];
      const groupId = loadedCards[i].card.set.thirdParty?.tcgplayer;
      if (card.tcgPlayerId != null || card.language !== "English" || groupId == null) continue;
      if (failedGroups.has(String(groupId))) continue;
      try {
        const products = await fetchGroupProducts(String(groupId));
        const match = matchTcgplayerProduct({ localId: loadedCards[i].localId, name: card.name }, products);
        if (match && !usedIds.has(match)) {
          card.tcgPlayerId = match;
          usedIds.add(match);
          filled++;
        }
      } catch (e) {
        failedGroups.add(String(groupId));
        console.warn(`Pokemon: TCGPlayer lookup failed for group ${groupId}: ${(e as Error).message}`);
      }
    }
    console.log(`Pokemon: filled ${filled} missing TCGPlayer id(s) from tcgcsv`);

    // Third pass: Japanese cards. data-asia/ also holds Chinese, Thai and
    // Indonesian prints TCGPlayer doesn't sell — only cards with a Japanese
    // (`ja`) name are looked up, in TCGPlayer's "Pokemon Japan" category.
    const jpBySet = new Map<string, number[]>();
    cards.forEach((card, i) => {
      // Every Japanese-language card: unmatched ones get an id, and every card
      // in a matched set gets the English set name (and card name, if its id
      // is in the set's product list).
      if (loadedCards[i].card.name.ja != null) {
        const setId = loadedCards[i].card.set.id;
        jpBySet.set(setId, [...(jpBySet.get(setId) ?? []), i]);
      }
    });
    const toJpCard = (i: number): JpCard => {
      const { card, localId } = loadedCards[i];
      return { localId, category: card.category, hp: card.hp, type: card.types?.[0], dexId: card.dexId?.[0] };
    };
    let jpFilled = 0;
    if (jpBySet.size > 0) {
      const setGroups = readJson<Record<string, string>>(JAPAN_SET_GROUPS_PATH, {});
      const unmappedTried = readJson<Record<string, string>>(JAPAN_UNMAPPED_SETS_PATH, {});
      const now = new Date();
      try {
        const toFingerprint = [...jpBySet.keys()].filter(
          (setId) => !setGroups[setId] && shouldRetrySet(unmappedTried[setId], now)
        );
        if (toFingerprint.length > 0) {
          const allGroups: Record<string, JpProduct[]> = {};
          for (const { id: gid } of await fetchJpGroups()) allGroups[gid] = await fetchJpGroupProducts(gid);
          for (const setId of toFingerprint) {
            const gid = fingerprintSetToGroup(jpBySet.get(setId)!.map(toJpCard), allGroups);
            if (gid) {
              setGroups[setId] = gid;
              delete unmappedTried[setId];
            } else {
              unmappedTried[setId] = now.toISOString();
            }
          }
          writeFileAtomic(JAPAN_SET_GROUPS_PATH, JSON.stringify(setGroups, null, 2));
          writeFileAtomic(JAPAN_UNMAPPED_SETS_PATH, JSON.stringify(unmappedTried, null, 2));
        }
        const species = buildSpeciesMap(ABSOLUTE_REPO_PATH);
        const groupNames = new Map((await fetchJpGroups()).map((g) => [g.id, g.name]));
        for (const [setId, indices] of jpBySet) {
          const gid = setGroups[setId];
          if (!gid) continue;
          const products = await fetchJpGroupProducts(gid);
          const productName = new Map(products.map((p) => [p.id, p.name]));
          const groupName = groupNames.get(gid);
          for (const i of indices) {
            // English set name from the TCGPlayer group; Japanese kept in setNameJa.
            if (groupName) cards[i].setNameEn = englishSetName(groupName);
            const existingId = cards[i].tcgPlayerId;
            if (existingId != null) {
              const name = productName.get(existingId);
              if (name) cards[i].name = englishCardName(name);
              continue;
            }
            const jpCard = toJpCard(i);
            const match = matchJapaneseProduct(jpCard, products, jpCard.dexId != null ? species[jpCard.dexId] : undefined);
            if (match && !usedIds.has(match)) {
              cards[i].tcgPlayerId = match;
              // English card name from the matched product; Japanese kept in nameJa.
              cards[i].name = englishCardName(productName.get(match) ?? cards[i].name);
              usedIds.add(match);
              jpFilled++;
            }
          }
        }
      } catch (e) {
        console.warn(`Pokemon: Japanese TCGPlayer lookup failed: ${(e as Error).message}`);
      }
    }
    console.log(`Pokemon: filled ${jpFilled} missing Japanese TCGPlayer id(s) from tcgcsv`);

    // Everything still eligible-but-unmatched is retried next run.
    const unmatched = cards
      .map((card, i) => ({ card, i }))
      .filter(({ card, i }) => card.tcgPlayerId == null && isRetryEligible(loadedCards[i].card, languageForPath(cardFiles[i])))
      .map(({ i }) => cardFiles[i]);
    const retryFilled = cards.filter((card, i) => retryOnly.has(cardFiles[i]) && card.tcgPlayerId != null).length;
    console.log(`Pokemon: retried ${retryOnly.size} previously-unmatched card(s), ${retryFilled} now matched; ${unmatched.length} still unmatched`);

    const emitted = cards.filter((card, i) => shouldEmit(cardFiles[i], retryOnly, card.tcgPlayerId));
    const delta: CatalogDelta = { game: "POKEMON", generatedAt: new Date().toISOString(), cards: emitted };

    mkdirSync(OUTPUT_DIR, { recursive: true });
    const outputPath = `${OUTPUT_DIR}/pokemon-delta-${Date.now()}.json`;
    writeFileAtomic(outputPath, JSON.stringify(delta, null, 2));
    writeFileAtomic(STATE_PATH, headSha);
    writeFileAtomic(UNMATCHED_PATH, JSON.stringify(unmatched, null, 2));

    console.log(`Pokemon: ${changedFiles.length} changed file(s) → ${emitted.length} cards → ${outputPath}`);
  });
}

main().catch((e) => {
  console.error("Pokemon sync failed:", e);
  process.exit(1);
});
