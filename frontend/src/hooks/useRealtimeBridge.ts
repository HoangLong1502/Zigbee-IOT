import { useEffect, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { realtime } from '@/lib/realtime';
import { WS_EVENTS } from '@/lib/ws-events';
import type { Alert } from '@/types';

/**
 * Boots the Socket.IO connection and keeps TanStack Query caches in sync with
 * live events. Browser notifications are requested the first time a critical
 * alert arrives.
 */
export function useRealtimeBridge(): { connected: boolean } {
  const queryClient = useQueryClient();
  const [connected, setConnected] = useState(realtime.isConnected);

  useEffect(() => {
    realtime.connect();
    const off = realtime.onConnectionChange(setConnected);

    const unsubscribers = [
      realtime.on(WS_EVENTS.DEVICE_TELEMETRY, () => {
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        void queryClient.invalidateQueries({ queryKey: ['devices'] });
      }),
      realtime.on(WS_EVENTS.DEVICE_UPDATED, () => {
        void queryClient.invalidateQueries({ queryKey: ['devices'] });
        void queryClient.invalidateQueries({ queryKey: ['device'] });
      }),
      realtime.on(WS_EVENTS.DEVICE_ADDED, () => {
        void queryClient.invalidateQueries({ queryKey: ['devices'] });
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      }),
      realtime.on(WS_EVENTS.DEVICE_REMOVED, () => {
        void queryClient.invalidateQueries({ queryKey: ['devices'] });
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      }),
      realtime.on(WS_EVENTS.DEVICE_AVAILABILITY, () => {
        void queryClient.invalidateQueries({ queryKey: ['devices'] });
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      }),
      realtime.on(WS_EVENTS.STATS, (payload) => {
        queryClient.setQueryData(['device-stats'], payload);
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      }),
      realtime.on(WS_EVENTS.COORDINATOR_UPDATED, () => {
        void queryClient.invalidateQueries({ queryKey: ['coordinator'] });
        void queryClient.invalidateQueries({ queryKey: ['discovery'] });
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      }),
      realtime.on(WS_EVENTS.MQTT_STATUS, (payload) => {
        queryClient.setQueryData(['mqtt-status'], payload);
      }),
      realtime.on(WS_EVENTS.EVENT_CREATED, () => {
        void queryClient.invalidateQueries({ queryKey: ['events'] });
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
      }),
      realtime.on(WS_EVENTS.ALERT_CREATED, (payload) => {
        void queryClient.invalidateQueries({ queryKey: ['alerts'] });
        void queryClient.invalidateQueries({ queryKey: ['dashboard'] });
        notifyBrowser(payload as Alert);
      }),
      realtime.on(WS_EVENTS.ALERT_UPDATED, () => {
        void queryClient.invalidateQueries({ queryKey: ['alerts'] });
      }),
      realtime.on(WS_EVENTS.TOPOLOGY_UPDATED, (payload) => {
        queryClient.setQueryData(['topology'], payload);
      }),
      realtime.on(WS_EVENTS.OTA_UPDATED, () => {
        void queryClient.invalidateQueries({ queryKey: ['ota'] });
      }),
    ];

    return () => {
      off();
      unsubscribers.forEach((unsubscribe) => unsubscribe());
    };
  }, [queryClient]);

  return { connected };
}

function notifyBrowser(alert: Alert): void {
  if (typeof window === 'undefined' || !('Notification' in window)) return;
  if (Notification.permission === 'default') {
    void Notification.requestPermission();
  }
  if (Notification.permission !== 'granted') return;

  try {
    new Notification(alert.severity === 'critical' ? 'Critical alert' : 'Zigbee alert', {
      body: alert.message,
      tag: alert.id,
    });
  } catch {
    // Some browsers block Notification construction outside a user gesture.
  }
}
