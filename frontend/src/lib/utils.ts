import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';
import { formatDistanceToNow, format, parseISO } from 'date-fns';

export function cn(...inputs: ClassValue[]): string {
  return twMerge(clsx(inputs));
}

export function formatRelative(value: string | Date | null | undefined): string {
  if (!value) return 'never';
  try {
    const date = typeof value === 'string' ? parseISO(value) : value;
    return formatDistanceToNow(date, { addSuffix: true });
  } catch {
    return 'unknown';
  }
}

export function formatAbsolute(value: string | Date | null | undefined): string {
  if (!value) return '—';
  try {
    const date = typeof value === 'string' ? parseISO(value) : value;
    return format(date, 'yyyy-MM-dd HH:mm:ss');
  } catch {
    return '—';
  }
}

/** Maps an LQI (0-255) onto a short label and colour. */
export function linkQualityInfo(lqi: number | null | undefined): {
  label: string;
  color: string;
  percent: number;
} {
  if (lqi === null || lqi === undefined) {
    return { label: 'n/a', color: 'text-slate-500', percent: 0 };
  }
  const percent = Math.round((Math.min(lqi, 255) / 255) * 100);
  if (percent >= 70) return { label: 'Excellent', color: 'text-success', percent };
  if (percent >= 40) return { label: 'Good', color: 'text-accent-soft', percent };
  if (percent >= 20) return { label: 'Fair', color: 'text-warning', percent };
  return { label: 'Weak', color: 'text-danger', percent };
}

export function batteryColor(percent: number | null | undefined): string {
  if (percent === null || percent === undefined) return 'text-slate-500';
  if (percent <= 20) return 'text-danger';
  if (percent <= 40) return 'text-warning';
  return 'text-success';
}

/**
 * Pretty-prints a JSON-ish value for the raw payload viewer.
 * Falls back to String() for non-JSON values.
 */
export function prettyJson(value: unknown): string {
  if (typeof value === 'string') {
    try {
      return JSON.stringify(JSON.parse(value), null, 2);
    } catch {
      return value;
    }
  }
  try {
    return JSON.stringify(value, null, 2);
  } catch {
    return String(value);
  }
}

/** Humanises an expose property name: `color_temp` -> `Color Temp`. */
export function humanizeProperty(property: string): string {
  return property
    .replace(/_/g, ' ')
    .replace(/\b\w/g, (char) => char.toUpperCase());
}
