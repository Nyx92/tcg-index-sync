import { describe, it, expect } from "vitest";
import { parseChangedCardFiles } from "./gitDiff";

describe("parseChangedCardFiles", () => {
  it("keeps only individual card files, by numeric filename", () => {
    const diffOutput = [
      "data/EX/Team Magma vs Team Aqua/39.ts",
      "data/EX/Team Magma vs Team Aqua.ts",   // set-level file — excluded
      "data/EX.ts",                            // series-level file — excluded
      "data-asia/SV/Scarlet & Violet/1.ts",
      "interfaces.ts",                         // unrelated — excluded
    ].join("\n");

    expect(parseChangedCardFiles(diffOutput)).toEqual([
      "data/EX/Team Magma vs Team Aqua/39.ts",
      "data-asia/SV/Scarlet & Violet/1.ts",
    ]);
  });

  it("returns an empty array for empty diff output", () => {
    expect(parseChangedCardFiles("")).toEqual([]);
  });
});
