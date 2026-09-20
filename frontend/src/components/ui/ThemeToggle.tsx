import { Check, Moon, Sun } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useTheme, type Theme } from '@/context/ThemeContext';

export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggle } = useTheme();

  return (
    <button
      type="button"
      onClick={toggle}
      className={cn(
        'rounded-lg p-1.5 text-slate-400 transition hover:bg-ink/5 hover:text-ink',
        className,
      )}
      aria-label={theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {theme === 'dark' ? <Sun className="h-4 w-4" /> : <Moon className="h-4 w-4" />}
    </button>
  );
}

export function ThemePicker() {
  const { theme, setTheme } = useTheme();

  return (
    <div className="grid grid-cols-2 gap-3">
      <ThemeOption
        value="light"
        label="Light"
        active={theme === 'light'}
        onSelect={setTheme}
        previewClass="from-[#eef2f7] to-white"
      />
      <ThemeOption
        value="dark"
        label="Dark"
        active={theme === 'dark'}
        onSelect={setTheme}
        previewClass="from-[#1e293b] to-[#020617]"
      />
    </div>
  );
}

function ThemeOption({
  value,
  label,
  active,
  onSelect,
  previewClass,
}: {
  value: Theme;
  label: string;
  active: boolean;
  onSelect: (theme: Theme) => void;
  previewClass: string;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={cn(
        'rounded-2xl border p-3 text-left transition',
        active
          ? 'border-accent bg-accent/10 ring-2 ring-accent/30'
          : 'border-ink/10 bg-ink/[0.02] hover:border-ink/20',
      )}
    >
      <span
        className={cn(
          'mb-3 block h-16 rounded-xl border bg-gradient-to-br',
          value === 'dark' ? 'border-white/20' : 'border-slate-200',
          previewClass,
        )}
      />
      <span className="flex items-center justify-between text-sm font-medium text-slate-100">
        {label}
        {active ? <Check className="h-4 w-4 text-accent-soft" /> : null}
      </span>
    </button>
  );
}
