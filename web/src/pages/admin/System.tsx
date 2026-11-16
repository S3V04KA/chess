import { useEffect, useState } from 'react';
import { Trans, useTranslation } from 'react-i18next';
import { CheckCircle2, AlertCircle, Save, Cpu, Loader2, Mail, UserPlus, Send } from 'lucide-react';
import { api } from '../../api';

interface SysSettings {
  stockfish_path: string | null;
  // signup + email (v7.7.0)
  update_check_enabled?: boolean;
  signup_mode?: SignupMode;
  require_email_verification?: boolean;
  notify_admin_on_signup?: boolean;
  public_base_url?: string;
  smtp_host?: string;
  smtp_port?: string | number;
  smtp_secure?: boolean;
  smtp_user?: string;
  smtp_from?: string;
  smtp_pass_set?: boolean;
  smtp_env_override?: boolean;
  email_enabled?: boolean;
}

type SignupMode = 'open' | 'invite' | 'closed';
const SIGNUP_MODES: readonly SignupMode[] = ['open', 'invite', 'closed'];

interface MailState {
  update_check_enabled: boolean;
  signup_mode: SignupMode;
  require_email_verification: boolean;
  notify_admin_on_signup: boolean;
  public_base_url: string;
  smtp_host: string;
  smtp_port: string;
  smtp_secure: boolean;
  smtp_user: string;
  smtp_from: string;
}

export default function AdminSystem() {
  const { t } = useTranslation();
  const [s, setS] = useState<SysSettings>({ stockfish_path: '' });
  const [stockfishStatus, setStockfishStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [saved, setSaved] = useState(false);

  // Signup + email (v7.7.0)
  const [mail, setMail] = useState<MailState>({
    update_check_enabled: true,
    signup_mode: 'open', require_email_verification: false, notify_admin_on_signup: true,
    public_base_url: '', smtp_host: '', smtp_port: '', smtp_secure: false, smtp_user: '', smtp_from: '',
  });
  const [smtpPass, setSmtpPass] = useState('');
  const [smtpPassSet, setSmtpPassSet] = useState(false);
  const [smtpEnvOverride, setSmtpEnvOverride] = useState(false);
  const [emailEnabled, setEmailEnabled] = useState(false);
  const [mailSaved, setMailSaved] = useState(false);
  const [mailBusy, setMailBusy] = useState(false);
  const [testTo, setTestTo] = useState('');
  const [testStatus, setTestStatus] = useState<{ ok: boolean; msg: string } | null>(null);
  const [testing, setTesting] = useState(false);

  function loadSettings() {
    return api.get<SysSettings>('/api/admin/system').then((d) => {
      setS({ stockfish_path: d.stockfish_path ?? '' });
      setMail({
        update_check_enabled: d.update_check_enabled ?? true,
        signup_mode: d.signup_mode ?? 'open',
        require_email_verification: d.require_email_verification ?? false,
        notify_admin_on_signup: d.notify_admin_on_signup ?? true,
        public_base_url: d.public_base_url ?? '',
        smtp_host: d.smtp_host ?? '',
        smtp_port: d.smtp_port != null ? String(d.smtp_port) : '',
        smtp_secure: d.smtp_secure ?? false,
        smtp_user: d.smtp_user ?? '',
        smtp_from: d.smtp_from ?? '',
      });
      setSmtpPassSet(!!d.smtp_pass_set);
      setSmtpEnvOverride(!!d.smtp_env_override);
      setEmailEnabled(!!d.email_enabled);
      setSmtpPass('');
    });
  }

  async function saveMail() {
    setMailBusy(true);
    try {
      await api.patch('/api/admin/system', {
        update_check_enabled: mail.update_check_enabled,
        signup_mode: mail.signup_mode,
        require_email_verification: mail.require_email_verification,
        notify_admin_on_signup: mail.notify_admin_on_signup,
        public_base_url: mail.public_base_url,
        smtp_host: mail.smtp_host,
        smtp_user: mail.smtp_user,
        smtp_from: mail.smtp_from,
        smtp_secure: mail.smtp_secure,
        smtp_port: mail.smtp_port === '' ? '' : Number(mail.smtp_port),
        // Only send the password when the admin typed a new one — empty leaves
        // the stored secret untouched.
        ...(smtpPass ? { smtp_pass: smtpPass } : {}),
      });
      setMailSaved(true); setTimeout(() => setMailSaved(false), 1500);
      await loadSettings();
    } finally { setMailBusy(false); }
  }

  async function sendTestEmail() {
    setTesting(true); setTestStatus(null);
    try {
      const r = await api.post<{ ok: boolean; error?: string }>('/api/admin/test/email', { to: testTo });
      setTestStatus({ ok: r.ok, msg: r.ok ? t('admin.testEmailSent') : (r.error ?? t('admin.failed')) });
    } catch (e) {
      setTestStatus({ ok: false, msg: (e as Error).message });
    } finally { setTesting(false); }
  }

  useEffect(() => { void loadSettings(); }, []);

  async function testStockfish() {
    setStockfishStatus(null);
    const r = await api.post<{ ok: boolean; name?: string; error?: string }>('/api/admin/test/stockfish', { path: s.stockfish_path });
    setStockfishStatus({ ok: r.ok, msg: r.ok ? (r.name ?? t('admin.ok')) : (r.error ?? t('admin.failed')) });
  }

  async function save() {
    await api.patch('/api/admin/system', { stockfish_path: s.stockfish_path });
    // This is the button people reach for. It used to save only the engine
    // fields, so a changed signup mode was silently lost unless "Save
    // email settings" further down was clicked instead.
    await saveMail();
    setSaved(true); setTimeout(() => setSaved(false), 1500);
  }

  return (
    <div className="mx-auto max-w-3xl space-y-6 pb-20">
      <header>
        <h1 className="text-3xl font-bold tracking-tight">{t('admin.system')}</h1>
        <p className="mt-1 text-sm text-ink-500">{t('admin.system_intro')}</p>
      </header>

      <section className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-ink-100 bg-ink-50/60 px-5 py-3 dark:border-ink-700 dark:bg-ink-900/40">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-amber-500/15 text-amber-600">
            <Cpu className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-semibold">{t('admin.stockfishConfig')}</h2>
            <p className="text-xs text-ink-500">{t('admin.stockfishDesc')}</p>
          </div>
        </div>
        <div className="space-y-4 p-5">
          <p className="text-xs text-ink-400">
            <Trans i18nKey="admin.engineBackendNote" components={{ code: <code className="font-mono" /> }} />
          </p>
          <div>
            <label className="label mb-1 block">{t('admin.stockfishPath')}</label>
            <div className="flex gap-2">
              <input className="input" value={s.stockfish_path ?? ''} onChange={(e) => setS({ ...s, stockfish_path: e.target.value })} placeholder={t('admin.autoDetect')} />
              <button onClick={testStockfish} className="btn-secondary text-sm">{t('common.test')}</button>
            </div>
            <p className="mt-1 text-xs text-ink-400">{t('admin.stockfishPathHelp')}</p>
            {stockfishStatus && (
              <div className={`mt-2 flex items-center gap-1 text-sm ${stockfishStatus.ok ? 'text-accent-600' : 'text-bad'}`}>
                {stockfishStatus.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />}
                {t('admin.engineFound', { name: stockfishStatus.msg })}
              </div>
            )}
          </div>
        </div>
      </section>

      {/* ---- Signup ---- */}
      <section className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-ink-100 bg-ink-50/60 px-5 py-3 dark:border-ink-700 dark:bg-ink-900/40">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-emerald-500/15 text-emerald-600">
            <UserPlus className="h-4 w-4" />
          </div>
          <div>
            <h2 className="font-semibold">{t('admin.signupConfig')}</h2>
            <p className="text-xs text-ink-500">{t('admin.signupConfigIntro')}</p>
          </div>
        </div>
        <div className="space-y-4 p-5">
          <ToggleRow checked={mail.update_check_enabled} onChange={(v) => setMail({ ...mail, update_check_enabled: v })}
            label={t('update.checkTitle', { defaultValue: 'Check for updates' })}
            hint={t('update.checkHelp', { defaultValue: 'Once every six hours, Patzer asks GitHub whether a newer release exists.' })} />
          <fieldset>
            <legend className="text-sm font-medium">{t('admin.signupMode')}</legend>
            <div className="mt-2 grid gap-2 sm:grid-cols-3">
              {SIGNUP_MODES.map((m) => (
                <label key={m} className={`cursor-pointer rounded-xl border p-3 transition-colors ${
                  mail.signup_mode === m
                    ? 'border-accent-500 bg-accent-500/10'
                    : 'border-ink-200 hover:border-ink-300 dark:border-ink-700 dark:hover:border-ink-600'
                }`}>
                  <span className="flex items-center gap-2 text-sm font-medium">
                    <input type="radio" name="signup_mode" value={m} checked={mail.signup_mode === m}
                      onChange={() => setMail({ ...mail, signup_mode: m })} />
                    {t(`admin.signupModes.${m}`)}
                  </span>
                  <span className="mt-1 block text-xs text-ink-400">{t(`admin.signupModes.${m}Hint`)}</span>
                </label>
              ))}
            </div>
          </fieldset>
          <ToggleRow checked={mail.require_email_verification} onChange={(v) => setMail({ ...mail, require_email_verification: v })}
            label={t('admin.requireVerification')} hint={emailEnabled ? t('admin.requireVerificationHint') : t('admin.requireVerificationNeedsSmtp')}
            disabled={!emailEnabled} />
          <ToggleRow checked={mail.notify_admin_on_signup} onChange={(v) => setMail({ ...mail, notify_admin_on_signup: v })}
            label={t('admin.notifyAdmins')} hint={t('admin.notifyAdminsHint')} disabled={!emailEnabled} />
          <div>
            <label className="label mb-1 block">{t('admin.publicBaseUrl')}</label>
            <input className="input" value={mail.public_base_url} onChange={(e) => setMail({ ...mail, public_base_url: e.target.value })} placeholder="http://ardi:8800" />
            <p className="mt-1 text-xs text-ink-400">{t('admin.publicBaseUrlHint')}</p>
          </div>
        </div>
      </section>

      {/* ---- SMTP / email ---- */}
      <section className="card overflow-hidden">
        <div className="flex items-center gap-3 border-b border-ink-100 bg-ink-50/60 px-5 py-3 dark:border-ink-700 dark:bg-ink-900/40">
          <div className="flex h-9 w-9 items-center justify-center rounded-lg bg-sky-500/15 text-sky-600">
            <Mail className="h-4 w-4" />
          </div>
          <div className="flex-1">
            <h2 className="font-semibold">{t('admin.smtpConfig')}</h2>
            <p className="text-xs text-ink-500">{t('admin.smtpConfigIntro')}</p>
          </div>
          <span className={`badge ${emailEnabled ? 'bg-accent-100 text-accent-700' : 'bg-ink-100 text-ink-500 dark:bg-ink-700 dark:text-ink-300'}`}>
            {emailEnabled ? t('admin.smtpOn') : t('admin.smtpOff')}
          </span>
        </div>
        <div className="space-y-4 p-5">
          {smtpEnvOverride && (
            <div className="flex items-start gap-2 rounded-xl border border-amber-300/50 bg-amber-50 px-3 py-2 text-xs text-amber-700 dark:border-amber-700/40 dark:bg-amber-900/20 dark:text-amber-300">
              <AlertCircle className="mt-0.5 h-3.5 w-3.5 shrink-0" /> {t('admin.smtpEnvOverride')}
            </div>
          )}
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
            <div className="sm:col-span-2">
              <label className="label mb-1 block">{t('admin.smtpHost')}</label>
              <input className="input" value={mail.smtp_host} onChange={(e) => setMail({ ...mail, smtp_host: e.target.value })} placeholder="smtp.gmail.com" />
            </div>
            <div>
              <label className="label mb-1 block">{t('admin.smtpPort')}</label>
              <input className="input" inputMode="numeric" value={mail.smtp_port} onChange={(e) => setMail({ ...mail, smtp_port: e.target.value.replace(/[^0-9]/g, '') })} placeholder="587" />
            </div>
          </div>
          <ToggleRow checked={mail.smtp_secure} onChange={(v) => setMail({ ...mail, smtp_secure: v })}
            label={t('admin.smtpSecure')} hint={t('admin.smtpSecureHint')} />
          <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
            <div>
              <label className="label mb-1 block">{t('admin.smtpUser')}</label>
              <input className="input" autoComplete="off" value={mail.smtp_user} onChange={(e) => setMail({ ...mail, smtp_user: e.target.value })} />
            </div>
            <div>
              <label className="label mb-1 block">{t('admin.smtpPass')}</label>
              <input className="input" type="password" autoComplete="new-password" value={smtpPass}
                onChange={(e) => setSmtpPass(e.target.value)} placeholder={smtpPassSet ? '••••••••' : ''} />
              {smtpPassSet && !smtpPass && <p className="mt-1 text-xs text-ink-400">{t('admin.smtpPassKept')}</p>}
            </div>
          </div>
          <div>
            <label className="label mb-1 block">{t('admin.smtpFrom')}</label>
            <input className="input" value={mail.smtp_from} onChange={(e) => setMail({ ...mail, smtp_from: e.target.value })} placeholder="Patzer <chess@example.com>" />
          </div>

          <div className="flex justify-end">
            <button onClick={saveMail} disabled={mailBusy} className="btn-primary">
              <Save className="h-4 w-4" /> {mailSaved ? t('settings.saved') : t('admin.saveEmailSettings')}
            </button>
          </div>

          {/* Send-test row — uses the SAVED config, so prompt to save first. */}
          <div className="rounded-xl border border-ink-200 bg-ink-50/50 p-3 dark:border-ink-700 dark:bg-ink-900/30">
            <label className="label mb-1 block">{t('admin.sendTestEmail')}</label>
            <div className="flex gap-2">
              <input className="input" type="email" value={testTo} onChange={(e) => setTestTo(e.target.value)} placeholder="you@example.com" />
              <button onClick={sendTestEmail} disabled={testing || !testTo} className="btn-secondary text-sm whitespace-nowrap">
                {testing ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />} {t('admin.send')}
              </button>
            </div>
            <p className="mt-1 text-xs text-ink-400">{t('admin.sendTestEmailHint')}</p>
            {testStatus && (
              <div className={`mt-2 flex items-center gap-1 text-sm ${testStatus.ok ? 'text-accent-600' : 'text-bad'}`}>
                {testStatus.ok ? <CheckCircle2 className="h-4 w-4" /> : <AlertCircle className="h-4 w-4" />} {testStatus.msg}
              </div>
            )}
          </div>
        </div>
      </section>

      <div className="sticky bottom-4 z-10 flex justify-end">
        <button onClick={save} className="btn-primary shadow-lg shadow-ink-900/10">
          <Save className="h-4 w-4" /> {saved ? t('settings.saved') : t('common.save')}
        </button>
      </div>
    </div>
  );
}

function ToggleRow({ checked, onChange, label, hint, disabled }: { checked: boolean; onChange: (v: boolean) => void; label: string; hint?: string; disabled?: boolean }) {
  return (
    <label className={`flex items-start justify-between gap-3 ${disabled ? 'opacity-50' : ''}`}>
      <div>
        <div className="text-sm font-medium">{label}</div>
        {hint && <div className="text-xs text-ink-400">{hint}</div>}
      </div>
      <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={checked} disabled={disabled} onChange={(e) => onChange(e.target.checked)} />
    </label>
  );
}
