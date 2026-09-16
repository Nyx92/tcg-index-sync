// src/pokemon/mapToDelta.ts
//
// Field paths verified against a real cards-database file (see
// task-5-brief.md): card.set.serie.id gives the "series" segment tcgdex
// needs, and https://assets.tcgdex.net/en/<series>/<set>/<card-number>/high.webp
// resolves real images (confirmed live: ex/ex4/39 -> 200).
import type { CatalogDeltaCard } from "../types";
import type { LoadedCard } from "./loadCard";

// Many data-asia (Japanese-origin) card and set files have no `en` name key
// at all — only regional locale keys like `ja`, `zh-tw`, `id`, `zh-cn`, `th`
// (verified live: a full-catalog run produced undefined names for 18,208 of
// 40,148 cards, all under data-asia/, before this fallback existed). Prefer
// English when present, otherwise fall back to whatever locale is available
// rather than ever emitting undefined into the CatalogDeltaCard contract.
function pickName(name: Record<string, string | undefined>): string {
  return name.en ?? Object.values(name).find((v): v is string => v != null) ?? "";
}

export function mapPokemonCardToDelta(
  loaded: LoadedCard,
  language: "English" | "Japanese"
): CatalogDeltaCard {
  const { card, localId } = loaded;
  const tcgPlayerId = card.thirdParty?.tcgplayer != null ? String(card.thirdParty.tcgplayer) : null;

  return {
    externalId: `${card.set.id}-${localId}`,
    tcgPlayerId,
    name: pickName(card.name),
    language,
    imageUrl: `https://assets.tcgdex.net/en/${card.set.serie.id}/${card.set.id}/${localId}/high.webp`,
    setId: card.set.id,
    setNameEn: pickName(card.set.name),
    rarity: card.rarity,
    hp: card.hp ?? null,
    types: card.types ?? [],
    stage: card.stage ?? null,
    localId,
  };
}
