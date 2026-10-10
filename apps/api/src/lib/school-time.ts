// School-timezone calendar boundaries (spec §12.7): every timestamp lives
// in UTC in the database; "today" and "this month" for KPI aggregates,
// fee reminders, and attendance are the SCHOOL's calendar day/month, never
// the server's. Intl with en-CA yields YYYY-MM-DD directly — no date
// library needed. `now` is injectable so timezone edge cases (IST midnight
// vs UTC, DST Sundays) are unit-testable.
export function schoolDay(timezone: string, now: Date): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}

export function schoolMonth(timezone: string, now: Date): { year: number; month: number } {  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: timezone,
    year: "numeric",
    month: "2-digit",
  }).formatToParts(now);
  const year = Number(parts.find((p) => p.type === "year")?.value);
  const month = Number(parts.find((p) => p.type === "month")?.value);
  if (!Number.isInteger(year) || !Number.isInteger(month) || month < 1 || month > 12) {
    throw new Error(`Cannot resolve school month for timezone ${timezone}.`);
  }
  return { year, month };
}

// School-local hour 0–23 (§12.4): the external scheduler fires hourly and
// each job decides, PER SCHOOL, whether it is that school's sending hour —
// one UTC time never fits all schools. `now` injectable, same as schoolDay.
export function schoolHour(timezone: string, now: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    hour: "2-digit",
  }).formatToParts(now);
  const raw = Number(parts.find((p) => p.type === "hour")?.value);
  if (!Number.isInteger(raw)) {
    throw new Error(`Cannot resolve school hour for timezone ${timezone}.`);
  }
  // Some ICU builds report midnight as 24 under hour12:false — normalize.
  return raw % 24;
}

// School-local weekday as 1 = Monday .. 7 = Sunday, matching
// timetable_slots.day_of_week (§12.7 — a "today" timetable is the school's
// today, not the server's).
export function schoolWeekday(timezone: string, now: Date): number {
  const short = new Intl.DateTimeFormat("en-US", { timeZone: timezone, weekday: "short" }).format(now);
  const day = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(short);
  if (day < 0) {
    throw new Error(`Cannot resolve school weekday for timezone ${timezone}.`);
  }
  return day === 0 ? 7 : day;
}

// Signed offset of `timezone` at `instant`, in milliseconds (local - UTC).
function tzOffsetMs(timezone: string, instant: Date): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: timezone,
    hour12: false,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(instant);
  const get = (type: string): number => Number(parts.find((p) => p.type === type)?.value);
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return asUtc - instant.getTime();
}

// UTC [start, end) covering a school-local calendar month. Two-pass offset
// resolution so DST transitions inside the month (US schools) land exactly;
// IST (no DST) converges on the first pass. Throws on unknown timezones
// (Intl throws RangeError) — fail closed, never silently UTC.
export function schoolMonthBoundsUtc(timezone: string, year: number, month: number): { start: Date; end: Date } {
  const resolve = (year: number, month: number): Date => {
    let guess = Date.UTC(year, month - 1, 1, 0, 0, 0);
    for (let i = 0; i < 2; i += 1) {
      guess = Date.UTC(year, month - 1, 1, 0, 0, 0) - tzOffsetMs(timezone, new Date(guess));
    }
    return new Date(guess);
  };
  const nextMonth = month === 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
  return { start: resolve(year, month), end: resolve(nextMonth.year, nextMonth.month) };
}

// UTC [start, end) covering a school-local calendar day (YYYY-MM-DD).
// Same two-pass resolution as months — correct across DST spring-forward
// days that are 23 hours long.
export function schoolDayBoundsUtc(timezone: string, day: string): { start: Date; end: Date } {
  const [year, month, date] = day.split("-").map(Number);
  if (!year || !month || !date) {
    throw new Error(`Day must be YYYY-MM-DD, got ${day}.`);
  }
  const resolve = (y: number, m: number, d: number): Date => {
    let guess = Date.UTC(y, m - 1, d, 0, 0, 0);
    for (let i = 0; i < 2; i += 1) {
      guess = Date.UTC(y, m - 1, d, 0, 0, 0) - tzOffsetMs(timezone, new Date(guess));
    }
    return new Date(guess);
  };
  const next = new Date(Date.UTC(year, month - 1, date + 1));
  return { start: resolve(year, month, date), end: resolve(next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate()) };
}
