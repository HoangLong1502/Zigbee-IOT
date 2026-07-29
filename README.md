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

## Quick start (Docker)

### 1. Prerequisites

- Docker Desktop / Docker Engine with Compose v2
- A Zigbee USB coordinator
- **Windows note:** Docker Desktop cannot pass a COM port into a container. Run Zigbee2MQTT **natively on Windows** (step 3) and leave the `zigbee` Compose profile disabled. On Linux you can enable it.

### 2. Start the platform services

```bash
cp .env.example .env
docker compose up -d postgres mosquitto backend frontend
```

| Service | URL |
| --- | --- |
| Frontend | http://localhost:8081 |
| Backend API / Swagger | http://localhost:3000/api/docs |
| Mosquitto MQTT | localhost:1883 |
| PostgreSQL | localhost:5432 |

Default login: **admin@local** / **admin123**

### 3. Run Zigbee2MQTT

#### Linux (Docker profile)

1. Find the dongle: `ls -l /dev/serial/by-id/`
2. Set `ZIGBEE_ADAPTER` in `.env`
3. Edit `docker/zigbee2mqtt/data/configuration.yaml` (`adapter: zstack` for CC2652P, `ember` for EFR32MG21)
4. Start it:

```bash
docker compose --profile zigbee up -d zigbee2mqtt
```

Zigbee2MQTT UI (optional): http://localhost:8080

#### Windows (native)

1. Install [Zigbee2MQTT](https://www.zigbee2mqtt.io/guide/installation/01_linux.html) (or run via Node / the Windows guide)
2. Point its `mqtt.server` at `mqtt://localhost:1883`
3. Set `serial.port` to your COM port (e.g. `COM3`) and the matching `adapter`
4. You can copy `docker/zigbee2mqtt/data/configuration.yaml` as a starting point — change `server` to `mqtt://localhost:1883` and `port` to `COMx`

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
├── docker/
│   ├── mosquitto/config/mosquitto.conf
│   └── zigbee2mqtt/data/configuration.yaml
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
| `JWT_SECRET` | change-me… | Sign tokens |
| `ADMIN_EMAIL` / `ADMIN_PASSWORD` | admin@local / admin123 | Seeded on first boot |
| `ALERT_LOW_BATTERY_PERCENT` | 20 | Low-battery threshold |
| `ALERT_HIGH_TEMPERATURE_C` | 40 | High-temp threshold |
| `HISTORY_RETENTION_DAYS` | 90 | Time-series prune |
| `MQTT_LOG_RETENTION_HOURS` | 48 | Log prune |

---

## Production notes

- Change `JWT_SECRET`, `ADMIN_PASSWORD` and Mosquitto credentials before exposing the stack
- Set Mosquitto `allow_anonymous false` and create a password file
- Prefer `DB_SYNCHRONIZE=false` and proper migrations once the schema is stable
- Keep Zigbee2MQTT `network_key` / `pan_id` / `channel` stable — changing them forces every device to re-pair

---

## License

MIT
