import axios, { AxiosError, AxiosInstance } from 'axios';
import type {
  Alert,
  AuthResponse,
  Coordinator,
  DashboardSummary,
  DetectedSerialPort,
  Device,
  DeviceEvent,
  DeviceExpose,
  DeviceStats,
  HistoryRange,
  HistorySeries,
  MqttLogEntry,
  MqttStatus,
  OtaJob,
  Paginated,
  TopologyGraph,
} from '@/types';

const TOKEN_KEY = 'zigbee_token';

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_KEY);
}

export function setToken(token: string | null): void {
  if (token) localStorage.setItem(TOKEN_KEY, token);
  else localStorage.removeItem(TOKEN_KEY);
}

/**
 * Axios client pointed at the NestJS API.
 *
 * In development Vite proxies `/api` to `http://localhost:3000`. In production
 * nginx does the same, so the relative base URL works in both environments.
 */
export const api: AxiosInstance = axios.create({
  baseURL: '/api',
  timeout: 60_000,
});

api.interceptors.request.use((config) => {
  const token = getToken();
  if (token) config.headers.Authorization = `Bearer ${token}`;
  return config;
});

api.interceptors.response.use(
  (response) => response,
  (error: AxiosError<{ message?: string | string[] }>) => {
    if (error.response?.status === 401) {
      setToken(null);
      if (!window.location.pathname.startsWith('/login')) {
        window.location.href = '/login';
      }
    }
    return Promise.reject(error);
  },
);

export function apiErrorMessage(error: unknown): string {
  if (axios.isAxiosError(error)) {
    const data = error.response?.data as { message?: string | string[] } | undefined;
    if (Array.isArray(data?.message)) return data.message.join(', ');
    if (typeof data?.message === 'string') return data.message;
    return error.message;
  }
  if (error instanceof Error) return error.message;
  return 'Unknown error';
}

// ---------------------------------------------------------------------------
// Auth
// ---------------------------------------------------------------------------

export const authApi = {
  login: (email: string, password: string) =>
    api.post<AuthResponse>('/auth/login', { email, password }).then((r) => r.data),
  me: () => api.get('/auth/me').then((r) => r.data),
};

// ---------------------------------------------------------------------------
// Dashboard / devices / coordinator / mqtt / ...
// ---------------------------------------------------------------------------

export const dashboardApi = {
  summary: () => api.get<DashboardSummary>('/dashboard/summary').then((r) => r.data),
  health: () => api.get('/dashboard/health').then((r) => r.data),
};

export const devicesApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<Paginated<Device>>('/devices', { params }).then((r) => r.data),
  get: (id: string) => api.get<Device>(`/devices/${encodeURIComponent(id)}`).then((r) => r.data),
  stats: () => api.get<DeviceStats>('/devices/stats').then((r) => r.data),
  exposes: (id: string) =>
    api.get<DeviceExpose[]>(`/devices/${encodeURIComponent(id)}/exposes`).then((r) => r.data),
  attributes: (id: string) =>
    api.get(`/devices/${encodeURIComponent(id)}/attributes`).then((r) => r.data),
  bindings: (id: string) =>
    api.get(`/devices/${encodeURIComponent(id)}/bindings`).then((r) => r.data),
  rename: (id: string, name: string) =>
    api.post(`/devices/${encodeURIComponent(id)}/rename`, { name }).then((r) => r.data),
  remove: (id: string, force = false, block = false) =>
    api.delete(`/devices/${encodeURIComponent(id)}`, { params: { force, block } }).then((r) => r.data),
  set: (id: string, payload: Record<string, unknown>) =>
    api.post(`/devices/${encodeURIComponent(id)}/set`, { payload }).then((r) => r.data),
  getState: (id: string, properties: string[]) =>
    api.post(`/devices/${encodeURIComponent(id)}/get`, { properties }).then((r) => r.data),
  configure: (id: string) =>
    api.post(`/devices/${encodeURIComponent(id)}/configure`).then((r) => r.data),
  interview: (id: string) =>
    api.post(`/devices/${encodeURIComponent(id)}/interview`).then((r) => r.data),
  ping: (id: string) =>
    api.post(`/devices/${encodeURIComponent(id)}/ping`).then((r) => r.data),
  identify: (id: string) =>
    api.post(`/devices/${encodeURIComponent(id)}/identify`).then((r) => r.data),
  factoryReset: (id: string) =>
    api.post(`/devices/${encodeURIComponent(id)}/factory-reset`).then((r) => r.data),
};

export const coordinatorApi = {
  get: () => api.get<Coordinator>('/coordinator').then((r) => r.data),
  ports: () => api.get<DetectedSerialPort[]>('/coordinator/ports').then((r) => r.data),
  update: (body: Record<string, unknown>) =>
    api.patch('/coordinator/settings', body).then((r) => r.data),
  permitJoin: (value: boolean, time?: number) =>
    api.post('/coordinator/permit-join', { value, time }).then((r) => r.data),
  restart: () => api.post('/coordinator/restart').then((r) => r.data),
  health: () => api.get('/coordinator/health').then((r) => r.data),
};

export const mqttApi = {
  status: () => api.get<MqttStatus>('/mqtt/status').then((r) => r.data),
  logs: (params?: Record<string, unknown>) =>
    api.get<Paginated<MqttLogEntry>>('/mqtt/logs', { params }).then((r) => r.data),
  export: (params?: Record<string, unknown>) =>
    api.get<MqttLogEntry[]>('/mqtt/logs/export', { params }).then((r) => r.data),
  clear: () => api.delete('/mqtt/logs').then((r) => r.data),
  publish: (topic: string, payload: string) =>
    api.post('/mqtt/publish', { topic, payload }).then((r) => r.data),
};

export const historyApi = {
  properties: (id: string) =>
    api
      .get<Array<{ property: string; unit: string | null; samples: number }>>(
        `/history/device/${encodeURIComponent(id)}/properties`,
      )
      .then((r) => r.data),
  series: (id: string, property: string, range: HistoryRange = '24h') =>
    api
      .get<HistorySeries>(
        `/history/device/${encodeURIComponent(id)}/${encodeURIComponent(property)}`,
        { params: { range } },
      )
      .then((r) => r.data),
};

export const topologyApi = {
  get: () => api.get<TopologyGraph>('/topology').then((r) => r.data),
  refresh: () => api.post<TopologyGraph>('/topology/refresh').then((r) => r.data),
  status: () => api.get<{ scanning: boolean }>('/topology/status').then((r) => r.data),
};

export const alertsApi = {
  list: (params?: Record<string, unknown>) =>
    api.get<Paginated<Alert>>('/alerts', { params }).then((r) => r.data),
  summary: () => api.get('/alerts/summary').then((r) => r.data),
  acknowledge: (id: string) =>
    api.post(`/alerts/${id}/acknowledge`).then((r) => r.data),
  resolve: (id: string) => api.post(`/alerts/${id}/resolve`).then((r) => r.data),
  acknowledgeAll: () => api.post('/alerts/acknowledge-all').then((r) => r.data),
};

export const eventsApi = {
  recent: (limit = 30) =>
    api.get<DeviceEvent[]>('/events/recent', { params: { limit } }).then((r) => r.data),
  list: (params?: Record<string, unknown>) =>
    api.get<Paginated<DeviceEvent>>('/events', { params }).then((r) => r.data),
};

export const otaApi = {
  jobs: () => api.get<OtaJob[]>('/ota/jobs').then((r) => r.data),
  check: (id: string) =>
    api.post<OtaJob>(`/ota/device/${encodeURIComponent(id)}/check`).then((r) => r.data),
  update: (id: string) =>
    api.post<OtaJob>(`/ota/device/${encodeURIComponent(id)}/update`).then((r) => r.data),
};

export const settingsApi = {
  get: () => api.get('/settings').then((r) => r.data),
  updateThresholds: (body: { lowBatteryPercent?: number; highTemperatureC?: number }) =>
    api.patch('/settings/thresholds', body).then((r) => r.data),
};
