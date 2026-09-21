import { useEffect, useState, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Power, Radar, RefreshCw, ShieldCheck, Zap } from 'lucide-react';
import { coordinatorApi, apiErrorMessage } from '@/lib/api';
import { formatRelative } from '@/lib/utils';
import { useLanguage } from '@/context/LanguageContext';
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
  const { t } = useLanguage();
  const queryClient = useQueryClient();
  const [syncSeconds, setSyncSeconds] = useState(120);
  const [syncMessage, setSyncMessage] = useState<string | null>(null);

  const { data, isLoading, error } = useQuery({
    queryKey: ['coordinator'],
    queryFn: coordinatorApi.get,
  });

  const discoveryQuery = useQuery({
    queryKey: ['discovery'],
    queryFn: coordinatorApi.discovery,
    refetchInterval: 10_000,
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

  const invalidate = () => {
    void queryClient.invalidateQueries({ queryKey: ['coordinator'] });
    void queryClient.invalidateQueries({ queryKey: ['discovery'] });
  };

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
    onSuccess: invalidate,
  });

  const permitJoin = useMutation({
    mutationFn: (value: boolean) => coordinatorApi.permitJoin(value, value ? 254 : undefined),
    onSuccess: invalidate,
  });

  const restart = useMutation({
    mutationFn: coordinatorApi.restart,
  });

  const setMode = useMutation({
    mutationFn: (mode: 'manual' | 'auto') => coordinatorApi.setDiscoveryMode(mode),
    onSuccess: () => {
      setSyncMessage(null);
      invalidate();
    },
    onError: (err) => setSyncMessage(apiErrorMessage(err)),
  });

  const manualSync = useMutation({
    mutationFn: () =>
      coordinatorApi.manualSync({
        durationSeconds: syncSeconds,
        interviewPending: true,
      }),
    onSuccess: (result) => {
      const interviewed = (result.interviewed as string[] | undefined)?.length ?? 0;
      setSyncMessage(
        `Manual sync started — join open ${result.permitJoinSeconds}s` +
          (interviewed ? `, re-interviewed ${interviewed} device(s)` : ''),
      );
      invalidate();
      void queryClient.invalidateQueries({ queryKey: ['devices'] });
    },
    onError: (err) => setSyncMessage(apiErrorMessage(err)),
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
        title={t('Coordinator unavailable')}
        description={error ? apiErrorMessage(error) : 'No data'}
      />
    );
  }

  const discovery = discoveryQuery.data;
  const isAuto = discovery?.pairingMode === 'auto' || data.pairingMode === 'auto';

  return (
    <div>
      <PageHeader
        title={t('Coordinator')}
        description={t('USB Zigbee coordinator detection and network settings')}
        actions={
          <>
            <button
              type="button"
              className={data.permitJoin ? 'btn-danger' : 'btn-primary'}
              onClick={() => permitJoin.mutate(!data.permitJoin)}
            >
              <ShieldCheck className="h-4 w-4" />
              {data.permitJoin ? t('Disable Permit Join') : t('Enable Permit Join')}
            </button>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => {
                if (confirm(t('Restart Zigbee2MQTT?'))) restart.mutate();
              }}
            >
              <Power className="h-4 w-4" /> {t('Restart bridge')}
            </button>
          </>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label={t('Bridge')}
          value={data.online ? t('Online') : t('Offline')}
          tone={data.online ? 'success' : 'danger'}
        />
        <StatCard
          label={t('Permit Join')}
          value={data.permitJoin ? t('Open') : t('Closed')}
          hint={
            data.permitJoinTimeout
              ? `${data.permitJoinTimeout}s remaining`
              : undefined
          }
          tone={data.permitJoin ? 'warning' : 'default'}
        />
        <StatCard
          label={t('Pairing mode')}
          value={isAuto ? t('Auto') : t('Manual')}
          hint={isAuto ? 'Nearby devices trigger a pair prompt' : 'Sync to open join'}
          tone={isAuto ? 'accent' : 'default'}
          icon={<Radar className="h-5 w-5" />}
        />
        <StatCard label={t('Channel')} value={data.channel ?? '—'} hint={data.firmwareVersion ?? undefined} />
      </div>

      <Card className="mb-6">
        <CardHeader
          title={t('Device discovery')}
          subtitle="Keep join open for nearby devices (auto) or open it only when you sync (manual). Either way you confirm each pair."
        />

        <div className="mb-4 grid gap-3 lg:grid-cols-2">
          <button
            type="button"
            className={`rounded-2xl border p-4 text-left transition ${
              isAuto
                ? 'border-accent/50 bg-accent/15'
                : 'border-ink/10 bg-ink/[0.02] hover:border-ink/20'
            }`}
            disabled={setMode.isPending}
            onClick={() => setMode.mutate('auto')}
          >
            <div className="mb-2 flex items-center gap-2">
              <Zap className="h-4 w-4 text-accent-soft" />
              <span className="font-medium text-slate-100">{t('Auto-pair (nearby)')}</span>
              {isAuto ? <Badge tone="accent">{t('Active')}</Badge> : null}
            </div>
            <p className="text-sm text-slate-400">
              Keep the Zigbee network open. When a device in pairing mode is within
              radio range, a prompt asks whether to pair it.
            </p>
          </button>

          <button
            type="button"
            className={`rounded-2xl border p-4 text-left transition ${
              !isAuto
                ? 'border-accent/50 bg-accent/15'
                : 'border-ink/10 bg-ink/[0.02] hover:border-ink/20'
            }`}
            disabled={setMode.isPending}
            onClick={() => setMode.mutate('manual')}
          >
            <div className="mb-2 flex items-center gap-2">
              <RefreshCw className="h-4 w-4 text-slate-300" />
              <span className="font-medium text-slate-100">{t('Manual sync')}</span>
              {!isAuto ? <Badge>{t('Active')}</Badge> : null}
            </div>
            <p className="text-sm text-slate-400">
              Safer for a stable network: the join window only opens when you press Sync.
            </p>
          </button>
        </div>

        <div className="flex flex-col gap-3 rounded-2xl border border-ink/5 bg-ink/[0.02] p-4 sm:flex-row sm:items-end">
          <label className="block flex-1">
            <span className="label">{t('Sync window (seconds)')}</span>
            <input
              className="input"
              type="number"
              min={1}
              max={254}
              value={syncSeconds}
              onChange={(event) => setSyncSeconds(Number(event.target.value) || 120)}
            />
          </label>
          <button
            type="button"
            className="btn-primary"
            disabled={manualSync.isPending}
            onClick={() => manualSync.mutate()}
          >
            {manualSync.isPending ? <Spinner /> : <Radar className="h-4 w-4" />}
            {t('Run Manual Sync')}
          </button>
        </div>

        <p className="mt-3 text-xs text-slate-500">
          Manual Sync opens permit join for the selected duration and re-interviews
          unfinished devices. Put sensors/plugs into pairing mode while the window is open.
          {discovery?.pendingInterviewCount
            ? ` · ${discovery.pendingInterviewCount} device(s) pending interview.`
            : ''}
          {discovery?.pendingPairingCount
            ? ` · ${discovery.pendingPairingCount} nearby device(s) waiting for Pair / Don't pair.`
            : ''}
          {discovery?.lastManualSyncAt
            ? ` · Last sync ${formatRelative(discovery.lastManualSyncAt)}.`
            : ''}
        </p>

        {syncMessage ? (
          <p
            className={`mt-3 rounded-xl px-3 py-2 text-sm ${
              manualSync.isError || setMode.isError
                ? 'bg-danger/10 text-danger'
                : 'bg-success/10 text-success'
            }`}
          >
            {syncMessage}
          </p>
        ) : null}
        {discovery?.description ? (
          <p className="mt-2 text-sm text-slate-400">{discovery.description}</p>
        ) : null}
      </Card>

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title={t('Coordinator Information')} />
          <dl className="grid gap-3 sm:grid-cols-2 text-sm">
            <Info label={t('IEEE Address')} value={data.ieeeAddress ?? '—'} />
            <Info label="PAN ID" value={data.panId ?? '—'} />
            <Info label={t('Extended PAN ID')} value={data.extendedPanId ?? '—'} />
            <Info label={t('Channel')} value={data.channel ?? '—'} />
            <Info label={t('Serial Port')} value={data.serialPort ?? '—'} />
            <Info label={t('Baud Rate')} value={data.baudRate ?? '—'} />
            <Info label={t('Adapter')} value={data.adapter ?? '—'} />
            <Info label="Hardware" value={data.hardwareLabel ?? '—'} />
            <Info label="Zigbee2MQTT" value={data.zigbee2mqttVersion ?? '—'} />
            <Info label={t('Firmware')} value={data.firmwareVersion ?? '—'} />
            <Info label={t('Last seen')} value={formatRelative(data.lastSeen)} />
            <Info label={t('Restart required')} value={data.restartRequired ? t('Yes') : t('No')} />
          </dl>
        </Card>

        <Card>
          <CardHeader
            title={t('Detected USB Ports')}
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
                <RefreshCw className="h-4 w-4" /> {t('Rescan')}
              </button>
            }
          />
          {data.detectedPorts.length === 0 ? (
            <EmptyState
              title={t('No serial ports found')}
              description="On Windows run Zigbee2MQTT natively and set the COM port below. Docker Desktop cannot pass COM ports through."
            />
          ) : (
            <ul className="space-y-2">
              {data.detectedPorts.map((port) => (
                <li
                  key={port.path}
                  className="flex items-start justify-between gap-3 rounded-xl border border-ink/5 bg-ink/[0.02] px-3 py-2"
                >
                  <div>
                    <p className="font-mono text-sm text-slate-100">{port.path}</p>
                    <p className="text-xs text-slate-500">
                      {port.label ?? port.manufacturer ?? t('Unknown device')}
                      {port.vendorId ? ` · ${port.vendorId}:${port.productId}` : ''}
                    </p>
                  </div>
                  <div className="flex flex-col items-end gap-1">
                    {port.isZigbeeCoordinator ? (
                      <Badge tone="success">{t('Coordinator')}</Badge>
                    ) : (
                      <Badge>{t('Other')}</Badge>
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
                      {t('Use')}
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader
            title={t('Configuration')}
            subtitle="Written to Zigbee2MQTT via bridge/request/options"
          />
          <form
            className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3"
            onSubmit={form.handleSubmit((values) => save.mutate(values))}
          >
            <Field label={t('Serial Port')}>
              <input className="input" {...form.register('serialPort')} placeholder="COM3 or /dev/ttyUSB0" />
            </Field>
            <Field label={t('Baud Rate')}>
              <input className="input" type="number" {...form.register('baudRate', { valueAsNumber: true })} />
            </Field>
            <Field label={t('Adapter')}>
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
            <Field label={`${t('Channel')} (11-26)`}>
              <input className="input" type="number" min={11} max={26} {...form.register('channel')} />
            </Field>
            <Field label={t('Extended PAN ID')}>
              <input className="input" {...form.register('extendedPanId')} placeholder="DDDDDDDDDDDDDDDD" />
            </Field>
            <Field label={t('Network Key')}>
              <input
                className="input"
                {...form.register('networkKey')}
                placeholder="leave blank to keep / GENERATE for random"
              />
            </Field>
            <Field label={t('Log Level')}>
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
                {t('Save settings')}
              </button>
              {save.isSuccess ? (
                <p className="text-sm text-success">
                  {t('Saved')}
                  {save.data?.warnings?.length
                    ? ` — ${(save.data.warnings as string[]).join(' · ')}`
                    : ''}
                </p>
              ) : null}
              {save.isError ? (
                <p className="text-sm text-danger">{apiErrorMessage(save.error)}</p>
              ) : null}
            </div>
          </form>
          <p className="mt-4 text-xs text-warning">
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
