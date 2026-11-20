import { useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { CheckCircle2, Clock, XCircle } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useForm } from '@/lib/hooks';
import { fmtDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, FormSection, Input, Select } from '@/components/ui/form';
import { Card, CardContent } from '@/components/ui/misc';

export function PublicShell({ title, subtitle, children, nav }: { title: string; subtitle?: ReactNode; children: ReactNode; nav?: ReactNode }) {
  return (
    <div className="min-h-screen bg-muted/30">
      <header className="border-b bg-background">
        <div className="mx-auto flex h-14 max-w-4xl items-center justify-between px-4">
          <Link to="/apply" className="flex items-center gap-2 font-semibold"><img src="/favicon.svg" alt="" className="size-7" />TODAnaTo</Link>
          <nav className="flex items-center gap-4 text-sm">
            {nav ?? <>
              <Link to="/application-status" className="text-muted-foreground hover:text-foreground">Check status</Link>
              <Link to="/driver/login" className="text-muted-foreground hover:text-foreground">Driver sign in</Link>
            </>}
          </nav>
        </div>
      </header>
      <main className="mx-auto max-w-4xl px-4 py-8">
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {subtitle && <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>}
        <div className="mt-6">{children}</div>
      </main>
    </div>
  );
}

const empty = {
  firstName: '', middleName: '', lastName: '', suffix: '', dateOfBirth: '', gender: '', contactNumber: '', email: '',
  address: '', barangay: '', city: '', emergencyName: '', emergencyRelation: '', emergencyPhone: '',
  licenseNumber: '', licenseType: 'PROFESSIONAL', licenseExpiry: '', memberType: 'DRIVER', website: '',
};

type Toda = { name: string; acronym: string | null; barangay: string | null; city: string | null; province: string | null; contactNumber: string | null; email: string | null };

export function ApplyPage() {
  const f = useForm(empty);
  const [file, setFile] = useState<File | null>(null);
  const [consent, setConsent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [done, setDone] = useState<{ reference: string; association: string } | null>(null);
  const toda = useQuery({ queryKey: ['public-toda'], queryFn: () => api.get<Toda>('/public/toda') });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    if (!consent) { setError('Please agree to the data privacy notice to continue.'); return; }
    setBusy(true);
    const fd = new FormData();
    for (const [k, v] of Object.entries(f.values)) if (v !== '') fd.append(k, v as string);
    fd.append('consent', 'true');
    if (file) fd.append('license', file);
    try {
      setDone(await api.post<{ reference: string; association: string }>('/public/driver-applications', fd));
      window.scrollTo({ top: 0 });
    } catch (err) {
      if (err instanceof ApiError && err.fields) f.setErrors(err.fields);
      setError(err instanceof Error ? err.message : 'Something went wrong. Please try again.');
    } finally {
      setBusy(false);
    }
  };

  if (done) {
    return (
      <PublicShell title="Application sent">
        <Card><CardContent className="space-y-4 pt-6">
          <div className="flex items-start gap-3">
            <CheckCircle2 className="mt-0.5 size-6 shrink-0 text-emerald-600" />
            <div>
              <p className="font-medium">Thank you, {f.values.firstName}. {done.association} will review your application.</p>
              <p className="mt-1 text-sm text-muted-foreground">Bring your original license and barangay clearance when the TODA contacts you.</p>
            </div>
          </div>
          <div className="rounded-md border bg-muted/40 p-4">
            <div className="text-xs uppercase tracking-wide text-muted-foreground">Your reference number</div>
            <div className="mt-1 font-mono text-2xl font-semibold">{done.reference}</div>
            <div className="mt-1 text-xs text-muted-foreground">Save this. You need it and your license number to check your status.</div>
          </div>
          <Button asChild variant="outline"><Link to={`/application-status?ref=${done.reference}`}>Check status</Link></Button>
        </CardContent></Card>
      </PublicShell>
    );
  }

  const e = f.errors;
  return (
    <PublicShell title="Apply as a tricycle driver" subtitle={`Fill in this form to join ${toda.data?.name ?? 'our TODA'}${toda.data?.barangay ? `, Brgy. ${toda.data.barangay}` : ''}. Our officers will review your application and contact you.`}>
      <form onSubmit={submit} noValidate>
        <Card><CardContent className="pt-6">
          {error && <div role="alert" className="mb-6 rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
          <FormSection title="Membership" description="How you will join the TODA.">
            <Field label="I am applying as" name="memberType">
              <Select {...f.bind('memberType')}><option value="DRIVER">Driver</option><option value="DRIVER_OPERATOR">Driver and tricycle owner</option></Select>
            </Field>
          </FormSection>
          <FormSection title="Personal information" description="As written on your driver's license.">
            <Field label="First name" name="firstName" required error={e.firstName}><Input {...f.bind('firstName')} autoComplete="given-name" /></Field>
            <Field label="Middle name" name="middleName" error={e.middleName}><Input {...f.bind('middleName')} autoComplete="additional-name" /></Field>
            <Field label="Last name" name="lastName" required error={e.lastName}><Input {...f.bind('lastName')} autoComplete="family-name" /></Field>
            <Field label="Suffix" name="suffix" error={e.suffix} hint="Jr., Sr., III"><Input {...f.bind('suffix')} /></Field>
            <Field label="Date of birth" name="dateOfBirth" required error={e.dateOfBirth}><Input type="date" {...f.bind('dateOfBirth')} /></Field>
            <Field label="Gender" name="gender" hint="Optional">
              <Select {...f.bind('gender')}><option value="">Prefer not to say</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option></Select>
            </Field>
          </FormSection>
          <FormSection title="Contact details">
            <Field label="Mobile number" name="contactNumber" required error={e.contactNumber} hint="e.g. 09171234567"><Input type="tel" inputMode="tel" autoComplete="tel" {...f.bind('contactNumber')} /></Field>
            <Field label="Email" name="email" error={e.email} hint="Optional"><Input type="email" autoComplete="email" {...f.bind('email')} /></Field>
            <Field label="Home address" name="address" required error={e.address} className="sm:col-span-2"><Input {...f.bind('address')} placeholder="House no., street" autoComplete="street-address" /></Field>
            <Field label="Barangay" name="barangay" error={e.barangay}><Input {...f.bind('barangay')} /></Field>
            <Field label="City / municipality" name="city" error={e.city}><Input {...f.bind('city')} /></Field>
          </FormSection>
          <FormSection title="Emergency contact">
            <Field label="Name" name="emergencyName" required error={e.emergencyName}><Input {...f.bind('emergencyName')} /></Field>
            <Field label="Relationship" name="emergencyRelation" error={e.emergencyRelation}><Input {...f.bind('emergencyRelation')} placeholder="Spouse, parent…" /></Field>
            <Field label="Mobile number" name="emergencyPhone" required error={e.emergencyPhone}><Input type="tel" inputMode="tel" {...f.bind('emergencyPhone')} /></Field>
          </FormSection>
          <FormSection title="Driver's license" description="Tricycle drivers need an LTO professional license.">
            <Field label="License number" name="licenseNumber" required error={e.licenseNumber} hint="Format: A01-23-456789"><Input {...f.bind('licenseNumber')} className="uppercase" /></Field>
            <Field label="License type" name="licenseType">
              <Select {...f.bind('licenseType')}><option value="PROFESSIONAL">Professional</option><option value="NON_PROFESSIONAL">Non-professional</option></Select>
            </Field>
            <Field label="Expiry date" name="licenseExpiry" required error={e.licenseExpiry}><Input type="date" {...f.bind('licenseExpiry')} /></Field>
            <Field label="Photo of your license" name="license" hint="Optional. JPG, PNG or PDF, up to 4 MB.">
              <Input id="license" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(ev) => setFile(ev.target.files?.[0] ?? null)} className="file:mr-3 file:border-0 file:bg-transparent file:text-sm file:font-medium" />
            </Field>
          </FormSection>
          {/* Hidden from people; bots that fill every field get rejected. */}
          <div aria-hidden="true" className="absolute -left-[9999px] h-0 overflow-hidden"><label>Website<input tabIndex={-1} autoComplete="off" {...f.bind('website')} /></label></div>
          <label className="flex items-start gap-3 border-t pt-6 text-sm">
            <input type="checkbox" checked={consent} onChange={(ev) => setConsent(ev.target.checked)} className="mt-0.5 size-4 rounded border-input" />
            <span>I agree that the TODA may collect and use my personal information to process this application, under the Data Privacy Act of 2012 (RA 10173). The details I gave are true.</span>
          </label>
        </CardContent></Card>
        <div className="mt-4 flex justify-end">
          <Button type="submit" loading={busy}>Submit application</Button>
        </div>
      </form>
    </PublicShell>
  );
}

type StatusResult = { reference: string; firstName: string; association: string | null; status: 'PENDING' | 'APPROVED' | 'REJECTED'; reason: string | null; appliedAt: string; decidedAt: string | null };

export function ApplicationStatusPage() {
  const [params] = useSearchParams();
  const [reference, setReference] = useState(params.get('ref') ?? '');
  const [fieldErrors, setFieldErrors] = useState<Record<string, string>>({});
  const [licenseNumber, setLicense] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [result, setResult] = useState<StatusResult | null>(null);

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    setResult(null);
    setFieldErrors({});
    try {
      setResult(await api.post<StatusResult>('/public/driver-applications/status', { reference, licenseNumber }));
    } catch (err) {
      if (err instanceof ApiError && err.fields) setFieldErrors(err.fields);
      setError(err instanceof Error ? err.message : 'Something went wrong');
    } finally {
      setBusy(false);
    }
  };

  const view = result && {
    PENDING: { icon: Clock, tone: 'text-amber-600', title: 'Under review', text: `${result.association ?? 'The TODA'} is still reviewing your application.` },
    APPROVED: { icon: CheckCircle2, tone: 'text-emerald-600', title: 'Approved', text: `Welcome to ${result.association ?? 'the TODA'}! You can now set up your driver account to see your records online.` },
    REJECTED: { icon: XCircle, tone: 'text-destructive', title: 'Not approved', text: result.reason ? `Reason: ${result.reason}` : 'Contact the TODA office for details.' },
  }[result.status];

  return (
    <PublicShell title="Check your application" subtitle="Enter the reference number you got when you applied, and your license number.">
      <div className="grid gap-4 md:grid-cols-2">
        <Card><CardContent className="pt-6">
          <form onSubmit={submit} className="space-y-4" noValidate>
            {error && <div role="alert" className="rounded-md border border-destructive/30 bg-destructive/10 px-3 py-2 text-sm text-destructive">{error}</div>}
            <Field label="Reference number" name="reference" error={fieldErrors.reference}><Input id="reference" value={reference} onChange={(e) => setReference(e.target.value)} placeholder="DRV-2026-00123" className="uppercase" /></Field>
            <Field label="License number" name="licenseNumber" error={fieldErrors.licenseNumber}><Input id="licenseNumber" value={licenseNumber} onChange={(e) => setLicense(e.target.value)} placeholder="A01-23-456789" className="uppercase" /></Field>
            <Button type="submit" className="w-full" loading={busy}>Check status</Button>
          </form>
        </CardContent></Card>
        {result && view && (
          <Card><CardContent className="space-y-3 pt-6">
            <div className="flex items-center gap-2"><view.icon className={`size-6 ${view.tone}`} /><span className="text-lg font-semibold">{view.title}</span></div>
            <p className="text-sm">Hi {result.firstName}. {view.text}</p>
            <dl className="grid grid-cols-2 gap-2 text-sm">
              <dt className="text-muted-foreground">Reference</dt><dd className="font-mono">{result.reference}</dd>
              <dt className="text-muted-foreground">Applied</dt><dd>{fmtDate(result.appliedAt)}</dd>
              {result.decidedAt && <><dt className="text-muted-foreground">Decided</dt><dd>{fmtDate(result.decidedAt)}</dd></>}
            </dl>
            {result.status === 'APPROVED' && <Button asChild className="w-full"><Link to={`/driver/activate?ref=${result.reference}`}>Set up my driver account</Link></Button>}
          </CardContent></Card>
        )}
      </div>
    </PublicShell>
  );
}
