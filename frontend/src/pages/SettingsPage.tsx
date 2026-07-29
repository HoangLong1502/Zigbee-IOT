import { useEffect, type ReactNode } from 'react';
import { useForm } from 'react-hook-form';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { otaApi, settingsApi, apiErrorMessage } from '@/lib/api';
import { formatRelative } from '@/lib/utils';
import {
  Badge,
  Card,
  CardHeader,
  EmptyState,
  PageHeader,
  Spinner,
} from '@/components/ui/Card';

interface ThresholdForm {
  lowBatteryPercent: number;
  highTemperatureC: number;
}

export function SettingsPage() {
  const queryClient = useQueryClient();
  const settingsQuery = useQuery({ queryKey: ['settings'], queryFn: settingsApi.get });
  const otaQuery = useQuery({ queryKey: ['ota'], queryFn: otaApi.jobs });

  const form = useForm<ThresholdForm>({
    defaultValues: { lowBatteryPercent: 20, highTemperatureC: 40 },
  });

  useEffect(() => {
    if (settingsQuery.data?.alerts) {
      form.reset({
        lowBatteryPercent: settingsQuery.data.alerts.lowBatteryPercent,
        highTemperatureC: settingsQuery.data.alerts.highTemperatureC,
      });
    }
  }, [settingsQuery.data, form]);

  const save = useMutation({
    mutationFn: (values: ThresholdForm) => settingsApi.updateThresholds(values),
    onSuccess: () => void queryClient.invalidateQueries({ queryKey: ['settings'] }),
  });

  const settings = settingsQuery.data;

  return (
    <div>
      <PageHeader
        title="Settings"
        description="Alert thresholds, MQTT identity and OTA job history"
      />

      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Alert Thresholds" />
          {settingsQuery.isLoading ? (
            <Spinner />
          ) : (
            <form
              className="space-y-4"
              onSubmit={form.handleSubmit((values) => save.mutate(values))}
            >
              <label className="block">
                <span className="label">Low battery percent</span>
                <input
                  className="input"
                  type="number"
                  min={1}
                  max={100}
                  {...form.register('lowBatteryPercent', { valueAsNumber: true })}
                />
              </label>
              <label className="block">
                <span className="label">High temperature (°C)</span>
                <input
                  className="input"
                  type="number"
                  {...form.register('highTemperatureC', { valueAsNumber: true })}
                />
              </label>
              <button type="submit" className="btn-primary" disabled={save.isPending}>
                {save.isPending ? <Spinner /> : null}
                Save thresholds
              </button>
              {save.isError ? (
                <p className="text-sm text-rose-300">{apiErrorMessage(save.error)}</p>
              ) : null}
              {save.isSuccess ? (
                <p className="text-sm text-emerald-300">Thresholds updated for this process</p>
              ) : null}
            </form>
          )}
        </Card>

        <Card>
          <CardHeader title="Platform" />
          {settings ? (
            <dl className="space-y-3 text-sm">
              <Row label="Version" value={settings.version} />
              <Row label="MQTT URL" value={settings.mqtt?.url} />
              <Row label="Base topic" value={settings.mqtt?.baseTopic} />
              <Row label="Client ID" value={settings.mqtt?.clientId} />
              <Row
                label="Auth"
                value={settings.authEnabled ? 'Enabled' : 'Disabled'}
              />
              <Row
                label="History retention"
                value={`${settings.retention?.historyRetentionDays ?? '—'} days`}
              />
              <Row
                label="MQTT log retention"
                value={`${settings.retention?.mqttLogRetentionHours ?? '—'} hours`}
              />
              <Row
                label="Offline timeout"
                value={`${settings.retention?.deviceOfflineTimeoutMinutes ?? '—'} minutes`}
              />
            </dl>
          ) : (
            <Spinner />
          )}
        </Card>

        <Card className="xl:col-span-2">
          <CardHeader title="OTA Jobs" subtitle="Firmware update history" />
          {(otaQuery.data?.length ?? 0) === 0 ? (
            <EmptyState title="No OTA jobs yet" />
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-left text-sm">
                <thead className="text-xs uppercase text-slate-500">
                  <tr>
                    <th className="pb-2">Device</th>
                    <th className="pb-2">Status</th>
                    <th className="pb-2">Progress</th>
                    <th className="pb-2">Versions</th>
                    <th className="pb-2">Started</th>
                  </tr>
                </thead>
                <tbody>
                  {otaQuery.data!.map((job) => (
                    <tr key={job.id} className="border-t border-white/5">
                      <td className="py-2">{job.friendlyName}</td>
                      <td className="py-2">
                        <Badge
                          tone={
                            job.status === 'failed'
                              ? 'danger'
                              : job.status === 'completed'
                                ? 'success'
                                : 'accent'
                          }
                        >
                          {job.status}
                        </Badge>
                      </td>
                      <td className="py-2">{Math.round(job.progress)}%</td>
                      <td className="py-2 font-mono text-xs text-slate-400">
                        {job.currentVersion ?? '—'} → {job.targetVersion ?? '—'}
                      </td>
                      <td className="py-2 text-xs text-slate-500">
                        {formatRelative(job.startedAt ?? job.createdAt)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Card>
      </div>
    </div>
  );
}

function Row({ label, value }: { label: string; value: ReactNode }) {
  return (
    <div className="flex items-start justify-between gap-4 border-b border-white/5 pb-2">
      <dt className="text-slate-400">{label}</dt>
      <dd className="text-right font-mono text-xs text-slate-100">{value}</dd>
    </div>
  );
}
