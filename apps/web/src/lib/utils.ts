import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Indian digit grouping, which is what this product's users read.
 * 1234567 renders as 12,34,567 — not 1,234,567.
 */
export function formatMoney(
  value: number | string | null | undefined,
  currency = 'INR',
  options: { compact?: boolean; showSymbol?: boolean } = {},
): string {
  const amount = Number(value ?? 0);
  if (!Number.isFinite(amount)) return '—';

  const symbol = options.showSymbol === false ? '' : currency === 'INR' ? '₹' : `${currency} `;

  if (options.compact && Math.abs(amount) >= 100000) {
    const crore = amount / 10000000;
    const lakh = amount / 100000;
    return Math.abs(amount) >= 10000000
      ? `${symbol}${crore.toFixed(2)} Cr`
      : `${symbol}${lakh.toFixed(2)} L`;
  }

  return `${symbol}${amount.toLocaleString('en-IN', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatNumber(value: number | string | null | undefined): string {
  const number = Number(value ?? 0);
  return Number.isFinite(number) ? number.toLocaleString('en-IN') : '—';
}

export function formatPercent(value: number | null | undefined, digits = 1): string {
  return value === null || value === undefined || !Number.isFinite(value)
    ? '—'
    : `${value.toFixed(digits)}%`;
}

export function initials(name: string | null | undefined): string {
  if (!name) return '?';
  const parts = name.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts.length > 1 ? (parts.at(-1)?.[0] ?? '') : '')).toUpperCase();
}

/** Blocks a call until the caller stops typing. */
export function debounce<T extends (...args: never[]) => void>(fn: T, ms: number) {
  let timer: ReturnType<typeof setTimeout> | undefined;
  return (...args: Parameters<T>) => {
    if (timer) clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

/** Triggers a browser download for a blob the API returned. */
export function saveBlob(blob: Blob, fileName: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = fileName;
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}
