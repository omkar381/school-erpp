import { format, formatDistanceToNowStrict, isToday, isValid, isYesterday, parseISO } from 'date-fns';

function toDate(value: string | Date | null | undefined): Date | null {
  if (!value) return null;
  const date = value instanceof Date ? value : parseISO(value);
  return isValid(date) ? date : null;
}

export function formatDate(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'dd MMM yyyy') : '—';
}

export function formatDateTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'dd MMM yyyy, h:mm a') : '—';
}

export function formatTime(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'h:mm a') : '—';
}

/** `14:30` from the API's plain time strings, rendered as `2:30 PM`. */
export function formatClock(value: string | null | undefined): string {
  if (!value) return '—';
  const [hours, minutes] = value.split(':').map(Number);
  if (!Number.isFinite(hours) || !Number.isFinite(minutes)) return value;
  const suffix = hours >= 12 ? 'PM' : 'AM';
  const hour = hours % 12 === 0 ? 12 : hours % 12;
  return `${hour}:${String(minutes).padStart(2, '0')} ${suffix}`;
}

/**
 * "Today", "Yesterday", or the date — what a notice list or an activity feed
 * should say rather than repeating the full date on every row.
 */
export function formatRelativeDay(value: string | Date | null | undefined): string {
  const date = toDate(value);
  if (!date) return '—';
  if (isToday(date)) return 'Today';
  if (isYesterday(date)) return 'Yesterday';
  return format(date, 'dd MMM yyyy');
}

export function formatAgo(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? `${formatDistanceToNowStrict(date)} ago` : '—';
}

/** `yyyy-MM-dd`, the format every date input and API date field uses. */
export function toDateInput(value: string | Date | null | undefined): string {
  const date = toDate(value);
  return date ? format(date, 'yyyy-MM-dd') : '';
}

export function today(): string {
  return format(new Date(), 'yyyy-MM-dd');
}

export function daysAgo(days: number): string {
  return format(new Date(Date.now() - days * 86_400_000), 'yyyy-MM-dd');
}

export function startOfThisMonth(): string {
  const now = new Date();
  return format(new Date(now.getFullYear(), now.getMonth(), 1), 'yyyy-MM-dd');
}
