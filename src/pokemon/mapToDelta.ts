// src/pokemon/mapToDelta.ts
//
// Field paths verified against a real cards-database file (see
// task-5-brief.md): card.set.serie.id gives the "series" segment tcgdex
// needs, and https://assets.tcgdex.net/en/<series>/<set>/<card-number>/high.webp
// resolves real images (confirmed live: ex/ex4/39 -> 200).
import type { CatalogDeltaCard } from "../types";
import type { LoadedCard } from "./loadCard";

export function mapPokemonCardToDelta(
  loaded: LoadedCard,
  language: "English" | "Japanese"
): CatalogDeltaCard {
  const { card, localId } = loaded;
  const tcgPlayerId = card.thirdParty?.tcgplayer != null ? String(card.thirdParty.tcgplayer) : null;

  return {
    externalId: `${card.set.id}-${localId}`,
    tcgPlayerId,
    name: card.name.en,
    language,
    imageUrl: `https://assets.tcgdex.net/en/${card.set.serie.id}/${card.set.id}/${localId}/high.webp`,
    setId: card.set.id,
    setNameEn: card.set.name.en,
    rarity: card.rarity,
    hp: card.hp ?? null,
    types: card.types ?? [],
    stage: card.stage ?? null,
    localId,
  };
}
