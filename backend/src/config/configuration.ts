/**
 * Centralised, strongly typed application configuration.
 *
 * Everything is sourced from environment variables so the same image can run
 * in Docker, bare metal or CI without code changes.
 */

export interface AppConfig {
  nodeEnv: string;
  port: number;
  corsOrigin: string;
}

export interface DatabaseConfig {
  host: string;
  port: number;
  username: string;
  password: string;
  database: string;
  synchronize: boolean;
  logging: boolean;
}

export interface MqttConfig {
  url: string;
  username?: string;
  password?: string;
  /** Zigbee2MQTT `base_topic`, normally `zigbee2mqtt`. */
  baseTopic: string;
  clientId: string;
  reconnectPeriodMs: number;
  connectTimeoutMs: number;
}

export interface RetentionConfig {
  mqttLogRetentionHours: number;
  mqttLogMaxRows: number;
  historyRetentionDays: number;
  deviceOfflineTimeoutMinutes: number;
}

export interface AlertConfig {
  lowBatteryPercent: number;
  highTemperatureC: number;
}

export interface AuthConfig {
  enabled: boolean;
  jwtSecret: string;
  jwtExpiresIn: string;
  adminEmail: string;
  adminPassword: string;
}

export interface RootConfig {
  app: AppConfig;
  database: DatabaseConfig;
  mqtt: MqttConfig;
  retention: RetentionConfig;
  alerts: AlertConfig;
  auth: AuthConfig;
}

const bool = (value: string | undefined, fallback: boolean): boolean =>
  value === undefined || value === '' ? fallback : /^(1|true|yes|on)$/i.test(value);

const int = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseInt(value ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

const num = (value: string | undefined, fallback: number): number => {
  const parsed = Number.parseFloat(value ?? '');
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const configuration = (): RootConfig => ({
  app: {
    nodeEnv: process.env.NODE_ENV ?? 'development',
    port: int(process.env.PORT, 3000),
    corsOrigin: process.env.CORS_ORIGIN ?? '*',
  },
  database: {
    host: process.env.DB_HOST ?? 'localhost',
    port: int(process.env.DB_PORT, 5432),
    username: process.env.DB_USERNAME ?? 'zigbee',
    password: process.env.DB_PASSWORD ?? 'zigbee',
    database: process.env.DB_DATABASE ?? 'zigbee',
    synchronize: bool(process.env.DB_SYNCHRONIZE, true),
    logging: bool(process.env.DB_LOGGING, false),
  },
  mqtt: {
    url: process.env.MQTT_URL ?? 'mqtt://localhost:1883',
    username: process.env.MQTT_USERNAME || undefined,
    password: process.env.MQTT_PASSWORD || undefined,
    baseTopic: process.env.MQTT_BASE_TOPIC ?? 'zigbee2mqtt',
    clientId:
      process.env.MQTT_CLIENT_ID ||
      `zigbee-monitor-${Math.random().toString(16).slice(2, 10)}`,
    reconnectPeriodMs: int(process.env.MQTT_RECONNECT_PERIOD_MS, 5000),
    connectTimeoutMs: int(process.env.MQTT_CONNECT_TIMEOUT_MS, 30000),
  },
  retention: {
    mqttLogRetentionHours: int(process.env.MQTT_LOG_RETENTION_HOURS, 48),
    mqttLogMaxRows: int(process.env.MQTT_LOG_MAX_ROWS, 200000),
    historyRetentionDays: int(process.env.HISTORY_RETENTION_DAYS, 90),
    deviceOfflineTimeoutMinutes: int(process.env.DEVICE_OFFLINE_TIMEOUT_MINUTES, 60),
  },
  alerts: {
    lowBatteryPercent: num(process.env.ALERT_LOW_BATTERY_PERCENT, 20),
    highTemperatureC: num(process.env.ALERT_HIGH_TEMPERATURE_C, 40),
  },
  auth: {
    enabled: bool(process.env.AUTH_ENABLED, true),
    jwtSecret: process.env.JWT_SECRET ?? 'change-me-in-production',
    jwtExpiresIn: process.env.JWT_EXPIRES_IN ?? '7d',
    adminEmail: process.env.ADMIN_EMAIL ?? 'admin@local',
    adminPassword: process.env.ADMIN_PASSWORD ?? 'admin123',
  },
});
