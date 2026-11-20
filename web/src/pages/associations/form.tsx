import { useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useAction, useForm } from '@/lib/hooks';
import { toInputDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, FormSection, Input, Select } from '@/components/ui/form';
import { Card, CardContent, ErrorState, PageHeader, Skeleton } from '@/components/ui/misc';

const empty = {
  name: '', acronym: '', barangay: '', city: '', province: 'Rizal', address: '', terminalLocation: '', contactNumber: '', email: '',
  ltfrbAccreditation: '', dateEstablished: '', status: 'ACTIVE', membershipFee: '0', monthlyDues: '0', dailyContribution: '0',
};

export default function AssociationForm() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const { user } = useAuth();
  const f = useForm(empty);
  const existing = useQuery({ queryKey: ['association', id], queryFn: () => api.get<Record<string, unknown>>(`/associations/${id}`), enabled: editing });
  useEffect(() => {
    const a = existing.data;
    if (!a) return;
    const o: Record<string, string> = {};
    for (const k of Object.keys(empty)) o[k] = a[k] == null ? '' : String(a[k]);
    o.dateEstablished = toInputDate(a.dateEstablished as string);
    f.setValues(o as typeof empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);
  const save = useAction(
    (b: typeof empty) => {
      const p = { ...b, dateEstablished: b.dateEstablished || null };
      return editing ? api.patch<{ id: string }>(`/associations/${id}`, p) : api.post<{ id: string }>('/associations', p);
    },
    { success: editing ? 'Association updated' : 'Association registered', invalidate: [['associations'], ['association', id]], onSuccess: (r) => nav(`/associations/${r.id}`), onFieldErrors: f.setErrors },
  );
  if (editing && existing.error) return <ErrorState error={existing.error} />;
  if (editing && !existing.data) return <Skeleton className="h-96" />;
  const e = f.errors;
  return (
    <div>
      <PageHeader title={editing ? 'Edit association' : 'Register association'} back={editing ? `/associations/${id}` : '/associations'} />
      <form onSubmit={(ev) => { ev.preventDefault(); save.mutate(f.values); }} noValidate>
        <Card><CardContent className="pt-6">
          <FormSection title="Association">
            <Field label="Name" name="name" required error={e.name} className="sm:col-span-2"><Input {...f.bind('name')} placeholder="e.g. San Roque Tricycle Operators and Drivers Association" /></Field>
            <Field label="Acronym" name="acronym" error={e.acronym}><Input {...f.bind('acronym')} placeholder="SRTODA" /></Field>
            <Field label="Date established" name="dateEstablished" error={e.dateEstablished}><Input type="date" {...f.bind('dateEstablished')} /></Field>
            <Field label="LTFRB / city accreditation no." name="ltfrbAccreditation" error={e.ltfrbAccreditation}><Input {...f.bind('ltfrbAccreditation')} /></Field>
            {editing && user?.role.scope !== 'ASSOCIATION' && (
              <Field label="Status" name="status"><Select {...f.bind('status')}><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="SUSPENDED">Suspended</option></Select></Field>
            )}
          </FormSection>
          <FormSection title="Location & contact">
            <Field label="Barangay" name="barangay" required error={e.barangay}><Input {...f.bind('barangay')} /></Field>
            <Field label="City / municipality" name="city" required error={e.city}><Input {...f.bind('city')} /></Field>
            <Field label="Province" name="province" required error={e.province}><Input {...f.bind('province')} /></Field>
            <Field label="Terminal location" name="terminalLocation" error={e.terminalLocation}><Input {...f.bind('terminalLocation')} /></Field>
            <Field label="Office address" name="address" error={e.address} className="sm:col-span-2"><Input {...f.bind('address')} /></Field>
            <Field label="Contact number" name="contactNumber" error={e.contactNumber}><Input type="tel" {...f.bind('contactNumber')} /></Field>
            <Field label="Email" name="email" error={e.email}><Input type="email" {...f.bind('email')} /></Field>
          </FormSection>
          <FormSection title="Fees" description="Default amounts used by the Finance module (Phase 2).">
            <Field label="Membership fee (₱)" name="membershipFee" error={e.membershipFee}><Input type="number" min="0" step="0.01" {...f.bind('membershipFee')} /></Field>
            <Field label="Monthly dues (₱)" name="monthlyDues" error={e.monthlyDues}><Input type="number" min="0" step="0.01" {...f.bind('monthlyDues')} /></Field>
            <Field label="Daily contribution (₱)" name="dailyContribution" error={e.dailyContribution}><Input type="number" min="0" step="0.01" {...f.bind('dailyContribution')} /></Field>
          </FormSection>
        </CardContent></Card>
        <div className="sticky bottom-0 mt-4 flex justify-end gap-2 border-t bg-background/95 py-3 backdrop-blur">
          <Button type="button" variant="outline" onClick={() => nav(-1)}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{editing ? 'Save changes' : 'Register association'}</Button>
        </div>
      </form>
    </div>
  );
}
