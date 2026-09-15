// src/pokemon/loadCard.ts
//
// A cards-database card file is a plain, side-effect-free TS module with a
// default export — importing it directly is simpler and more robust than
// re-parsing its source text (the approach the older Python indexer used).
// tsx (this project's runtime) handles .ts imports natively.

import { join } from "path";

export type LoadedCard = { card: any; localId: string };

export async function loadCardFile(repoPath: string, relativeFilePath: string): Promise<LoadedCard> {
  const absolutePath = join(repoPath, relativeFilePath);
  const mod = await import(absolutePath);
  const localId = relativeFilePath.split("/").pop()!.replace(/\.ts$/, "");
  return { card: mod.default, localId };
}
