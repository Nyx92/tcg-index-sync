import { describe, it, expect } from "vitest";
import { isRetryEligible, planFiles, shouldEmit, shouldRetrySet } from "./unmatched";
import type { PokemonSourceCard } from "./loadCard";

const card = (over: Partial<PokemonSourceCard> = {}): PokemonSourceCard => ({
  name: { en: "Tropius" },
  rarity: "Common",
  set: { id: "sv08", name: { en: "Surging Sparks" }, serie: { id: "sv" } },
  ...over,
});

describe("isRetryEligible", () => {
  it("tracks English cards only when their set has a TCGPlayer group id", () => {
    expect(isRetryEligible(card({ set: { id: "sv08", name: {}, serie: { id: "sv" }, thirdParty: { tcgplayer: 23651 } } }), "English")).toBe(true);
    expect(isRetryEligible(card(), "English")).toBe(false); // e.g. Pocket / promo sets
  });

  it("tracks data-asia cards only when they are Japanese-language", () => {
    expect(isRetryEligible(card({ name: { ja: "トロピウス" } }), "Japanese")).toBe(true);
    expect(isRetryEligible(card({ name: { "zh-tw": "熱帶龍" } }), "Japanese")).toBe(false); // Chinese print
  });
});

describe("planFiles", () => {
  it("processes changed files plus previously-unmatched ones, without duplicates", () => {
    const { files, retryOnly } = planFiles(["a.ts", "b.ts"], ["b.ts", "c.ts"]);
    expect(files).toEqual(["a.ts", "b.ts", "c.ts"]);
    expect([...retryOnly]).toEqual(["c.ts"]);
  });
});

describe("shouldEmit", () => {
  const retryOnly = new Set(["c.ts"]);
  it("always emits changed cards", () => {
    expect(shouldEmit("a.ts", retryOnly, null)).toBe(true);
  });
  it("emits a retried card only once it has gained an id", () => {
    expect(shouldEmit("c.ts", retryOnly, null)).toBe(false);
    expect(shouldEmit("c.ts", retryOnly, "12345")).toBe(true);
  });
});

describe("shouldRetrySet", () => {
  const now = new Date("2026-10-18T00:00:00Z");
  it("retries a never-tried set, or one last tried 7+ days ago", () => {
    expect(shouldRetrySet(undefined, now)).toBe(true);
    expect(shouldRetrySet("2026-10-10T00:00:00Z", now)).toBe(true);
  });
  it("skips a set tried within the last 7 days", () => {
    expect(shouldRetrySet("2026-10-15T00:00:00Z", now)).toBe(false);
  });
});
