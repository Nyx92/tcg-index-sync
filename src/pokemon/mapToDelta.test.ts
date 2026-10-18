import { describe, it, expect } from "vitest";
import { mapPokemonCardToDelta, printedNumber } from "./mapToDelta";
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

  // Mimics a real data-asia file (cards-database/data-asia/S/SC1D/001.ts and
  // its set, SC1D.ts) where neither the card nor the set has an `en` name —
  // only regional locales. A live run against the full catalog produced
  // undefined names for ~45% of cards (all under data-asia/) before the
  // pickName() fallback existed.
  it("falls back to a non-English locale when the card and set have no en name", () => {
    const asiaCard = {
      ...fixtureCard,
      name: { "zh-tw": "飛天螳螂" },
      set: {
        ...fixtureCard.set,
        name: { "zh-tw": "劍&盾", id: "Pedang & Perisai", th: "ซอร์ด แอนด์ ชีลด์" },
      },
    };
    const result = mapPokemonCardToDelta({ card: asiaCard, localId: "001" }, "Japanese");
    expect(result.name).toBe("飛天螳螂");
    expect(result.setNameEn).toBe("劍&盾");
  });
});

describe("printedNumber", () => {
  it("pads both numbers to 3 digits for Sword & Shield and later English sets", () => {
    expect(printedNumber("1", 73, "swsh", "English")).toBe("001/073");
    expect(printedNumber("74", 73, "swsh", "English")).toBe("074/073");
    expect(printedNumber("207", 203, "swsh", "English")).toBe("207/203");
    expect(printedNumber("12", 198, "sv", "English")).toBe("012/198");
  });

  it("does not pad older English sets", () => {
    expect(printedNumber("2", 102, "base", "English")).toBe("2/102");
    expect(printedNumber("051", 64, "neo", "English")).toBe("51/64");
  });

  it("pads Japanese cards to 3 digits", () => {
    expect(printedNumber("054", 165, "SV", "Japanese")).toBe("054/165");
    expect(printedNumber("75", 67, "S", "Japanese")).toBe("075/067");
  });

  it("keeps a number with letters, or one with no printed total, as-is", () => {
    expect(printedNumber("TG01", 196, "swsh", "English")).toBe("TG01");
    expect(printedNumber("SWSH001", undefined, "swsh", "English")).toBe("SWSH001");
    expect(printedNumber("5", undefined, "base", "English")).toBe("5");
  });
});
