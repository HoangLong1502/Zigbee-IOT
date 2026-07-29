/**
 * Socket.IO event names.
 *
 * Kept in one place because they form the contract with the React frontend
 * (mirrored in `frontend/src/lib/ws-events.ts`).
 */
export const WS_EVENTS = {
  /** Full snapshot pushed right after a client connects. */
  SNAPSHOT: 'snapshot',

  /** A device state payload was received and persisted. */
  DEVICE_TELEMETRY: 'device:telemetry',
  /** Device metadata changed (rename, interview, new device, removal). */
  DEVICE_UPDATED: 'device:updated',
  DEVICE_ADDED: 'device:added',
  DEVICE_REMOVED: 'device:removed',
  /** Online/offline transition. */
  DEVICE_AVAILABILITY: 'device:availability',

  /** Aggregated dashboard counters. */
  STATS: 'stats',

  /** Coordinator / bridge information changed. */
  COORDINATOR_UPDATED: 'coordinator:updated',
  /** Backend <-> broker connection state. */
  MQTT_STATUS: 'mqtt:status',
  /** A raw MQTT frame, for the live log viewer. */
  MQTT_MESSAGE: 'mqtt:message',

  /** Network map refreshed. */
  TOPOLOGY_UPDATED: 'topology:updated',

  /** Something happened on the network (join, leave, interview, ...). */
  EVENT_CREATED: 'event:created',

  /** Alert lifecycle. */
  ALERT_CREATED: 'alert:created',
  ALERT_UPDATED: 'alert:updated',

  /** OTA progress. */
  OTA_UPDATED: 'ota:updated',
} as const;

export type WsEventName = (typeof WS_EVENTS)[keyof typeof WS_EVENTS];

/** Rooms clients can join to limit traffic. */
export const WS_ROOMS = {
  /** Everything except the raw MQTT firehose. */
  DEFAULT: 'default',
  /** Opt-in room for the MQTT log viewer. */
  MQTT_LOGS: 'mqtt-logs',
  /** Per-device room: `device:<ieeeAddress>` */
  device: (ieeeAddress: string) => `device:${ieeeAddress}`,
} as const;
