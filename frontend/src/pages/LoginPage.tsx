import { FormEvent, useState } from 'react';
import { Navigate } from 'react-router-dom';
import { Activity } from 'lucide-react';
import { useAuth } from '@/context/AuthContext';
import { useLanguage } from '@/context/LanguageContext';
import { apiErrorMessage } from '@/lib/api';
import { Spinner } from '@/components/ui/Card';
import { ThemeToggle } from '@/components/ui/ThemeToggle';
import { LanguageToggle } from '@/components/ui/LanguageToggle';

export function LoginPage() {
  const { login, isAuthenticated, loading } = useAuth();
  const { t } = useLanguage();
  const [email, setEmail] = useState('admin@local');
  const [password, setPassword] = useState('admin123');
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  if (!loading && isAuthenticated) return <Navigate to="/" replace />;

  async function onSubmit(event: FormEvent) {
    event.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      await login(email, password);
    } catch (err) {
      setError(apiErrorMessage(err));
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="relative flex min-h-full items-center justify-center bg-[radial-gradient(ellipse_at_top,_var(--tw-gradient-stops))] from-indigo-500/20 via-surface-950 to-surface-950 px-4">
      <div className="absolute right-4 top-4 flex items-center gap-2">
        <LanguageToggle className="rounded-xl border border-ink/10 bg-surface-900/80 p-2" />
        <ThemeToggle className="rounded-xl border border-ink/10 bg-surface-900/80 p-2" />
      </div>
      <form onSubmit={onSubmit} className="card w-full max-w-md p-8">
        <div className="mb-8 flex flex-col items-center text-center">
          <div className="mb-3 flex h-12 w-12 items-center justify-center rounded-2xl bg-accent/20 text-accent-soft">
            <Activity className="h-6 w-6" />
          </div>
          <h1 className="text-xl font-semibold text-ink">Zigbee Monitor</h1>
          <p className="mt-1 text-sm text-slate-400">{t('Sign in to the IoT monitoring platform')}</p>
        </div>

        <label className="label" htmlFor="email">
          {t('Email')}
        </label>
        <input
          id="email"
          className="input mb-4"
          type="email"
          autoComplete="username"
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          required
        />

        <label className="label" htmlFor="password">
          {t('Password')}
        </label>
        <input
          id="password"
          className="input mb-6"
          type="password"
          autoComplete="current-password"
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          required
        />

        {error ? (
          <p className="mb-4 rounded-xl bg-danger/10 px-3 py-2 text-sm text-danger">{error}</p>
        ) : null}

        <button type="submit" className="btn-primary w-full" disabled={submitting}>
          {submitting ? <Spinner /> : null}
          {t('Sign in')}
        </button>

        <p className="mt-4 text-center text-xs text-slate-500">
          {t('Default credentials: admin@local / admin123')}
        </p>
      </form>
    </div>
  );
}
