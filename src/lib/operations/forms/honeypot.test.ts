import { describe, expect, it } from "vitest";
import { isHoneypotTripped, isSubmittedTooFast, MIN_SUBMIT_MS } from "./honeypot";

describe("isHoneypotTripped", () => {
  it("is false for empty/whitespace/missing values", () => {
    expect(isHoneypotTripped("")).toBe(false);
    expect(isHoneypotTripped("   ")).toBe(false);
    expect(isHoneypotTripped(undefined)).toBe(false);
    expect(isHoneypotTripped(null)).toBe(false);
  });

  it("is true when the trap field has any content", () => {
    expect(isHoneypotTripped("http://spam.example")).toBe(true);
  });
});

describe("isSubmittedTooFast", () => {
  const now = 1_000_000;

  it("is true when elapsed time is below the threshold", () => {
    expect(isSubmittedTooFast(now - (MIN_SUBMIT_MS - 1), now)).toBe(true);
  });

  it("is false right at and above the threshold", () => {
    expect(isSubmittedTooFast(now - MIN_SUBMIT_MS, now)).toBe(false);
    expect(isSubmittedTooFast(now - MIN_SUBMIT_MS - 5000, now)).toBe(false);
  });

  it("is true when loadedAt is missing or not a finite number", () => {
    expect(isSubmittedTooFast(undefined, now)).toBe(true);
    expect(isSubmittedTooFast(null, now)).toBe(true);
    expect(isSubmittedTooFast(Number.NaN, now)).toBe(true);
  });

  it("is true when loadedAt is in the future", () => {
    expect(isSubmittedTooFast(now + 1000, now)).toBe(true);
  });

  it("is true when loadedAt is absurdly old (forgotten open tab)", () => {
    expect(isSubmittedTooFast(now - 2 * 60 * 60 * 1000, now)).toBe(true);
  });
});
