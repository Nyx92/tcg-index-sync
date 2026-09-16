// src/pokemon/loadCard.ts
//
// A cards-database card file is a plain, side-effect-free TS module with a
// default export — importing it directly is simpler and more robust than
// re-parsing its source text (the approach the older Python indexer used).
// tsx (this project's runtime) handles .ts imports natively.

import { join } from "path";

// The card shape lives here (not in mapToDelta.ts) so loadCardFile's return
// type and mapPokemonCardToDelta's parameter type are provably the same
// shape, rather than two independent definitions that could drift apart.
// Name objects are locale-keyed and, for data-asia (Japanese-origin) files,
// frequently have no `en` key at all — only regional locales like `ja`,
// `zh-tw`, `id`, `zh-cn`, `th` (verified against a real file:
// cards-database/data-asia/S/SC1D.ts's set name has no `en`/`ja`, only
// `zh-tw`/`id`/`th`). mapToDelta's pickName() picks whichever is present.
type LocalizedName = { en?: string; [locale: string]: string | undefined };

export type PokemonSourceCard = {
  name: LocalizedName;
  rarity: string;
  set: { id: string; name: LocalizedName; serie: { id: string } };
  dexId?: number[];
  hp?: number;
  types?: string[];
  stage?: string;
  thirdParty?: { tcgplayer?: number };
};

export type LoadedCard = { card: PokemonSourceCard; localId: string };

export async function loadCardFile(repoPath: string, relativeFilePath: string): Promise<LoadedCard> {
  const absolutePath = join(repoPath, relativeFilePath);
  const mod = await import(absolutePath);
  const card = mod.default;

  // A card file that fails to build a usable default export (missing,
  // undefined, or the wrong shape) should fail loudly and specifically here
  // rather than crashing later inside mapPokemonCardToDelta with a
  // confusing "Cannot read properties of undefined" stack trace.
  if (!card || typeof card !== "object" || !("name" in card)) {
    throw new Error(`Malformed card file: ${absolutePath} has no usable default export`);
  }

  const localId = relativeFilePath.split("/").pop()!.replace(/\.ts$/, "");
  return { card: card as PokemonSourceCard, localId };
}
