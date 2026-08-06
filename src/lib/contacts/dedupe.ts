import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizePhone, phonesMatch } from "@/lib/whatsapp/phone-utils";

/**
 * Contact de-duplication helpers, shared by the WhatsApp webhook, the
 * manual contact form, and CSV import so all paths agree on what
 * "same number" means (issue #212).
 *
 * The canonical key is `normalizePhone` (digits-only) — the same form
 * the DB stores in the generated `contacts.phone_normalized` column
 * and enforces unique per account. `phonesMatch` adds trunk-prefix
 * tolerance (last-8-digit match) for the softer "possible duplicate"
 * surfaces.
 */

/** Canonical de-dup key for a phone string (digits only). */
export function normalizeKey(phone: string): string {
  return normalizePhone(phone);
}

/** Minimal shape we need back from a contacts lookup. */
export interface ExistingContact {
  id: string;
  phone: string;
  name?: string | null;
  [key: string]: unknown;
}

/**
 * Find an existing contact in `accountId` whose phone matches `phone`,
 * or null. Pre-filters in SQL by the last-8-digit suffix (so we don't
 * pull every contact), then applies the strict `phonesMatch` in JS on
 * the small candidate set — the exact approach the webhook has used.
 *
 * `excludeGroupPlaceholders`: a WhatsApp group's synthetic contact row
 * (migration 049) stores its JID's long digit prefix in `phone` — real
 * collision with a genuine phone number is exceedingly unlikely but not
 * impossible. The Evolution webhook's participant-resolution path (a
 * real person's number, inside a group) sets this so a group's own
 * placeholder row can never be misattributed as the sender.
 */
export async function findExistingContact(
  db: SupabaseClient,
  accountId: string,
  phone: string,
  options?: { excludeGroupPlaceholders?: boolean },
): Promise<ExistingContact | null> {
  const normalized = normalizePhone(phone);
  if (!normalized) return null;

  const suffix = normalized.length >= 8 ? normalized.slice(-8) : normalized;

  let query = db
    .from("contacts")
    .select("*")
    .eq("account_id", accountId)
    .like("phone", `%${suffix}`);
  if (options?.excludeGroupPlaceholders) {
    query = query.eq("is_group_placeholder", false);
  }
  const { data, error } = await query;

  if (error || !data) return null;

  return (
    (data as ExistingContact[]).find((c) => phonesMatch(c.phone, phone)) ?? null
  );
}

/**
 * Find an existing contact in `accountId` by exact email match
 * (case-insensitive) — the fallback dedupe key for Release D forms
 * (PRD 17.5: "dedup prioritiza telefone, opcionalmente e-mail"), used
 * only when a form has `dedupe_use_email` on AND no phone match was
 * found. `contacts.email` has no unique constraint or functional index
 * today (low expected volume for V1) — a straight `.ilike()` is
 * sufficient; add an index if this ever shows up in a slow-query log.
 */
export async function findExistingContactByEmail(
  db: SupabaseClient,
  accountId: string,
  email: string,
): Promise<ExistingContact | null> {
  const trimmed = email.trim();
  if (!trimmed) return null;

  const { data, error } = await db
    .from("contacts")
    .select("*")
    .eq("account_id", accountId)
    .ilike("email", trimmed)
    .limit(1)
    .maybeSingle();

  if (error || !data) return null;
  return data as ExistingContact;
}

/**
 * True when an existing contact is an *exact* normalized match for
 * `phone` (vs only a fuzzy trunk-variant match). The form hard-blocks
 * exact matches but only warns on fuzzy ones.
 */
export function isExactMatch(existing: ExistingContact, phone: string): boolean {
  return normalizeKey(existing.phone) === normalizeKey(phone);
}

/**
 * True for a Postgres unique-constraint violation (SQLSTATE 23505).
 * Used as the backstop when the DB unique index rejects a racing or
 * format-equal insert that slipped past the in-app check.
 */
export function isUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  return (error as { code?: string }).code === "23505";
}

/**
 * De-duplicate parsed CSV rows by normalized phone, keeping the first
 * occurrence of each. Rows with an empty normalized phone are dropped
 * (they can't be a valid contact). Returns the unique rows plus the
 * count removed as in-file duplicates.
 */
export function dedupeByPhone<T extends { phone: string }>(
  rows: T[],
): { unique: T[]; duplicates: number } {
  const seen = new Set<string>();
  const unique: T[] = [];
  let duplicates = 0;

  for (const row of rows) {
    const key = normalizeKey(row.phone);
    if (!key) {
      duplicates++;
      continue;
    }
    if (seen.has(key)) {
      duplicates++;
      continue;
    }
    seen.add(key);
    unique.push(row);
  }

  return { unique, duplicates };
}
