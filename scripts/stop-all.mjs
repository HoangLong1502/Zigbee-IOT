#!/usr/bin/env node

import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import process from 'node:process';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const isWin = process.platform === 'win32';

function run(command, args) {
  spawnSync(command, args, { cwd: root, stdio: 'inherit', shell: isWin });
}

function killZigbeeProcesses() {
  console.log('Stopping Zigbee2MQTT processes...');
  if (isWin) {
    run('powershell', [
      '-NoProfile',
      '-Command',
      "Get-CimInstance Win32_Process -Filter \"Name='node.exe'\" | Where-Object { $_.CommandLine -match 'zigbee-launcher|zigbee2mqtt.*index\\.js' } | ForEach-Object { Stop-Process -Id $_.ProcessId -Force -ErrorAction SilentlyContinue }",
    ]);
    return;
  }
  spawnSync('pkill', ['-f', 'zigbee-launcher.mjs'], { stdio: 'ignore' });
  spawnSync('pkill', ['-f', 'zigbee2mqtt.*/index.js'], { stdio: 'ignore' });
}

console.log('Stopping SmartHome stack...');
killZigbeeProcesses();
console.log('Stopping Docker services...');
run('docker', ['compose', 'down']);
console.log('Done.');
