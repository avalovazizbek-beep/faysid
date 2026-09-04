/** Asia/Tashkent is UTC+5 year-round (no DST) — shared by every module that needs to
 * reason about "which Tashkent calendar day" or "what Tashkent wall-clock time" a
 * given instant falls on. */
export const TASHKENT_OFFSET_MS = 5 * 60 * 60_000;

/**
 * Start of the Tashkent calendar day containing `reference`, represented as a
 * UTC-midnight Date — the storage convention for `Attendance.date` throughout
 * this codebase. Using the raw UTC day here (as earlier code did) instead of
 * shifting by the Tashkent offset first misfiles any event before ~05:00
 * Tashkent time under the previous day — the exact bug that broke the night
 * shift's (20:00-08:00) checkout half.
 */
export function startOfTashkentDay(reference: Date = new Date()): Date {
  const tashkent = new Date(reference.getTime() + TASHKENT_OFFSET_MS);
  return new Date(Date.UTC(tashkent.getUTCFullYear(), tashkent.getUTCMonth(), tashkent.getUTCDate()));
}

/** Renders a Date as Asia/Tashkent wall-clock "HH:mm". */
export function formatTashkentTime(date: Date): string {
  const tashkent = new Date(date.getTime() + TASHKENT_OFFSET_MS);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(tashkent.getUTCHours())}:${pad(tashkent.getUTCMinutes())}`;
}
