// src/riftbound/sync.ts
//
// Run with: pnpm sync:riftbound
// Additive: reads the previous full pull from state/riftbound-snapshot.json,
// diffs the fresh pull against it, writes only the delta to output/, and
// overwrites the snapshot with the fresh full pull for next time.

import { readFileSync, existsSync, mkdirSync } from "fs";
import { scrapeAllRiftboundCards } from "./scrape";
import { diffRiftboundCards, type RiftboundApiCard } from "./diff";
import { mapRiftboundCardToDelta } from "./mapToDelta";
import type { CatalogDelta } from "../types";
import { addPendingDelta, writeFileAtomic, withLock } from "../fsSafety";

const SNAPSHOT_PATH = "state/riftbound-snapshot.json";
const OUTPUT_DIR = "output";
const LOCK_PATH = "state/riftbound.lock";
// Delta files not yet imported into MXYYC-WEB (see addPendingDelta).
const PENDING_PATH = "state/riftbound-pending-deltas.txt";

async function main() {
  mkdirSync("state", { recursive: true });

  await withLock(LOCK_PATH, async () => {
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
    const outputPath = `${OUTPUT_DIR}/riftbound-delta-${Date.now()}.json`;
    writeFileAtomic(outputPath, JSON.stringify(delta, null, 2));
    // Before the snapshot moves forward: a crash in between means a re-sync, not lost cards.
    addPendingDelta(PENDING_PATH, outputPath, delta.cards.length);
    writeFileAtomic(SNAPSHOT_PATH, JSON.stringify(current, null, 2));

    console.log(`Riftbound: ${current.length} total, ${changed.length} new/changed → ${outputPath}`);
  });
}

main().catch((e) => {
  console.error("Riftbound sync failed:", e);
  process.exit(1);
});
