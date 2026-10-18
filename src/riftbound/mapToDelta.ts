// src/riftbound/mapToDelta.ts
//
// Field paths below reflect the actual api.riftcodex.com card shape,
// verified against a live scrape (see task-3-report.md), which nests more
// deeply than a first guess at the shape would suggest: rarity/type/
// supertype/domain live under `classification`, energy/might/power under
// `attributes`, and the set's short id is `set.set_id` (not `set.id`).
import type { CatalogDeltaCard } from "../types";
import type { RiftboundApiCard } from "./diff";

type FullRiftboundApiCard = RiftboundApiCard & {
  tcgplayer_id: string | null;
  name: string;
  set: { label: string; set_id: string };
  // supertype is null for most cards (952/1451 in a live pull) — only
  // Champion/Signature/Token/Basic cards carry a real value.
  classification: { rarity: string; type: string; supertype: string | null; domain: string[] };
  collector_number: number;
  media: { image_url: string };
  attributes: { energy: number | null; might: number | null; power: number | null };
};

/**
 * The card number as printed, from the riftbound_id: "unl-002-219" -> "002/219",
 * "opp-007b-298" -> "007b/298"; a signature "309*" suffix is kept too. Ids without a
 * total (some promos, e.g. "ven-r01") return null; the app then shows
 * collectorNumber.
 */
export function printedNumber(riftboundId: string): string | null {
  const m = /^[a-z0-9]+-(\d+[a-z*]*)-(\d+)$/.exec(riftboundId);
  return m ? `${m[1]}/${m[2]}` : null;
}

export function mapRiftboundCardToDelta(card: FullRiftboundApiCard): CatalogDeltaCard {
  return {
    externalId: card.riftbound_id,
    tcgPlayerId: card.tcgplayer_id,
    name: card.name,
    imageUrl: card.media.image_url,
    setLabel: card.set.label,
    setId: card.set.set_id,
    rarity: card.classification.rarity,
    type: card.classification.type,
    supertype: card.classification.supertype,
    collectorNumber: String(card.collector_number),
    printedNumber: printedNumber(card.riftbound_id),
    domain: card.classification.domain,
    energy: card.attributes.energy,
    might: card.attributes.might,
    power: card.attributes.power,
  };
}
