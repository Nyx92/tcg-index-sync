// src/pokemon/unmatched.ts
//
// Retry bookkeeping for cards that could get a TCGPlayer id but didn't yet
// (typically a new set synced before TCGPlayer listed it). The sync is
// incremental — it only reprocesses card files that changed in
// cards-database — so without this a card that missed its match on its first
// sync would never be looked at again. The list lives in
// state/pokemon-unmatched.json and is retried on every run.

import type { PokemonSourceCard } from "./loadCard";

// Worth retrying = a matcher could ever find it: an English card whose set
// has a TCGPlayer group id, or a Japanese-language (`ja`-named) card.
// Pocket cards (no group id) and Chinese/Thai/Indonesian prints (no `ja`
// name) never will, so they're not tracked.
export function isRetryEligible(card: PokemonSourceCard, language: "English" | "Japanese"): boolean {
  if (language === "English") return card.set.thirdParty?.tcgplayer != null;
  return card.name.ja != null;
}

// Changed files first, then previously-unmatched files not already among them.
export function planFiles(changed: string[], unmatched: string[]): { files: string[]; retryOnly: Set<string> } {
  const changedSet = new Set(changed);
  const retryOnly = new Set(unmatched.filter((f) => !changedSet.has(f)));
  return { files: [...changed, ...retryOnly], retryOnly };
}

// A retried card only goes into the delta once it has gained an id; until
// then re-emitting it every run would just repeat an unchanged, unimportable card.
export function shouldEmit(file: string, retryOnly: Set<string>, tcgPlayerId: string | null): boolean {
  return !retryOnly.has(file) || tcgPlayerId != null;
}

// Japanese sets that didn't fingerprint to a TCGPlayer group (vintage sets
// without printed numbers, sets TCGPlayer doesn't list yet) are re-tried at
// most this often — fingerprinting needs every one of the ~460 groups.
export const UNMAPPED_SET_RETRY_MS = 7 * 24 * 60 * 60 * 1000;

export function shouldRetrySet(lastTriedIso: string | undefined, now: Date): boolean {
  return lastTriedIso == null || now.getTime() - new Date(lastTriedIso).getTime() >= UNMAPPED_SET_RETRY_MS;
}
