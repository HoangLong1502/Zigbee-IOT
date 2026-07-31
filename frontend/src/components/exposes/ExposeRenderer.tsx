/**
 * Dynamic expose renderer.
 *
 * The UI never hardcodes sensor names. Instead it walks the Zigbee2MQTT expose
 * metadata (type, access, unit, value_min/max, values, value_on/off) and picks
 * the right control for each property. A brand-new device therefore renders
 * correctly without a frontend change.
 *
 * Config / composite settings (overload protection, inching, power-on behavior,
 * …) are collapsed behind a Config button so the main surface stays readable.
 */

import { useMemo, useState } from 'react';
import {
  Battery,
  ChevronDown,
  Droplets,
  Flame,
  Gauge,
  Lightbulb,
  Power,
  Settings2,
  Thermometer,
  Waves,
  Zap,
} from 'lucide-react';
import type { DeviceExpose } from '@/types';
import { cn, humanizeProperty } from '@/lib/utils';
import { Badge } from '@/components/ui/Card';

const ACCESS_SET = 0b010;
const ACCESS_GET = 0b100;

/** Primary power / light channels that stay on the main surface. */
const PRIMARY_CONTROL = /^(state(_l\d+)?|brightness|color_temp|color|color_hs|color_xy)$/i;

const ICON_BY_PROPERTY: Record<string, typeof Thermometer> = {
  temperature: Thermometer,
  humidity: Droplets,
  pressure: Gauge,
  illuminance: Lightbulb,
  battery: Battery,
  power: Zap,
  energy: Zap,
  voltage: Zap,
  current: Zap,
  water_leak: Waves,
  smoke: Flame,
  state: Power,
  occupancy: Gauge,
  contact: Gauge,
};

export interface ExposeRendererProps {
  exposes: DeviceExpose[];
  values: Record<string, unknown>;
  /** Called when the user writes a settable expose. */
  onSet?: (property: string, value: unknown) => Promise<void> | void;
  /** Compact mode for dashboard cards. */
  compact?: boolean;
  className?: string;
}

export function ExposeRenderer({
  exposes,
  values,
  onSet,
  compact = false,
  className,
}: ExposeRendererProps) {
  const [configOpen, setConfigOpen] = useState(false);
  const { primary, config } = useMemo(() => splitPrimaryAndConfig(exposes), [exposes]);

  if (primary.length === 0 && config.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No exposes reported yet. Wait for the device interview to complete.
      </p>
    );
  }

  return (
    <div className={cn('space-y-4', className)}>
      {primary.length > 0 ? (
        <ExposeGrid items={primary} values={values} onSet={onSet} compact={compact} />
      ) : null}

      {config.length > 0 && !compact ? (
        <div className="rounded-2xl border border-white/5 bg-white/[0.02]">
          <button
            type="button"
            className="flex w-full items-center justify-between gap-3 px-4 py-3 text-left transition hover:bg-white/[0.03]"
            onClick={() => setConfigOpen((open) => !open)}
            aria-expanded={configOpen}
          >
            <span className="inline-flex items-center gap-2 text-sm font-medium text-slate-200">
              <Settings2 className="h-4 w-4 text-accent-soft" />
              Config
              <Badge>{configItemCount(config)}</Badge>
            </span>
            <ChevronDown
              className={cn(
                'h-4 w-4 text-slate-400 transition',
                configOpen && 'rotate-180',
              )}
            />
          </button>
          {configOpen ? (
            <div className="border-t border-white/5 px-4 py-4">
              <ExposeGrid items={config} values={values} onSet={onSet} compact={false} />
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function ExposeGrid({
  items,
  values,
  onSet,
  compact,
}: {
  items: RenderItem[];
  values: Record<string, unknown>;
  onSet?: (property: string, value: unknown) => Promise<void> | void;
  compact: boolean;
}) {
  return (
    <div
      className={cn(
        compact
          ? 'grid grid-cols-2 gap-2 sm:grid-cols-3'
          : 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3',
      )}
    >
      {items.map((item) =>
        item.kind === 'group' ? (
          <ExposeGroupCard
            key={`group:${item.key}`}
            group={item}
            values={values}
            onSet={onSet}
            compact={compact}
          />
        ) : (
          <ExposeControl
            key={item.expose.id || `${item.expose.property}:${item.expose.endpoint ?? ''}`}
            expose={item.expose}
            value={resolveExposeValue(values, item.expose)}
            onSet={onSet}
            compact={compact}
          />
        ),
      )}
    </div>
  );
}

type RenderItem =
  | { kind: 'single'; expose: DeviceExpose; rank: number }
  | {
      kind: 'group';
      key: string;
      label: string;
      description: string | null;
      features: DeviceExpose[];
      rank: number;
    };

function configItemCount(items: RenderItem[]): number {
  return items.reduce(
    (sum, item) => sum + (item.kind === 'group' ? item.features.length : 1),
    0,
  );
}

function exposeRank(expose: DeviceExpose): number {
  if (expose.category === 'diagnostic') return 2;
  if (expose.category === 'config' || expose.groupKey) return 1;
  return 0;
}

/** Config / composite settings go behind the Config button; sensors stay visible. */
function isConfigExpose(expose: DeviceExpose): boolean {
  if (expose.groupKey) return true;
  if (expose.category === 'config') return true;
  if (PRIMARY_CONTROL.test(expose.property)) return false;
  if (expose.parentType === 'switch' || expose.parentType === 'light') return false;
  // Other settable knobs (outlet protect, etc.) belong in Config.
  return (expose.access & ACCESS_SET) === ACCESS_SET;
}

function dedupeExposes(exposes: DeviceExpose[]): DeviceExpose[] {
  const byKey = new Map<string, DeviceExpose>();
  for (const expose of exposes) {
    const key = `${expose.property}::${expose.endpoint || ''}`;
    const existing = byKey.get(key);
    if (!existing || (expose.access ?? 0) >= (existing.access ?? 0)) {
      byKey.set(key, expose);
    }
  }
  return [...byKey.values()];
}

function buildRenderItems(exposes: DeviceExpose[]): RenderItem[] {
  const unique = dedupeExposes(exposes);
  const groups = new Map<string, Extract<RenderItem, { kind: 'group' }>>();
  const singles: Extract<RenderItem, { kind: 'single' }>[] = [];

  for (const expose of unique) {
    if (expose.groupKey) {
      const existing = groups.get(expose.groupKey);
      if (existing) {
        existing.features.push(expose);
      } else {
        groups.set(expose.groupKey, {
          kind: 'group',
          key: expose.groupKey,
          label: expose.groupLabel || humanizeProperty(expose.groupKey),
          description: expose.groupDescription ?? null,
          features: [expose],
          rank: exposeRank(expose),
        });
      }
      continue;
    }
    singles.push({ kind: 'single', expose, rank: exposeRank(expose) });
  }

  return [...singles, ...groups.values()].sort(
    (a, b) =>
      a.rank - b.rank ||
      (a.kind === 'group' ? a.label : a.expose.property).localeCompare(
        b.kind === 'group' ? b.label : b.expose.property,
      ),
  );
}

function splitPrimaryAndConfig(exposes: DeviceExpose[]): {
  primary: RenderItem[];
  config: RenderItem[];
} {
  const unique = dedupeExposes(exposes);
  return {
    primary: buildRenderItems(unique.filter((expose) => !isConfigExpose(expose))),
    config: buildRenderItems(unique.filter((expose) => isConfigExpose(expose))),
  };
}

/** Resolve flat or composite-nested values from the device payload. */
export function resolveExposeValue(
  values: Record<string, unknown>,
  expose: Pick<DeviceExpose, 'property' | 'groupKey'>,
): unknown {
  if (Object.prototype.hasOwnProperty.call(values, expose.property)) {
    return values[expose.property];
  }
  if (expose.groupKey) {
    const group = values[expose.groupKey];
    if (group && typeof group === 'object' && !Array.isArray(group)) {
      return (group as Record<string, unknown>)[expose.property];
    }
  }
  return undefined;
}

function ExposeGroupCard({
  group,
  values,
  onSet,
  compact,
}: {
  group: Extract<RenderItem, { kind: 'group' }>;
  values: Record<string, unknown>;
  onSet?: (property: string, value: unknown) => Promise<void> | void;
  compact: boolean;
}) {
  const features = [...group.features].sort((a, b) =>
    a.property.localeCompare(b.property),
  );

  return (
    <div
      className={cn(
        'rounded-2xl border border-white/5 bg-white/[0.03] p-3',
        compact ? 'p-2.5' : 'sm:col-span-2 xl:col-span-3',
      )}
    >
      <div className="mb-3 flex items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <Gauge className="h-3.5 w-3.5 shrink-0 text-accent-soft" />
            <span className="truncate text-xs font-medium text-slate-200">
              {group.label}
            </span>
          </div>
          {!compact && group.description ? (
            <p className="mt-1 line-clamp-2 text-[11px] text-slate-500">
              {group.description}
            </p>
          ) : null}
        </div>
        <Badge tone="accent">settings</Badge>
      </div>

      <div
        className={cn(
          'grid gap-3',
          compact ? 'grid-cols-1' : 'sm:grid-cols-2 xl:grid-cols-3',
        )}
      >
        {features.map((expose) => (
          <div
            key={expose.id || expose.property}
            className="rounded-xl border border-white/5 bg-black/20 p-2.5"
          >
            <div className="mb-2 flex items-center justify-between gap-2">
              <span className="truncate text-xs font-medium text-slate-300">
                {expose.label || expose.name || humanizeProperty(expose.property)}
              </span>
              {expose.unit ? <Badge>{expose.unit}</Badge> : null}
            </div>
            <ExposeValue
              expose={expose}
              value={resolveExposeValue(values, expose)}
              onSet={onSet}
            />
            {!compact && expose.description ? (
              <p className="mt-2 line-clamp-2 text-[11px] text-slate-500">
                {expose.description}
              </p>
            ) : null}
          </div>
        ))}
      </div>
    </div>
  );
}

function ExposeControl({
  expose,
  value,
  onSet,
  compact,
}: {
  expose: DeviceExpose;
  value: unknown;
  onSet?: (property: string, value: unknown) => Promise<void> | void;
  compact: boolean;
}) {
  const Icon = ICON_BY_PROPERTY[expose.property] ?? Gauge;
  const label = expose.label || expose.name || humanizeProperty(expose.property);

  return (
    <div
      className={cn(
        'rounded-2xl border border-white/5 bg-white/[0.03] p-3',
        compact && 'p-2.5',
      )}
    >
      <div className="mb-2 flex items-center justify-between gap-2">
        <div className="flex min-w-0 items-center gap-2">
          <Icon className="h-3.5 w-3.5 shrink-0 text-accent-soft" />
          <span className="truncate text-xs font-medium text-slate-300">{label}</span>
        </div>
        <div className="flex items-center gap-1">
          {expose.unit ? <Badge>{expose.unit}</Badge> : null}
          {expose.parentType && expose.parentType !== 'composite' ? (
            <Badge tone="accent">{expose.parentType}</Badge>
          ) : null}
        </div>
      </div>

      <ExposeValue expose={expose} value={value} onSet={onSet} />

      {!compact && expose.description ? (
        <p className="mt-2 line-clamp-2 text-[11px] text-slate-500">{expose.description}</p>
      ) : null}
    </div>
  );
}

function ExposeValue({
  expose,
  value,
  onSet,
}: {
  expose: DeviceExpose;
  value: unknown;
  onSet?: (property: string, value: unknown) => Promise<void> | void;
}) {
  const settable = (expose.access & ACCESS_SET) === ACCESS_SET;

  if (expose.type === 'binary') {
    return (
      <BinaryControl expose={expose} value={value} settable={settable} onSet={onSet} />
    );
  }
  if (expose.type === 'numeric') {
    return (
      <NumericControl expose={expose} value={value} settable={settable} onSet={onSet} />
    );
  }
  if (expose.type === 'enum') {
    return (
      <EnumControl expose={expose} value={value} settable={settable} onSet={onSet} />
    );
  }
  return <TextControl expose={expose} value={value} settable={settable} onSet={onSet} />;
}

function BinaryControl({
  expose,
  value,
  settable,
  onSet,
}: {
  expose: DeviceExpose;
  value: unknown;
  settable: boolean;
  onSet?: (property: string, value: unknown) => Promise<void> | void;
}) {
  const onValue = expose.valueOn ?? 'ON';
  const offValue = expose.valueOff ?? 'OFF';
  const text = String(value ?? '').toLowerCase();
  const isOn =
    value === onValue ||
    value === true ||
    value === 1 ||
    text === 'on' ||
    text === 'true' ||
    text === 'enable';

  if (!settable || !onSet) {
    return (
      <p className={cn('text-lg font-semibold', isOn ? 'text-success' : 'text-slate-400')}>
        {String(value ?? '—')}
      </p>
    );
  }

  return (
    <button
      type="button"
      className={cn(
        'relative h-8 w-14 rounded-full transition',
        isOn ? 'bg-accent' : 'bg-white/10',
      )}
      onClick={() => void onSet(expose.property, isOn ? offValue : onValue)}
      aria-label={`Toggle ${expose.property}`}
    >
      <span
        className={cn(
          'absolute top-1 h-6 w-6 rounded-full bg-white transition',
          isOn ? 'left-7' : 'left-1',
        )}
      />
    </button>
  );
}

function NumericControl({
  expose,
  value,
  settable,
  onSet,
}: {
  expose: DeviceExpose;
  value: unknown;
  settable: boolean;
  onSet?: (property: string, value: unknown) => Promise<void> | void;
}) {
  const numeric = typeof value === 'number' ? value : Number(value);
  const display = Number.isFinite(numeric) ? numeric : null;
  const [draft, setDraft] = useState(display ?? expose.valueMin ?? 0);

  if (!settable || !onSet) {
    return (
      <p className="text-lg font-semibold text-slate-50">
        {display === null ? '—' : display}
        {expose.unit ? (
          <span className="ml-1 text-sm font-normal text-slate-400">{expose.unit}</span>
        ) : null}
      </p>
    );
  }

  const min = expose.valueMin ?? 0;
  const max = expose.valueMax ?? 100;
  const step = expose.valueStep ?? 1;

  return (
    <div className="space-y-2">
      <div className="flex items-baseline justify-between">
        <span className="text-lg font-semibold text-slate-50">{draft}</span>
        <span className="text-xs text-slate-500">
          {min} – {max}
        </span>
      </div>
      <input
        type="range"
        className="w-full accent-indigo-500"
        min={min}
        max={max}
        step={step}
        value={draft}
        onChange={(event) => setDraft(Number(event.target.value))}
        onMouseUp={() => void onSet(expose.property, draft)}
        onTouchEnd={() => void onSet(expose.property, draft)}
      />
    </div>
  );
}

function EnumControl({
  expose,
  value,
  settable,
  onSet,
}: {
  expose: DeviceExpose;
  value: unknown;
  settable: boolean;
  onSet?: (property: string, value: unknown) => Promise<void> | void;
}) {
  const options = expose.values ?? [];

  if (!settable || !onSet) {
    return <p className="text-lg font-semibold text-slate-50">{String(value ?? '—')}</p>;
  }

  return (
    <select
      className="input"
      value={String(value ?? '')}
      onChange={(event) => void onSet(expose.property, event.target.value)}
    >
      <option value="" disabled>
        Select…
      </option>
      {options.map((option) => (
        <option key={String(option)} value={String(option)}>
          {String(option)}
        </option>
      ))}
    </select>
  );
}

function TextControl({
  expose,
  value,
  settable,
  onSet,
}: {
  expose: DeviceExpose;
  value: unknown;
  settable: boolean;
  onSet?: (property: string, value: unknown) => Promise<void> | void;
}) {
  const [draft, setDraft] = useState(String(value ?? ''));

  if (!settable || !onSet) {
    return (
      <p className="truncate font-mono text-sm text-slate-200">{String(value ?? '—')}</p>
    );
  }

  return (
    <form
      className="flex gap-2"
      onSubmit={(event) => {
        event.preventDefault();
        void onSet(expose.property, draft);
      }}
    >
      <input className="input" value={draft} onChange={(event) => setDraft(event.target.value)} />
      <button type="submit" className="btn-secondary">
        Set
      </button>
    </form>
  );
}

export function isGettable(access: number): boolean {
  return (access & ACCESS_GET) === ACCESS_GET;
}

export function isSettable(access: number): boolean {
  return (access & ACCESS_SET) === ACCESS_SET;
}
