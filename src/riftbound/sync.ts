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
  const changed = diffRiftboundCards(previous, current);

  const delta: CatalogDelta = {
    game: "RIFTBOUND",
    generatedAt: new Date().toISOString(),
    cards: changed.map((c) => mapRiftboundCardToDelta(c as Parameters<typeof mapRiftboundCardToDelta>[0])),
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
