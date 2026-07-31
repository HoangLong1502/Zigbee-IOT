import {
  ACCESS_GET,
  ACCESS_PUBLISHED,
  ACCESS_SET,
  ZigbeeExpose,
} from '../types/zigbee.types';

/**
 * Result of walking the Zigbee2MQTT exposes tree.
 *
 * `property` is the exact key that appears in (or is accepted by) the MQTT
 * payload, which is all the rest of the system needs in order to stay generic.
 */
export interface FlatExpose {
  property: string;
  name: string | null;
  label: string | null;
  type: string;
  parentType: string | null;
  /** Composite parent key so the UI can render related features as one card. */
  groupKey: string | null;
  groupLabel: string | null;
  groupDescription: string | null;
  endpoint: string;
  access: number;
  unit: string | null;
  description: string | null;
  category: string | null;
  valueMin: number | null;
  valueMax: number | null;
  valueStep: number | null;
  values: Array<string | number> | null;
  valueOn: unknown;
  valueOff: unknown;
  valueToggle: unknown;
  raw: ZigbeeExpose;
}

interface ExposeGroup {
  key: string;
  label: string;
  description: string | null;
}

/** Expose types that group other exposes instead of carrying a value. */
const GROUPING_TYPES = new Set([
  'light',
  'switch',
  'fan',
  'cover',
  'lock',
  'climate',
  'composite',
]);

const asNumber = (value: unknown): number | null =>
  typeof value === 'number' && Number.isFinite(value) ? value : null;

const asString = (value: unknown): string | null =>
  typeof value === 'string' && value.length > 0 ? value : null;

/**
 * Flattens the nested exposes tree into one entry per addressable property.
 *
 * Zigbee2MQTT nests generic exposes (numeric/binary/enum/text) inside specific
 * ones (light/switch/climate/...). A multi-gang plug additionally suffixes the
 * property with the endpoint, e.g. `state_l1`. Both cases are handled here so
 * that callers only ever deal with a flat list.
 *
 * Composite parents also stamp `groupKey` / `groupLabel` so the UI can keep
 * related settings (e.g. inching_control + inching_mode + inching_time) in one
 * card instead of looking like duplicates.
 */
export function flattenExposes(
  exposes: ZigbeeExpose[] | null | undefined,
  parentType: string | null = null,
  group: ExposeGroup | null = null,
): FlatExpose[] {
  if (!Array.isArray(exposes)) return [];

  const result: FlatExpose[] = [];

  for (const expose of exposes) {
    if (!expose || typeof expose !== 'object') continue;

    const type = String(expose.type ?? 'unknown');
    const hasFeatures = Array.isArray(expose.features) && expose.features.length > 0;

    // A grouping expose contributes no property of its own - recurse into it.
    if (hasFeatures && (GROUPING_TYPES.has(type) || !expose.property)) {
      // Only `composite` becomes a UI group. light/switch stay flat so primary
      // controls (state, brightness) remain first-class cards.
      const nextGroup: ExposeGroup | null =
        type === 'composite'
          ? {
              key: String(
                expose.property ?? expose.name ?? expose.label ?? 'composite',
              ),
              label:
                asString(expose.label) ??
                asString(expose.name) ??
                'Settings',
              description: asString(expose.description),
            }
          : group;

      result.push(...flattenExposes(expose.features, type, nextGroup));
      continue;
    }

    if (!expose.property) continue;

    // Always store '' (never null): Postgres UNIQUE treats NULLs as distinct.
    const endpoint = asString((expose as Record<string, unknown>).endpoint) ?? '';

    result.push({
      property: String(expose.property),
      name: asString(expose.name),
      label: asString(expose.label),
      type,
      parentType,
      groupKey: group?.key ?? null,
      groupLabel: group?.label ?? null,
      groupDescription: group?.description ?? null,
      endpoint,
      access: typeof expose.access === 'number' ? expose.access : ACCESS_PUBLISHED,
      unit: asString(expose.unit),
      description: asString(expose.description),
      category: asString(expose.category),
      valueMin: asNumber(expose.value_min),
      valueMax: asNumber(expose.value_max),
      valueStep: asNumber(expose.value_step),
      values: Array.isArray(expose.values) ? expose.values : null,
      valueOn: expose.value_on ?? null,
      valueOff: expose.value_off ?? null,
      valueToggle: expose.value_toggle ?? null,
      raw: expose,
    });
  }

  // De-duplicate on property+endpoint: some definitions repeat a property
  // inside nested composites (e.g. voltage protection features listed twice).
  const seen = new Map<string, FlatExpose>();
  for (const item of result) {
    const key = `${item.property}::${item.endpoint || ''}`;
    const existing = seen.get(key);
    if (!existing || (item.access ?? 0) >= (existing.access ?? 0)) {
      seen.set(key, item);
    }
  }
  return [...seen.values()];
}

export const isPublished = (access: number): boolean =>
  (access & ACCESS_PUBLISHED) === ACCESS_PUBLISHED;

export const isSettable = (access: number): boolean =>
  (access & ACCESS_SET) === ACCESS_SET;

export const isGettable = (access: number): boolean =>
  (access & ACCESS_GET) === ACCESS_GET;

/**
 * Properties that describe the transport rather than the sensor. They are
 * still stored, but excluded from "sensor value" views and charts.
 */
export const META_PROPERTIES = new Set([
  'linkquality',
  'last_seen',
  'elapsed',
  'update',
  'update_available',
  'device',
]);
