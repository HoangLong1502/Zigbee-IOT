/**
 * Dynamic expose renderer.
 *
 * The UI never hardcodes sensor names. Instead it walks the Zigbee2MQTT expose
 * metadata (type, access, unit, value_min/max, values, value_on/off) and picks
 * the right control for each property. A brand-new device therefore renders
 * correctly without a frontend change.
 */

import { useMemo, useState } from 'react';
import {
  Battery,
  Droplets,
  Flame,
  Gauge,
  Lightbulb,
  Power,
  Thermometer,
  Waves,
  Zap,
} from 'lucide-react';
import type { DeviceExpose } from '@/types';
import { cn, humanizeProperty } from '@/lib/utils';
import { Badge } from '@/components/ui/Card';

const ACCESS_SET = 0b010;
const ACCESS_GET = 0b100;

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
  const sorted = useMemo(
    () =>
      [...exposes].sort((a, b) => {
        // Sensors first, then controls, then diagnostics.
        const rank = (expose: DeviceExpose) => {
          if (expose.category === 'diagnostic') return 2;
          if (expose.category === 'config') return 1;
          return 0;
        };
        return rank(a) - rank(b) || a.property.localeCompare(b.property);
      }),
    [exposes],
  );

  if (sorted.length === 0) {
    return (
      <p className="text-sm text-slate-400">
        No exposes reported yet. Wait for the device interview to complete.
      </p>
    );
  }

  return (
    <div
      className={cn(
        compact
          ? 'grid grid-cols-2 gap-2 sm:grid-cols-3'
          : 'grid gap-3 sm:grid-cols-2 xl:grid-cols-3',
        className,
      )}
    >
      {sorted.map((expose) => (
        <ExposeControl
          key={`${expose.property}-${expose.endpoint ?? ''}`}
          expose={expose}
          value={values[expose.property]}
          onSet={onSet}
          compact={compact}
        />
      ))}
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
  const settable = (expose.access & ACCESS_SET) === ACCESS_SET;
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
          {expose.parentType ? <Badge tone="accent">{expose.parentType}</Badge> : null}
        </div>
      </div>

      {expose.type === 'binary' ? (
        <BinaryControl
          expose={expose}
          value={value}
          settable={settable}
          onSet={onSet}
        />
      ) : expose.type === 'numeric' ? (
        <NumericControl
          expose={expose}
          value={value}
          settable={settable}
          onSet={onSet}
        />
      ) : expose.type === 'enum' ? (
        <EnumControl
          expose={expose}
          value={value}
          settable={settable}
          onSet={onSet}
        />
      ) : (
        <TextControl
          expose={expose}
          value={value}
          settable={settable}
          onSet={onSet}
        />
      )}

      {!compact && expose.description ? (
        <p className="mt-2 line-clamp-2 text-[11px] text-slate-500">{expose.description}</p>
      ) : null}
    </div>
  );
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
  const isOn =
    value === onValue ||
    value === true ||
    value === 1 ||
    String(value).toLowerCase() === 'on' ||
    String(value).toLowerCase() === 'true';

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
