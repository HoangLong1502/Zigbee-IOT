import { Injectable, Logger } from '@nestjs/common';

/** A serial port as reported by the OS. */
export interface DetectedSerialPort {
  path: string;
  manufacturer: string | null;
  serialNumber: string | null;
  vendorId: string | null;
  productId: string | null;
  /** True when the USB ids match a known Zigbee coordinator. */
  isZigbeeCoordinator: boolean;
  /** Human readable dongle name when recognised. */
  label: string | null;
  /** Zigbee2MQTT adapter driver to use: zstack | ember | deconz | zigate. */
  suggestedAdapter: string | null;
  suggestedBaudRate: number | null;
}

interface KnownAdapter {
  label: string;
  adapter: string;
  baudRate: number;
}

/**
 * USB ids of the coordinators people actually use. The key is
 * `vendorId:productId`, lower-cased.
 *
 * Several dongles share a USB-serial bridge chip (CP2102N is used by both the
 * Sonoff Plus and the SkyConnect), so the label is a best guess while the
 * adapter driver is the part that matters for Zigbee2MQTT.
 */
const KNOWN_ADAPTERS: Record<string, KnownAdapter> = {
  // Texas Instruments CC2652P / CC1352P (LAUNCHXL, zzh, slaesh)
  '0451:bef3': { label: 'Texas Instruments CC1352P/CC2652P', adapter: 'zstack', baudRate: 115200 },
  '0451:16a8': { label: 'Texas Instruments CC2531', adapter: 'zstack', baudRate: 115200 },
  '0403:6015': { label: 'Electrolama zig-a-zig-ah! (CC2652R)', adapter: 'zstack', baudRate: 115200 },
  // Silicon Labs CP2102N - Sonoff ZBDongle-P, SkyConnect, slaesh CC2652RB
  '10c4:ea60': { label: 'CP2102N based dongle (Sonoff ZBDongle-P / SkyConnect)', adapter: 'zstack', baudRate: 115200 },
  // CH9102F - Sonoff ZBDongle-E (EFR32MG21)
  '1a86:55d4': { label: 'Sonoff ZBDongle-E (EFR32MG21)', adapter: 'ember', baudRate: 115200 },
  '1a86:7523': { label: 'CH340 based Zigbee dongle', adapter: 'zstack', baudRate: 115200 },
  // Silicon Labs EFR32 native USB
  '1366:1015': { label: 'Silicon Labs EFR32MG21 (J-Link)', adapter: 'ember', baudRate: 115200 },
  // Dresden Elektronik
  '1cf1:0030': { label: 'ConBee II / RaspBee II', adapter: 'deconz', baudRate: 38400 },
  '0403:6001': { label: 'ConBee I', adapter: 'deconz', baudRate: 38400 },
  // ZiGate
  '067b:2303': { label: 'ZiGate (PL2303)', adapter: 'zigate', baudRate: 115200 },
};

/** Manufacturer strings that hint at a Zigbee dongle when the ids are unknown. */
const MANUFACTURER_HINTS = [
  'texas instruments',
  'silicon labs',
  'silabs',
  'itead',
  'sonoff',
  'dresden',
  'nabu casa',
  'zigbee',
];

/**
 * Enumerates USB serial ports so the UI can suggest which one carries the
 * Zigbee coordinator.
 *
 * `serialport` is a native module and is declared as an optional dependency:
 * in a container that never sees a USB device the build should not fail just
 * because prebuilt binaries are unavailable. It is therefore loaded lazily and
 * a missing module degrades to "detection unavailable" instead of a crash.
 */
@Injectable()
export class SerialDetectionService {
  private readonly logger = new Logger(SerialDetectionService.name);
  private moduleUnavailableReason: string | null = null;

  async listPorts(): Promise<DetectedSerialPort[]> {
    const SerialPortClass = await this.loadSerialPort();
    if (!SerialPortClass) return [];

    try {
      const ports = await SerialPortClass.list();
      return ports.map((port) => this.describe(port));
    } catch (error) {
      this.logger.warn(`Enumerating serial ports failed: ${(error as Error).message}`);
      return [];
    }
  }

  /** The most likely coordinator port, or null when nothing matched. */
  async detectCoordinatorPort(): Promise<DetectedSerialPort | null> {
    const ports = await this.listPorts();
    return ports.find((port) => port.isZigbeeCoordinator) ?? null;
  }

  get detectionAvailable(): boolean {
    return this.moduleUnavailableReason === null;
  }

  get unavailableReason(): string | null {
    return this.moduleUnavailableReason;
  }

  private describe(port: {
    path: string;
    manufacturer?: string;
    serialNumber?: string;
    vendorId?: string;
    productId?: string;
  }): DetectedSerialPort {
    const vendorId = port.vendorId?.toLowerCase() ?? null;
    const productId = port.productId?.toLowerCase() ?? null;
    const key = vendorId && productId ? `${vendorId}:${productId}` : '';
    const known = KNOWN_ADAPTERS[key];

    const manufacturer = port.manufacturer ?? null;
    const hinted =
      !known &&
      !!manufacturer &&
      MANUFACTURER_HINTS.some((hint) => manufacturer.toLowerCase().includes(hint));

    return {
      path: port.path,
      manufacturer,
      serialNumber: port.serialNumber ?? null,
      vendorId,
      productId,
      isZigbeeCoordinator: Boolean(known) || hinted,
      label: known?.label ?? (hinted ? `${manufacturer} (possible coordinator)` : null),
      suggestedAdapter: known?.adapter ?? (hinted ? 'zstack' : null),
      suggestedBaudRate: known?.baudRate ?? (hinted ? 115200 : null),
    };
  }

  /** Dynamic import so a missing native binary never breaks startup. */
  private async loadSerialPort(): Promise<
    | {
        list: () => Promise<
          Array<{
            path: string;
            manufacturer?: string;
            serialNumber?: string;
            vendorId?: string;
            productId?: string;
          }>
        >;
      }
    | null
  > {
    try {
      // eslint-disable-next-line @typescript-eslint/no-var-requires
      const module = (await import('serialport')) as unknown as {
        SerialPort?: { list: () => Promise<never[]> };
      };
      const SerialPortClass = module.SerialPort;
      if (!SerialPortClass) {
        this.moduleUnavailableReason = 'serialport module did not export SerialPort';
        return null;
      }
      this.moduleUnavailableReason = null;
      return SerialPortClass as never;
    } catch (error) {
      if (!this.moduleUnavailableReason) {
        this.moduleUnavailableReason = `serialport is not installed (${(error as Error).message})`;
        this.logger.warn(
          'Serial port detection unavailable - install the optional "serialport" dependency to enable it',
        );
      }
      return null;
    }
  }
}
