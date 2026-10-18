// src/pokemon/tcgplayerMatch.ts
//
// Fills in a card's TCGPlayer product id when cards-database doesn't have
// one. cards-database only records per-card ids for some (mostly older)
// sets, but almost every English set file carries its TCGPlayer *group* id
// (set.thirdParty.tcgplayer). tcgcsv.com publishes TCGPlayer's own product
// list per group, each single card with its printed number — so a card can
// be matched by (group, number, name) against TCGPlayer's own data.
//
// Strict on purpose: a wrong id would price a card with another card's
// history, so anything short of one clear match stays null.

export type TcgplayerProduct = { productId: number; name: string; extendedData?: { name: string; value: string }[] };

// "007/182" → "7", "SV001" → "SV1", "TG05" → "TG5", "84" → "84".
export function normalizeCardNumber(raw: string): string {
  return raw.split("/")[0].trim().toUpperCase().replace(/^([A-Z]*)0*(\d+)([A-Z]*)$/, "$1$2$3");
}

function baseName(name: string, keepBracketed: boolean): string {
  let s = name
    .replace(/♀/g, " F")
    .replace(/♂/g, " M")
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "") // é → e
    .replace(/\s+-\s+.*$/, "") // "Infernape - 116 (Prerelease)" → "Infernape"
    .replace(/\s+\d+\/\d+$/, ""); // "Finizen 061/197" → "Finizen"
  if (!keepBracketed) s = s.replace(/\(.*?\)|\[.*?\]/g, "");
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}

// "Unown Y" = "Unown (Y)", "Electrode" = "Electrode (Prime)", "Nidoran ♀" = "Nidoran F".
export function namesMatch(cardName: string, productName: string): boolean {
  return (
    baseName(cardName, true) === baseName(productName, true) ||
    baseName(cardName, false) === baseName(productName, false)
  );
}

// "Infernape - 116" is plain; "Infernape - 116 (Prerelease) [Staff]" is not.
const isPlainProduct = (p: TcgplayerProduct) => !/[([]/.test(p.name);

// Returns the product id as a string, or null when there is no single clear match.
export function matchTcgplayerProduct(
  card: { localId: string; name: string },
  products: TcgplayerProduct[]
): string | null {
  const number = normalizeCardNumber(card.localId);
  const candidates = products.filter((p) => {
    const printed = p.extendedData?.find((e) => e.name === "Number")?.value;
    return printed != null && normalizeCardNumber(printed) === number && namesMatch(card.name, p.name);
  });
  if (candidates.length === 1) return String(candidates[0].productId);
  // Same number + name also covers stamped/staff/exclusive variants listed as
  // separate products. The regular card is the one plain product without a
  // "(…)" or "[…]" qualifier; if that isn't unique, don't guess.
  const plain = candidates.filter(isPlainProduct);
  return plain.length === 1 ? String(plain[0].productId) : null;
}

const groupCache = new Map<string, Promise<TcgplayerProduct[]>>();

// tcgcsv rejects requests without a User-Agent (HTTP 401).
export function fetchGroupProducts(groupId: string): Promise<TcgplayerProduct[]> {
  let cached = groupCache.get(groupId);
  if (!cached) {
    cached = fetch(`https://tcgcsv.com/tcgplayer/3/${groupId}/products`, {
      headers: { "User-Agent": "tcg-index-sync/1.0 (catalog matcher)" },
    }).then(async (r) => {
      if (!r.ok) throw new Error(`tcgcsv group ${groupId}: HTTP ${r.status}`);
      return ((await r.json()) as { results: TcgplayerProduct[] }).results;
    });
    groupCache.set(groupId, cached);
  }
  return cached;
}
