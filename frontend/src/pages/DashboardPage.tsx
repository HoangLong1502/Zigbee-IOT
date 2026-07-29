import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Battery,
  Cpu,
  Radio,
  Wifi,
  WifiOff,
} from 'lucide-react';
import { motion } from 'framer-motion';
import { dashboardApi } from '@/lib/api';
import { formatRelative, humanizeProperty, linkQualityInfo } from '@/lib/utils';
import { Badge, Card, CardHeader, EmptyState, PageHeader, Spinner, StatCard } from '@/components/ui/Card';

export function DashboardPage() {
  const { data, isLoading, error } = useQuery({
    queryKey: ['dashboard'],
    queryFn: dashboardApi.summary,
    refetchInterval: 30_000,
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
        title="Dashboard unavailable"
        description="Is the NestJS backend running and connected to PostgreSQL?"
      />
    );
  }

  const { stats, coordinator, mqtt, alerts, recentEvents, latestReadings } = data;

  return (
    <div>
      <PageHeader
        title="Dashboard"
        description="Live overview of your Zigbee network"
      />

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Total Devices"
          value={stats.total}
          hint={`${stats.routers} routers · ${stats.endDevices} end devices`}
          icon={<Cpu className="h-5 w-5" />}
          tone="accent"
        />
        <StatCard
          label="Online"
          value={stats.online}
          hint={`${stats.offline} offline`}
          icon={<Wifi className="h-5 w-5" />}
          tone="success"
        />
        <StatCard
          label="Coordinator"
          value={coordinator.online ? 'Online' : 'Offline'}
          hint={
            coordinator.permitJoin
              ? 'Permit join OPEN'
              : `Ch ${coordinator.channel ?? '—'} · PAN ${coordinator.panId ?? '—'}`
          }
          icon={<Radio className="h-5 w-5" />}
          tone={coordinator.online ? 'success' : 'danger'}
        />
        <StatCard
          label="MQTT"
          value={mqtt.connected ? 'Connected' : 'Down'}
          hint={`${stats.messagesLastHour} msgs / last hour`}
          icon={mqtt.connected ? <Activity className="h-5 w-5" /> : <WifiOff className="h-5 w-5" />}
          tone={mqtt.connected ? 'success' : 'danger'}
        />
      </div>

      <div className="mt-4 grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          label="Network Health"
          value={`${stats.networkHealth}%`}
          hint={`Avg LQI ${stats.averageLinkQuality}`}
          tone={stats.networkHealth >= 70 ? 'success' : stats.networkHealth >= 40 ? 'warning' : 'danger'}
        />
        <StatCard
          label="Low Battery"
          value={stats.lowBattery}
          icon={<Battery className="h-5 w-5" />}
          tone={stats.lowBattery > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Active Alerts"
          value={alerts.active}
          hint={`${alerts.critical} critical · ${alerts.unacknowledged} unread`}
          icon={<AlertTriangle className="h-5 w-5" />}
          tone={alerts.critical > 0 ? 'danger' : alerts.active > 0 ? 'warning' : 'default'}
        />
        <StatCard
          label="Battery Devices"
          value={stats.batteryPowered}
          hint={`${stats.unsupported} unsupported`}
        />
      </div>

      <div className="mt-6 grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader
            title="Latest Sensor Readings"
            subtitle="Online devices with a recent payload"
            action={
              <Link to="/devices" className="text-xs text-accent-soft hover:underline">
                View all
              </Link>
            }
          />
          {latestReadings.length === 0 ? (
            <EmptyState
              title="No readings yet"
              description="Pair a device and open permit join to start receiving data."
            />
          ) : (
            <div className="space-y-3">
              {latestReadings.map((reading, index) => {
                const lqi = linkQualityInfo(reading.linkQuality);
                const preview = Object.entries(reading.payload ?? {})
                  .filter(([key]) => !['linkquality', 'last_seen', 'device', 'elapsed'].includes(key))
                  .slice(0, 4);

                return (
                  <motion.div
                    key={reading.id}
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    transition={{ delay: index * 0.03 }}
                  >
                    <Link
                      to={`/devices/${encodeURIComponent(reading.ieeeAddress)}`}
                      className="block rounded-2xl border border-white/5 bg-white/[0.02] p-3 transition hover:border-accent/30 hover:bg-white/[0.04]"
                    >
                      <div className="flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <p className="truncate font-medium text-slate-100">
                            {reading.friendlyName}
                          </p>
                          <p className="truncate text-xs text-slate-500">
                            {reading.model ?? 'Unknown model'} · {formatRelative(reading.lastSeen)}
                          </p>
                        </div>
                        <div className="flex shrink-0 items-center gap-2">
                          {typeof reading.battery === 'number' ? (
                            <Badge tone={reading.battery <= 20 ? 'danger' : 'success'}>
                              {reading.battery}%
                            </Badge>
                          ) : null}
                          <Badge tone={lqi.percent >= 40 ? 'success' : 'warning'}>
                            LQI {reading.linkQuality ?? '—'}
                          </Badge>
                        </div>
                      </div>
                      {preview.length > 0 ? (
                        <div className="mt-2 flex flex-wrap gap-2">
                          {preview.map(([key, value]) => (
                            <span
                              key={key}
                              className="rounded-lg bg-surface-950/60 px-2 py-1 font-mono text-[11px] text-slate-300"
                            >
                              {humanizeProperty(key)}:{' '}
                              <span className="text-slate-100">{String(value)}</span>
                            </span>
                          ))}
                        </div>
                      ) : null}
                    </Link>
                  </motion.div>
                );
              })}
            </div>
          )}
        </Card>

        <Card>
          <CardHeader
            title="Recent Events"
            subtitle="Joins, leaves, interviews and bridge logs"
            action={
              <Link to="/alerts" className="text-xs text-accent-soft hover:underline">
                Alerts
              </Link>
            }
          />
          {recentEvents.length === 0 ? (
            <EmptyState title="No events yet" />
          ) : (
            <ul className="max-h-[32rem] space-y-2 overflow-y-auto scroll-thin pr-1">
              {recentEvents.map((event) => (
                <li
                  key={event.id}
                  className="flex gap-3 rounded-xl border border-white/5 bg-white/[0.02] px-3 py-2.5"
                >
                  <SeverityDot severity={event.severity} />
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-sm text-slate-200">{event.message}</p>
                    <p className="mt-0.5 text-xs text-slate-500">
                      {event.type} · {formatRelative(event.createdAt)}
                    </p>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </Card>
      </div>
    </div>
  );
}

function SeverityDot({ severity }: { severity: string }) {
  const color =
    severity === 'error' || severity === 'critical'
      ? 'bg-danger'
      : severity === 'warning'
        ? 'bg-warning'
        : 'bg-accent-soft';
  return <span className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${color}`} />;
}
