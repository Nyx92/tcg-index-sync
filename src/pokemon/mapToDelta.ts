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

// Series whose English cards print both numbers padded to 3 digits
// ("001/073"). Older English series print them as-is ("2/102").
const PADDED_SERIES = new Set(["swsh", "sv", "me"]);

/**
 * The card number as printed on the card, e.g. "001/073", "2/102", "054/165".
 * Japanese cards always print 3 digits. A number with letters ("TG01",
 * "SWSH001") or a set with no printed total keeps the number alone.
 */
export function printedNumber(
  localId: string,
  officialTotal: number | undefined,
  serieId: string,
  language: "English" | "Japanese"
): string {
  if (!/^\d+$/.test(localId) || !officialTotal) return localId;
  const pad = language === "Japanese" || PADDED_SERIES.has(serieId);
  const fmt = (n: string) => (pad ? n.padStart(3, "0") : String(Number(n)));
  return `${fmt(localId)}/${fmt(String(officialTotal))}`;
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
    // Japanese names kept separately so `name` / `setNameEn` can carry the
    // English TCGPlayer names once a Japanese card is matched (see sync.ts).
    nameJa: card.name.ja ?? null,
    setNameJa: card.set.name.ja ?? null,
    language,
    // tcgdex serves Japanese card images under /ja/ (the /en/ path 404s for them).
    imageUrl: `https://assets.tcgdex.net/${language === "Japanese" ? "ja" : "en"}/${card.set.serie.id}/${card.set.id}/${localId}/high.webp`,
    setId: card.set.id,
    setNameEn: pickName(card.set.name),
    rarity: card.rarity,
    hp: card.hp ?? null,
    types: card.types ?? [],
    stage: card.stage ?? null,
    localId,
    printedNumber: printedNumber(localId, card.set.cardCount?.official, card.set.serie.id, language),
  };
}
