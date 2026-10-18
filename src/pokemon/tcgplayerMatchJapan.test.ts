import { describe, it, expect } from "vitest";
import { fingerprintSetToGroup, matchJapaneseProduct, toJpProducts, type JpProduct } from "./tcgplayerMatchJapan";

const p = (id: string, name: string, num: string, hp?: string, types: string[] = []): JpProduct => ({ id, name, num, hp, types });

describe("toJpProducts", () => {
  it("keeps single cards only and splits dual types", () => {
    const out = toJpProducts([
      { productId: 1, name: "Raging Bolt ex - 053/071", extendedData: [
        { name: "Number", value: "053/071" }, { name: "HP", value: "240" }, { name: "CardType", value: "Dragon;Dragon" },
      ] },
      { productId: 2, name: "Booster Box", extendedData: [] },
    ]);
    expect(out).toEqual([{ id: "1", name: "Raging Bolt ex - 053/071", num: "53", hp: "240", types: ["Dragon", "Dragon"] }]);
  });
});

describe("matchJapaneseProduct", () => {
  const m5 = [
    p("694993", "Energy Switch", "103", undefined, ["Trainer - Item"]),
    p("695001", "Tropius", "1", "110", ["Grass"]),
    p("695002", "Mega Darkrai ex - 046/081", "46", "280", ["Darkness"]),
  ];

  it("matches a Pokémon on number + HP + type, confirmed by species name", () => {
    expect(matchJapaneseProduct({ localId: "001", category: "Pokemon", hp: 110, type: "Grass", dexId: 357 }, m5, "Tropius")).toBe("695001");
  });

  it("finds the species inside a longer product name (Mega … ex)", () => {
    expect(matchJapaneseProduct({ localId: "046", category: "Pokemon", hp: 280, type: "Darkness" }, m5, "Darkrai")).toBe("695002");
  });

  it("rejects when HP disagrees (never guesses)", () => {
    expect(matchJapaneseProduct({ localId: "001", category: "Pokemon", hp: 90, type: "Grass" }, m5, "Tropius")).toBeNull();
  });

  it("rejects when the species name is not in the product name", () => {
    expect(matchJapaneseProduct({ localId: "001", category: "Pokemon", hp: 110, type: "Grass" }, m5, "Lapras")).toBeNull();
  });

  it("matches a Trainer on number + Trainer card type", () => {
    expect(matchJapaneseProduct({ localId: "103", category: "Trainer" }, m5)).toBe("694993");
  });

  it("rejects a Trainer whose number lands on a Pokémon product", () => {
    expect(matchJapaneseProduct({ localId: "001", category: "Trainer" }, m5)).toBeNull();
  });

  it("picks the plain product over stamped variants", () => {
    const promos = [p("1", "Pikachu - 001/S-P", "1", "70", ["Lightning"]), p("2", "Pikachu - 001/S-P (Staff)", "1", "70", ["Lightning"])];
    expect(matchJapaneseProduct({ localId: "001", category: "Pokemon", hp: 70, type: "Lightning" }, promos, "Pikachu")).toBe("1");
  });
});

describe("fingerprintSetToGroup", () => {
  const set = [
    { localId: "001", category: "Pokemon", hp: 110, type: "Grass" },
    { localId: "002", category: "Pokemon", hp: 60, type: "Fire" },
    { localId: "003", category: "Pokemon", hp: 90, type: "Water" },
    { localId: "004", category: "Trainer" },
  ];

  it("picks the group whose (number, HP, type) triples match the set", () => {
    const groups = {
      right: [p("a", "A", "1", "110", ["Grass"]), p("b", "B", "2", "60", ["Fire"]), p("c", "C", "3", "90", ["Water"])],
      wrong: [p("d", "D", "1", "50", ["Grass"]), p("e", "E", "2", "60", ["Fire"])],
    };
    expect(fingerprintSetToGroup(set, groups)).toBe("right");
  });

  it("returns null when no group is a clear winner", () => {
    const twin = [p("a", "A", "1", "110", ["Grass"]), p("b", "B", "2", "60", ["Fire"]), p("c", "C", "3", "90", ["Water"])];
    expect(fingerprintSetToGroup(set, { one: twin, two: twin })).toBeNull();
  });

  it("returns null for a set with too few Pokémon to fingerprint", () => {
    expect(fingerprintSetToGroup([{ localId: "1", category: "Trainer" }], { g: [] })).toBeNull();
  });
});
