#!/usr/bin/env node

import { existsSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawn, spawnSync } from 'node:child_process';
import process from 'node:process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const launcher = join(root, 'scripts', 'zigbee-launcher.mjs');
const isWin = process.platform === 'win32';
const isMac = process.platform === 'darwin';
const osLabel =
  { win32: 'Windows', darwin: 'macOS', linux: 'Linux' }[process.platform] ??
  process.platform;

function run(command, args, options = {}) {
  const result = spawnSync(command, args, {
    cwd: root,
    stdio: 'inherit',
    shell: isWin,
    ...options,
  });
  if (result.status !== 0) {
    throw new Error(`${command} ${args.join(' ')} failed (exit ${result.status ?? 1})`);
  }
}

function runQuiet(command, args) {
  return spawnSync(command, args, {
    cwd: root,
    encoding: 'utf8',
    shell: isWin,
  });
}

function dockerReady() {
  const result = runQuiet('docker', ['info']);
  return result.status === 0;
}

function sleep(ms) {
  spawnSync(isWin ? 'powershell' : 'sleep', isWin ? ['-Command', `Start-Sleep -Seconds ${ms / 1000}`] : [String(ms / 1000)], {
    stdio: 'ignore',
    shell: isWin,
  });
}

function ensureNodeDeps() {
  if (existsSync(join(root, 'node_modules', 'serialport'))) return;
  console.log('Installing launcher dependencies...');
  run('npm', ['install', '--no-audit', '--no-fund']);
}

function startDockerDesktop() {
  if (dockerReady()) return;

  console.log('Docker is not running. Trying to start it...');

  if (isWin) {
    const candidates = [
      process.env['ProgramFiles'] + '\\Docker\\Docker\\Docker Desktop.exe',
      process.env['ProgramFiles(x86)'] + '\\Docker\\Docker\\Docker Desktop.exe',
    ].filter((path) => path && existsSync(path));
    if (candidates.length === 0) {
      throw new Error('Docker Desktop not found. Start Docker manually, then run start again.');
    }
    spawn(candidates[0], [], { detached: true, stdio: 'ignore' }).unref();
  } else if (isMac) {
    const result = runQuiet('open', ['-a', 'Docker']);
    if (result.status !== 0) {
      throw new Error('Could not open Docker Desktop. Start Docker manually, then retry.');
    }
  } else {
    throw new Error(
      'Docker daemon is not running. Start it with: sudo systemctl start docker',
    );
  }

  for (let attempt = 1; attempt <= 40; attempt += 1) {
    if (dockerReady()) {
      console.log('Docker is ready.');
      return;
    }
    sleep(3000);
  }
  throw new Error('Docker did not become ready in time.');
}

function bridgeOnline() {
  const result = runQuiet('docker', [
    'compose',
    'exec',
    '-T',
    'mosquitto',
    'mosquitto_sub',
    '-t',
    'zigbee2mqtt/bridge/state',
    '-C',
    '1',
    '-W',
    '2',
  ]);
  return result.stdout?.includes('"online"') ?? false;
}

function zigbeeProcessRunning() {
  if (isWin) {
    const ps = runQuiet('powershell', [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'zigbee-launcher|zigbee2mqtt.*index\\.js' } | Select-Object -ExpandProperty ProcessId",
    ]);
    return Boolean(ps.stdout?.trim());
  }
  const pgrep = runQuiet('pgrep', ['-f', 'zigbee-launcher.mjs|zigbee2mqtt.*/index\\.js']);
  return pgrep.status === 0;
}

function startZigbeeInNewTerminal() {
  const command = `cd ${JSON.stringify(root)} && npm run zigbee:start`;

  if (isWin) {
    spawn('cmd', ['/c', 'start', 'Zigbee2MQTT', 'cmd', '/k', `cd /d "${root}" && npm run zigbee:start`], {
      cwd: root,
      detached: true,
      stdio: 'ignore',
      shell: true,
    }).unref();
    console.log('Opened Zigbee2MQTT in a new terminal window.');
    return;
  }

  if (isMac) {
    const script = `tell application "Terminal" to do script "${command.replace(/"/g, '\\"')}"`;
    const result = runQuiet('osascript', ['-e', script]);
    if (result.status === 0) {
      console.log('Opened Zigbee2MQTT in Terminal.app.');
      return;
    }
  }

  if (process.env.DISPLAY || process.env.WAYLAND_DISPLAY) {
    const terminals = [
      ['gnome-terminal', ['--', 'bash', '-lc', command]],
      ['xterm', ['-e', `bash -lc ${JSON.stringify(command)}`]],
      ['konsole', ['-e', 'bash', '-lc', command]],
    ];
    for (const [bin, args] of terminals) {
      const check = runQuiet('which', [bin]);
      if (check.status !== 0) continue;
      spawn(bin, args, { cwd: root, detached: true, stdio: 'ignore' }).unref();
      console.log(`Opened Zigbee2MQTT in ${bin}.`);
      return;
    }
  }

  // Headless fallback: run in background (logs go to this process stdout if attached).
  const child = spawn(process.execPath, [launcher], {
    cwd: root,
    detached: true,
    stdio: 'ignore',
    env: process.env,
  });
  child.unref();
  console.log('Started Zigbee2MQTT in the background (no GUI terminal found).');
}

function printBanner() {
  console.log('');
  console.log('============================================================');
  console.log(' SmartHome is starting');
  console.log('============================================================');
  console.log('  Web UI:     http://localhost:8081');
  console.log('  API docs:   http://localhost:3000/api/docs');
  console.log('  Z2M UI:     http://localhost:8080');
  console.log('  Login:      admin@local / admin123');
  console.log('============================================================');
  console.log('');
}

async function main() {
  console.log('============================================================');
  console.log(` SmartHome - one-click start (${osLabel})`);
  console.log('============================================================');
  console.log('');

  console.log(`[1/5] OS: ${osLabel} (${process.arch})`);
  console.log('');

  console.log('[2/5] Dependencies...');
  ensureNodeDeps();
  console.log('');

  console.log('[3/5] Docker...');
  startDockerDesktop();
  console.log('');

  console.log('[4/5] Starting postgres, mosquitto, backend, frontend...');
  run('docker', ['compose', 'up', '-d', 'postgres', 'mosquitto', 'backend', 'frontend']);
  console.log('');

  console.log('[5/5] Zigbee coordinator...');
  const detect = spawnSync(process.execPath, [launcher, '--dry-run'], {
    cwd: root,
    stdio: 'inherit',
    env: process.env,
  });
  if (detect.status !== 0) {
    console.log('');
    console.log('WARNING: Could not auto-detect the Zigbee dongle.');
    console.log('  Plug in the USB coordinator, or set:');
    if (isWin) {
      console.log('    set ZIGBEE_PORT=COM5');
      console.log('    set ZIGBEE_ADAPTER=ember');
    } else {
      console.log('    export ZIGBEE_PORT=/dev/ttyUSB0');
      console.log('    export ZIGBEE_ADAPTER=ember   # E=ember, P=zstack');
    }
    console.log('');
  }

  if (bridgeOnline()) {
    console.log('Zigbee2MQTT bridge already online - skipping start.');
  } else if (zigbeeProcessRunning()) {
    console.log('Zigbee2MQTT process already running - skipping start.');
  } else {
    startZigbeeInNewTerminal();
  }

  printBanner();
}

main().catch((error) => {
  console.error(`\nStart failed: ${error.message}`);
  process.exitCode = 1;
});
