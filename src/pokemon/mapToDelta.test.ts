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
