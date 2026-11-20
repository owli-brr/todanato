import { useEffect, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useForm } from '@/lib/hooks';
import { toInputDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, FormSection, Input, Select } from '@/components/ui/form';
import { Card, CardContent, ErrorState, PageHeader, Skeleton } from '@/components/ui/misc';
import { AssociationSelect } from '@/components/shared';

const empty = {
  firstName: '', middleName: '', lastName: '', suffix: '', dateOfBirth: '', gender: '', contactNumber: '', email: '',
  address: '', barangay: '', city: '', emergencyName: '', emergencyRelation: '', emergencyPhone: '',
  licenseNumber: '', licenseType: 'PROFESSIONAL', licenseExpiry: '', associationId: '', memberType: 'DRIVER',
};

export default function DriverForm() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const { user } = useAuth();
  const f = useForm({ ...empty, associationId: user?.association?.id ?? '' });

  const existing = useQuery({ queryKey: ['driver', id], queryFn: () => api.get<Record<string, unknown>>(`/drivers/${id}`), enabled: editing });
  useEffect(() => {
    const d = existing.data;
    if (!d) return;
    const v: Record<string, string> = {};
    for (const k of Object.keys(empty)) v[k] = (d[k] as string) ?? '';
    v.dateOfBirth = toInputDate(d.dateOfBirth as string);
    v.licenseExpiry = toInputDate(d.licenseExpiry as string);
    f.setValues(v as typeof empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  const save = useAction(
    (body: typeof empty) => {
      const payload: Record<string, unknown> = { ...body, gender: body.gender || null, associationId: body.associationId || null };
      if (editing) delete payload.memberType;
      return editing ? api.patch<{ id: string }>(`/drivers/${id}`, payload) : api.post<{ id: string }>('/drivers', payload);
    },
    {
      success: editing ? 'Driver updated' : 'Driver registered. The application is now pending approval.',
      invalidate: [['drivers'], ['driver', id], ['dashboard']],
      onSuccess: (r) => nav(`/drivers/${r.id}`),
      onFieldErrors: f.setErrors,
    },
  );

  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(f.values); };
  if (editing && existing.error) return <ErrorState error={existing.error} />;
  if (editing && !existing.data) return <Skeleton className="h-96" />;
  const e = f.errors;
  const restrictedAssoc = user?.role.scope === 'ASSOCIATION';
  const piiHidden = editing && existing.data?.address === '••••••';

  return (
    <div>
      <PageHeader title={editing ? 'Edit driver' : 'Register driver'} description={editing ? (existing.data?.fullName as string) : 'New drivers start as pending applications until approved.'} back={editing ? `/drivers/${id}` : '/drivers'} />
      {piiHidden && <div className="mb-4 rounded-md border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900 dark:border-amber-500/30 dark:bg-amber-500/10 dark:text-amber-200">Your role can't see this driver's full personal details, so those fields can't be edited here.</div>}
      <form onSubmit={submit} noValidate>
        <Card><CardContent className="pt-6">
          <FormSection title="Personal information" description="As written on the driver's license or government ID.">
            <Field label="First name" name="firstName" required error={e.firstName}><Input {...f.bind('firstName')} autoComplete="off" /></Field>
            <Field label="Middle name" name="middleName" error={e.middleName}><Input {...f.bind('middleName')} /></Field>
            <Field label="Last name" name="lastName" required error={e.lastName}><Input {...f.bind('lastName')} /></Field>
            <Field label="Suffix" name="suffix" error={e.suffix} hint="Jr., Sr., III"><Input {...f.bind('suffix')} /></Field>
            <Field label="Date of birth" name="dateOfBirth" required error={e.dateOfBirth}><Input type="date" {...f.bind('dateOfBirth')} disabled={piiHidden} /></Field>
            <Field label="Gender" name="gender" error={e.gender} hint="Optional">
              <Select {...f.bind('gender')}><option value="">Prefer not to say</option><option value="MALE">Male</option><option value="FEMALE">Female</option><option value="OTHER">Other</option></Select>
            </Field>
          </FormSection>
          <FormSection title="Contact details">
            <Field label="Mobile number" name="contactNumber" required error={e.contactNumber} hint="e.g. 09171234567"><Input type="tel" inputMode="tel" {...f.bind('contactNumber')} /></Field>
            <Field label="Email" name="email" error={e.email}><Input type="email" {...f.bind('email')} disabled={piiHidden} /></Field>
            <Field label="Residential address" name="address" required error={e.address} className="sm:col-span-2"><Input {...f.bind('address')} placeholder="House no., street, barangay" disabled={piiHidden} /></Field>
            <Field label="Barangay" name="barangay" error={e.barangay}><Input {...f.bind('barangay')} /></Field>
            <Field label="City / municipality" name="city" error={e.city}><Input {...f.bind('city')} /></Field>
          </FormSection>
          <FormSection title="Emergency contact">
            <Field label="Name" name="emergencyName" required error={e.emergencyName}><Input {...f.bind('emergencyName')} disabled={piiHidden} /></Field>
            <Field label="Relationship" name="emergencyRelation" error={e.emergencyRelation}><Input {...f.bind('emergencyRelation')} placeholder="Spouse, parent…" disabled={piiHidden} /></Field>
            <Field label="Mobile number" name="emergencyPhone" required error={e.emergencyPhone}><Input type="tel" {...f.bind('emergencyPhone')} disabled={piiHidden} /></Field>
          </FormSection>
          <FormSection title="Driver's license" description="LTO-issued license. Tricycle drivers need a professional license.">
            <Field label="License number" name="licenseNumber" required error={e.licenseNumber} hint="Format: A01-23-456789"><Input {...f.bind('licenseNumber')} className="uppercase" /></Field>
            <Field label="License type" name="licenseType" error={e.licenseType}>
              <Select {...f.bind('licenseType')}><option value="PROFESSIONAL">Professional</option><option value="NON_PROFESSIONAL">Non-professional</option></Select>
            </Field>
            <Field label="Expiry date" name="licenseExpiry" required error={e.licenseExpiry}><Input type="date" {...f.bind('licenseExpiry')} /></Field>
          </FormSection>
          <FormSection title="Membership" description={editing ? 'Changing the association transfers the driver and opens a new membership.' : 'The driver joins this association as a pending member.'}>
            <Field label="Association" name="associationId" error={e.associationId} hint={restrictedAssoc ? 'Drivers you add join your association.' : undefined}>
              {restrictedAssoc ? <Input value={user?.association?.name ?? ''} disabled /> : <AssociationSelect id="associationId" value={f.values.associationId} onChange={(v) => f.set('associationId', v)} allLabel="— Not assigned yet —" />}
            </Field>
            {!editing && (
              <Field label="Member type" name="memberType">
                <Select {...f.bind('memberType')}><option value="DRIVER">Driver</option><option value="OPERATOR">Operator</option><option value="DRIVER_OPERATOR">Driver-operator</option></Select>
              </Field>
            )}
          </FormSection>
        </CardContent></Card>
        <div className="sticky bottom-0 mt-4 flex justify-end gap-2 border-t bg-background/95 py-3 backdrop-blur">
          <Button type="button" variant="outline" onClick={() => nav(-1)}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{editing ? 'Save changes' : 'Register driver'}</Button>
        </div>
      </form>
    </div>
  );
}
