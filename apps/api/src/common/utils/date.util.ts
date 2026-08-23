import { DateTime } from 'luxon';

/**
 * All timestamps are stored in UTC. A school's configured timezone is applied
 * only when interpreting a wall-clock date (attendance for "today") or when
 * formatting for display, so a school in IST and one in GMT never disagree
 * about which calendar day a record belongs to.
 */

export const DEFAULT_TIMEZONE = 'Asia/Kolkata';

/** Parses a `yyyy-MM-dd` string into the UTC midnight used by `@db.Date` columns. */
export function parseDateOnly(value: string | Date): Date {
  if (value instanceof Date) {
    return new Date(Date.UTC(value.getUTCFullYear(), value.getUTCMonth(), value.getUTCDate()));
  }
  const parsed = DateTime.fromISO(value, { zone: 'utc' }).startOf('day');
  if (!parsed.isValid) throw new Error(`Invalid date: ${value}`);
  return parsed.toJSDate();
}

/** The current calendar date in the school's timezone, as a UTC-midnight Date. */
export function todayInZone(timezone = DEFAULT_TIMEZONE): Date {
  const now = DateTime.now().setZone(timezone);
  return DateTime.utc(now.year, now.month, now.day).toJSDate();
}

/** Start and end instants of a calendar day in the given zone, expressed in UTC. */
export function dayBoundsInZone(
  date: string | Date,
  timezone = DEFAULT_TIMEZONE,
): { start: Date; end: Date } {
  const iso = typeof date === 'string' ? date : DateTime.fromJSDate(date).toISODate()!;
  const day = DateTime.fromISO(iso, { zone: timezone });
  return { start: day.startOf('day').toUTC().toJSDate(), end: day.endOf('day').toUTC().toJSDate() };
}

export function formatDate(
  value: Date | string | null | undefined,
  format = 'dd MMM yyyy',
  timezone = DEFAULT_TIMEZONE,
): string {
  if (!value) return '';
  const dt =
    value instanceof Date ? DateTime.fromJSDate(value) : DateTime.fromISO(value, { zone: 'utc' });
  return dt.setZone(timezone).toFormat(format);
}

export function formatDateTime(
  value: Date | string | null | undefined,
  timezone = DEFAULT_TIMEZONE,
): string {
  return formatDate(value, 'dd MMM yyyy, hh:mm a', timezone);
}

/** Whole days between two dates, inclusive of both endpoints. */
export function inclusiveDayCount(from: Date, to: Date): number {
  const start = DateTime.fromJSDate(from, { zone: 'utc' }).startOf('day');
  const end = DateTime.fromJSDate(to, { zone: 'utc' }).startOf('day');
  return Math.max(0, Math.floor(end.diff(start, 'days').days) + 1);
}

export function addDays(date: Date, days: number): Date {
  return DateTime.fromJSDate(date, { zone: 'utc' }).plus({ days }).toJSDate();
}

export function isSameDay(a: Date, b: Date): boolean {
  return (
    a.getUTCFullYear() === b.getUTCFullYear() &&
    a.getUTCMonth() === b.getUTCMonth() &&
    a.getUTCDate() === b.getUTCDate()
  );
}

export function isFutureDate(date: Date, timezone = DEFAULT_TIMEZONE): boolean {
  return date.getTime() > todayInZone(timezone).getTime();
}

/** Every calendar date from `from` to `to`, inclusive. */
export function eachDay(from: Date, to: Date): Date[] {
  const days: Date[] = [];
  let cursor = DateTime.fromJSDate(from, { zone: 'utc' }).startOf('day');
  const end = DateTime.fromJSDate(to, { zone: 'utc' }).startOf('day');

  while (cursor <= end && days.length < 400) {
    days.push(cursor.toJSDate());
    cursor = cursor.plus({ days: 1 });
  }
  return days;
}

const WEEKDAYS = [
  'MONDAY',
  'TUESDAY',
  'WEDNESDAY',
  'THURSDAY',
  'FRIDAY',
  'SATURDAY',
  'SUNDAY',
] as const;

export type WeekdayName = (typeof WEEKDAYS)[number];

export function weekdayOf(date: Date): WeekdayName {
  // Luxon weekdays are 1 (Monday) through 7 (Sunday).
  return WEEKDAYS[DateTime.fromJSDate(date, { zone: 'utc' }).weekday - 1];
}

/** Parses an `HH:mm` string into minutes past midnight, for interval overlap maths. */
export function timeToMinutes(time: string): number {
  const [hours, minutes] = time.split(':').map((part) => Number.parseInt(part, 10));
  return (hours || 0) * 60 + (minutes || 0);
}

export function minutesToTime(minutes: number): string {
  const hours = Math.floor(minutes / 60) % 24;
  return `${String(hours).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}`;
}

/** True when two half-open time intervals overlap. */
export function timeRangesOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string,
): boolean {
  return timeToMinutes(startA) < timeToMinutes(endB) && timeToMinutes(startB) < timeToMinutes(endA);
}

export function ageFrom(dateOfBirth: Date, at: Date = new Date()): number {
  return Math.floor(
    DateTime.fromJSDate(at, { zone: 'utc' }).diff(
      DateTime.fromJSDate(dateOfBirth, { zone: 'utc' }),
      'years',
    ).years,
  );
}

/** Indian financial year label for a date, e.g. 2026-27. */
export function financialYearOf(date: Date = new Date()): string {
  const dt = DateTime.fromJSDate(date, { zone: 'utc' });
  const startYear = dt.month >= 4 ? dt.year : dt.year - 1;
  return `${startYear}-${String((startYear + 1) % 100).padStart(2, '0')}`;
}
