import { type ReactNode } from 'react';
import { Navigate, Route, Routes } from 'react-router-dom';
import { useAuth } from '@/context/AuthContext';
import { AppLayout } from '@/components/layout/AppLayout';
import { Spinner } from '@/components/ui/Card';
import { LoginPage } from '@/pages/LoginPage';
import { DashboardPage } from '@/pages/DashboardPage';
import { DevicesPage } from '@/pages/DevicesPage';
import { DeviceDetailPage } from '@/pages/DeviceDetailPage';
import { TopologyPage } from '@/pages/TopologyPage';
import { MqttLogsPage } from '@/pages/MqttLogsPage';
import { AlertsPage } from '@/pages/AlertsPage';
import { CoordinatorPage } from '@/pages/CoordinatorPage';
import { SettingsPage } from '@/pages/SettingsPage';

function Protected({ children }: { children: ReactNode }) {
  const { isAuthenticated, loading } = useAuth();

  if (loading) {
    return (
      <div className="flex min-h-full items-center justify-center">
        <Spinner className="h-8 w-8" />
      </div>
    );
  }

  if (!isAuthenticated) return <Navigate to="/login" replace />;
  return children;
}

export default function App() {
  return (
    <Routes>
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <AppLayout />
          </Protected>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="devices" element={<DevicesPage />} />
        <Route path="devices/:id" element={<DeviceDetailPage />} />
        <Route path="topology" element={<TopologyPage />} />
        <Route path="mqtt" element={<MqttLogsPage />} />
        <Route path="alerts" element={<AlertsPage />} />
        <Route path="coordinator" element={<CoordinatorPage />} />
        <Route path="settings" element={<SettingsPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
