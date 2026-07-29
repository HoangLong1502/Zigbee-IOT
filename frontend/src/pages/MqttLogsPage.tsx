import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Download, Pause, Play, Trash2 } from 'lucide-react';
import { mqttApi, apiErrorMessage } from '@/lib/api';
import { realtime } from '@/lib/realtime';
import { WS_EVENTS } from '@/lib/ws-events';
import { formatAbsolute, prettyJson } from '@/lib/utils';
import type { MqttLogEntry } from '@/types';
import {
  Badge,
  Card,
  EmptyState,
  PageHeader,
  Spinner,
} from '@/components/ui/Card';

const MAX_LIVE = 500;

export function MqttLogsPage() {
  const [live, setLive] = useState(true);
  const [paused, setPaused] = useState(false);
  const [search, setSearch] = useState('');
  const [direction, setDirection] = useState('');
  const [topic, setTopic] = useState('');
  const [liveRows, setLiveRows] = useState<MqttLogEntry[]>([]);
  const bottomRef = useRef<HTMLDivElement | null>(null);

  const historyQuery = useQuery({
    queryKey: ['mqtt-logs', search, direction, topic],
    queryFn: () =>
      mqttApi.logs({
        search: search || undefined,
        direction: direction || undefined,
        topic: topic || undefined,
        limit: 200,
      }),
    enabled: !live,
  });

  useEffect(() => {
    if (!live) return;
    realtime.subscribeMqttLogs();
    const off = realtime.on(WS_EVENTS.MQTT_MESSAGE, (payload) => {
      if (paused) return;
      const entry = payload as MqttLogEntry;
      setLiveRows((rows) => [entry, ...rows].slice(0, MAX_LIVE));
    });
    return () => {
      realtime.unsubscribeMqttLogs();
      off();
    };
  }, [live, paused]);

  const rows = useMemo(() => {
    const source = live ? liveRows : historyQuery.data?.items ?? [];
    return source.filter((row) => {
      if (direction && row.direction !== direction) return false;
      if (topic && !row.topic.toLowerCase().includes(topic.toLowerCase())) return false;
      if (
        search &&
        !`${row.topic} ${row.payload} ${row.deviceName ?? ''}`
          .toLowerCase()
          .includes(search.toLowerCase())
      ) {
        return false;
      }
      return true;
    });
  }, [live, liveRows, historyQuery.data, direction, topic, search]);

  const exportJson = async () => {
    const data = live
      ? rows
      : await mqttApi.export({
          search: search || undefined,
          direction: direction || undefined,
          topic: topic || undefined,
        });
    const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const anchor = document.createElement('a');
    anchor.href = url;
    anchor.download = `mqtt-logs-${Date.now()}.json`;
    anchor.click();
    URL.revokeObjectURL(url);
  };

  return (
    <div>
      <PageHeader
        title="MQTT Logs"
        description="Live traffic between Zigbee2MQTT, Mosquitto and the backend"
        actions={
          <>
            <button
              type="button"
              className="btn-secondary"
              onClick={() => setLive((value) => !value)}
            >
              {live ? 'Show history' : 'Show live'}
            </button>
            {live ? (
              <button
                type="button"
                className="btn-secondary"
                onClick={() => setPaused((value) => !value)}
              >
                {paused ? <Play className="h-4 w-4" /> : <Pause className="h-4 w-4" />}
                {paused ? 'Resume' : 'Pause'}
              </button>
            ) : null}
            <button type="button" className="btn-secondary" onClick={() => void exportJson()}>
              <Download className="h-4 w-4" /> Export JSON
            </button>
            <button
              type="button"
              className="btn-danger"
              onClick={() => {
                if (confirm('Delete all stored MQTT logs?')) {
                  void mqttApi.clear().then(() => {
                    setLiveRows([]);
                    void historyQuery.refetch();
                  });
                }
              }}
            >
              <Trash2 className="h-4 w-4" /> Clear
            </button>
          </>
        }
      />

      <div className="mb-4 grid gap-3 sm:grid-cols-3">
        <input
          className="input"
          placeholder="Search topic or payload…"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        />
        <input
          className="input"
          placeholder="Filter topic…"
          value={topic}
          onChange={(event) => setTopic(event.target.value)}
        />
        <select
          className="input"
          value={direction}
          onChange={(event) => setDirection(event.target.value)}
        >
          <option value="">All directions</option>
          <option value="inbound">Inbound</option>
          <option value="outbound">Outbound</option>
        </select>
      </div>

      <Card className="p-0">
        <div className="grid grid-cols-[160px_1fr_70px_90px_1.2fr] gap-2 border-b border-white/5 px-4 py-2 text-[11px] uppercase tracking-wide text-slate-500">
          <span>Timestamp</span>
          <span>Topic</span>
          <span>QoS</span>
          <span>Direction</span>
          <span>Payload / Device</span>
        </div>

        {!live && historyQuery.isLoading ? (
          <div className="flex h-40 items-center justify-center">
            <Spinner />
          </div>
        ) : rows.length === 0 ? (
          <div className="p-6">
            <EmptyState
              title="No messages"
              description={
                live
                  ? 'Waiting for MQTT traffic…'
                  : 'Nothing matched the current filters.'
              }
            />
          </div>
        ) : (
          <div className="max-h-[70vh] overflow-auto scroll-thin font-mono text-xs">
            {rows.map((row, index) => (
              <div
                key={`${row.createdAt}-${row.topic}-${index}`}
                className="grid grid-cols-[160px_1fr_70px_90px_1.2fr] gap-2 border-b border-white/[0.04] px-4 py-2 hover:bg-white/[0.03]"
              >
                <span className="text-slate-500">{formatAbsolute(row.createdAt)}</span>
                <span className="truncate text-slate-200" title={row.topic}>
                  {row.topic}
                </span>
                <span className="text-slate-400">{row.qos}</span>
                <span>
                  <Badge tone={row.direction === 'inbound' ? 'success' : 'accent'}>
                    {row.direction}
                  </Badge>
                </span>
                <div className="min-w-0">
                  {row.deviceName ? (
                    <p className="mb-0.5 text-[10px] text-accent-soft">{row.deviceName}</p>
                  ) : null}
                  <pre className="truncate whitespace-pre-wrap break-all text-slate-300">
                    {row.payloadJson ? prettyJson(row.payloadJson) : row.payload}
                  </pre>
                </div>
              </div>
            ))}
            <div ref={bottomRef} />
          </div>
        )}
      </Card>

      {historyQuery.isError ? (
        <p className="mt-3 text-sm text-rose-300">{apiErrorMessage(historyQuery.error)}</p>
      ) : null}
    </div>
  );
}
