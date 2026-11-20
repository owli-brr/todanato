import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { toast } from 'sonner';
import { Eye, EyeOff } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { api, ApiError } from '@/lib/api';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';

function AuthShell({ title, subtitle, children }: { title: string; subtitle?: ReactNode; children: ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-2">
      <div className="relative hidden overflow-hidden bg-sidebar p-10 text-sidebar-foreground lg:flex lg:flex-col">
        <div className="flex items-center gap-3">
          <img src="/favicon.svg" alt="" className="size-10" />
          <div>
            <div className="text-lg font-semibold">TOMS</div>
            <div className="text-sm text-sidebar-muted">Tricycle Organization Management System</div>
          </div>
        </div>
        <div className="mt-auto max-w-md space-y-4">
          <p className="text-2xl font-semibold leading-snug text-white">One place for your TODA's drivers, tricycles, dues and daily operations.</p>
          <p className="text-sm text-sidebar-muted">Records stay with each association. Every change is logged. Personal information is handled under the Data Privacy Act of 2012 (RA 10173).</p>
        </div>
      </div>
      <div className="flex items-center justify-center p-6">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2 lg:hidden">
            <img src="/favicon.svg" alt="" className="size-8" />
            <span className="font-semibold">TOMS</span>
          </div>
          <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
          {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
          <div className="mt-6">{children}</div>
        </div>
      </div>
    </div>
  );
}

function PasswordInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  const [show, setShow] = useState(false);
  return (
    <div className="relative">
      <Input {...props} type={show ? 'text' : 'password'} className="pr-10" />
      <button type="button" onClick={() => setShow((s) => !s)} className="absolute right-2 top-1/2 -translate-y-1/2 p-1 text-muted-foreground hover:text-foreground" aria-label={show ? 'Hide password' : 'Show password'}>
        {show ? <EyeOff className="size-4" /> : <Eye className="size-4" />}
      </button>
    </div>
  );
}

export function LoginPage() {
  const { login } = useAuth();
  const nav = useNavigate();
  const loc = useLocation() as { state?: { from?: string } };
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await login(email, password);
      nav(loc.state?.from ?? '/', { replace: true });
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Sign-in failed');
    } finally {
      setBusy(false);
    }
  };

  return (
    <AuthShell title="Sign in" subtitle="Use the account given by your organization administrator.">
      <form onSubmit={submit} className="space-y-4" noValidate>
        {error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
        <Field label="Email" name="email">
          <Input id="email" type="email" autoComplete="username" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus />
        </Field>
        <Field label="Password" name="password">
          <PasswordInput id="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} required />
        </Field>
        <div className="flex justify-end">
          <Link to="/forgot-password" className="text-sm text-primary hover:underline">Forgot password?</Link>
        </div>
        <Button type="submit" className="w-full" loading={busy}>Sign in</Button>
      </form>
      {import.meta.env.DEV && (
        <div className="mt-8 rounded-md border border-dashed p-3 text-xs text-muted-foreground">
          <div className="mb-1 font-medium text-foreground">Demo accounts · password <code>Toda2026demo</code></div>
          {['superadmin', 'admin', 'president.srtoda', 'secretary.srtoda', 'treasurer.srtoda', 'dispatcher.srtoda', 'auditor'].map((u) => (
            <button key={u} type="button" className="mr-2 underline-offset-2 hover:underline" onClick={() => { setEmail(`${u}@toms.ph`); setPassword('Toda2026demo'); }}>{u}</button>
          ))}
        </div>
      )}
    </AuthShell>
  );
}

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState<string | null>(null);
  const [devToken, setDevToken] = useState<string | undefined>();
  const [busy, setBusy] = useState(false);
  return (
    <AuthShell title="Reset your password" subtitle="We'll send a reset link to your email.">
      {sent ? (
        <div className="space-y-4 text-sm">
          <p>{sent}</p>
          {devToken && <p className="rounded-md bg-muted p-3 text-xs">Development mode: <Link className="text-primary underline" to={`/reset-password?token=${devToken}`}>open the reset link</Link></p>}
          <Link to="/login" className="text-primary hover:underline">Back to sign in</Link>
        </div>
      ) : (
        <form
          className="space-y-4"
          onSubmit={async (e) => {
            e.preventDefault();
            setBusy(true);
            try {
              const r = await api.post<{ message: string; devToken?: string }>('/auth/forgot-password', { email });
              setSent(r.message);
              setDevToken(r.devToken);
            } catch (err) {
              toast.error(err instanceof Error ? err.message : 'Request failed');
            } finally { setBusy(false); }
          }}
        >
          <Field label="Email" name="email"><Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} required autoFocus /></Field>
          <Button type="submit" className="w-full" loading={busy}>Send reset link</Button>
          <Link to="/login" className="block text-center text-sm text-muted-foreground hover:text-foreground">Back to sign in</Link>
        </form>
      )}
    </AuthShell>
  );
}

function NewPasswordForm({ onSubmit, needCurrent, submitLabel }: { onSubmit: (v: { currentPassword?: string; password: string }) => Promise<void>; needCurrent?: boolean; submitLabel: string }) {
  const [current, setCurrent] = useState('');
  const [pw, setPw] = useState('');
  const [pw2, setPw2] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  return (
    <form
      className="space-y-4"
      noValidate
      onSubmit={async (e) => {
        e.preventDefault();
        if (pw !== pw2) return setErrors({ confirm: 'Passwords do not match' });
        setBusy(true);
        setErrors({});
        try { await onSubmit({ currentPassword: current, password: pw }); }
        catch (err) {
          if (err instanceof ApiError && err.fields) setErrors({ password: err.fields.newPassword ?? err.fields.password, current: err.fields.currentPassword });
          else if (err instanceof Error && /current/i.test(err.message)) setErrors({ current: err.message });
          toast.error(err instanceof Error ? err.message : 'Could not change password');
        } finally { setBusy(false); }
      }}
    >
      {needCurrent && <Field label="Current password" name="current" error={errors.current}><PasswordInput id="current" autoComplete="current-password" value={current} onChange={(e) => setCurrent(e.target.value)} /></Field>}
      <Field label="New password" name="password" error={errors.password} hint="At least 10 characters with a letter and a number."><PasswordInput id="password" autoComplete="new-password" value={pw} onChange={(e) => setPw(e.target.value)} /></Field>
      <Field label="Confirm new password" name="confirm" error={errors.confirm}><PasswordInput id="confirm" autoComplete="new-password" value={pw2} onChange={(e) => setPw2(e.target.value)} /></Field>
      <Button type="submit" className="w-full" loading={busy}>{submitLabel}</Button>
    </form>
  );
}

export function ResetPasswordPage() {
  const [sp] = useSearchParams();
  const nav = useNavigate();
  return (
    <AuthShell title="Choose a new password">
      <NewPasswordForm
        submitLabel="Set password"
        onSubmit={async ({ password }) => {
          await api.post('/auth/reset-password', { token: sp.get('token'), password });
          toast.success('Password updated. Please sign in.');
          nav('/login');
        }}
      />
    </AuthShell>
  );
}

export function ChangePasswordForm({ forced }: { forced?: boolean }) {
  const { reload } = useAuth();
  return (
    <NewPasswordForm
      needCurrent
      submitLabel="Change password"
      onSubmit={async ({ currentPassword, password }) => {
        await api.post('/auth/change-password', { currentPassword, newPassword: password });
        toast.success(forced ? 'Password set. Welcome!' : 'Password changed. Other sessions were signed out.');
        await reload();
      }}
    />
  );
}

export function ForcedPasswordChange() {
  const { logout } = useAuth();
  return (
    <AuthShell title="Set your own password" subtitle="Your account was created with a temporary password. Choose a new one to continue.">
      <ChangePasswordForm forced />
      <button className="mt-4 w-full text-center text-sm text-muted-foreground hover:text-foreground" onClick={() => logout()}>Sign out</button>
    </AuthShell>
  );
}
