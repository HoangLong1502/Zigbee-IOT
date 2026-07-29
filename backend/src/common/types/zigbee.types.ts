/**
 * Type definitions mirroring the Zigbee2MQTT MQTT contract.
 *
 * These are intentionally kept close to the wire format so that the ingestion
 * pipeline never has to guess: whatever Zigbee2MQTT publishes on
 * `zigbee2mqtt/bridge/#` is parsed into these shapes and then mapped onto our
 * own persistence model.
 *
 * Reference: https://www.zigbee2mqtt.io/guide/usage/mqtt_topics_and_messages.html
 */

/** Bitmask used by Zigbee2MQTT to describe how a property may be used. */
export const ACCESS_PUBLISHED = 0b001; // value is published in the state
export const ACCESS_SET = 0b010; // value can be written with /set
export const ACCESS_GET = 0b100; // value can be requested with /get

export type ZigbeeExposeType =
  | 'numeric'
  | 'binary'
  | 'enum'
  | 'text'
  | 'composite'
  | 'list'
  | 'light'
  | 'switch'
  | 'fan'
  | 'cover'
  | 'lock'
  | 'climate';

/**
 * A single "expose" entry. Generic exposes (numeric/binary/enum/text) carry a
 * `property`; specific exposes (light/switch/climate/...) instead carry a
 * `features` array of generic exposes. The renderer walks this tree, which is
 * how the UI stays free of hardcoded sensor names.
 */
export interface ZigbeeExpose {
  type: ZigbeeExposeType | string;
  name?: string;
  label?: string;
  property?: string;
  access?: number;
  unit?: string;
  description?: string;
  category?: string;
  /** numeric */
  value_min?: number;
  value_max?: number;
  value_step?: number;
  /** enum */
  values?: Array<string | number>;
  /** binary */
  value_on?: string | number | boolean;
  value_off?: string | number | boolean;
  value_toggle?: string | number | boolean;
  /** composite / list / specific types */
  features?: ZigbeeExpose[];
  item_type?: ZigbeeExpose | string;
  [key: string]: unknown;
}

export interface ZigbeeDeviceDefinition {
  model?: string;
  vendor?: string;
  description?: string;
  exposes?: ZigbeeExpose[];
  options?: ZigbeeExpose[];
  supports_ota?: boolean;
  /** Zigbee2MQTT >= 1.3x publishes a CDN URL for the device photo. */
  icon?: string;
}

export interface ZigbeeEndpointBinding {
  cluster: string;
  target: {
    type: 'endpoint' | 'group';
    ieee_address?: string;
    endpoint?: number;
    id?: number;
  };
}

export interface ZigbeeConfiguredReporting {
  cluster: string;
  attribute: string | number;
  minimum_report_interval: number;
  maximum_report_interval: number;
  reportable_change: number;
}

export interface ZigbeeEndpoint {
  bindings?: ZigbeeEndpointBinding[];
  configured_reportings?: ZigbeeConfiguredReporting[];
  clusters?: { input?: string[]; output?: string[] };
  scenes?: Array<{ id: number; name: string }>;
}

/** One entry of the `zigbee2mqtt/bridge/devices` array. */
export interface ZigbeeBridgeDevice {
  ieee_address: string;
  type: 'Coordinator' | 'Router' | 'EndDevice' | 'GreenPower' | string;
  friendly_name: string;
  network_address?: number;
  supported?: boolean;
  disabled?: boolean;
  description?: string;
  manufacturer?: string;
  model_id?: string;
  power_source?: string;
  software_build_id?: string;
  date_code?: string;
  interviewing?: boolean;
  interview_completed?: boolean;
  interview_state?: string;
  definition?: ZigbeeDeviceDefinition | null;
  endpoints?: Record<string, ZigbeeEndpoint>;
}

/** `zigbee2mqtt/bridge/info` - coordinator + network configuration. */
export interface ZigbeeBridgeInfo {
  version?: string;
  commit?: string;
  zigbee_herdsman?: { version?: string };
  zigbee_herdsman_converters?: { version?: string };
  coordinator?: {
    ieee_address?: string;
    type?: string;
    meta?: Record<string, unknown> & {
      revision?: number | string;
      transportrev?: number;
      product?: number;
      majorrel?: number;
      minorrel?: number;
      maintrel?: number;
    };
  };
  network?: {
    channel?: number;
    pan_id?: number;
    extended_pan_id?: number[] | string;
  };
  permit_join?: boolean;
  permit_join_timeout?: number;
  restart_required?: boolean;
  config?: Record<string, unknown> & {
    serial?: { port?: string; adapter?: string; baudrate?: number };
    advanced?: Record<string, unknown>;
    mqtt?: { base_topic?: string; server?: string };
  };
  log_level?: string;
}

/** `zigbee2mqtt/bridge/event` */
export interface ZigbeeBridgeEvent {
  type:
    | 'device_joined'
    | 'device_interview'
    | 'device_leave'
    | 'device_announce'
    | string;
  data: {
    friendly_name?: string;
    ieee_address?: string;
    status?: 'started' | 'successful' | 'failed' | string;
    definition?: ZigbeeDeviceDefinition | null;
    supported?: boolean;
    [key: string]: unknown;
  };
}

/** `zigbee2mqtt/bridge/response/<command>` */
export interface ZigbeeBridgeResponse<T = Record<string, unknown>> {
  status: 'ok' | 'error';
  data: T;
  error?: string;
  transaction?: string;
}

/** `zigbee2mqtt/bridge/logging` */
export interface ZigbeeBridgeLog {
  level: 'debug' | 'info' | 'warning' | 'error' | string;
  message: string;
  namespace?: string;
}

/** One node of `zigbee2mqtt/bridge/response/networkmap` (raw type). */
export interface ZigbeeNetworkMapNode {
  ieeeAddr: string;
  friendlyName: string;
  type: string;
  networkAddress: number;
  manufacturerName?: string;
  modelID?: string;
  failed?: string[];
  lastSeen?: number;
  definition?: { model?: string; vendor?: string; description?: string } | null;
}

export interface ZigbeeNetworkMapLink {
  source: { ieeeAddr: string; networkAddress: number };
  target: { ieeeAddr: string; networkAddress: number };
  linkquality: number;
  depth?: number;
  routes?: unknown[];
  sourceIeeeAddr: string;
  targetIeeeAddr: string;
  sourceNwkAddr: number;
  lqi: number;
  relationship: number;
}

export interface ZigbeeNetworkMap {
  nodes: ZigbeeNetworkMapNode[];
  links: ZigbeeNetworkMapLink[];
}

/**
 * A device state payload, e.g. `zigbee2mqtt/Living Room Sensor`:
 * `{ "temperature": 21.5, "humidity": 48, "battery": 97, "linkquality": 120 }`
 *
 * Keys are entirely device specific - never hardcode them.
 */
export type ZigbeeDeviceState = Record<string, unknown> & {
  linkquality?: number;
  battery?: number;
  voltage?: number;
  last_seen?: string | number;
};

/** `zigbee2mqtt/<device>/availability` */
export interface ZigbeeAvailabilityPayload {
  state: 'online' | 'offline';
}

/** Zigbee "relationship" field semantics from the routing table. */
export enum ZigbeeRelationship {
  Parent = 0,
  Child = 1,
  Sibling = 2,
  None = 3,
  PreviousChild = 4,
  Unauthenticated = 5,
}
