import type { SupabaseClient } from "@supabase/supabase-js";
import type { OperationBoardOverviewStats, OperationTaskStatus } from "@/types";

/** Client wrapper for the `get_board_overview_stats` RPC (072). */
export async function getBoardOverviewStats(
  supabase: SupabaseClient,
  boardId: string,
): Promise<OperationBoardOverviewStats | null> {
  const { data, error } = await supabase.rpc("get_board_overview_stats", { p_board_id: boardId });
  if (error) {
    console.error("[board-overview] get_board_overview_stats failed:", error);
    return null;
  }
  // The RPC returns TABLE(...), so PostgREST wraps it as an array of one row.
  const rows = data as OperationBoardOverviewStats[] | null;
  return rows?.[0] ?? null;
}

export type TaskDueClassification = "overdue" | "due_today" | "due_this_week" | "future" | "done_or_cancelled" | "none";

/** Brazil (this product's market), UTC-3, no DST currently observed. */
const DEFAULT_UTC_OFFSET_MINUTES = -180;

/**
 * Pure mirror of the date-window logic inside `get_board_overview_stats`
 * (072) — same "local midnight, as a server-clock instant" idiom the
 * SQL uses (`date_trunc('day', NOW() AT TIME ZONE tz) AT TIME ZONE tz`),
 * expressed with a fixed UTC offset instead of an IANA timezone name
 * (no timezone library is a dependency here) so the formula itself can
 * be unit-tested in isolation from the database. "due_this_week" is a
 * rolling 7-day window that includes "due_today" as a subset, matching
 * the RPC.
 */
export function classifyTaskDueDate(
  dueAt: string | null | undefined,
  status: OperationTaskStatus,
  now: Date = new Date(),
  utcOffsetMinutes: number = DEFAULT_UTC_OFFSET_MINUTES,
): TaskDueClassification {
  if (status === "done" || status === "cancelled") return "done_or_cancelled";
  if (!dueAt) return "none";

  const due = new Date(dueAt);
  const localNow = new Date(now.getTime() + utcOffsetMinutes * 60_000);
  const todayStartLocal = Date.UTC(localNow.getUTCFullYear(), localNow.getUTCMonth(), localNow.getUTCDate());
  const todayStartUtc = new Date(todayStartLocal - utcOffsetMinutes * 60_000);
  const tomorrowStartUtc = new Date(todayStartUtc.getTime() + 24 * 60 * 60_000);
  const weekEndUtc = new Date(todayStartUtc.getTime() + 7 * 24 * 60 * 60_000);

  if (due < todayStartUtc) return "overdue";
  if (due < tomorrowStartUtc) return "due_today";
  if (due < weekEndUtc) return "due_this_week";
  return "future";
}
