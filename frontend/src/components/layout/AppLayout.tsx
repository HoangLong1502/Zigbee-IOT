import { NavLink, Outlet } from 'react-router-dom';
import {
  Activity,
  AlertTriangle,
  Cpu,
  Home,
  LogOut,
  Network,
  Radio,
  ScrollText,
  Settings,
  Wifi,
} from 'lucide-react';
import { cn } from '@/lib/utils';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { useRealtimeBridge } from '@/hooks/useRealtimeBridge';
import { PairingPromptModal } from '@/components/pairing/PairingPromptModal';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { LanguageToggle } from '@/components/ui/LanguageToggle';

const NAV = [
  { to: '/', label: 'Dashboard', icon: Home },
  { to: '/devices', label: 'Devices', icon: Cpu },
  { to: '/topology', label: 'Topology', icon: Network },
  { to: '/mqtt', label: 'MQTT Logs', icon: ScrollText },
  { to: '/alerts', label: 'Alerts', icon: AlertTriangle },
  { to: '/coordinator', label: 'Coordinator', icon: Radio },
  { to: '/settings', label: 'Settings', icon: Settings },
];

export function AppLayout() {
  const { user, logout } = useAuth();
  const { t } = useLanguage();
  const { connected } = useRealtimeBridge();

  return (
    <div className="flex min-h-full bg-surface-950">
      <aside className="sticky top-0 hidden h-screen w-64 shrink-0 flex-col border-r border-ink/10 bg-surface-900/80 px-4 py-5 backdrop-blur lg:flex">
        <div className="mb-8 flex items-center gap-3 px-2">
          <div className="flex h-10 w-10 items-center justify-center rounded-2xl bg-accent/20 text-accent-soft">
            <Activity className="h-5 w-5" />
          </div>
          <div>
            <p className="text-sm font-semibold text-ink">Zigbee Monitor</p>
            <p className="text-xs text-slate-400">{t('IoT Platform')}</p>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-1">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'flex items-center gap-3 rounded-xl px-3 py-2.5 text-sm font-medium transition',
                  isActive
                    ? 'bg-accent/15 text-ink'
                    : 'text-slate-400 hover:bg-ink/5 hover:text-slate-100',
                )
              }
            >
              <item.icon className="h-4 w-4" />
              {t(item.label)}
            </NavLink>
          ))}
        </nav>

        <div className="mt-auto space-y-3 border-t border-ink/10 pt-4">
          <div className="flex items-center justify-between px-2 text-xs">
            <span className="flex items-center gap-1.5 text-slate-400">
              <Wifi className={cn('h-3.5 w-3.5', connected ? 'text-success' : 'text-danger')} />
              {connected ? t('Live') : t('Offline')}
            </span>
            <LanguageToggle />
            <ThemeToggle />
          </div>
          <div className="flex items-center justify-between rounded-xl bg-ink/5 px-3 py-2">
            <div className="min-w-0">
              <p className="truncate text-sm text-slate-200">{user?.email ?? t('Guest')}</p>
              <p className="truncate text-xs text-slate-500">
                {(user?.roles ?? []).join(', ') || 'viewer'}
              </p>
            </div>
            <button
              type="button"
              onClick={logout}
              className="rounded-lg p-1.5 text-slate-400 hover:bg-ink/10 hover:text-ink"
              aria-label={t('Sign out')}
            >
              <LogOut className="h-4 w-4" />
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <header className="sticky top-0 z-20 flex items-center justify-between border-b border-ink/10 bg-surface-950/80 px-4 py-3 backdrop-blur lg:hidden">
          <div className="flex items-center gap-2">
            <Activity className="h-5 w-5 text-accent-soft" />
            <span className="font-semibold">Zigbee Monitor</span>
          </div>
          <div className="flex items-center gap-2">
            <span className="flex items-center gap-1.5 text-xs text-slate-400">
              <Wifi className={cn('h-3.5 w-3.5', connected ? 'text-success' : 'text-danger')} />
              {connected ? t('Live') : t('Offline')}
            </span>
            <LanguageToggle />
            <ThemeToggle />
          </div>
        </header>

        <nav className="flex gap-1 overflow-x-auto border-b border-ink/10 px-2 py-2 lg:hidden">
          {NAV.map((item) => (
            <NavLink
              key={item.to}
              to={item.to}
              end={item.to === '/'}
              className={({ isActive }) =>
                cn(
                  'whitespace-nowrap rounded-lg px-3 py-1.5 text-xs font-medium',
                  isActive ? 'bg-accent/15 text-ink' : 'text-slate-400',
                )
              }
            >
              {t(item.label)}
            </NavLink>
          ))}
        </nav>

        <main className="flex-1 px-4 py-6 sm:px-6 lg:px-8">
          <Outlet />
        </main>
      </div>
      <PairingPromptModal />
    </div>
  );
}
