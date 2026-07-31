import { useEffect, useMemo, useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import {
  Area,
  AreaChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import {
  ArrowLeft,
  BellRing,
  RefreshCw,
  Trash2,
  Wrench,
} from 'lucide-react';
import { devicesApi, historyApi, otaApi, coordinatorApi, apiErrorMessage } from '@/lib/api';
import { realtime } from '@/lib/realtime';
import { WS_EVENTS } from '@/lib/ws-events';
import {
  batteryColor,
  formatAbsolute,
  formatRelative,
  linkQualityInfo,
  prettyJson,
} from '@/lib/utils';
import type { HistoryRange } from '@/types';
import { ExposeRenderer } from '@/components/exposes/ExposeRenderer';
import { DeviceOnOffToggle } from '@/components/devices/DeviceOnOffToggle';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Spinner,
} from '@/components/ui/Card';

const RANGES: Array<{ id: HistoryRange; label: string }> = [
  { id: 'hour', label: 'Last Hour' },
  { id: 'today', label: 'Today' },
  { id: '24h', label: 'Last 24 Hours' },
  { id: '7d', label: 'Last 7 Days' },
  { id: '30d', label: 'Last 30 Days' },
];

export function DeviceDetailPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const [range, setRange] = useState<HistoryRange>('24h');
  const [chartProperty, setChartProperty] = useState<string | null>(null);
  const [rename, setRename] = useState('');
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const deviceQuery = useQuery({
    queryKey: ['device', id],
    queryFn: () => devicesApi.get(id),
    enabled: Boolean(id),
  });

  const discoveryQuery = useQuery({
    queryKey: ['discovery'],
    queryFn: () => coordinatorApi.discovery(),
    refetchInterval: 15_000,
  });

  const device = deviceQuery.data;
  const bridgeOnline = discoveryQuery.data?.bridgeOnline ?? true;

  useEffect(() => {
    if (!device?.ieeeAddress) return;
    realtime.subscribeDevice(device.ieeeAddress);
    const off = realtime.on(WS_EVENTS.DEVICE_TELEMETRY, (payload) => {
      const data = payload as { ieeeAddress?: string };
      if (data.ieeeAddress === device.ieeeAddress) {
        void queryClient.invalidateQueries({ queryKey: ['device', id] });
      }
    });
    return () => {
      realtime.unsubscribeDevice(device.ieeeAddress);
      off();
    };
  }, [device?.ieeeAddress, id, queryClient]);

  useEffect(() => {
    if (device) setRename(device.friendlyName);
  }, [device?.friendlyName]);

  const propertiesQuery = useQuery({
    queryKey: ['history-properties', device?.id],
    queryFn: () => historyApi.properties(device!.id),
    enabled: Boolean(device?.id),
  });

  useEffect(() => {
    const first = propertiesQuery.data?.[0]?.property;
    if (first && !chartProperty) setChartProperty(first);
  }, [propertiesQuery.data, chartProperty]);

  const seriesQuery = useQuery({
    queryKey: ['history-series', device?.id, chartProperty, range],
    queryFn: () => historyApi.series(device!.id, chartProperty!, range),
    enabled: Boolean(device?.id && chartProperty),
  });

  const setMutation = useMutation({
    mutationFn: ({ property, value }: { property: string; value: unknown }) =>
      devicesApi.set(id, { [property]: value }),
    onSuccess: () => setMessage('Command sent'),
    onError: (err) => setError(apiErrorMessage(err)),
  });

  const action = async (label: string, fn: () => Promise<unknown>) => {
    setMessage(null);
    setError(null);
    try {
      await fn();
      setMessage(`${label} succeeded`);
      void queryClient.invalidateQueries({ queryKey: ['device', id] });
    } catch (err) {
      setError(apiErrorMessage(err));
    }
  };

  const exposes = useMemo(() => device?.exposes ?? [], [device?.exposes]);
  const values = device?.lastPayload ?? {};
  const lqi = linkQualityInfo(device?.linkQuality);

  if (deviceQuery.isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!device) {
    return (
      <EmptyState
        title="Device not found"
        description="It may have left the network. Return to the device list."
      />
    );
  }

  return (
    <div>
      <button
        type="button"
        className="mb-4 inline-flex items-center gap-2 text-sm text-slate-400 hover:text-white"
        onClick={() => navigate('/devices')}
      >
        <ArrowLeft className="h-4 w-4" /> Back to devices
      </button>

      <PageHeader
        title={device.friendlyName}
        description={`${device.manufacturer ?? 'Unknown'} · ${device.model ?? '—'} · ${device.ieeeAddress}`}
        actions={
          <>
            <DeviceOnOffToggle device={device} />
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void action('Identify', () => devicesApi.identify(id))}
            >
              <BellRing className="h-4 w-4" /> Identify
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void action('Ping', () => devicesApi.ping(id))}
            >
              <RefreshCw className="h-4 w-4" /> Ping
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => void action('Reconfigure', () => devicesApi.configure(id))}
            >
              <Wrench className="h-4 w-4" /> Reconfigure
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                if (confirm(`Remove ${device.friendlyName} from the network?`)) {
                  void action('Remove', () => devicesApi.remove(id, true)).then(() =>
                    navigate('/devices'),
                  );
                }
              }}
            >
              <Trash2 className="h-4 w-4" /> Remove
            </button>
          </>
        }
      />

      {(message || error) && (
        <p
          className={`mb-4 rounded-xl px-3 py-2 text-sm ${
            error ? 'bg-danger/10 text-rose-300' : 'bg-success/10 text-emerald-300'
          }`}
        >
          {error ?? message}
        </p>
      )}

      {!bridgeOnline ? (
        <p className="mb-4 rounded-xl bg-amber-500/10 px-3 py-2 text-sm text-amber-200">
          Zigbee2MQTT bridge is offline — On/Off and config commands will not reach the device.
          Start Zigbee2MQTT (Windows: <code className="text-amber-100">zigbee2mqtt-windows/start.bat</code>),
          then retry.
        </p>
      ) : null}

      <div className="mb-6 grid gap-4 lg:grid-cols-[280px_1fr]">
        <Card className="flex flex-col items-center text-center">
          <div className="mb-4 flex h-36 w-36 items-center justify-center overflow-hidden rounded-3xl bg-white/5">
            {device.imageUrl ? (
              <img src={device.imageUrl} alt="" className="h-full w-full object-contain p-3" />
            ) : (
              <span className="text-sm text-slate-500">No image</span>
            )}
          </div>
          <div className="flex flex-wrap justify-center gap-1.5">
            <Badge tone={device.online ? 'success' : 'default'}>
              {device.online ? 'Online' : 'Offline'}
            </Badge>
            <Badge tone="accent">{device.type}</Badge>
            {device.supportsOta ? <Badge>OTA</Badge> : null}
          </div>
        </Card>

        <Card>
          <CardHeader title="General Information" />
          <dl className="grid gap-3 sm:grid-cols-2">
            <Info label="Friendly Name" value={device.friendlyName} />
            <Info label="IEEE Address" value={device.ieeeAddress} mono />
            <Info label="Network Address" value={device.networkAddress ?? '—'} />
            <Info label="Manufacturer" value={device.manufacturer ?? '—'} />
            <Info label="Model" value={device.model ?? '—'} />
            <Info label="Power Source" value={device.powerSource ?? '—'} />
            <Info label="Interview" value={device.interviewStatus} />
            <Info label="Last Seen" value={formatRelative(device.lastSeen)} />
            <Info
              label="Link Quality"
              value={
                <span className={lqi.color}>
                  {device.linkQuality ?? '—'} ({lqi.label})
                </span>
              }
            />
            <Info
              label="Battery"
              value={
                typeof device.battery === 'number' ? (
                  <span className={batteryColor(device.battery)}>{device.battery}%</span>
                ) : (
                  '—'
                )
              }
            />
            <Info label="Firmware" value={device.softwareBuildId ?? '—'} />
            <Info label="Description" value={device.description ?? '—'} />
          </dl>

          <form
            className="mt-5 flex flex-col gap-2 sm:flex-row"
            onSubmit={(event) => {
              event.preventDefault();
              void action('Rename', () => devicesApi.rename(id, rename));
            }}
          >
            <input
              className="input"
              value={rename}
              onChange={(event) => setRename(event.target.value)}
              aria-label="New friendly name"
            />
            <button type="submit" className="btn-primary shrink-0">
              Rename
            </button>
          </form>
        </Card>
      </div>

      <Card className="mb-6">
        <CardHeader
          title="Current values"
          subtitle="Sensors and controls from Zigbee2MQTT expose metadata"
          action={
            <Link
              to="/coordinator"
              className="text-xs text-slate-400 hover:text-white"
            >
              Bridge status
            </Link>
          }
        />
        <ExposeRenderer
          exposes={exposes}
          values={values}
          onSet={(property, value) => setMutation.mutateAsync({ property, value })}
        />
      </Card>

      <Card className="mb-6">
        <CardHeader
          title="Historical Data"
          subtitle="Selectable ranges with bucketed time series"
          action={
            <div className="flex flex-wrap gap-1">
              {RANGES.map((item) => (
                <button
                  key={item.id}
                  type="button"
                  className={`rounded-lg px-2.5 py-1 text-xs ${
                    range === item.id
                      ? 'bg-accent/20 text-white'
                      : 'text-slate-400 hover:bg-white/5'
                  }`}
                  onClick={() => setRange(item.id)}
                >
                  {item.label}
                </button>
              ))}
            </div>
          }
        />

        {(propertiesQuery.data?.length ?? 0) === 0 ? (
          <EmptyState title="No chartable history yet" description="Numeric readings will appear here." />
        ) : (
          <>
            <div className="mb-4 flex flex-wrap gap-2">
              {propertiesQuery.data!.map((item) => (
                <button
                  key={item.property}
                  type="button"
                  className={`rounded-full px-3 py-1 text-xs ${
                    chartProperty === item.property
                      ? 'bg-accent text-white'
                      : 'bg-white/5 text-slate-300'
                  }`}
                  onClick={() => setChartProperty(item.property)}
                >
                  {item.property}
                  {item.unit ? ` (${item.unit})` : ''}
                </button>
              ))}
            </div>
            <div className="h-72 w-full">
              {seriesQuery.isLoading ? (
                <div className="flex h-full items-center justify-center">
                  <Spinner />
                </div>
              ) : (
                <ResponsiveContainer width="100%" height="100%">
                  <AreaChart data={seriesQuery.data?.points ?? []}>
                    <defs>
                      <linearGradient id="fill" x1="0" y1="0" x2="0" y2="1">
                        <stop offset="0%" stopColor="#6366f1" stopOpacity={0.4} />
                        <stop offset="100%" stopColor="#6366f1" stopOpacity={0} />
                      </linearGradient>
                    </defs>
                    <CartesianGrid stroke="rgba(148,163,184,0.1)" vertical={false} />
                    <XAxis
                      dataKey="timestamp"
                      tickFormatter={(value) => formatAbsolute(value).slice(11, 16)}
                      stroke="#64748b"
                      fontSize={11}
                    />
                    <YAxis stroke="#64748b" fontSize={11} width={40} />
                    <Tooltip
                      contentStyle={{
                        background: '#0f172a',
                        border: '1px solid rgba(255,255,255,0.08)',
                        borderRadius: 12,
                      }}
                      labelFormatter={(value) => formatAbsolute(String(value))}
                    />
                    <Area
                      type="monotone"
                      dataKey="value"
                      stroke="#818cf8"
                      fill="url(#fill)"
                      strokeWidth={2}
                      dot={false}
                    />
                  </AreaChart>
                </ResponsiveContainer>
              )}
            </div>
          </>
        )}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Supported Exposes" subtitle={`${exposes.length} properties`} />
          <div className="max-h-80 overflow-y-auto scroll-thin">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="pb-2">Property</th>
                  <th className="pb-2">Type</th>
                  <th className="pb-2">Access</th>
                  <th className="pb-2">Unit</th>
                </tr>
              </thead>
              <tbody>
                {exposes.map((expose) => (
                  <tr key={expose.id} className="border-t border-white/5">
                    <td className="py-2 font-mono text-xs text-slate-200">{expose.property}</td>
                    <td className="py-2 text-slate-400">{expose.type}</td>
                    <td className="py-2 text-slate-400">{expose.access}</td>
                    <td className="py-2 text-slate-400">{expose.unit ?? '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader title="Raw MQTT Payload" subtitle="Last state message" />
          <pre className="max-h-80 overflow-auto rounded-xl bg-surface-950/80 p-3 font-mono text-xs text-slate-300 scroll-thin">
            {prettyJson(device.lastPayload ?? {})}
          </pre>
        </Card>

        <Card>
          <CardHeader title="Device Attributes" subtitle="Latest value per property" />
          <div className="max-h-80 overflow-y-auto scroll-thin">
            <table className="w-full text-left text-sm">
              <thead className="text-xs uppercase text-slate-500">
                <tr>
                  <th className="pb-2">Property</th>
                  <th className="pb-2">Value</th>
                  <th className="pb-2">Updated</th>
                </tr>
              </thead>
              <tbody>
                {(device.attributes ?? []).map((attribute) => (
                  <tr key={attribute.id} className="border-t border-white/5">
                    <td className="py-2 font-mono text-xs">{attribute.property}</td>
                    <td className="py-2 text-slate-300">{String(attribute.value)}</td>
                    <td className="py-2 text-xs text-slate-500">
                      {formatRelative(attribute.updatedAtSource)}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>

        <Card>
          <CardHeader
            title="OTA Firmware"
            subtitle={device.supportsOta ? 'Supported by this device' : 'Not advertised'}
            action={
              device.supportsOta ? (
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => void action('OTA check', () => otaApi.check(id))}
                  >
                    Check
                  </button>
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => {
                      if (confirm('Start firmware update? Do not power-cycle the device.')) {
                        void action('OTA update', () => otaApi.update(id));
                      }
                    }}
                  >
                    Update
                  </button>
                </div>
              ) : null
            }
          />
          <p className="text-sm text-slate-400">
            Current build: <span className="text-slate-200">{device.softwareBuildId ?? 'unknown'}</span>
          </p>
          <p className="mt-2 text-xs text-slate-500">
            Progress is pushed live over WebSocket while Zigbee2MQTT transfers the image.
          </p>
          <Link to="/settings" className="mt-3 inline-block text-xs text-accent-soft hover:underline">
            View OTA jobs in settings →
          </Link>
        </Card>
      </div>
    </div>
  );
}

function Info({
  label,
  value,
  mono,
}: {
  label: string;
  value: ReactNode;
  mono?: boolean;
}) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className={`mt-1 text-sm text-slate-100 ${mono ? 'font-mono text-xs' : ''}`}>{value}</dd>
    </div>
  );
}
