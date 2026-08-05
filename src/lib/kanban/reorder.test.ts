import { describe, expect, it } from "vitest";
import { computeReorderPosition } from "./reorder";

describe("computeReorderPosition", () => {
  it("returns the midpoint when dropped between two items", () => {
    expect(computeReorderPosition([1000, undefined, 2000], 1)).toBe(1500);
  });

  it("returns before + 1000 when dropped at the end", () => {
    expect(computeReorderPosition([1000, 2000, undefined], 2)).toBe(3000);
  });

  it("returns after - 1000 when dropped at the start", () => {
    expect(computeReorderPosition([undefined, 2000, 3000], 0)).toBe(1000);
  });

  it("returns 1000 for the only item in an empty list", () => {
    expect(computeReorderPosition([undefined], 0)).toBe(1000);
  });

  it("handles a colliding gap (equal neighboring positions) by averaging", () => {
    expect(computeReorderPosition([1000, undefined, 1000], 1)).toBe(1000);
  });

  it("treats null the same as undefined for missing neighbors", () => {
    expect(computeReorderPosition([null, 2000, 3000], 0)).toBe(1000);
  });
});
