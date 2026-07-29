import { Alert } from './alert.entity';
import { Coordinator } from './coordinator.entity';
import { DeviceAttribute } from './device-attribute.entity';
import { DeviceEvent } from './event.entity';
import { DeviceExpose } from './device-expose.entity';
import { Device } from './device.entity';
import { History } from './history.entity';
import { MqttLog } from './mqtt-log.entity';
import { OtaJob } from './ota-job.entity';
import { Role } from './role.entity';
import { Telemetry } from './telemetry.entity';
import { TopologySnapshot } from './topology.entity';
import { User } from './user.entity';

export * from './alert.entity';
export * from './coordinator.entity';
export * from './device-attribute.entity';
export * from './device-expose.entity';
export * from './device.entity';
export * from './event.entity';
export * from './history.entity';
export * from './mqtt-log.entity';
export * from './ota-job.entity';
export * from './role.entity';
export * from './telemetry.entity';
export * from './topology.entity';
export * from './user.entity';

/** Every entity registered with TypeORM. */
export const ALL_ENTITIES = [
  Alert,
  Coordinator,
  Device,
  DeviceAttribute,
  DeviceEvent,
  DeviceExpose,
  History,
  MqttLog,
  OtaJob,
  Role,
  Telemetry,
  TopologySnapshot,
  User,
];
