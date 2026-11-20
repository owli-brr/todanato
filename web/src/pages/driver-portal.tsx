import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { AlertTriangle, Bike, FileText, IdCard, LogOut, ShieldAlert } from 'lucide-react';
import { fmtDate, label, peso } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, Input } from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle, DescList, Skeleton, StatusBadge } from '@/components/ui/misc';
import { Dialog } from '@/components/ui/dialog';
import { PublicShell } from './apply';

// Driver portal. Uses its own cookie (path /api/driver), separate from staff sign-in.

class PortalError extends Error {
  constructor(public status: number, message: string, public fields?: Record<string, string>) { super(message); }
}

async function portal<T>(method: string, path: string, body?: unknown): Promise<T> {
  const r = await fetch(`/api/driver${path}`, {
    method, credentials: 'include',
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new PortalError(r.status, data.error ?? `Request failed (${r.status})`, data.fields ?? data.details?.fields);
  return data as T;
}

function FormError({ error }: { error: string }) {
  return error ? <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div> : null;
}

const narrow = (children: ReactNode) => <div className="max-w-md">{children}</div>;

export function DriverLoginPage() {
  const nav = useNavigate();
  const [phone, setPhone] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setError('');
    try { await portal('POST', '/login', { phone, password }); nav('/driver', { replace: true }); }
    catch (err) { setError(err instanceof Error ? err.message : 'Sign-in failed'); }
    finally { setBusy(false); }
  };
  return (
    <PublicShell title="Driver sign in" subtitle="For approved drivers of the TODA.">
      {narrow(
        <Card><CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-4" noValidate>
            <FormError error={error} />
            <Field label="Mobile number" name="phone"><Input id="phone" type="tel" inputMode="tel" autoComplete="tel" value={phone} onChange={(e) => setPhone(e.target.value)} placeholder="09171234567" /></Field>
            <Field label="Password" name="password"><Input id="password" type="password" autoComplete="current-password" value={password} onChange={(e) => setPassword(e.target.value)} /></Field>
            <Button type="submit" className="w-full" loading={busy}>Sign in</Button>
          </form>
          <div className="mt-6 space-y-1 border-t pt-4 text-sm text-muted-foreground">
            <p>First time? <Link to="/driver/activate" className="font-medium text-primary hover:underline">Set up your driver account</Link></p>
            <p>Not a driver yet? <Link to="/apply" className="text-primary hover:underline">Apply to the TODA</Link></p>
            <p>TODA staff? <Link to="/login" className="text-primary hover:underline">Staff sign in</Link></p>
          </div>
        </CardContent></Card>,
      )}
    </PublicShell>
  );
}

export function DriverActivatePage() {
  const nav = useNavigate();
  const [params] = useSearchParams();
  const [v, setV] = useState({ reference: params.get('ref') ?? '', licenseNumber: '', phone: '', password: '', confirm: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const bind = (k: keyof typeof v) => ({ id: k, value: v[k], onChange: (e: { target: { value: string } }) => setV((o) => ({ ...o, [k]: e.target.value })) });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setError(''); setErrors({});
    if (v.password !== v.confirm) { setErrors({ confirm: 'Passwords don’t match' }); return; }
    setBusy(true);
    try {
      await portal('POST', '/activate', { reference: v.reference, licenseNumber: v.licenseNumber, phone: v.phone, password: v.password });
      toast.success('Your driver account is ready');
      nav('/driver', { replace: true });
    } catch (err) {
      if (err instanceof PortalError && err.fields) setErrors(err.fields);
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally { setBusy(false); }
  };
  return (
    <PublicShell title="Set up your driver account" subtitle="Use the reference number from your application, your license number, and the mobile number you gave the TODA.">
      {narrow(
        <Card><CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-4" noValidate>
            <FormError error={error} />
            <Field label="Reference number" name="reference" error={errors.reference}><Input {...bind('reference')} placeholder="DRV-2026-00123" className="uppercase" /></Field>
            <Field label="License number" name="licenseNumber" error={errors.licenseNumber}><Input {...bind('licenseNumber')} placeholder="A01-23-456789" className="uppercase" /></Field>
            <Field label="Mobile number" name="phone" error={errors.phone}><Input {...bind('phone')} type="tel" inputMode="tel" placeholder="09171234567" /></Field>
            <Field label="Choose a password" name="password" error={errors.password} hint="At least 10 characters, with a letter and a number."><Input {...bind('password')} type="password" autoComplete="new-password" /></Field>
            <Field label="Confirm password" name="confirm" error={errors.confirm}><Input {...bind('confirm')} type="password" autoComplete="new-password" /></Field>
            <Button type="submit" className="w-full" loading={busy}>Create my account</Button>
          </form>
          <p className="mt-4 text-sm text-muted-foreground">Already set up? <Link to="/driver/login" className="text-primary hover:underline">Sign in</Link></p>
        </CardContent></Card>,
      )}
    </PublicShell>
  );
}

interface Me {
  driver: { fullName: string; firstName: string; driverCode: string; photo: boolean; status: string; suspensionReason: string | null; suspendedUntil: string | null; contactNumber: string; email: string | null; address: string; licenseNumber: string; licenseType: string; licenseExpiry: string; approvedAt: string | null; rating: string | null };
  toda: { name: string; acronym: string | null; terminalLocation: string | null; contactNumber: string | null; email: string | null; monthlyDues: string; dailyContribution: string } | null;
  membership: { membershipNo: string; status: string; memberType: string; since: string | null } | null;
  vehicle: { plateNumber: string; bodyNumber: string | null; make: string; model: string; color: string; status: string; registrationExpiry: string | null; franchiseExpiry: string | null; insuranceExpiry: string | null } | null;
  documents: { id: string; type: string; documentNo: string | null; fileName: string; expiresAt: string | null; status: string; remarks: string | null; uploadedAt: string }[];
  reminders: { level: 'warning' | 'danger'; text: string }[];
}

function ChangePassword({ open, onOpenChange }: { open: boolean; onOpenChange: (o: boolean) => void }) {
  const [v, setV] = useState({ currentPassword: '', newPassword: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setV({ currentPassword: '', newPassword: '' }); setErrors({}); } }, [open]);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Change password" description="You'll stay signed in here and be signed out on other phones."
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={busy} onClick={async () => {
        setBusy(true);
        try { await portal('POST', '/change-password', v); toast.success('Password changed'); onOpenChange(false); }
        catch (e) { if (e instanceof PortalError && e.fields) setErrors(e.fields); toast.error(e instanceof Error ? e.message : 'Failed'); }
        finally { setBusy(false); }
      }}>Change password</Button></>}>
      <div className="grid gap-4">
        <Field label="Current password" name="currentPassword" error={errors.currentPassword}><Input id="currentPassword" type="password" value={v.currentPassword} onChange={(e) => setV({ ...v, currentPassword: e.target.value })} /></Field>
        <Field label="New password" name="newPassword" error={errors.newPassword} hint="At least 10 characters, with a letter and a number."><Input id="newPassword" type="password" value={v.newPassword} onChange={(e) => setV({ ...v, newPassword: e.target.value })} /></Field>
      </div>
    </Dialog>
  );
}

export function DriverPortalPage() {
  const nav = useNavigate();
  const qc = useQueryClient();
  const [pwOpen, setPwOpen] = useState(false);
  const me = useQuery({ queryKey: ['driver-portal', 'me'], queryFn: () => portal<Me>('GET', '/me'), retry: false });
  useEffect(() => {
    if (me.error instanceof PortalError && me.error.status === 401) nav('/driver/login', { replace: true });
  }, [me.error, nav]);
  const signOut = async () => { await portal('POST', '/logout').catch(() => null); qc.removeQueries({ queryKey: ['driver-portal'] }); nav('/driver/login', { replace: true }); };
  const navActions = <>
    <button onClick={() => setPwOpen(true)} className="text-muted-foreground hover:text-foreground">Password</button>
    <button onClick={signOut} className="inline-flex items-center gap-1 text-muted-foreground hover:text-foreground"><LogOut className="size-4" />Sign out</button>
  </>;

  if (!me.data) {
    return <PublicShell title="Driver portal" nav={navActions}>{me.error && !(me.error instanceof PortalError && me.error.status === 401) ? <FormError error={me.error.message} /> : <Skeleton className="h-80" />}</PublicShell>;
  }
  const { driver: d, toda, membership: m, vehicle: v, documents, reminders } = me.data;
  return (
    <PublicShell title={`Hi, ${d.firstName}`} subtitle={`${d.driverCode}${toda ? ` · ${toda.name}` : ''}`} nav={navActions}>
      <div className="space-y-4">
        {d.status === 'SUSPENDED' && (
          <div className="flex gap-3 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            <ShieldAlert className="size-5 shrink-0" />
            <div><div className="font-medium">You are suspended{d.suspendedUntil ? ` until ${fmtDate(d.suspendedUntil)}` : ''}.</div>{d.suspensionReason && <div>Reason: {d.suspensionReason}</div>}<div className="mt-1">Contact the TODA office if you have questions.</div></div>
          </div>
        )}
        {reminders.length > 0 && (
          <Card><CardContent className="space-y-2 pt-5">
            {reminders.map((r, i) => (
              <div key={i} className={`flex items-start gap-2 text-sm ${r.level === 'danger' ? 'text-red-700 dark:text-red-300' : 'text-amber-700 dark:text-amber-300'}`}><AlertTriangle className="mt-0.5 size-4 shrink-0" />{r.text}</div>
            ))}
          </CardContent></Card>
        )}
        <div className="grid gap-4 md:grid-cols-2">
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><IdCard className="size-4" />My membership</CardTitle></CardHeader>
            <CardContent>
              <DescList cols={1} items={[
                ['Driver status', <StatusBadge status={d.status} />],
                ['Membership no.', m?.membershipNo ?? '—'],
                ['Membership', m ? <span className="flex items-center gap-2"><StatusBadge status={m.status} />{label(m.memberType)}</span> : '—'],
                ['Member since', fmtDate(m?.since ?? d.approvedAt)],
                ...(toda ? [['Monthly dues', peso(toda.monthlyDues)] as [string, ReactNode], ['Daily contribution', peso(toda.dailyContribution)] as [string, ReactNode]] : []),
              ]} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><Bike className="size-4" />My tricycle</CardTitle></CardHeader>
            <CardContent>
              {v ? (
                <DescList cols={1} items={[
                  ['Plate number', <span className="font-medium">{v.plateNumber}</span>],
                  ['Body number', v.bodyNumber ?? '—'],
                  ['Unit', `${v.make} ${v.model} · ${v.color}`],
                  ['Status', <StatusBadge status={v.status} />],
                  ['Registration expiry', fmtDate(v.registrationExpiry)],
                  ['Franchise (MTOP) expiry', fmtDate(v.franchiseExpiry)],
                ]} />
              ) : <p className="text-sm text-muted-foreground">No tricycle is assigned to you yet. The TODA office assigns one.</p>}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>My details</CardTitle></CardHeader>
            <CardContent>
              <DescList cols={1} items={[
                ['Mobile', d.contactNumber], ['Email', d.email ?? '—'], ['Address', d.address],
                ['License', `${d.licenseNumber} · ${label(d.licenseType)}`], ['License expiry', fmtDate(d.licenseExpiry)],
              ]} />
              <p className="mt-4 text-xs text-muted-foreground">Something wrong? Ask the TODA office to update your record{toda?.contactNumber ? ` (${toda.contactNumber})` : ''}.</p>
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle className="flex items-center gap-2"><FileText className="size-4" />My documents</CardTitle></CardHeader>
            <CardContent>
              {documents.length === 0 ? <p className="text-sm text-muted-foreground">No documents on file yet.</p> : (
                <ul className="divide-y">
                  {documents.map((doc) => (
                    <li key={doc.id} className="flex items-center justify-between gap-3 py-2.5 text-sm">
                      <div className="min-w-0">
                        <a href={`/api/driver/documents/${doc.id}`} target="_blank" rel="noreferrer" className="font-medium hover:text-primary">{label(doc.type)}</a>
                        <div className="text-xs text-muted-foreground">{doc.expiresAt ? `Expires ${fmtDate(doc.expiresAt)}` : `Uploaded ${fmtDate(doc.uploadedAt)}`}</div>
                      </div>
                      <StatusBadge status={doc.status} />
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
        {toda && <p className="text-xs text-muted-foreground">{toda.name}{toda.terminalLocation ? ` · Terminal: ${toda.terminalLocation}` : ''}{toda.email ? ` · ${toda.email}` : ''}</p>}
      </div>
      <ChangePassword open={pwOpen} onOpenChange={setPwOpen} />
    </PublicShell>
  );
}
