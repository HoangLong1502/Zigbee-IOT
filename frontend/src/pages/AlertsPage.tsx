import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCheck } from 'lucide-react';
import { alertsApi, apiErrorMessage } from '@/lib/api';
import { formatRelative } from '@/lib/utils';
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Spinner,
  StatCard,
} from '@/components/ui/Card';

export function AlertsPage() {
  const queryClient = useQueryClient();

  const listQuery = useQuery({
    queryKey: ['alerts'],
    queryFn: () => alertsApi.list({ limit: 200 }),
  });

  const summaryQuery = useQuery({
    queryKey: ['alerts-summary'],
    queryFn: alertsApi.summary,
  });

  const acknowledge = useMutation({
    mutationFn: (id: string) => alertsApi.acknowledge(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      void queryClient.invalidateQueries({ queryKey: ['alerts-summary'] });
    },
  });

  const resolve = useMutation({
    mutationFn: (id: string) => alertsApi.resolve(id),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      void queryClient.invalidateQueries({ queryKey: ['alerts-summary'] });
    },
  });

  const acknowledgeAll = useMutation({
    mutationFn: alertsApi.acknowledgeAll,
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      void queryClient.invalidateQueries({ queryKey: ['alerts-summary'] });
    },
  });

  const summary = summaryQuery.data;
  const items = listQuery.data?.items ?? [];

  return (
    <div>
      <PageHeader
        title="Alerts"
        description="Low battery, offline devices, water leak, smoke and more"
        actions={
          <button
            type="button"
            className="btn-secondary"
            onClick={() => {
              if ('Notification' in window && Notification.permission === 'default') {
                void Notification.requestPermission();
              }
              acknowledgeAll.mutate();
            }}
          >
            <CheckCheck className="h-4 w-4" /> Acknowledge all
          </button>
        }
      />

      <div className="mb-6 grid gap-3 sm:grid-cols-4">
        <StatCard label="Active" value={summary?.active ?? 0} tone="warning" />
        <StatCard label="Critical" value={summary?.critical ?? 0} tone="danger" />
        <StatCard label="Warning" value={summary?.warning ?? 0} />
        <StatCard label="Unacknowledged" value={summary?.unacknowledged ?? 0} tone="accent" />
      </div>

      {listQuery.isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      ) : items.length === 0 ? (
        <EmptyState title="No alerts" description="Everything looks calm." />
      ) : (
        <div className="space-y-3">
          {items.map((alert) => (
            <Card key={alert.id} className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="min-w-0">
                <div className="mb-1 flex flex-wrap items-center gap-2">
                  <Badge
                    tone={
                      alert.severity === 'critical'
                        ? 'danger'
                        : alert.severity === 'warning'
                          ? 'warning'
                          : 'default'
                    }
                  >
                    {alert.severity}
                  </Badge>
                  <Badge>{alert.type}</Badge>
                  {alert.resolved ? <Badge tone="success">resolved</Badge> : null}
                  {!alert.acknowledged && !alert.resolved ? (
                    <Badge tone="accent">new</Badge>
                  ) : null}
                </div>
                <p className="text-sm text-slate-100">{alert.message}</p>
                <p className="mt-1 text-xs text-slate-500">
                  {alert.friendlyName ?? 'System'} · {alert.occurrences}× · last{' '}
                  {formatRelative(alert.lastOccurredAt)}
                </p>
              </div>
              <div className="flex shrink-0 gap-2">
                {!alert.acknowledged ? (
                  <button
                    type="button"
                    className="btn-secondary"
                    onClick={() => acknowledge.mutate(alert.id)}
                  >
                    Acknowledge
                  </button>
                ) : null}
                {!alert.resolved ? (
                  <button
                    type="button"
                    className="btn-primary"
                    onClick={() => resolve.mutate(alert.id)}
                  >
                    Resolve
                  </button>
                ) : null}
              </div>
            </Card>
          ))}
        </div>
      )}

      {listQuery.isError ? (
        <p className="mt-3 text-sm text-rose-300">{apiErrorMessage(listQuery.error)}</p>
      ) : null}
    </div>
  );
}
