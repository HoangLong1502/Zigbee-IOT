#!/usr/bin/env node

import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';
import { config as loadEnv } from 'dotenv';
import { SerialPort } from 'serialport';
import YAML from 'yaml';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
loadEnv({ path: join(root, '.env'), quiet: true });
const nativeRoot = join(root, 'zigbee2mqtt-native');
const legacyRoot = join(root, 'zigbee2mqtt-windows');
const args = new Set(process.argv.slice(2));

const KNOWN_DONGLES = new Map([
  ['0451:bef3', { adapter: 'zstack', label: 'TI CC1352P/CC2652P' }],
  ['0403:6015', { adapter: 'zstack', label: 'Electrolama zzh (CC2652R)' }],
  ['1a86:55d4', { adapter: 'ember', label: 'Sonoff ZBDongle-E (EFR32MG21)' }],
  ['1cf1:0030', { adapter: 'deconz', label: 'ConBee II' }],
  ['1366:1015', { adapter: 'ember', label: 'Silicon Labs EFR32' }],
  // Both ZBDongle-P and some ZBDongle-E revisions use this USB bridge.
  ['10c4:ea60', { adapter: null, label: 'CP210x Zigbee coordinator (P or E)' }],
]);

const normalizeId = (value) => String(value ?? '').toLowerCase().padStart(4, '0');
const usbId = (port) => `${normalizeId(port.vendorId)}:${normalizeId(port.productId)}`;
const textOf = (port) =>
  [port.path, port.manufacturer, port.friendlyName, port.pnpId]
    .filter(Boolean)
    .join(' ')
    .toLowerCase();

function inferAdapter(port, savedAdapter = null) {
  const rawOverride = process.env.ZIGBEE_ADAPTER?.trim();
  // Older project versions used ZIGBEE_ADAPTER for a Linux /dev path.
  const override = rawOverride && !/[\\/]/.test(rawOverride) ? rawOverride : null;
  if (override) return override;

  const text = textOf(port);
  if (/zbdongle[-_ ]?e|efr32|ember|skyconnect|slzb-06m/.test(text)) return 'ember';
  if (/zbdongle[-_ ]?p|cc26|cc13|zstack|electrolama|zzh/.test(text)) return 'zstack';
  if (/conbee|deconz/.test(text)) return 'deconz';

  const fromUsb = KNOWN_DONGLES.get(usbId(port))?.adapter ?? null;
  if (fromUsb) return fromUsb;

  // CP210x (10C4:EA60) is shared by ZBDongle-P and E — reuse a prior config.
  if (savedAdapter) return savedAdapter;
  return null;
}

function readSavedSerialConfig(dataDir) {
  const configPath = join(dataDir, 'configuration.yaml');
  if (!existsSync(configPath)) return { port: null, adapter: null };
  try {
    const config = YAML.parse(readFileSync(configPath, 'utf8')) ?? {};
    return {
      port: typeof config.serial?.port === 'string' ? config.serial.port.trim() : null,
      adapter: typeof config.serial?.adapter === 'string' ? config.serial.adapter.trim() : null,
    };
  } catch {
    return { port: null, adapter: null };
  }
}

function scorePort(port) {
  const id = usbId(port);
  const text = textOf(port);
  let score = KNOWN_DONGLES.has(id) ? 100 : 0;
  if (/zigbee|sonoff|itead|efr32|cc26|cc13|conbee|skyconnect|electrolama/.test(text)) score += 40;
  if (/bluetooth/.test(text)) score -= 100;
  return score;
}

async function detectPort() {
  const override = process.env.ZIGBEE_PORT?.trim();
  const ports = await SerialPort.list();

  if (args.has('--list')) {
    if (ports.length === 0) {
      console.log('No serial ports found.');
      return null;
    }
    for (const port of ports) {
      const known = KNOWN_DONGLES.get(usbId(port));
      console.log(
        [
          port.path,
          usbId(port) === '0000:0000' ? null : usbId(port),
          known?.label ?? port.manufacturer,
          `adapter=${inferAdapter(port) ?? 'ambiguous'}`,
        ]
          .filter(Boolean)
          .join('  |  '),
      );
    }
    return null;
  }

  if (override) {
    const matched = ports.find((port) => port.path.toLowerCase() === override.toLowerCase());
    return matched ?? { path: override };
  }

  const candidates = ports
    .map((port) => ({ port, score: scorePort(port) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    throw new Error(
      `No Zigbee USB coordinator found on ${process.platform}. ` +
        'Run "npm run zigbee:list" or set ZIGBEE_PORT explicitly.',
    );
  }

  if (candidates.length > 1 && candidates[0].score === candidates[1].score) {
    throw new Error(
      `Multiple possible coordinators found (${candidates
        .map(({ port }) => port.path)
        .join(', ')}). Set ZIGBEE_PORT explicitly.`,
    );
  }

  return candidates[0].port;
}

function hasLegacyNetworkState() {
  return ['database.db', 'state.json', 'coordinator_backup.json'].some((name) =>
    existsSync(join(legacyRoot, 'data', name)),
  );
}

function resolveDataDir() {
  if (process.env.ZIGBEE_DATA_DIR) return resolve(process.env.ZIGBEE_DATA_DIR);
  // Preserve an existing Windows installation/network so devices do not need
  // to be paired again after switching to this cross-platform launcher.
  if (hasLegacyNetworkState()) return join(legacyRoot, 'data');
  return join(nativeRoot, 'data');
}

function resolveSourceDir() {
  if (process.env.ZIGBEE2MQTT_SOURCE_DIR) return resolve(process.env.ZIGBEE2MQTT_SOURCE_DIR);
  const legacySource = join(legacyRoot, 'zigbee2mqtt');
  if (existsSync(join(legacySource, 'package.json'))) return legacySource;
  return join(nativeRoot, 'zigbee2mqtt');
}

function restoreConfiguration(dataDir) {
  const target = join(dataDir, 'configuration.yaml');
  if (existsSync(target)) return target;

  mkdirSync(dataDir, { recursive: true });
  const backups = existsSync(dataDir)
    ? readdirSync(dataDir)
        .filter((name) => /^configuration_backup_v\d+\.yaml$/.test(name))
        .sort((a, b) => b.localeCompare(a, undefined, { numeric: true }))
    : [];

  if (backups[0]) {
    writeFileSync(target, readFileSync(join(dataDir, backups[0])));
    console.log(`Restored configuration from ${backups[0]}`);
    return target;
  }

  writeFileSync(
    target,
    YAML.stringify({
      homeassistant: { enabled: false },
      frontend: { enabled: true, port: 8080, host: '0.0.0.0' },
      permit_join: false,
      mqtt: {
        base_topic: 'zigbee2mqtt',
        server: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
        include_device_information: true,
      },
      serial: { port: '', adapter: '' },
      advanced: {
        pan_id: 'GENERATE',
        ext_pan_id: 'GENERATE',
        network_key: 'GENERATE',
        channel: 11,
        last_seen: 'ISO_8601',
        log_level: 'info',
      },
      availability: { enabled: true },
      device_options: { retain: false },
      devices: {},
      groups: {},
    }),
  );
  return target;
}

function updateConfiguration(configPath, port, adapter) {
  const config = YAML.parse(readFileSync(configPath, 'utf8')) ?? {};
  config.mqtt ??= {};
  config.mqtt.base_topic ??= 'zigbee2mqtt';
  config.mqtt.server = process.env.MQTT_URL ?? 'mqtt://localhost:1883';
  config.mqtt.include_device_information ??= true;
  config.serial ??= {};
  config.serial.port = port.path;
  config.serial.adapter = adapter;
  config.serial.baudrate = Number(process.env.ZIGBEE_BAUD ?? config.serial.baudrate ?? 115200);
  config.frontend ??= {};
  config.frontend.enabled ??= true;
  config.frontend.port ??= 8080;
  config.frontend.host ??= '0.0.0.0';
  config.availability ??= {};
  config.availability.enabled ??= true;
  writeFileSync(configPath, YAML.stringify(config), 'utf8');
}

function run(command, commandArgs, options = {}) {
  const result = spawnSync(command, commandArgs, {
    cwd: root,
    stdio: 'inherit',
    shell: process.platform === 'win32',
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${commandArgs.join(' ')} failed with exit code ${result.status}`);
  }
}

function ensureZigbee2Mqtt(sourceDir) {
  if (!existsSync(join(sourceDir, 'package.json'))) {
    mkdirSync(dirname(sourceDir), { recursive: true });
    console.log('Cloning Zigbee2MQTT...');
    run('git', ['clone', '--depth', '1', 'https://github.com/Koenkk/zigbee2mqtt.git', sourceDir]);
  }
  if (!existsSync(join(sourceDir, 'node_modules'))) {
    console.log('Installing Zigbee2MQTT dependencies...');
    run('npm', ['install', '--no-audit', '--no-fund'], { cwd: sourceDir });
  }
}

async function main() {
  const dataDir = resolveDataDir();
  const saved = readSavedSerialConfig(dataDir);
  const port = await detectPort();
  if (args.has('--list')) return;

  const adapter = inferAdapter(port, saved.adapter);
  if (!adapter) {
    throw new Error(
      `${port.path} (${usbId(port)}) can be either ZBDongle-P or ZBDongle-E. ` +
        'Set ZIGBEE_ADAPTER=zstack for P or ZIGBEE_ADAPTER=ember for E.',
    );
  }

  const sourceDir = resolveSourceDir();

  console.log(`OS:       ${process.platform}`);
  console.log(`Port:     ${port.path}`);
  console.log(`Adapter:  ${adapter}`);
  console.log(`Data:     ${dataDir}`);
  console.log(`MQTT:     ${process.env.MQTT_URL ?? 'mqtt://localhost:1883'}`);

  if (args.has('--dry-run')) {
    console.log('Dry run complete; no files were changed and Zigbee2MQTT was not started.');
    return;
  }

  const configPath = restoreConfiguration(dataDir);
  updateConfiguration(configPath, port, adapter);
  ensureZigbee2Mqtt(sourceDir);
  const child = spawn(process.execPath, ['index.js'], {
    cwd: sourceDir,
    stdio: 'inherit',
    env: { ...process.env, ZIGBEE2MQTT_DATA: dataDir },
  });
  child.on('exit', (code, signal) => {
    if (signal) process.kill(process.pid, signal);
    process.exitCode = code ?? 1;
  });
}

main().catch((error) => {
  console.error(`\nZigbee launcher error: ${error.message}`);
  process.exitCode = 1;
});
