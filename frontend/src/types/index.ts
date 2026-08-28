/**
 * Shared TypeScript contracts mirroring the NestJS API responses.
 *
 * Kept deliberately close to the backend entities so that Socket.IO payloads
 * and REST responses share the same shapes.
 */

export interface Device {
  id: string;
  ieeeAddress: string;
  friendlyName: string;
  networkAddress: number | null;
  type: 'Coordinator' | 'Router' | 'EndDevice' | 'GreenPower' | 'Unknown' | string;
  manufacturer: string | null;
  model: string | null;
  description: string | null;
  powerSource: string | null;
  softwareBuildId: string | null;
  dateCode: string | null;
  interviewStatus: string;
  interviewCompleted: boolean;
  pairingConfirmed?: boolean;
  supported: boolean;
  disabled: boolean;
  supportsOta: boolean;
  imageUrl: string | null;
  online: boolean;
  lastSeen: string | null;
  linkQuality: number | null;
  rssi: number | null;
  battery: number | null;
  batteryVoltage: number | null;
  lastPayload: Record<string, unknown> | null;
  exposesRaw: ZigbeeExpose[] | null;
  endpoints: Record<string, unknown> | null;
  definitionRaw: Record<string, unknown> | null;
  exposes?: DeviceExpose[];
  attributes?: DeviceAttribute[];
  createdAt: string;
  updatedAt: string;
}

export interface ZigbeeExpose {
  type: string;
  name?: string;
  label?: string;
  property?: string;
  access?: number;
  unit?: string;
  description?: string;
  category?: string;
  value_min?: number;
  value_max?: number;
  value_step?: number;
  values?: Array<string | number>;
  value_on?: unknown;
  value_off?: unknown;
  value_toggle?: unknown;
  features?: ZigbeeExpose[];
  endpoint?: string;
  [key: string]: unknown;
}

export interface DeviceExpose {
  id: string;
  deviceId: string;
  property: string;
  name: string | null;
  label: string | null;
  type: string;
  parentType: string | null;
  groupKey?: string | null;
  groupLabel?: string | null;
  groupDescription?: string | null;
  endpoint: string | null;
  access: number;
  unit: string | null;
  description: string | null;
  category: string | null;
  valueMin: number | null;
  valueMax: number | null;
  valueStep: number | null;
  values: Array<string | number> | null;
  valueOn: unknown;
  valueOff: unknown;
  valueToggle: unknown;
  raw: ZigbeeExpose | null;
}

export interface DeviceAttribute {
  id: string;
  deviceId: string;
  property: string;
  value: unknown;
  numericValue: number | null;
  valueType: string;
  unit: string | null;
  updatedAtSource: string;
  updatedAt: string;
}

export interface DeviceStats {
  total: number;
  online: number;
  offline: number;
  routers: number;
  endDevices: number;
  batteryPowered: number;
  lowBattery: number;
  unsupported: number;
  averageLinkQuality: number;
  networkHealth: number;
}

export interface Coordinator {
  id: string;
  online: boolean;
  permitJoin: boolean;
  permitJoinTimeout: number | null;
  serialPort: string | null;
  baudRate: number | null;
  adapter: string | null;
  vendorId: string | null;
  productId: string | null;
  hardwareLabel: string | null;
  ieeeAddress: string | null;
  panId: number | null;
  extendedPanId: string | null;
  channel: number | null;
  networkKey: string | null;
  zigbee2mqttVersion: string | null;
  firmwareVersion: string | null;
  coordinatorType: string | null;
  herdsmanVersion: string | null;
  convertersVersion: string | null;
  logLevel: string | null;
  restartRequired: boolean;
  pairingMode: 'manual' | 'auto';
  autoPairWindowSeconds: number;
  lastManualSyncAt: string | null;
  lastSeen: string | null;
  detectedPorts: DetectedSerialPort[];
  detectionAvailable: boolean;
  detectionUnavailableReason: string | null;
}

export interface PairingPrompt {
  ieeeAddress: string;
  friendlyName: string;
  deviceId: string | null;
  manufacturer: string | null;
  model: string | null;
  description: string | null;
  imageUrl: string | null;
  interviewStatus: string | null;
  supported: boolean | null;
  linkQuality: number | null;
  nearCoordinator: boolean;
  pairingMode: 'manual' | 'auto';
  joinedAt: string;
}

export interface DetectedSerialPort {
  path: string;
  manufacturer: string | null;
  serialNumber: string | null;
  vendorId: string | null;
  productId: string | null;
  isZigbeeCoordinator: boolean;
  label: string | null;
  suggestedAdapter: string | null;
  suggestedBaudRate: number | null;
}

export interface MqttStatus {
  connected: boolean;
  reconnecting: boolean;
  url: string;
  baseTopic: string;
  clientId: string;
  lastConnectedAt: string | null;
  lastDisconnectedAt: string | null;
  lastError: string | null;
  reconnectAttempts: number;
  messagesReceived: number;
  messagesPublished: number;
}

export interface MqttLogEntry {
  id?: string;
  topic: string;
  direction: 'inbound' | 'outbound';
  payload: string;
  payloadJson: unknown;
  qos: number;
  retain: boolean;
  deviceName: string | null;
  size: number;
  createdAt: string;
}

export interface DeviceEvent {
  id: string;
  type: string;
  severity: 'debug' | 'info' | 'warning' | 'error' | string;
  message: string;
  deviceId: string | null;
  friendlyName: string | null;
  ieeeAddress: string | null;
  data: Record<string, unknown> | null;
  createdAt: string;
}

export interface Alert {
  id: string;
  type: string;
  severity: 'info' | 'warning' | 'critical' | string;
  message: string;
  deviceId: string | null;
  friendlyName: string | null;
  property: string | null;
  value: unknown;
  threshold: number | null;
  acknowledged: boolean;
  acknowledgedAt: string | null;
  resolved: boolean;
  resolvedAt: string | null;
  occurrences: number;
  lastOccurredAt: string;
  createdAt: string;
}

export interface TopologyNode {
  id: string;
  ieeeAddress: string;
  friendlyName: string;
  type: string;
  networkAddress: number;
  manufacturer: string | null;
  model: string | null;
  lastSeen: string | null;
  failed: boolean;
}

export interface TopologyEdge {
  source: string;
  target: string;
  linkQuality: number;
  quality: number;
  relationship: string;
  depth: number | null;
  isParentChild: boolean;
}

export interface TopologyGraph {
  nodes: TopologyNode[];
  edges: TopologyEdge[];
  generatedAt: string | null;
  stats: {
    coordinators: number;
    routers: number;
    endDevices: number;
    links: number;
    averageLinkQuality: number;
    weakLinks: number;
  };
}

export interface HistoryPoint {
  timestamp: string;
  value: number | null;
  min: number | null;
  max: number | null;
  count: number;
}

export interface HistorySeries {
  property: string;
  unit: string | null;
  points: HistoryPoint[];
  from: string;
  to: string;
  bucketSeconds: number;
}

export interface OtaJob {
  id: string;
  deviceId: string;
  friendlyName: string;
  status: string;
  progress: number;
  remaining: number | null;
  currentVersion: string | null;
  targetVersion: string | null;
  error: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface DashboardSummary {
  stats: DeviceStats & {
    messagesLastHour: number;
    mqttConnected: boolean;
    coordinatorOnline: boolean;
    permitJoin: boolean;
  };
  coordinator: {
    online: boolean;
    permitJoin: boolean;
    channel: number | null;
    panId: number | null;
    firmwareVersion: string | null;
    zigbee2mqttVersion: string | null;
    serialPort: string | null;
    adapter: string | null;
  };
  mqtt: MqttStatus;
  alerts: {
    active: number;
    critical: number;
    warning: number;
    unacknowledged: number;
  };
  recentEvents: DeviceEvent[];
  latestReadings: Array<{
    id: string;
    friendlyName: string;
    ieeeAddress: string;
    model: string | null;
    lastSeen: string | null;
    linkQuality: number | null;
    battery: number | null;
    payload: Record<string, unknown> | null;
  }>;
}

export interface AuthUser {
  id: string;
  email: string;
  displayName: string | null;
  roles: string[];
}

export interface AuthResponse {
  accessToken: string;
  expiresIn: string;
  user: AuthUser;
}

export interface Paginated<T> {
  items: T[];
  total: number;
  limit?: number;
  offset?: number;
}

export type HistoryRange = 'hour' | 'today' | '24h' | '7d' | '30d' | 'custom';
