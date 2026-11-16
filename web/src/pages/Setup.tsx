import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { LANGUAGES, normalizeLanguage, type Language } from '../lib/languages';
import { useNavigate } from 'react-router-dom';
import { Sparkles } from 'lucide-react';
import { motion } from 'framer-motion';
import { api } from '../api';
import { useAuth } from '../state/auth';
import { LogoMark } from '../components/Logo';

export default function Setup() {
  const { t, i18n } = useTranslation();
  const { refresh } = useAuth();
  const nav = useNavigate();

  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [language, setLanguage] = useState<Language>(normalizeLanguage(i18n.language));
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    setBusy(true); setError('');
    try {
      await api.post('/api/setup/init', {
        username, password, display_name: displayName || username, language,
      });
      await i18n.changeLanguage(language);
      await refresh();
      nav('/');
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative flex min-h-screen items-center justify-center overflow-hidden bg-cream px-4 py-10 dark:bg-ink-900">
      <div className="pointer-events-none absolute -left-40 -top-40 h-[480px] w-[480px] rounded-full bg-amber-200/30 blur-3xl dark:bg-amber-700/10" />
      <div className="pointer-events-none absolute -bottom-40 -right-40 h-[480px] w-[480px] rounded-full bg-emerald-200/30 blur-3xl dark:bg-emerald-700/10" />

      <motion.div
        initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }}
        className="relative w-full max-w-xl"
      >
        <div className="mb-6 flex flex-col items-center text-center">
          <LogoMark size={64} className="mb-3" />
          <h1 className="text-3xl font-bold tracking-tight">{t('setup.title')}</h1>
          <p className="page-sub">{t('setup.subtitle')}</p>
        </div>

        <div className="card overflow-hidden p-6 shadow-lift sm:p-8">
          <motion.div initial={{ opacity: 0, y: 8 }} animate={{ opacity: 1, y: 0 }} className="space-y-4">
            <h2 className="text-lg font-semibold">{t('setup.step1')}</h2>
            <div>
              <label className="label mb-1 block">{t('common.language')}</label>
              <div className="flex gap-2">
                {LANGUAGES.map((l) => (
                  <LangBtn key={l.code} current={language} value={l.code} onClick={() => { setLanguage(l.code); void i18n.changeLanguage(l.code); }} lang={l.code}>{l.native}</LangBtn>
                ))}
              </div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <div>
                <label className="label mb-1 block">{t('common.username')}</label>
                <input className="input" autoFocus value={username} onChange={(e) => setUsername(e.target.value)} />
              </div>
              <div>
                <label className="label mb-1 block">{t('common.displayName')}</label>
                <input className="input" value={displayName} onChange={(e) => setDisplayName(e.target.value)} placeholder={username} />
              </div>
            </div>
            <div>
              <label className="label mb-1 block">{t('common.password')}</label>
              <input className="input" type="password" autoComplete="new-password" value={password} onChange={(e) => setPassword(e.target.value)} />
              <p className="mt-1 text-xs text-ink-400">{t('setup.passwordHint')}</p>
            </div>
            {error && <div className="rounded-lg border border-bad/30 bg-bad/10 px-3 py-2 text-sm text-bad">{error}</div>}
            <button onClick={submit} disabled={busy || !username || password.length < 10} className="btn-primary w-full">
              <Sparkles className="h-4 w-4" />
              {busy ? t('setup.creating') : t('setup.finish')}
            </button>
          </motion.div>
        </div>
      </motion.div>
    </div>
  );
}

function LangBtn({ current, value, onClick, lang, children }: { current: string; value: string; onClick: () => void; lang?: string; children: React.ReactNode }) {
  return (
    <button type="button" onClick={onClick} lang={lang}
      className={`btn flex-1 ${current === value ? 'btn-primary' : 'btn-secondary'}`}>{children}</button>
  );
}
