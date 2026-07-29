import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export function Card({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return <div className={cn('card p-5', className)}>{children}</div>;
}

export function CardHeader({
  title,
  subtitle,
  action,
}: {
  title: string;
  subtitle?: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-4 flex items-start justify-between gap-3">
      <div>
        <h2 className="text-base font-semibold text-slate-100">{title}</h2>
        {subtitle ? <p className="mt-0.5 text-sm text-slate-400">{subtitle}</p> : null}
      </div>
      {action}
    </div>
  );
}

export function StatCard({
  label,
  value,
  hint,
  icon,
  tone = 'default',
}: {
  label: string;
  value: string | number;
  hint?: string;
  icon?: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'accent';
}) {
  const tones = {
    default: 'from-slate-800/80 to-slate-900/80',
    success: 'from-emerald-500/15 to-surface-900/80',
    warning: 'from-amber-500/15 to-surface-900/80',
    danger: 'from-rose-500/15 to-surface-900/80',
    accent: 'from-indigo-500/15 to-surface-900/80',
  };

  return (
    <div className={cn('card bg-gradient-to-br p-4', tones[tone])}>
      <div className="flex items-start justify-between gap-3">
        <div>
          <p className="text-xs font-medium uppercase tracking-wide text-slate-400">{label}</p>
          <p className="mt-2 text-2xl font-semibold text-slate-50">{value}</p>
          {hint ? <p className="mt-1 text-xs text-slate-400">{hint}</p> : null}
        </div>
        {icon ? (
          <div className="rounded-xl bg-white/5 p-2 text-slate-300">{icon}</div>
        ) : null}
      </div>
    </div>
  );
}

export function Badge({
  children,
  tone = 'default',
}: {
  children: ReactNode;
  tone?: 'default' | 'success' | 'warning' | 'danger' | 'accent';
}) {
  const tones = {
    default: 'bg-white/10 text-slate-200',
    success: 'bg-emerald-500/15 text-emerald-300',
    warning: 'bg-amber-500/15 text-amber-300',
    danger: 'bg-rose-500/15 text-rose-300',
    accent: 'bg-indigo-500/15 text-indigo-300',
  };
  return <span className={cn('badge', tones[tone])}>{children}</span>;
}

export function EmptyState({
  title,
  description,
}: {
  title: string;
  description?: string;
}) {
  return (
    <div className="flex flex-col items-center justify-center rounded-2xl border border-dashed border-white/10 px-6 py-12 text-center">
      <p className="text-sm font-medium text-slate-200">{title}</p>
      {description ? <p className="mt-1 max-w-md text-sm text-slate-400">{description}</p> : null}
    </div>
  );
}

export function Spinner({ className }: { className?: string }) {
  return (
    <div
      className={cn(
        'h-5 w-5 animate-spin rounded-full border-2 border-white/20 border-t-accent',
        className,
      )}
    />
  );
}

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div>
        <h1 className="text-2xl font-semibold tracking-tight text-white">{title}</h1>
        {description ? <p className="mt-1 text-sm text-slate-400">{description}</p> : null}
      </div>
      {actions ? <div className="flex flex-wrap items-center gap-2">{actions}</div> : null}
    </div>
  );
}
