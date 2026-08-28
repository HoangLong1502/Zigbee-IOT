# Zigbee IoT Monitoring Platform

Real-time Zigbee device monitoring built around Zigbee2MQTT.

```
Zigbee Devices
      │
      ▼
USB Zigbee Coordinator  (CC2652P / EFR32MG21 / …)
      │
      ▼
Zigbee2MQTT
      │ MQTT
      ▼
Mosquitto MQTT Broker
      │
      ▼
NestJS Backend  ── PostgreSQL
      │           ── Socket.IO
      │           ── REST + Swagger
      ▼
React Frontend  (Tailwind, TanStack Query, Recharts)
```

Nothing about sensors is hardcoded. The backend reads Zigbee2MQTT **exposes** dynamically and the frontend renders controls from that metadata, so a brand-new device type works without a code change.

---

## Features

| Area | Capabilities |
| --- | --- |
| Coordinator | USB auto-detection, serial/baud/adapter, PAN ID, channel, extended PAN ID, network key, permit join, firmware info |
| Devices | Auto-discovery, online/offline, LQI, battery, interview status, rename/remove/ping/identify/reconfigure/OTA |
| Dynamic exposes | numeric / binary / enum / text / light / switch / … rendered from metadata |
| Real-time | Socket.IO pushes telemetry, alerts, topology, MQTT frames, OTA progress |
| History | Per-property time series with hour / today / 24h / 7d / 30d charts |
| Topology | Mesh visualisation with parent-child links and LQI |
| MQTT logs | Live firehose with filter, search and JSON export |
| Alerts | Low battery, offline, high temp, water leak, smoke, unexpected join/leave + browser notifications |
| Auth | JWT with admin / operator / viewer roles |

---

## Quick start (Windows, Linux, macOS)

### 1. Prerequisites

- Docker Desktop / Docker Engine with Compose v2
- Node.js 20+
- A Zigbee USB coordinator

The application services run in Docker. Zigbee2MQTT runs natively through the
same Node.js launcher on all three operating systems, avoiding USB passthrough
differences in Docker Desktop.

### 2. One command start (all platforms)

```bash
cp .env.example .env   # first time only
npm install            # first time only
npm run start
```

Or use the OS wrapper:

| OS | Start | Stop |
| --- | --- | --- |
| Windows | `start.bat` | `stop.bat` |
| Linux / macOS | `sh start.sh` | `sh stop.sh` |

`npm run start` will:

1. Detect OS (Windows / Linux / macOS)
2. Start Docker if needed (Desktop on Windows/macOS)
3. Run `docker compose up` for postgres, mosquitto, backend, frontend
4. Auto-detect Zigbee USB port + adapter
5. Open Zigbee2MQTT (new terminal on Windows/macOS, or background on headless Linux)

| Service | URL |
| --- | --- |
| Frontend | http://localhost:8081 |
| Backend API / Swagger | http://localhost:3000/api/docs |
| Mosquitto MQTT | localhost:1883 |
| PostgreSQL | localhost:5432 |
| Zigbee2MQTT UI | http://localhost:8080 |

Default login: **admin@local** / **admin123**

### 3. Zigbee only (optional)

```bash
npm run zigbee:list
npm run zigbee:detect
npm run zigbee:start
```

Wrappers: `start-zigbee.bat` (Windows) · `./start-zigbee.sh` (Linux/macOS)

The launcher detects these platform-specific port formats automatically:

- Windows: `COM5`
- Linux: `/dev/ttyUSB0`, `/dev/ttyACM0`, or `/dev/serial/by-id/...`
- macOS: `/dev/cu.usbserial-*` or `/dev/cu.usbmodem-*`

It then detects the adapter, updates the native Zigbee2MQTT configuration,
clones/installs Zigbee2MQTT when needed, and starts it with
`mqtt://localhost:1883`.

Some CP210x dongles share USB ID `10C4:EA60`, so hardware alone cannot reliably
distinguish ZBDongle-P from ZBDongle-E. Override when prompted:

```bash
# Windows PowerShell
$env:ZIGBEE_PORT = "COM5"
$env:ZIGBEE_ADAPTER = "ember" # E=ember, P=zstack
npm run zigbee:start

# Linux/macOS
ZIGBEE_PORT=/dev/serial/by-id/your-dongle \
ZIGBEE_ADAPTER=ember npm run zigbee:start
```

Existing state under `zigbee2mqtt-windows/data` is reused automatically, so
upgrading to this launcher does not change the network key or require pairing
devices again.

Zigbee2MQTT UI: http://localhost:8080

#### Optional Linux Docker profile

Native mode above is recommended and consistent across platforms. Linux may
still run Zigbee2MQTT in Docker:

```bash
# Set ZIGBEE_DEVICE=/dev/serial/by-id/... in .env first
docker compose --profile zigbee up -d zigbee2mqtt
```

### 4. Pair devices

1. Open **Coordinator** in the web UI
2. Click **Enable Permit Join**
3. Put each Zigbee device into pairing mode
4. Devices appear on the **Devices** page within seconds

---

## Local development (without Docker for app code)

```bash
# Infrastructure only
docker compose up -d postgres mosquitto

# Backend
cd backend
cp .env.example .env
npm install
npm run start:dev
# http://localhost:3000/api/docs

# Frontend (new terminal)
cd frontend
npm install
npm run dev
# http://localhost:5173  (proxies /api and /socket.io → :3000)
```

Optional native serial detection:

```bash
cd backend
npm install serialport
```

---

## Project layout

```
SmartHome/
├── docker-compose.yml
├── start.bat / start.sh       One-click start (all platforms)
├── stop.bat / stop.sh         Stop stack + Zigbee2MQTT
├── scripts/
│   ├── start-all.mjs          Docker + Zigbee orchestration
│   ├── stop-all.mjs
│   └── zigbee-launcher.mjs    Serial detection + native Z2M bootstrap
├── zigbee2mqtt-native/      Generated source/data (gitignored)
├── docker/
│   ├── mosquitto/config/mosquitto.conf
│   └── zigbee2mqtt/data/configuration.yaml  # Optional Linux Docker mode
├── backend/                 NestJS + TypeORM + MQTT.js + Socket.IO
│   └── src/
│       ├── config/
│       ├── domain/entities/ # Device, Expose, Telemetry, History, …
│       ├── common/          # Zigbee types, expose flattener, WS events
│       └── modules/
│           ├── mqtt/        # Client, commands, ingestion pipeline
│           ├── device/
│           ├── telemetry/
│           ├── history/
│           ├── topology/
│           ├── coordinator/ # + USB serial detection
│           ├── alert/
│           ├── event/
│           ├── ota/
│           ├── websocket/
│           ├── auth/
│           ├── dashboard/
│           └── settings/
└── frontend/                React + TS + Tailwind + TanStack Query
    └── src/
        ├── components/exposes/  # Dynamic expose renderer
        ├── pages/
        ├── lib/                 # api, realtime, utils
        └── context/
```

---

## Data flow (real-time path)

1. Zigbee device reports → USB coordinator
2. Zigbee2MQTT publishes `zigbee2mqtt/<friendly_name>` and `zigbee2mqtt/bridge/#`
3. Mosquitto brokers the message
4. `MqttService` receives it and pushes onto an RxJS stream
5. `MqttIngestionService` routes by topic:
   - `bridge/devices` → device discovery / expose sync
   - `bridge/info` → coordinator state
   - `bridge/event` → timeline events
   - `bridge/response/*` → command correlation + topology snapshots
   - `<device>` → telemetry + history + alert rules + OTA progress
   - `<device>/availability` → online/offline
6. Changes are written to PostgreSQL
7. `RealtimeGateway` emits Socket.IO events
8. React invalidates TanStack Query caches / updates charts — **no page refresh**

---

## REST API

Swagger UI: http://localhost:3000/api/docs

Key groups: `/api/auth`, `/api/dashboard`, `/api/devices`, `/api/telemetry`, `/api/history`, `/api/topology`, `/api/coordinator`, `/api/mqtt`, `/api/alerts`, `/api/events`, `/api/ota`, `/api/settings`.

Authentication: `Authorization: Bearer <jwt>`. Set `AUTH_ENABLED=false` to disable for a trusted LAN.

---

## Configuration

| Variable | Default | Meaning |
| --- | --- | --- |
| `DB_*` | zigbee/zigbee | PostgreSQL connection |
| `MQTT_URL` | `mqtt://localhost:1883` | Mosquitto |
| `MQTT_BASE_TOPIC` | `zigbee2mqtt` | Must match Zigbee2MQTT `base_topic` |
| `ZIGBEE_PORT` | auto | Native serial port override (`COM5`, `/dev/...`) |
| `ZIGBEE_ADAPTER` | auto | Native adapter override (`ember`, `zstack`, `deconz`) |
| `ZIGBEE_BAUD` | 115200 | Native coordinator baud rate |
| `ZIGBEE_DATA_DIR` | auto | Native Zigbee2MQTT data directory override |
| `ZIGBEE_DEVICE` | `/dev/ttyUSB0` | Linux Docker profile host device |
| `JWT_SECRET` | change-me… | Sign tokens |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | admin@local / admin123 | Seeded on first boot |
| `ALERT_LOW_BATTERY_PERCENT` | 20 | Low-battery threshold |
| `ALERT_HIGH_TEMPERATURE_C` | 40 | High-temp threshold |
| `HISTORY_RETENTION_DAYS` | 90 | Time-series prune |
| `MQTT_LOG_RETENTION_HOURS` | 48 | Log prune |

---

## Zigbee launcher troubleshooting

| Symptom | Fix |
| --- | --- |
| No coordinator found | Run `npm run zigbee:list`, then set `ZIGBEE_PORT` |
| CP210x adapter is ambiguous | Set `ZIGBEE_ADAPTER=ember` for E or `zstack` for P |
| `Access denied` / `Resource busy` | Stop the other process holding the serial port |
| Linux permission denied | Add the user to `dialout`, then log out/in |
| Zigbee2MQTT cannot reach MQTT | Start Mosquitto and keep `MQTT_URL=mqtt://localhost:1883` |

---

## Production notes

- Change `JWT_SECRET`, `ADMIN_PASSWORD` and Mosquitto credentials before exposing the stack
- Set Mosquitto `allow_anonymous false` and create a password file
- Prefer `DB_SYNCHRONIZE=false` and proper migrations once the schema is stable
- Keep Zigbee2MQTT `network_key` / `pan_id` / `channel` stable — changing them forces every device to re-pair

---

## License

MIT
