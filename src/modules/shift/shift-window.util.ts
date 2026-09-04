import { startOfTashkentDay, TASHKENT_OFFSET_MS } from "../../common/tashkent-time";

export interface ShiftTimes {
  /** "HH:mm", Asia/Tashkent wall-clock. */
  startTime: string;
  /** "HH:mm", Asia/Tashkent wall-clock. */
  endTime: string;
}

/** Real Date for a "HH:mm" Tashkent wall-clock time on the Tashkent calendar day represented by `sessionDate` (a UTC-midnight Date — see tashkent-time.ts's startOfTashkentDay()). */
function atTashkentTime(sessionDate: Date, hhmm: string): Date {
  const [hours, minutes] = hhmm.split(":").map(Number);
  const utcMs = Date.UTC(sessionDate.getUTCFullYear(), sessionDate.getUTCMonth(), sessionDate.getUTCDate(), hours, minutes, 0, 0) - TASHKENT_OFFSET_MS;
  return new Date(utcMs);
}

/**
 * Turns a shift + the calendar day its occurrence *starts* on into concrete
 * start/end instants — adding a day to `scheduledEnd` when the shift crosses
 * midnight (e.g. 20:00-08:00), so an overnight shift's single continuous
 * occurrence is represented correctly instead of as two unrelated half-days.
 */
export function resolveShiftOccurrence(shift: ShiftTimes, sessionDate: Date): { scheduledStart: Date; scheduledEnd: Date } {
  const scheduledStart = atTashkentTime(sessionDate, shift.startTime);
  let scheduledEnd = atTashkentTime(sessionDate, shift.endTime);
  if (shift.endTime <= shift.startTime) {
    // Overnight shift — the end time belongs to the next calendar day.
    scheduledEnd = new Date(scheduledEnd.getTime() + 24 * 60 * 60_000);
  }
  return { scheduledStart, scheduledEnd };
}

/** How far outside a shift's nominal window a real detection can still be attributed to it (early arrival / late departure tolerance) when deciding which occurrence a scan belongs to. */
const ATTRIBUTION_GRACE_MS = 3 * 60 * 60_000;

/**
 * Given an employee's shift (or null) and a real detection time, decides
 * which "session date" (the Attendance.date key) this detection belongs to —
 * the Tashkent calendar day the shift *occurrence* started on, which for an
 * overnight shift's early-morning tail end is the PREVIOUS day, not the day
 * the scan itself happened on.
 */
export function resolveAttendanceSession(
  shift: ShiftTimes | null,
  eventTime: Date,
): { sessionDate: Date; scheduledStart: Date | null; scheduledEnd: Date | null } {
  const todayUtc = startOfTashkentDay(eventTime);

  if (!shift) {
    return { sessionDate: todayUtc, scheduledStart: null, scheduledEnd: null };
  }

  const yesterdayUtc = new Date(todayUtc.getTime() - 24 * 60 * 60_000);
  const candidates = [todayUtc, yesterdayUtc].map((sessionDate) => ({
    sessionDate,
    ...resolveShiftOccurrence(shift, sessionDate),
  }));

  for (const candidate of candidates) {
    const windowStart = candidate.scheduledStart.getTime() - ATTRIBUTION_GRACE_MS;
    const windowEnd = candidate.scheduledEnd.getTime() + ATTRIBUTION_GRACE_MS;
    if (eventTime.getTime() >= windowStart && eventTime.getTime() <= windowEnd) {
      return candidate;
    }
  }

  // Outside every occurrence's grace window (e.g. the employee scanned at a
  // time unrelated to their assigned shift) — fall back to today's occurrence
  // rather than silently dropping the event.
  return candidates[0];
}
