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
