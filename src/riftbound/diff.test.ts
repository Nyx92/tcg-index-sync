import { describe, it, expect } from "vitest";
import { diffRiftboundCards, type RiftboundApiCard } from "./diff";

function card(overrides: Partial<RiftboundApiCard>): RiftboundApiCard {
  return {
    id: "mongo-1",
    riftbound_id: "a-1",
    updated_on: "2026-01-01",
    name: "Test",
    ...overrides,
  } as RiftboundApiCard;
}

describe("diffRiftboundCards", () => {
  it("includes a card that wasn't in the previous snapshot at all", () => {
    const result = diffRiftboundCards([], [card({ id: "mongo-new-1", riftbound_id: "new-1" })]);
    expect(result.map((c) => c.riftbound_id)).toEqual(["new-1"]);
  });

  it("excludes a card whose updated_on is unchanged", () => {
    const previous = [card({ id: "mongo-1", riftbound_id: "a-1", updated_on: "2026-01-01" })];
    const current = [card({ id: "mongo-1", riftbound_id: "a-1", updated_on: "2026-01-01" })];
    expect(diffRiftboundCards(previous, current)).toEqual([]);
  });

  it("includes a card whose updated_on moved forward", () => {
    const previous = [card({ id: "mongo-1", riftbound_id: "a-1", updated_on: "2026-01-01" })];
    const current = [card({ id: "mongo-1", riftbound_id: "a-1", updated_on: "2026-02-01" })];
    const result = diffRiftboundCards(previous, current);
    expect(result.map((c) => c.riftbound_id)).toEqual(["a-1"]);
  });

  it("compares two cards that share the same riftbound_id independently, keyed on the unique id", () => {
    // Regression test for the live-data defect: 147 of 1451 live cards share
    // a riftbound_id with another row. Keying the dedup Map on riftbound_id
    // would collapse these two into one Map entry and produce a false
    // "changed" result for whichever card lost the collision.
    const previous = [
      card({ id: "mongo-1", riftbound_id: "shared-id", updated_on: "2026-01-01" }),
      card({ id: "mongo-2", riftbound_id: "shared-id", updated_on: "2026-01-01" }),
    ];
    const current = [
      card({ id: "mongo-1", riftbound_id: "shared-id", updated_on: "2026-01-01" }),
      card({ id: "mongo-2", riftbound_id: "shared-id", updated_on: "2026-01-01" }),
    ];
    expect(diffRiftboundCards(previous, current)).toEqual([]);
  });
});
