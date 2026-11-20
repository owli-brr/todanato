import { useEffect, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/api';
import { useAction, useForm } from '@/lib/hooks';
import { toInputDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Field, FormSection, Input, Select } from '@/components/ui/form';
import { Card, CardContent, ErrorState, PageHeader, Skeleton } from '@/components/ui/misc';

const empty = {
  plateNumber: '', franchiseNumber: '', franchiseExpiry: '', bodyNumber: '',
  ownerName: '', ownerContact: '', ownerAddress: '',
  make: '', model: '', year: '', color: '', engineNumber: '', chassisNumber: '',
  orNumber: '', crNumber: '', registrationExpiry: '', insuranceProvider: '', insurancePolicyNo: '', insuranceExpiry: '',
  inspectionStatus: 'PENDING', lastInspectionAt: '',
};
const DATES = ['franchiseExpiry', 'registrationExpiry', 'insuranceExpiry', 'lastInspectionAt'] as const;

export default function VehicleForm() {
  const { id } = useParams();
  const editing = !!id;
  const nav = useNavigate();
  const f = useForm(empty);
  const existing = useQuery({ queryKey: ['vehicle', id], queryFn: () => api.get<Record<string, unknown>>(`/vehicles/${id}`), enabled: editing });
  useEffect(() => {
    const v = existing.data;
    if (!v) return;
    const o: Record<string, string> = {};
    for (const k of Object.keys(empty)) o[k] = v[k] == null ? '' : String(v[k]);
    for (const k of DATES) o[k] = toInputDate(v[k] as string);
    f.setValues(o as typeof empty);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [existing.data]);

  const save = useAction(
    (b: typeof empty) => {
      const payload: Record<string, unknown> = { ...b, year: b.year || null };
      for (const k of DATES) payload[k] = b[k] || null;
      return editing ? api.patch<{ id: string }>(`/vehicles/${id}`, payload) : api.post<{ id: string }>('/vehicles', payload);
    },
    { success: editing ? 'Tricycle updated' : 'Tricycle registered', invalidate: [['vehicles'], ['vehicle', id], ['dashboard']], onSuccess: (r) => nav(`/vehicles/${r.id}`), onFieldErrors: f.setErrors },
  );

  if (editing && existing.error) return <ErrorState error={existing.error} />;
  if (editing && !existing.data) return <Skeleton className="h-96" />;
  const e = f.errors;
  return (
    <div>
      <PageHeader title={editing ? `Edit ${existing.data?.plateNumber}` : 'Register tricycle'} back={editing ? `/vehicles/${id}` : '/vehicles'} />
      <form onSubmit={(ev: FormEvent) => { ev.preventDefault(); save.mutate(f.values); }} noValidate>
        <Card><CardContent className="pt-6">
          <FormSection title="Identification" description="Plate and franchise as issued by LTO and the city/municipal TRU.">
            <Field label="Plate number" name="plateNumber" required error={e.plateNumber} hint="e.g. AB 12345"><Input {...f.bind('plateNumber')} className="uppercase" /></Field>
            <Field label="Body number" name="bodyNumber" error={e.bodyNumber}><Input {...f.bind('bodyNumber')} /></Field>
            <Field label="Franchise / MTOP no." name="franchiseNumber" error={e.franchiseNumber}><Input {...f.bind('franchiseNumber')} /></Field>
            <Field label="Franchise expiry" name="franchiseExpiry" error={e.franchiseExpiry}><Input type="date" {...f.bind('franchiseExpiry')} /></Field>
          </FormSection>
          <FormSection title="Vehicle details">
            <Field label="Make" name="make" required error={e.make}><Input {...f.bind('make')} placeholder="Honda, Kawasaki…" list="makes" /></Field>
            <datalist id="makes">{['Honda', 'Kawasaki', 'Yamaha', 'Suzuki', 'Rusi', 'Motorstar', 'Bajaj', 'TVS'].map((m) => <option key={m} value={m} />)}</datalist>
            <Field label="Model" name="model" required error={e.model}><Input {...f.bind('model')} placeholder="TMX 155" /></Field>
            <Field label="Year" name="year" error={e.year}><Input type="number" inputMode="numeric" {...f.bind('year')} /></Field>
            <Field label="Color" name="color" required error={e.color}><Input {...f.bind('color')} /></Field>
            <Field label="Engine number" name="engineNumber" error={e.engineNumber}><Input {...f.bind('engineNumber')} /></Field>
            <Field label="Chassis number" name="chassisNumber" error={e.chassisNumber}><Input {...f.bind('chassisNumber')} /></Field>
          </FormSection>
          <FormSection title="Owner / operator">
            <Field label="Owner name" name="ownerName" required error={e.ownerName}><Input {...f.bind('ownerName')} /></Field>
            <Field label="Owner contact" name="ownerContact" error={e.ownerContact}><Input type="tel" {...f.bind('ownerContact')} /></Field>
            <Field label="Owner address" name="ownerAddress" error={e.ownerAddress} className="sm:col-span-2"><Input {...f.bind('ownerAddress')} /></Field>
          </FormSection>
          <FormSection title="Registration & insurance">
            <Field label="LTO OR number" name="orNumber" error={e.orNumber}><Input {...f.bind('orNumber')} /></Field>
            <Field label="LTO CR number" name="crNumber" error={e.crNumber}><Input {...f.bind('crNumber')} /></Field>
            <Field label="Registration expiry" name="registrationExpiry" error={e.registrationExpiry}><Input type="date" {...f.bind('registrationExpiry')} /></Field>
            <div />
            <Field label="Insurance provider" name="insuranceProvider" error={e.insuranceProvider}><Input {...f.bind('insuranceProvider')} /></Field>
            <Field label="Policy number" name="insurancePolicyNo" error={e.insurancePolicyNo}><Input {...f.bind('insurancePolicyNo')} /></Field>
            <Field label="Insurance expiry" name="insuranceExpiry" error={e.insuranceExpiry}><Input type="date" {...f.bind('insuranceExpiry')} /></Field>
          </FormSection>
          <FormSection title="Inspection">
            <Field label="Inspection status" name="inspectionStatus"><Select {...f.bind('inspectionStatus')}><option value="PENDING">Pending</option><option value="PASSED">Passed</option><option value="FAILED">Failed</option><option value="EXPIRED">Expired</option></Select></Field>
            <Field label="Last inspection" name="lastInspectionAt"><Input type="date" {...f.bind('lastInspectionAt')} /></Field>
          </FormSection>
        </CardContent></Card>
        <div className="sticky bottom-0 mt-4 flex justify-end gap-2 border-t bg-background/95 py-3 backdrop-blur">
          <Button type="button" variant="outline" onClick={() => nav(-1)}>Cancel</Button>
          <Button type="submit" loading={save.isPending}>{editing ? 'Save changes' : 'Register tricycle'}</Button>
        </div>
      </form>
    </div>
  );
}
