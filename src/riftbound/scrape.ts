// src/riftbound/scrape.ts
//
// api.riftcodex.com sits behind a Cloudflare managed JS challenge that a
// plain HTTP client can't solve (no JS engine, and cf_clearance cookies are
// bound to the TLS fingerprint of whatever client solved the challenge —
// copying the cookie into a plain client doesn't help). This drives a real
// Chromium browser via Playwright: it lets Cloudflare's challenge clear
// naturally, then runs the pagination loop as fetch() calls from inside
// that browser context so every request carries a genuine browser
// fingerprint and cookies. A persistent profile directory caches the
// solved cf_clearance session so it isn't re-solved on every run.
//
// Ported from the existing riftbound_script.py, whose actual API contract
// this follows exactly: GET {BASE_URL}?size=N&page=N&sort=collector_number
// returns { items: [...], pages: <total pages>, total: <total cards> }
// (a paginated envelope, not a bare array), with 1-indexed pages.
//
// The raw card objects also nest their last-modified timestamp at
// `metadata.updated_on` rather than at the top level. diffRiftboundCards
// (src/riftbound/diff.ts) keys its change detection off a top-level
// `updated_on` field per the RiftboundApiCard contract, so each raw card is
// normalized here to hoist that value up before it leaves this module.

import { chromium } from "playwright";
import type { RiftboundApiCard } from "./diff";

const BASE_URL = "https://api.riftcodex.com/cards";
const PROFILE_DIR = "./.riftcodex_browser_profile";
const PAGE_SIZE = 100;

// Cloudflare's interstitial sets the document title to "Just a moment...";
// wait for that to clear before treating the page as past the challenge.
async function waitPastChallenge(page: import("playwright").Page, timeoutMs = 30000): Promise<void> {
  await page.waitForFunction(
    () => !document.title.includes("Just a moment"),
    undefined,
    { timeout: timeoutMs }
  );
}

type RawRiftboundApiCard = { metadata?: { updated_on?: string }; [key: string]: unknown };
type CardsPage = { items: RawRiftboundApiCard[]; pages: number; total: number };
type CardsPageResult = CardsPage | { error: true; status: number };

// The card's own `updated_on` lives at `metadata.updated_on` in the raw
// payload; hoist it to the top level so it satisfies RiftboundApiCard's
// contract for diffRiftboundCards without disturbing the rest of the shape
// (mapRiftboundCardToDelta still reads the original nested fields).
function normalize(raw: RawRiftboundApiCard): RiftboundApiCard {
  return { ...raw, updated_on: raw.metadata?.updated_on ?? "" } as RiftboundApiCard;
}

export async function scrapeAllRiftboundCards(): Promise<RiftboundApiCard[]> {
  // Set RIFTBOUND_HEADED=1 to run headed — needed the first time a fresh
  // profile directory has to solve the Cloudflare challenge, matching the
  // existing Python script's own --headed fallback.
  const headless = process.env.RIFTBOUND_HEADED !== "1";
  const context = await chromium.launchPersistentContext(PROFILE_DIR, { headless });
  const page = await context.newPage();

  await page.goto(`${BASE_URL}?size=1&page=1`, { waitUntil: "domcontentloaded" });
  try {
    await waitPastChallenge(page);
  } catch {
    await context.close();
    throw new Error(
      "Still stuck on the Cloudflare challenge after 30s. Re-run with " +
        "RIFTBOUND_HEADED=1, solve it manually in the window that opens, " +
        `then re-run (the solved session is cached in ${PROFILE_DIR}).`
    );
  }

  const allCards: RiftboundApiCard[] = [];
  let pageNum = 1;

  while (true) {
    const result: CardsPageResult = await page.evaluate(
      async ({ url, size, page: p }) => {
        const r = await fetch(`${url}?size=${size}&page=${p}&sort=collector_number`, {
          credentials: "same-origin",
        });
        if (!r.ok) {
          return { error: true, status: r.status };
        }
        return await r.json();
      },
      { url: BASE_URL, size: PAGE_SIZE, page: pageNum }
    );

    if ("error" in result) {
      await context.close();
      throw new Error(`Riftbound scrape got HTTP ${result.status} on page ${pageNum}.`);
    }

    allCards.push(...result.items.map(normalize));
    if (pageNum >= result.pages) break;
    pageNum += 1;
  }

  await context.close();
  return allCards;
}
