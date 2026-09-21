import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link } from 'react-router-dom';
import { Search } from 'lucide-react';
import { devicesApi } from '@/lib/api';
import { batteryColor, formatRelative, linkQualityInfo } from '@/lib/utils';
import { Badge, EmptyState, PageHeader, Spinner } from '@/components/ui/Card';
import { DeviceOnOffToggle } from '@/components/devices/DeviceOnOffToggle';
import { useLanguage } from '@/context/LanguageContext';

export function DevicesPage() {
  const { t } = useLanguage();
  const [search, setSearch] = useState('');
  const [onlineOnly, setOnlineOnly] = useState(false);
  const [type, setType] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['devices', search, onlineOnly, type],
    queryFn: () =>
      devicesApi.list({
        search: search || undefined,
        online: onlineOnly ? true : undefined,
        type: type || undefined,
        limit: 500,
      }),
  });

  const items = data?.items ?? [];

  const grouped = useMemo(() => {
    const order = ['Router', 'EndDevice', 'Coordinator', 'GreenPower', 'Unknown'];
    return [...items].sort((a, b) => {
      const ai = order.indexOf(a.type);
      const bi = order.indexOf(b.type);
      return (ai === -1 ? 99 : ai) - (bi === -1 ? 99 : bi) ||
        a.friendlyName.localeCompare(b.friendlyName);
    });
  }, [items]);

  return (
    <div>
      <PageHeader
        title={t('Devices')}
        description={`${data?.total ?? 0} ${t('discovered on the Zigbee network')}`}
      />

      <div className="mb-5 flex flex-col gap-3 sm:flex-row sm:items-center">
        <div className="relative flex-1">
          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-500" />
          <input
            className="input pl-9"
            placeholder={t('Search by name, model, manufacturer or IEEE…')}
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </div>
        <select
          className="input w-full sm:w-44"
          value={type}
          onChange={(event) => setType(event.target.value)}
        >
          <option value="">{t('All types')}</option>
          <option value="Router">{t('Routers')}</option>
          <option value="EndDevice">{t('End devices')}</option>
          <option value="Coordinator">{t('Coordinator')}</option>
        </select>
        <label className="flex items-center gap-2 text-sm text-slate-300">
          <input
            type="checkbox"
            checked={onlineOnly}
            onChange={(event) => setOnlineOnly(event.target.checked)}
          />
          {t('Online only')}
        </label>
      </div>

      {isLoading ? (
        <div className="flex h-40 items-center justify-center">
          <Spinner className="h-8 w-8" />
        </div>
      ) : grouped.length === 0 ? (
        <EmptyState
          title={t('No devices found')}
          description={t('Open permit join on the Coordinator page and put your device into pairing mode.')}
        />
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
          {grouped.map((device) => {
            const lqi = linkQualityInfo(device.linkQuality);
            return (
              <Link
                key={device.id}
                to={`/devices/${encodeURIComponent(device.ieeeAddress)}`}
                className="card group p-4 transition hover:border-accent/40 hover:bg-ink/[0.03]"
              >
                <div className="flex items-start gap-3">
                  <div className="relative h-14 w-14 shrink-0 overflow-hidden rounded-2xl bg-ink/5">
                    {device.imageUrl ? (
                      <img
                        src={device.imageUrl}
                        alt=""
                        className="h-full w-full object-contain p-1"
                      />
                    ) : (
                      <div className="flex h-full w-full items-center justify-center text-xs text-slate-500">
                        Zigbee
                      </div>
                    )}
                    <span
                      className={`absolute bottom-1 right-1 h-2.5 w-2.5 rounded-full ring-2 ring-surface-950 ${
                        device.online ? 'bg-success' : 'bg-slate-600'
                      }`}
                    />
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate font-medium text-slate-100 group-hover:text-ink">
                      {device.friendlyName}
                    </p>
                    <p className="truncate text-xs text-slate-500">
                      {device.manufacturer ?? t('Unknown')} · {device.model ?? '—'}
                    </p>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {device.pairingConfirmed === false ? (
                        <Badge tone="warning">{t('Awaiting pair')}</Badge>
                      ) : null}
                      <Badge tone={device.online ? 'success' : 'default'}>
                        {device.online ? t('Online') : t('Offline')}
                      </Badge>
                      {typeof device.battery === 'number' ? (
                        <Badge>
                          <span className={batteryColor(device.battery)}>{device.battery}%</span>
                        </Badge>
                      ) : null}
                      <Badge>
                        <span className={lqi.color}>LQI {device.linkQuality ?? '—'}</span>
                      </Badge>
                    </div>
                    <DeviceOnOffToggle device={device} size="sm" className="mt-3" />
                  </div>
                </div>
                <p className="mt-3 truncate font-mono text-[11px] text-slate-500">
                  {device.ieeeAddress} · {t('seen')} {formatRelative(device.lastSeen)}
                </p>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
}
