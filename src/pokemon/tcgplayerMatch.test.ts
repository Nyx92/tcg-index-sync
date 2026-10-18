import { describe, it, expect } from "vitest";
import { matchTcgplayerProduct, namesMatch, normalizeCardNumber, type TcgplayerProduct } from "./tcgplayerMatch";

const product = (productId: number, name: string, number?: string): TcgplayerProduct => ({
  productId,
  name,
  extendedData: number ? [{ name: "Number", value: number }] : [],
});

describe("normalizeCardNumber", () => {
  it("drops the set total and leading zeros, keeping letter prefixes", () => {
    expect(normalizeCardNumber("007/182")).toBe("7");
    expect(normalizeCardNumber("007")).toBe("7");
    expect(normalizeCardNumber("SV001")).toBe("SV1");
    expect(normalizeCardNumber("TG05/TG30")).toBe("TG5");
    expect(normalizeCardNumber("84")).toBe("84");
  });
});

describe("namesMatch", () => {
  it.each([
    ["Electrode", "Electrode (Prime)"],
    ["Unown Y", "Unown (Y)"],
    ["Nidoran ♀", "Nidoran F"],
    ["Pokédex HANDY910is", "Pokedex (HANDY910is)"],
    ["Finizen", "Finizen 061/197"],
    ["Infernape", "Infernape - 116"],
  ])("treats %s and %s as the same card", (a, b) => {
    expect(namesMatch(a, b)).toBe(true);
  });

  it("rejects a different card", () => {
    expect(namesMatch("Psyduck", "Salamence")).toBe(false);
    expect(namesMatch("Unown Y", "Unown (J)")).toBe(false);
  });
});

describe("matchTcgplayerProduct", () => {
  const products = [
    product(630803, "Cynthia's Roselia", "007/182"),
    product(630804, "Cynthia's Roserade", "008/182"),
    product(1, "Destined Rivals Elite Trainer Box"), // sealed: no Number
  ];

  it("matches on printed number + name", () => {
    expect(matchTcgplayerProduct({ localId: "007", name: "Cynthia's Roselia" }, products)).toBe("630803");
  });

  it("returns null when the number matches but the name doesn't (never guesses)", () => {
    expect(matchTcgplayerProduct({ localId: "007", name: "Magikarp" }, products)).toBeNull();
  });

  it("returns null when no product has that number", () => {
    expect(matchTcgplayerProduct({ localId: "999", name: "Cynthia's Roselia" }, products)).toBeNull();
  });

  it("picks the plain product over stamped/staff variants with the same number", () => {
    const promos = [
      product(551689, "Infernape - 116", "116"),
      product(563316, "Infernape - 116 (Prerelease) [Staff]", "116"),
    ];
    expect(matchTcgplayerProduct({ localId: "116", name: "Infernape" }, promos)).toBe("551689");
  });

  it("returns null when there is no single plain product among variants", () => {
    const promos = [
      product(512896, "Cleffa - 037 (Prerelease)", "037"),
      product(513423, "Cleffa - 037 (Prerelease) [Staff]", "037"),
    ];
    expect(matchTcgplayerProduct({ localId: "037", name: "Cleffa" }, promos)).toBeNull();
  });
});
