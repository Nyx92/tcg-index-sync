import { describe, it, expect } from "vitest";
import { join } from "path";
import { loadCardFile } from "./loadCard";

const fixturesDir = join(__dirname, "__fixtures__");

describe("loadCardFile", () => {
  it("throws a clear error when the module has no default export", async () => {
    await expect(loadCardFile(fixturesDir, "noDefaultExport.ts")).rejects.toThrow(
      /Malformed card file/
    );
  });

  it("throws a clear error when the default export doesn't look like a card", async () => {
    await expect(loadCardFile(fixturesDir, "wrongShapeDefault.ts")).rejects.toThrow(
      /Malformed card file/
    );
  });
});
