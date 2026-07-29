import { useEffect, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Power, RefreshCw, ShieldCheck } from 'lucide-react';
import { coordinatorApi, apiErrorMessage } from '@/lib/api';
import { formatRelative } from '@/lib/utils';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Spinner,
  StatCard,
} from '@/components/ui/Card';

interface FormValues {
  serialPort: string;
  baudRate: number;
  adapter: string;
  panId: number | '';
  channel: number | '';
  extendedPanId: string;
  networkKey: string;
  logLevel: string;
}

export function CoordinatorPage() {
  const queryClient = useQueryClient();
  const { data, isLoading, error } = useQuery({
    queryKey: ['coordinator'],
    queryFn: coordinatorApi.get,
  });

  const form = useForm<FormValues>({
    defaultValues: {
      serialPort: '',
      baudRate: 115200,
      adapter: 'zstack',
      panId: '',
      channel: '',
      extendedPanId: '',
      networkKey: '',
      logLevel: 'info',
    },
  });

  useEffect(() => {
    if (!data) return;
    form.reset({
      serialPort: data.serialPort ?? '',
      baudRate: data.baudRate ?? 115200,
      adapter: data.adapter ?? 'zstack',
      panId: data.panId ?? '',
      channel: data.channel ?? '',
      extendedPanId: data.extendedPanId ?? '',
      networkKey: '',
      logLevel: data.logLevel ?? 'info',
    });
  }, [data, form]);

  const save = useMutation({
    mutationFn: (values: FormValues) =>
      coordinatorApi.update({
        serialPort: values.serialPort || undefined,
        baudRate: Number(values.baudRate) || undefined,
        adapter: values.adapter || undefined,
        panId: values.panId === '' ? undefined : Number(values.panId),
        channel: values.channel === '' ? undefined : Number(values.channel),
        extendedPanId: values.extendedPanId || undefined,
        networkKey: values.networkKey || undefined,
        logLevel: values.logLevel || undefined,
      }),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['coordinator'] }),
  });

  const permitJoin = useMutation({
    mutationFn: (value: boolean) => coordinatorApi.permitJoin(value, value ? 254 : undefined),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['coordinator'] }),
  });

  const restart = useMutation({
    mutationFn: coordinatorApi.restart,
  });

  if (isLoading) {
    return (
      <div className="flex h-64 items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <EmptyState
        title="Coordinator unavailable"
        description={error ? apiErrorMessage(error) : 'No data'}
      />
    );
  }

  return (
    <div>
      <PageHeader
        title="Coordinator"
        description="USB Zigbee coordinator detection and network settings"
        actions={
          <>
            <button
              type="button"
              className={data.permitJoin ? 'btn-danger' : 'btn-primary'}
              onClick={() => permitJoin.mutate(!data.permitJoin)}
            >
              <ShieldCheck className="h-4 w-4" />
              {data.permitJoin ? 'Disable Permit Join' : 'Enable Permit Join'}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                if (confirm('Restart Zigbee2MQTT?')) restart.mutate();
              }}
            >
              <Power className="h-4 w-4" /> Restart bridge
            </button>
          </>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Bridge"
          value={data.online ? 'Online' : 'Offline'}
          tone={data.online ? 'success' : 'danger'}
        />
        <StatCard
          label="Permit Join"
          value={data.permitJoin ? 'Open' : 'Closed'}
          hint={
            data.permitJoinTimeout
              ? `${data.permitJoinTimeout}s remaining`
              : undefined
          }
          tone={data.permitJoin ? 'warning' : 'default'}
        />
        <StatCard label="Channel" value={data.channel ?? '—'} />
        <StatCard label="Firmware" value={data.firmwareVersion ?? '—'} hint={data.coordinatorType ?? undefined} />
      </div>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Coordinator Information" />
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <Info label="IEEE Address" value={data.ieeeAddress ?? '—'} />
            <Info label="PAN ID" value={data.panId ?? '—'} />
            <Info label="Extended PAN ID" value={data.extendedPanId ?? '—'} />
            <Info label="Channel" value={data.channel ?? '—'} />
            <Info label="Serial Port" value={data.serialPort ?? '—'} />
            <Info label="Baud Rate" value={data.baudRate ?? '—'} />
            <Info label="Adapter" value={data.adapter ?? '—'} />
            <Info label="Hardware" value={data.hardwareLabel ?? '—'} />
            <Info label="Zigbee2MQTT" value={data.zigbee2mqttVersion ?? '—'} />
            <Info label="Firmware" value={data.firmwareVersion ?? '—'} />
            <Info label="Last seen" value={formatRelative(data.lastSeen)} />
            <Info
              label="Restart required"
              value={data.restartRequired ? 'Yes' : 'No'}
            />
          </dl>
        </Card>

        <Card>
          <CardHeader
            title="Detected USB Ports"
            subtitle={
              data.detectionAvailable
                ? 'Auto-detected Zigbee coordinators are highlighted'
                : data.detectionUnavailableReason ?? 'Detection unavailable'
            }
            action={
              <button
                type="button"
                className="btn-secondary"
                onClick={() => void queryClient.invalidateQueries({ queryKey: ['coordinator'] })}
              >
                <RefreshCw className="h-4 w-4" /> Rescan
              </button>
            }
          />
          {data.detectedPorts.length === 0 ? (
            <EmptyState
              title="No serial ports found"
              description="On Windows run Zigbee2MQTT natively and set the COM port below. Docker Desktop cannot pass COM ports through."
            />
          ) : (
            <ul className="space-y-2">
              {data.detectedPorts.map((port) => (
                <li
                  key={port.path}
                  className="flex items-start justify-between gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2"
                >
                  <div>
                    <p className="font-mono text-sm text-slate-100">{port.path}</p>
                    <p className="text-xs text-slate-500">
                      {port.label ?? port.manufacturer ?? 'Unknown device'}
                      {port.vendorId ? ` · ${port.vendorId}:${port.productId}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {port.isZigbeeCoordinator ? (
                      <Badge tone="success">Coordinator</Badge>
                    ) : (
                      <Badge>Other</Badge>
                    )}
                    <button
                      type="button"
                      className="text-xs text-accent-soft hover:underline"
                      onClick={() => {
                        form.setValue('serialPort', port.path);
                        if (port.suggestedAdapter) form.setValue('adapter', port.suggestedAdapter);
                        if (port.suggestedBaudRate) form.setValue('baudRate', port.suggestedBaudRate);
                      }}
                    >
                      Use
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader
            title="Configuration"
            subtitle="Written to Zigbee2MQTT via bridge/request/options"
          />
          <form
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={form.handleSubmit((values) => save.mutate(values))}
          >
            <Field label="Serial Port">
              <input className="input" {...form.register('serialPort')} placeholder="COM3 or /dev/ttyUSB0" />
            </Field>
            <Field label="Baud Rate">
              <input className="input" type="number" {...form.register('baudRate', { valueAsNumber: true })} />
            </Field>
            <Field label="Adapter">
              <select className="input" {...form.register('adapter')}>
                <option value="zstack">zstack (CC2652P)</option>
                <option value="ember">ember (EFR32MG21)</option>
                <option value="deconz">deconz (ConBee)</option>
                <option value="zigate">zigate</option>
                <option value="auto">auto</option>
              </select>
            </Field>
            <Field label="PAN ID">
              <input className="input" type="number" {...form.register('panId')} />
            </Field>
            <Field label="Channel (11-26)">
              <input className="input" type="number" min={11} max={26} {...form.register('channel')} />
            </Field>
            <Field label="Extended PAN ID">
              <input className="input" {...form.register('extendedPanId')} placeholder="DDDDDDDDDDDDDDDD" />
            </Field>
            <Field label="Network Key">
              <input
                className="input"
                {...form.register('networkKey')}
                placeholder="leave blank to keep / GENERATE for random"
              />
            </Field>
            <Field label="Log Level">
              <select className="input" {...form.register('logLevel')}>
                <option value="debug">debug</option>
                <option value="info">info</option>
                <option value="warning">warning</option>
                <option value="error">error</option>
              </select>
            </Field>

            <div className="flex items-end gap-2 sm:col-span-2 lg:col-span-3">
              <button type="submit" className="btn-primary" disabled={save.isPending}>
                {save.isPending ? <Spinner /> : null}
                Save settings
              </button>
              {save.isSuccess ? (
                <p className="text-sm text-emerald-300">
                  Saved
                  {save.data?.warnings?.length
                    ? ` — ${(save.data.warnings as string[]).join(' · ')}`
                    : ''}
                </p>
              ) : null}
              {save.isError ? (
                <p className="text-sm text-rose-300">{apiErrorMessage(save.error)}</p>
              ) : null}
            </div>
          </form>
          <p className="mt-4 text-xs text-amber-300/90">
            Changing PAN ID, channel or network key creates a new Zigbee network — every
            device must be paired again. Serial changes require a Zigbee2MQTT restart.
          </p>
        </Card>
      </div>
    </div>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="block">
      <span className="label">{label}</span>
      {children}
    </label>
  );
}

function Info({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div>
      <dt className="text-xs uppercase tracking-wide text-slate-500">{label}</dt>
      <dd className="mt-1 font-mono text-xs text-slate-100">{value}</dd>
    </div>
  );
}
