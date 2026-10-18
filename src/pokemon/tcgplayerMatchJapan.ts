// src/pokemon/tcgplayerMatchJapan.ts
//
// Fills in TCGPlayer product ids for Japanese cards (TCGPlayer category 85,
// "Pokemon Japan"). Unlike English sets, cards-database's Japanese set files
// carry no TCGPlayer group id, and Japanese card names have no English key,
// so tcgplayerMatch.ts's (group, number, name) approach can't work directly.
//
// Instead:
//   1. Set → group by fingerprint: the TCGPlayer group whose products share
//      the most (number, HP, type) triples with the set's Pokémon cards —
//      abbreviations alone are unreliable (tcgdex "MC" is TCGPlayer's
//      "Start Deck 100 Battle Collection").
//   2. Card → product inside that group: same printed number, and
//        - Pokémon: same HP, same type, and (when the card has a dexId) the
//          species' English name appears in the product name;
//        - Trainer / Energy: the product is a Trainer / Energy card.
// Strict on purpose: anything short of one clear match stays null.

import { readdirSync, readFileSync, statSync } from "fs";
import { join } from "path";
import { normalizeCardNumber, type TcgplayerProduct } from "./tcgplayerMatch";

export type JpProduct = { id: string; name: string; num: string; hp?: string; types: string[] };
export type JpCard = { localId: string; category?: string; hp?: number; type?: string; dexId?: number };

export function toJpProducts(raw: TcgplayerProduct[]): JpProduct[] {
  const out: JpProduct[] = [];
  for (const p of raw) {
    const ext = Object.fromEntries((p.extendedData ?? []).map((e) => [e.name, e.value]));
    if (!ext.Number) continue; // sealed product, not a single card
    // Dual types come through as "Dragon;Dragon"; Trainer tools sometimes have no type.
    out.push({ id: String(p.productId), name: p.name, num: normalizeCardNumber(ext.Number), hp: ext.HP, types: ext.CardType ? ext.CardType.split(";") : [] });
  }
  return out;
}

const norm = (s: string) =>
  s.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").replace(/[^a-z0-9]+/g, " ").trim();

// Returns the group id whose products best fingerprint-match the set, or null
// when the set has too few Pokémon cards or no group is a clear winner.
export function fingerprintSetToGroup(cards: JpCard[], groups: Record<string, JpProduct[]>): string | null {
  const pokemon = cards.filter((c) => c.category === "Pokemon" && c.hp != null && c.type);
  if (pokemon.length < 3) return null;
  const scores = Object.entries(groups)
    .map(([gid, products]) => {
      const keys = new Set(products.map((p) => `${p.num}|${p.hp}|${p.types[0]}`));
      const hits = pokemon.filter((c) => keys.has(`${normalizeCardNumber(c.localId)}|${c.hp}|${c.type}`)).length;
      return [gid, hits / pokemon.length] as const;
    })
    .sort((a, b) => b[1] - a[1]);
  const [best, second] = scores;
  return best && best[1] >= 0.8 && best[1] - (second?.[1] ?? 0) >= 0.2 ? best[0] : null;
}

export function matchJapaneseProduct(card: JpCard, products: JpProduct[], speciesName?: string): string | null {
  let candidates = products.filter((p) => p.num === normalizeCardNumber(card.localId));
  if (card.category === "Pokemon") {
    candidates = candidates.filter((p) => p.hp === String(card.hp) && card.type != null && p.types.includes(card.type));
    if (speciesName) candidates = candidates.filter((p) => norm(p.name).includes(norm(speciesName)));
  } else if (card.category === "Trainer") {
    candidates = candidates.filter((p) => /^Trainer/i.test(p.types[0] ?? "") || (p.types.length === 0 && !p.hp));
  } else if (card.category === "Energy") {
    candidates = candidates.filter((p) => p.types.some((t) => /Energy/i.test(t)) || /energy/i.test(p.name));
  } else {
    return null;
  }
  if (candidates.length > 1) {
    // Stamped/staff/exclusive variants share a number; the regular card is the
    // one plain product without a "(…)" or "[…]" qualifier.
    const plain = candidates.filter((p) => !/[([]/.test(p.name));
    candidates = plain.length === 1 ? plain : candidates;
  }
  return candidates.length === 1 ? candidates[0].id : null;
}

// dexId → English species name, from cards-database's English card files: the
// most common base name across single-dexId *Pokémon* cards ("Lapras ex",
// "Misty's Lapras" → "Lapras"). Trainer cards can carry a dexId too ("Misty"),
// so they're excluded. Text scan rather than import(): ~22k files, read once.
export function buildSpeciesMap(repoPath: string): Record<number, string> {
  const counts: Record<number, Record<string, number>> = {};
  const root = join(repoPath, "data");
  for (const serie of readdirSync(root)) {
    const seriePath = join(root, serie);
    if (!statSync(seriePath).isDirectory()) continue;
    for (const set of readdirSync(seriePath)) {
      const setPath = join(seriePath, set);
      if (!statSync(setPath).isDirectory()) continue;
      for (const file of readdirSync(setPath)) {
        if (!/^\d+\.ts$/.test(file)) continue;
        const text = readFileSync(join(setPath, file), "utf-8");
        if (!/category:\s*["']Pokemon["']/.test(text)) continue;
        const dex = text.match(/dexId:\s*\[(\d+)\]/);
        const en = text.match(/name:\s*\{[^}]*\ben:\s*["'`](.+?)["'`]/s);
        if (!dex || !en) continue;
        const base = en[1]
          .replace(/\s+(ex|EX|GX|V|VMAX|VSTAR|V-UNION|LV\.?X|BREAK|Prime|LEGEND|δ|☆|◇|Star)$/, "")
          .replace(/^(Mega|M|Dark|Light|Shining|Radiant|Alolan|Galarian|Hisuian|Paldean)\s+/, "")
          .replace(/^.+?'s\s+/, "")
          .trim();
        const bucket = (counts[Number(dex[1])] ??= {});
        bucket[base] = (bucket[base] ?? 0) + 1;
      }
    }
  }
  return Object.fromEntries(
    Object.entries(counts).map(([dex, names]) => [dex, Object.entries(names).sort((a, b) => b[1] - a[1])[0][0]])
  );
}

const UA = { headers: { "User-Agent": "tcg-index-sync/1.0 (catalog matcher)" } };
const productCache = new Map<string, Promise<JpProduct[]>>();

export async function fetchJpGroupIds(): Promise<string[]> {
  const r = await fetch("https://tcgcsv.com/tcgplayer/85/groups", UA);
  if (!r.ok) throw new Error(`tcgcsv Japanese groups: HTTP ${r.status}`);
  return ((await r.json()) as { results: { groupId: number }[] }).results.map((g) => String(g.groupId));
}

export function fetchJpGroupProducts(groupId: string): Promise<JpProduct[]> {
  let cached = productCache.get(groupId);
  if (!cached) {
    cached = fetch(`https://tcgcsv.com/tcgplayer/85/${groupId}/products`, UA).then(async (r) => {
      if (!r.ok) throw new Error(`tcgcsv Japanese group ${groupId}: HTTP ${r.status}`);
      return toJpProducts(((await r.json()) as { results: TcgplayerProduct[] }).results);
    });
    productCache.set(groupId, cached);
  }
  return cached;
}
