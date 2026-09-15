import { describe, it, expect } from "vitest";
import { mapRiftboundCardToDelta } from "./mapToDelta";

// NOTE: fixtures below use the real riftcodex.com API card shape, verified
// against a live scrape (see task-3-report.md). The brief's illustrative
// fixture assumed a flatter shape (`set.id`, top-level `domain`/`energy`/
// `might`/`power`) that the live API does not actually return: those fields
// are nested under `set.set_id` and `classification.domain` /
// `attributes.{energy,might,power}` respectively.
describe("mapRiftboundCardToDelta", () => {
  it("maps a riftcodex API card into a CatalogDeltaCard", () => {
    const result = mapRiftboundCardToDelta({
      id: "mongo-1",
      riftbound_id: "unl-176-219", tcgplayer_id: "706028", name: "Vi - Peacekeeper",
      updated_on: "2026-09-01", set: { label: "Unleashed", set_id: "unl" },
      classification: { rarity: "Rare", type: "Unit", supertype: "Champion", domain: ["Fury"] },
      collector_number: 176, media: { image_url: "https://cmsassets.rgpub.io/x.png" },
      attributes: { energy: 5, might: 3, power: null },
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
      domain: ["Fury"],
      energy: 5,
      might: 3,
      power: null,
    }));
  });

  it("passes through a null tcgplayer_id as null, not a string", () => {
    const result = mapRiftboundCardToDelta({
      id: "mongo-2",
      riftbound_id: "x", tcgplayer_id: null, name: "X", updated_on: "2026-01-01",
      set: { label: "S", set_id: "s" }, classification: { rarity: "R", type: "T", supertype: "", domain: [] },
      collector_number: 1, media: { image_url: "url" }, attributes: { energy: null, might: null, power: null },
    });
    expect(result.tcgPlayerId).toBeNull();
  });
});
