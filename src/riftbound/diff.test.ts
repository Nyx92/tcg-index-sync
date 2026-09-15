import { describe, it, expect } from "vitest";
import { diffRiftboundCards, type RiftboundApiCard } from "./diff";

function card(overrides: Partial<RiftboundApiCard>): RiftboundApiCard {
  return { riftbound_id: "a-1", updated_on: "2026-01-01", name: "Test", ...overrides } as RiftboundApiCard;
}

describe("diffRiftboundCards", () => {
  it("includes a card that wasn't in the previous snapshot at all", () => {
    const result = diffRiftboundCards([], [card({ riftbound_id: "new-1" })]);
    expect(result.map((c) => c.riftbound_id)).toEqual(["new-1"]);
  });

  it("excludes a card whose updated_on is unchanged", () => {
    const previous = [card({ riftbound_id: "a-1", updated_on: "2026-01-01" })];
    const current = [card({ riftbound_id: "a-1", updated_on: "2026-01-01" })];
    expect(diffRiftboundCards(previous, current)).toEqual([]);
  });

  it("includes a card whose updated_on moved forward", () => {
    const previous = [card({ riftbound_id: "a-1", updated_on: "2026-01-01" })];
    const current = [card({ riftbound_id: "a-1", updated_on: "2026-02-01" })];
    const result = diffRiftboundCards(previous, current);
    expect(result.map((c) => c.riftbound_id)).toEqual(["a-1"]);
  });
});
