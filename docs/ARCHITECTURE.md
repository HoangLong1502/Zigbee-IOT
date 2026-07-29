# Architecture

## Clean Architecture (backend)

```
src/
  domain/entities/     ← persistence models (innermost)
  common/              ← Zigbee wire types, expose flattener, WS event names
  config/              ← env → typed configuration
  modules/
    mqtt/              ← transport (MqttService) + commands + ingestion
    device/ … ota/     ← application services + REST controllers
    websocket/         ← Socket.IO gateway (outbound real-time)
    auth/              ← JWT + roles
```

Dependency direction: controllers → services → repositories (TypeORM) → entities.
Cross-cutting concerns (MQTT client, WebSocket gateway) are `@Global()` modules.

## Zigbee2MQTT contract

| Topic | Owner |
| --- | --- |
| `bridge/state` | Coordinator online/offline |
| `bridge/info` | Firmware, PAN, channel, permit join |
| `bridge/devices` | Full device inventory + exposes |
| `bridge/event` | join / leave / interview / announce |
| `bridge/logging` | Bridge log stream → events |
| `bridge/response/<cmd>` | Correlated with `ZigbeeCommandService` |
| `<friendly_name>` | Device state → telemetry + history + alerts |
| `<friendly_name>/availability` | Online / offline |
| `<friendly_name>/set\|get` | Write path from the UI |

## Dynamic exposes

1. Zigbee2MQTT publishes nested `definition.exposes`
2. `flattenExposes()` walks grouping types (`light`, `switch`, `climate`, …) and produces one row per addressable `property`
3. Rows are upserted into `device_exposes`
4. The React `ExposeRenderer` picks a control by `type` (`numeric` → slider, `binary` → toggle, `enum` → select, else text) and only enables writes when `access & 2`

No sensor name is ever hardcoded in the render path.

## Real-time path

```
MQTT frame
  → MqttService.message$
  → MqttIngestionService (topic router)
  → DeviceService / TelemetryService / HistoryService / AlertService / …
  → RealtimeGateway.emit(...)
  → Socket.IO
  → useRealtimeBridge() invalidates TanStack Query / updates UI
```

## Database

Normalised PostgreSQL schema (TypeORM entities, `synchronize` on by default for first run):

`devices`, `device_exposes`, `device_attributes`, `telemetry`, `history`,
`events`, `mqtt_logs`, `topology_snapshots`, `coordinators`, `ota_jobs`,
`alerts`, `users`, `roles`, `user_roles`

Retention crons prune `mqtt_logs`, `telemetry` and `history`.
