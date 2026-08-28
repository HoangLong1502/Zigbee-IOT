/**
 * Socket.IO event names - must stay in sync with
 * `backend/src/common/constants/ws-events.ts`.
 */
export const WS_EVENTS = {
  SNAPSHOT: 'snapshot',
  DEVICE_TELEMETRY: 'device:telemetry',
  DEVICE_UPDATED: 'device:updated',
  DEVICE_ADDED: 'device:added',
  DEVICE_REMOVED: 'device:removed',
  DEVICE_AVAILABILITY: 'device:availability',
  STATS: 'stats',
  COORDINATOR_UPDATED: 'coordinator:updated',
  MQTT_STATUS: 'mqtt:status',
  MQTT_MESSAGE: 'mqtt:message',
  TOPOLOGY_UPDATED: 'topology:updated',
  PAIRING_PROMPT: 'pairing:prompt',
  PAIRING_RESOLVED: 'pairing:resolved',
  EVENT_CREATED: 'event:created',
  ALERT_CREATED: 'alert:created',
  ALERT_UPDATED: 'alert:updated',
  OTA_UPDATED: 'ota:updated',
} as const;

export type WsEventName = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];
