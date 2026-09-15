// src/types.ts
//
// Must match pokemon-mvp's src/lib/catalogDeltaImport.ts CatalogDelta type
// exactly — this is the contract between the two projects.

export type CatalogDeltaCard = {
  externalId: string;
  tcgPlayerId: string | null;
  name: string;
  language?: "English" | "Japanese";
  imageUrl: string | null;
  [key: string]: unknown;
};

export type CatalogDelta = {
  game: "POKEMON" | "RIFTBOUND";
  generatedAt: string;
  cards: CatalogDeltaCard[];
};
