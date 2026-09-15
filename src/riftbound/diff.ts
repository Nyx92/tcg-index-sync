// src/riftbound/diff.ts
//
// Riftbound's additive step: api.riftcodex.com has no "give me only what
// changed" endpoint, so this project re-pulls the full current list every
// run (cheap — it's paginated reads, not per-card work) and diffs it
// against the previous run's saved snapshot, only carrying forward cards
// that are new or whose updated_on moved.
//
// Live data (see task-3-report.md / task-3-fix-report.md) shows
// `riftbound_id` is NOT unique: 147 of 1451 live cards share a
// `riftbound_id` with another row (a real upstream data-quality issue,
// concentrated in the VEN and OPP sets). Keying the dedup Map on
// `riftbound_id` silently drops one sibling of each duplicate pair and
// compares the other against the wrong row's `updated_on`, producing a
// deterministic, non-shrinking false "changed" result every run. The
// Mongo-style `id` field is confirmed 100% unique across all 1451 live
// cards, so the Map (and lookup) is keyed on `id` instead. This is purely
// a diff-key stability fix — `mapRiftboundCardToDelta` still writes
// `riftbound_id` into `CatalogDeltaCard.externalId` unchanged; that's a
// separate, established identifier scheme and out of scope here.

export type RiftboundApiCard = {
  id: string;
  riftbound_id: string;
  updated_on: string;
  [key: string]: unknown;
};

export function diffRiftboundCards(
  previous: RiftboundApiCard[],
  current: RiftboundApiCard[]
): RiftboundApiCard[] {
  const previousById = new Map(previous.map((c) => [c.id, c]));
  return current.filter((card) => {
    const prior = previousById.get(card.id);
    return !prior || card.updated_on > prior.updated_on;
  });
}
