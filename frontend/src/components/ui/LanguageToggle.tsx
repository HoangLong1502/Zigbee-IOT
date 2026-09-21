import { Check, Languages } from 'lucide-react';
import { cn } from '@/lib/utils';
import { useLanguage, type Language } from '@/context/LanguageContext';

export function LanguageToggle({ className }: { className?: string }) {
  const { language, toggleLanguage, t } = useLanguage();

  return (
    <button
      type="button"
      onClick={toggleLanguage}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-lg p-1.5 text-xs font-medium text-slate-400 transition hover:bg-ink/5 hover:text-ink',
        className,
      )}
      aria-label={t('Language')}
      title={language === 'en' ? t('Vietnamese') : t('English')}
    >
      <Languages className="h-4 w-4" />
      <span>{language === 'en' ? 'VI' : 'EN'}</span>
    </button>
  );
}

export function LanguagePicker() {
  const { language, setLanguage, t } = useLanguage();

  return (
    <div className="grid grid-cols-2 gap-3">
      <LanguageOption
        value="en"
        label={t('English')}
        active={language === 'en'}
        onSelect={setLanguage}
      />
      <LanguageOption
        value="vi"
        label={t('Vietnamese')}
        active={language === 'vi'}
        onSelect={setLanguage}
      />
    </div>
  );
}

function LanguageOption({
  value,
  label,
  active,
  onSelect,
}: {
  value: Language;
  label: string;
  active: boolean;
  onSelect: (language: Language) => void;
}) {
  return (
    <button
      type="button"
      onClick={() => onSelect(value)}
      className={cn(
        'flex items-center justify-between rounded-2xl border p-4 text-left text-sm font-medium transition',
        active
          ? 'border-accent bg-accent/10 text-slate-100 ring-2 ring-accent/30'
          : 'border-ink/10 bg-ink/[0.02] text-slate-300 hover:border-ink/20',
      )}
    >
      <span>
        <span className="mr-2 text-base">{value === 'en' ? '🇬🇧' : '🇻🇳'}</span>
        {label}
      </span>
      {active ? <Check className="h-4 w-4 text-accent-soft" /> : null}
    </button>
  );
}
