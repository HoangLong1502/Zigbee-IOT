/**
 * Helpers for turning arbitrary JSON values coming from Zigbee2MQTT into the
 * shapes our storage layer expects.
 *
 * Payload values are wildly heterogeneous: `21.5`, `true`, `"ON"`, `"open"`,
 * `{ r: 1, g: 2 }`. We keep the original in JSONB and additionally derive a
 * numeric projection so that charts and threshold rules work uniformly.
 */

export type ValueType = 'number' | 'boolean' | 'string' | 'object' | 'null';

export function detectValueType(value: unknown): ValueType {
  if (value === null || value === undefined) return 'null';
  if (typeof value === 'number') return 'number';
  if (typeof value === 'boolean') return 'boolean';
  if (typeof value === 'string') return 'string';
  return 'object';
}

/** Strings Zigbee2MQTT uses for the "active/true" side of a binary expose. */
const TRUTHY = new Set([
  'on',
  'true',
  'open',
  'detected',
  'occupied',
  'alarm',
  'locked',
  'yes',
  'active',
  'wet',
]);

/** Strings used for the "inactive/false" side. */
const FALSY = new Set([
  'off',
  'false',
  'closed',
  'clear',
  'not_occupied',
  'no',
  'idle',
  'unlocked',
  'dry',
  'none',
]);

/**
 * Projects a value onto a number suitable for time-series storage.
 * Booleans and known binary strings become 1/0; anything non-numeric is null.
 */
export function toNumericValue(value: unknown): number | null {
  if (typeof value === 'number') return Number.isFinite(value) ? value : null;
  if (typeof value === 'boolean') return value ? 1 : 0;
  if (typeof value === 'string') {
    const normalised = value.trim().toLowerCase();
    if (TRUTHY.has(normalised)) return 1;
    if (FALSY.has(normalised)) return 0;
    const parsed = Number.parseFloat(normalised);
    return Number.isFinite(parsed) && normalised === String(parsed) ? parsed : null;
  }
  return null;
}

/** Short textual projection used for enum/string series. */
export function toStringValue(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') return value.slice(0, 255);
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return null;
}

/** Parses `true`/`"ON"`/`1` style values into a boolean, or null if ambiguous. */
export function toBooleanValue(value: unknown): boolean | null {
  if (typeof value === 'boolean') return value;
  if (typeof value === 'number') return value !== 0;
  if (typeof value === 'string') {
    const normalised = value.trim().toLowerCase();
    if (TRUTHY.has(normalised)) return true;
    if (FALSY.has(normalised)) return false;
  }
  return null;
}

/** Safe JSON.parse that returns null instead of throwing. */
export function safeJsonParse<T = unknown>(raw: string): T | null {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return null;
  }
}

/** Formats a Zigbee ext PAN id (number[] or number) as a hex string. */
export function formatExtendedPanId(value: unknown): string | null {
  if (Array.isArray(value)) {
    return value
      .map((byte) => Number(byte).toString(16).padStart(2, '0').toUpperCase())
      .join('');
  }
  if (typeof value === 'number') return value.toString(16).toUpperCase();
  if (typeof value === 'string') return value;
  return null;
}
