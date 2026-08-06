/** True if the invisible trap field was filled — a real visitor never sees or fills it. */
export function isHoneypotTripped(honeypotValue: string | undefined | null): boolean {
  return typeof honeypotValue === "string" && honeypotValue.trim().length > 0;
}

export const MIN_SUBMIT_MS = 3000;
/** A tab left open across a lunch break shouldn't look suspicious — cap how "old" a load timestamp can be before it's treated the same as a too-fast one (i.e. ignored/rejected as untrustworthy). */
const MAX_LOAD_AGE_MS = 60 * 60 * 1000;

/**
 * True if the submission is bot-like by timing: sent implausibly fast
 * after the page loaded, or with a loadedAt that's missing/in the
 * future/absurdly old (all signs the client didn't behave like a real
 * browser rendering the form).
 */
export function isSubmittedTooFast(loadedAt: number | undefined | null, now: number = Date.now(), minMs: number = MIN_SUBMIT_MS): boolean {
  if (typeof loadedAt !== "number" || !Number.isFinite(loadedAt)) return true;
  const elapsed = now - loadedAt;
  if (elapsed < 0) return true; // loadedAt in the future
  if (elapsed > MAX_LOAD_AGE_MS) return true;
  return elapsed < minMs;
}
