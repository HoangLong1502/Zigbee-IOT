import { Injectable, Logger, RequestTimeoutException } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { MqttService } from './mqtt.service';
import type { ZigbeeBridgeResponse } from '../../common/types/zigbee.types';

interface PendingRequest {
  resolve: (value: ZigbeeBridgeResponse) => void;
  reject: (reason: Error) => void;
  timer: NodeJS.Timeout;
}

/**
 * The write path of the platform - the mirror image of the ingestion pipeline.
 *
 *   React UI -> REST -> **ZigbeeCommandService** -> Mosquitto
 *            -> Zigbee2MQTT -> coordinator -> Zigbee device
 *
 * Zigbee2MQTT exposes a request/response protocol: a command published to
 * `zigbee2mqtt/bridge/request/<command>` carrying a `transaction` id is
 * answered on `zigbee2mqtt/bridge/response/<command>` with the same id. This
 * service owns that correlation so controllers can simply `await` a result.
 *
 * Responses are fed back in by the ingestion service via `handleResponse()`.
 */
@Injectable()
export class ZigbeeCommandService {
  private readonly logger = new Logger(ZigbeeCommandService.name);
  private readonly pending = new Map<string, PendingRequest>();
  private readonly defaultTimeoutMs = 20_000;

  constructor(private readonly mqtt: MqttService) {}

  private get base(): string {
    return this.mqtt.baseTopic;
  }

  // -------------------------------------------------------------------------
  // Low level request / response
  // -------------------------------------------------------------------------

  /**
   * Publishes a bridge request and waits for the matching response.
   * OTA updates legitimately take minutes, hence the configurable timeout.
   */
  async request<T = Record<string, unknown>>(
    command: string,
    payload: Record<string, unknown> = {},
    timeoutMs = this.defaultTimeoutMs,
  ): Promise<ZigbeeBridgeResponse<T>> {
    const transaction = randomUUID().slice(0, 8);
    const topic = `${this.base}/bridge/request/${command}`;

    const promise = new Promise<ZigbeeBridgeResponse>((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(transaction);
        reject(
          new RequestTimeoutException(
            `Zigbee2MQTT did not answer "${command}" within ${timeoutMs}ms`,
          ),
        );
      }, timeoutMs);

      this.pending.set(transaction, { resolve, reject, timer });
    });

    await this.mqtt.publish(topic, { ...payload, transaction });
    this.logger.log(`Request ${command} (transaction ${transaction})`);

    const response = (await promise) as ZigbeeBridgeResponse<T>;
    if (response.status === 'error') {
      throw new Error(response.error ?? `Zigbee2MQTT rejected "${command}"`);
    }
    return response;
  }

  /** Fire-and-forget publish, used for device `/set` and `/get`. */
  async publishRaw(topic: string, payload: unknown): Promise<void> {
    await this.mqtt.publish(topic, payload);
  }

  /**
   * Called by the ingestion service for every `bridge/response/*` frame.
   * Returns true when the response belonged to a request we are awaiting.
   */
  handleResponse(response: ZigbeeBridgeResponse): boolean {
    const transaction = response.transaction;
    if (!transaction) return false;

    const pending = this.pending.get(transaction);
    if (!pending) return false;

    clearTimeout(pending.timer);
    this.pending.delete(transaction);
    pending.resolve(response);
    return true;
  }

  // -------------------------------------------------------------------------
  // Device state (the `/set` and `/get` topics)
  // -------------------------------------------------------------------------

  /**
   * Writes one or more exposed properties, e.g. `{ state: 'ON', brightness: 200 }`.
   * The keys must be `access & 2` (settable) exposes of that device.
   */
  async setState(
    friendlyName: string,
    payload: Record<string, unknown>,
  ): Promise<void> {
    await this.mqtt.publish(`${this.base}/${friendlyName}/set`, payload);
  }

  /**
   * Asks the device to report properties now. Zigbee2MQTT expects the wanted
   * keys with an empty value, e.g. `{ state: '' }`.
   */
  async getState(friendlyName: string, properties: string[]): Promise<void> {
    const payload = Object.fromEntries(properties.map((key) => [key, '']));
    await this.mqtt.publish(`${this.base}/${friendlyName}/get`, payload);
  }

  /**
   * Reads raw ZCL attributes. Zigbee2MQTT accepts a `read` instruction on the
   * `/set` topic; the result is published back in the device state.
   */
  async readAttributes(
    friendlyName: string,
    cluster: string,
    attributes: (string | number)[],
    endpoint?: number | string,
  ): Promise<void> {
    const topic = endpoint
      ? `${this.base}/${friendlyName}/${endpoint}/set`
      : `${this.base}/${friendlyName}/set`;
    await this.mqtt.publish(topic, {
      read: { cluster, attributes, options: {} },
    });
  }

  /** Writes raw ZCL attributes (counterpart of {@link readAttributes}). */
  async writeAttributes(
    friendlyName: string,
    cluster: string,
    payload: Record<string, unknown>,
    endpoint?: number | string,
  ): Promise<void> {
    const topic = endpoint
      ? `${this.base}/${friendlyName}/${endpoint}/set`
      : `${this.base}/${friendlyName}/set`;
    await this.mqtt.publish(topic, {
      write: { cluster, payload, options: {} },
    });
  }

  /**
   * Best-effort liveness probe. Zigbee2MQTT has no dedicated ping request, so
   * we trigger a read of a property the device is known to publish; a fresh
   * state message (and therefore an updated `lastSeen`) means the device
   * answered.
   */
  async ping(friendlyName: string, property = 'state'): Promise<void> {
    await this.getState(friendlyName, [property]);
  }

  /**
   * Makes the device announce itself physically (blink / beep). Devices with
   * an `identify` expose take the first form, lights the `effect` form.
   */
  async identify(friendlyName: string, useEffect = false): Promise<void> {
    await this.setState(
      friendlyName,
      useEffect ? { effect: 'blink' } : { identify: 'identify' },
    );
  }

  // -------------------------------------------------------------------------
  // Bridge requests
  // -------------------------------------------------------------------------

  /** Opens or closes the join window, optionally only via one router. */
  async permitJoin(value: boolean, time?: number, device?: string) {
    const payload: Record<string, unknown> = { value };
    if (typeof time === 'number') payload.time = time;
    if (device) payload.device = device;
    return this.request('permit_join', payload);
  }

  async renameDevice(from: string, to: string) {
    return this.request('device/rename', { from, to });
  }

  /**
   * Removes a device from the network.
   * - `force`: drop it from the database even if it does not answer
   * - `block`: refuse re-joining until unblocked
   */
  async removeDevice(id: string, force = false, block = false) {
    return this.request('device/remove', { id, force, block });
  }

  /** Re-runs the interview so exposes and endpoints are refreshed. */
  async interviewDevice(id: string) {
    return this.request('device/interview', { id }, 90_000);
  }

  /** Re-applies bindings and reporting configuration. */
  async configureDevice(id: string) {
    return this.request('device/configure', { id }, 60_000);
  }

  async setDeviceOptions(id: string, options: Record<string, unknown>) {
    return this.request('device/options', { id, options });
  }

  async bind(
    from: string,
    to: string,
    clusters?: string[],
    fromEndpoint?: number | string,
    toEndpoint?: number | string,
  ) {
    const payload: Record<string, unknown> = { from, to };
    if (clusters?.length) payload.clusters = clusters;
    if (fromEndpoint !== undefined) payload.from_endpoint = fromEndpoint;
    if (toEndpoint !== undefined) payload.to_endpoint = toEndpoint;
    return this.request('device/bind', payload, 30_000);
  }

  async unbind(
    from: string,
    to: string,
    clusters?: string[],
    fromEndpoint?: number | string,
    toEndpoint?: number | string,
  ) {
    const payload: Record<string, unknown> = { from, to };
    if (clusters?.length) payload.clusters = clusters;
    if (fromEndpoint !== undefined) payload.from_endpoint = fromEndpoint;
    if (toEndpoint !== undefined) payload.to_endpoint = toEndpoint;
    return this.request('device/unbind', payload, 30_000);
  }

  /** Configures ZCL attribute reporting intervals for a device endpoint. */
  async configureReporting(params: {
    id: string;
    endpoint: number | string;
    cluster: string;
    attribute: string | number;
    minimumReportInterval: number;
    maximumReportInterval: number;
    reportableChange: number;
  }) {
    return this.request(
      'device/configure_reporting',
      {
        id: params.id,
        endpoint: params.endpoint,
        cluster: params.cluster,
        attribute: params.attribute,
        minimum_report_interval: params.minimumReportInterval,
        maximum_report_interval: params.maximumReportInterval,
        reportable_change: params.reportableChange,
      },
      30_000,
    );
  }

  /** Asks Zigbee2MQTT whether newer firmware exists for a device. */
  async checkOta(id: string) {
    return this.request('device/ota_update/check', { id }, 60_000);
  }

  /** Starts the OTA transfer. Progress arrives asynchronously per device. */
  async startOta(id: string) {
    // Firmware transfers routinely take 10+ minutes on battery devices.
    return this.request('device/ota_update/update', { id }, 15 * 60_000);
  }

  /** Requests a fresh network map (used by the topology page). */
  async requestNetworkMap(type: 'raw' | 'graphviz' = 'raw', routes = false) {
    return this.request<{ type: string; value: unknown; routes: boolean }>(
      'networkmap',
      { type, routes },
      120_000,
    );
  }

  /** Patches `configuration.yaml` at runtime (channel, pan id, log level...). */
  async setBridgeOptions(options: Record<string, unknown>) {
    return this.request('options', { options }, 30_000);
  }

  async restartBridge() {
    return this.request('restart', {}, 60_000);
  }

  async healthCheck() {
    return this.request<{ healthy: boolean }>('health_check', {}, 15_000);
  }
}
