import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Power } from 'lucide-react';
import { devicesApi, apiErrorMessage } from '@/lib/api';
import { cn } from '@/lib/utils';
import type { Device, DeviceExpose } from '@/types';

const ACCESS_SET = 0b010;

/** Primary power channels: `state`, `state_l1`, `state_l2`, … */
const POWER_PROPERTY = /^state(_l\d+)?$/i;

export interface SwitchChannel {
  property: string;
  label: string;
  valueOn: string | boolean | number;
  valueOff: string | boolean | number;
  current: unknown;
  isOn: boolean;
}

/**
 * Finds settable on/off channels on a device.
 *
 * Prefers Zigbee2MQTT expose metadata (binary `state` / `state_l1` / …).
 * Falls back to the last MQTT payload when exposes are not loaded yet
 * (e.g. on the devices list page).
 */
export function getSwitchChannels(
  device: Pick<Device, 'lastPayload' | 'exposes' | 'exposesRaw'>,
  exposes?: DeviceExpose[],
): SwitchChannel[] {
  const payload = device.lastPayload ?? {};
  const list = exposes ?? device.exposes ?? [];

  const fromExposes = list.filter(
    (expose) =>
      expose.type === 'binary' &&
      (expose.access & ACCESS_SET) === ACCESS_SET &&
      POWER_PROPERTY.test(expose.property),
  );

  if (fromExposes.length > 0) {
    const byProperty = new Map<string, DeviceExpose>();
    for (const expose of fromExposes) {
      // Prefer switch/light parent when the same property was stored twice.
      const existing = byProperty.get(expose.property);
      if (
        !existing ||
        (expose.parentType === 'switch' || expose.parentType === 'light') ||
        (expose.access ?? 0) > (existing.access ?? 0)
      ) {
        byProperty.set(expose.property, expose);
      }
    }

    return [...byProperty.values()].map((expose) => {
      const valueOn = (expose.valueOn as string | boolean | number | null) ?? 'ON';
      const valueOff = (expose.valueOff as string | boolean | number | null) ?? 'OFF';
      const current = payload[expose.property];
      return {
        property: expose.property,
        label:
          expose.label ||
          expose.name ||
          (expose.property === 'state' ? 'Power' : expose.property.replace(/_/g, ' ')),
        valueOn,
        valueOff,
        current,
        isOn: isOnValue(current, valueOn),
      };
    });
  }

  // Payload fallback for list view (exposes not joined).
  return Object.keys(payload)
    .filter((key) => POWER_PROPERTY.test(key))
    .map((property) => {
      const current = payload[property];
      return {
        property,
        label: property === 'state' ? 'Power' : property.replace(/_/g, ' '),
        valueOn: 'ON',
        valueOff: 'OFF',
        current,
        isOn: isOnValue(current, 'ON'),
      };
    });
}

function isOnValue(value: unknown, valueOn: unknown): boolean {
  if (value === valueOn) return true;
  if (value === true || value === 1) return true;
  const text = String(value ?? '').toLowerCase();
  return text === 'on' || text === 'true' || text === '1' || text === 'open';
}

interface DeviceOnOffToggleProps {
  device: Device;
  /** Limit to one channel (default: all state* channels). */
  property?: string;
  size?: 'sm' | 'md';
  className?: string;
}

/**
 * Quick On/Off control for plugs, switches and lights that expose a settable
 * `state` (or `state_l1` …) property via Zigbee2MQTT.
 */
export function DeviceOnOffToggle({
  device,
  property,
  size = 'md',
  className,
}: DeviceOnOffToggleProps) {
  const queryClient = useQueryClient();
  const channels = getSwitchChannels(device).filter((channel) =>
    property ? channel.property === property : true,
  );

  const mutation = useMutation({
    mutationFn: ({ prop, value }: { prop: string; value: unknown }) =>
      devicesApi.set(device.ieeeAddress || device.id, { [prop]: value }),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
      void queryClient.invalidateQueries({ queryKey: ['device'] });
      void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
    },
  });

  if (channels.length === 0) return null;

  return (
    <div
      className={cn('flex flex-wrap items-center gap-2', className)}
      onClick={(event) => event.preventDefault()}
      onKeyDown={(event) => event.stopPropagation()}
    >
      {channels.map((channel) => (
        <button
          key={channel.property}
          type="button"
          title={`${channel.label}: ${channel.isOn ? 'ON' : 'OFF'} (click to toggle)`}
          disabled={mutation.isPending || !device.online}
          aria-pressed={channel.isOn}
          className={cn(
            'inline-flex items-center gap-1.5 rounded-full font-medium transition',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent/60',
            'disabled:cursor-not-allowed disabled:opacity-40',
            size === 'sm' ? 'px-2.5 py-1 text-[11px]' : 'px-3 py-1.5 text-xs',
            channel.isOn
              ? 'bg-emerald-500/20 text-emerald-300 hover:bg-emerald-500/30'
              : 'bg-white/10 text-slate-300 hover:bg-white/15',
          )}
          onClick={(event) => {
            event.preventDefault();
            event.stopPropagation();
            const next = channel.isOn ? channel.valueOff : channel.valueOn;
            mutation.mutate({ prop: channel.property, value: next });
          }}
        >
          <Power
            className={cn(
              size === 'sm' ? 'h-3 w-3' : 'h-3.5 w-3.5',
              channel.isOn ? 'text-emerald-300' : 'text-slate-400',
            )}
          />
          {channels.length === 1
            ? channel.isOn
              ? 'ON'
              : 'OFF'
            : `${channel.label}: ${channel.isOn ? 'ON' : 'OFF'}`}
        </button>
      ))}
      {mutation.isError ? (
        <span className="text-[10px] text-rose-300">{apiErrorMessage(mutation.error)}</span>
      ) : null}
    </div>
  );
}
