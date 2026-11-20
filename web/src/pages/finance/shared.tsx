import { useEffect, useState, type FormEvent } from 'react';
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { api, ApiError, qs, type Paged } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { fmtDate, label, peso, toInputDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';

export const PAYMENT_TYPES = ['MONTHLY_DUES', 'DAILY_CONTRIBUTION', 'WEEKLY_CONTRIBUTION', 'MEMBERSHIP_FEE', 'ASSOCIATION_FEE', 'PENALTY', 'OTHER'] as const;
export const METHODS = ['CASH', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER'] as const;
export const needsRef = (m: string) => ['GCASH', 'MAYA', 'BANK_TRANSFER'].includes(m);
export const monthLabel = (d: string) => new Date(d).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
export const chargeLabel = (c: { type: string; periodStart: string }) => (c.type === 'MONTHLY_DUES' ? `Dues for ${monthLabel(c.periodStart)}` : label(c.type));

export interface DriverPick { id: string; fullName: string; driverCode: string }

/** Search-as-you-type driver picker. */
export function DriverPicker({ value, onChange, invalid }: { value: DriverPick | null; onChange: (d: DriverPick | null) => void; invalid?: boolean }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data } = useQuery({
    queryKey: ['driver-pick', dq], enabled: !value && dq.length >= 2,
    queryFn: () => api.get<Paged<DriverPick>>(`/drivers${qs({ q: dq, pageSize: 8, application: 'APPROVED' })}`),
  });
  if (value) {
    return (
      <div className="flex h-10 items-center justify-between rounded-md border bg-muted/40 px-3 text-sm">
        <span><span className="font-medium">{value.fullName}</span> <span className="text-muted-foreground">· {value.driverCode}</span></span>
        <button type="button" onClick={() => onChange(null)} aria-label="Change driver" className="text-muted-foreground hover:text-foreground"><X className="size-4" /></button>
      </div>
    );
  }
  return (
    <div className="relative">
      <Input id="driverId" value={q} onChange={(e) => setQ(e.target.value)} placeholder="Type a name or driver code…" autoComplete="off" aria-invalid={invalid || undefined} />
      {dq.length >= 2 && data && (
        <ul className="absolute z-10 mt-1 max-h-60 w-full overflow-y-auto rounded-md border bg-popover py-1 text-sm shadow-md">
          {data.items.length === 0 && <li className="px-3 py-2 text-muted-foreground">No approved driver matches</li>}
          {data.items.map((d) => (
            <li key={d.id}><button type="button" className="w-full px-3 py-2 text-left hover:bg-muted" onClick={() => { onChange({ id: d.id, fullName: d.fullName, driverCode: d.driverCode }); setQ(''); }}>{d.fullName} <span className="text-muted-foreground">· {d.driverCode}</span></button></li>
          ))}
        </ul>
      )}
    </div>
  );
}

interface OpenCharge { id: string; type: string; periodStart: string; dueDate: string; balance: number; overdue: boolean }

export interface PaymentDraft { type: string; method: string; amount: string; referenceNo: string; paidAt: string; notes: string }
export const emptyDraft = (): PaymentDraft => ({ type: 'MONTHLY_DUES', method: 'CASH', amount: '', referenceNo: '', paidAt: toInputDate(new Date()), notes: '' });

/** The payment fields, shared by "Record payment" and "Void and correct". */
export function PaymentFields({ v, set, errors, driver, setDriver, lockDriver }: {
  v: PaymentDraft; set: (p: Partial<PaymentDraft>) => void; errors: Record<string, string>;
  driver: DriverPick | null; setDriver: (d: DriverPick | null) => void; lockDriver?: boolean;
}) {
  const open = useQuery({
    queryKey: ['finance', 'dues', 'open', driver?.id], enabled: !!driver,
    queryFn: () => api.get<Paged<OpenCharge>>(`/finance/dues${qs({ driverId: driver!.id, status: 'OPEN', pageSize: 50, sort: 'dueDate', dir: 'asc' })}`),
  });
  const sameType = open.data?.items.filter((c) => c.type === v.type) ?? [];
  const owed = sameType.reduce((s, c) => s + c.balance, 0);
  return (
    <div className="grid gap-4 sm:grid-cols-2">
      <Field label="Driver" name="driverId" error={errors.driverId} className="sm:col-span-2" hint={lockDriver ? undefined : 'Leave empty only for payments not tied to a driver.'}>
        {lockDriver && driver ? <div className="flex h-10 items-center rounded-md border bg-muted/40 px-3 text-sm">{driver.fullName} · {driver.driverCode}</div> : <DriverPicker value={driver} onChange={setDriver} invalid={!!errors.driverId} />}
      </Field>
      {driver && open.data && (
        <div className="rounded-md border bg-muted/30 p-3 text-sm sm:col-span-2">
          {open.data.items.length === 0 ? <span className="text-muted-foreground">No unpaid charges. A payment is kept as an advance.</span> : (
            <>
              <div className="mb-1 font-medium">Unpaid charges</div>
              <ul className="space-y-0.5">
                {open.data.items.slice(0, 6).map((c) => (
                  <li key={c.id} className="flex justify-between gap-3"><span className={c.overdue ? 'text-destructive' : ''}>{chargeLabel(c)} · due {fmtDate(c.dueDate)}</span><span className="tabular">{peso(c.balance, 2)}</span></li>
                ))}
                {open.data.items.length > 6 && <li className="text-muted-foreground">and {open.data.items.length - 6} more</li>}
              </ul>
              {owed > 0 && <button type="button" className="mt-2 text-xs font-medium text-primary hover:underline" onClick={() => set({ amount: String(owed) })}>Pay all {label(v.type).toLowerCase()} owed ({peso(owed, 2)})</button>}
            </>
          )}
        </div>
      )}
      <Field label="Payment for" name="type" required error={errors.type}>
        <Select id="type" value={v.type} onChange={(e) => set({ type: e.target.value })}>{PAYMENT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select>
      </Field>
      <Field label="Amount (₱)" name="amount" required error={errors.amount}>
        <Input id="amount" inputMode="decimal" value={v.amount} onChange={(e) => set({ amount: e.target.value.replace(/[^0-9.]/g, '') })} aria-invalid={!!errors.amount || undefined} />
      </Field>
      <Field label="Paid via" name="method" required error={errors.method}>
        <Select id="method" value={v.method} onChange={(e) => set({ method: e.target.value })}>{METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</Select>
      </Field>
      <Field label="Reference no." name="referenceNo" required={needsRef(v.method)} error={errors.referenceNo}>
        <Input id="referenceNo" value={v.referenceNo} onChange={(e) => set({ referenceNo: e.target.value })} placeholder={needsRef(v.method) ? 'Transaction reference' : 'Optional'} aria-invalid={!!errors.referenceNo || undefined} />
      </Field>
      <Field label="Date paid" name="paidAt" required error={errors.paidAt}>
        <Input id="paidAt" type="date" max={toInputDate(new Date())} value={v.paidAt} onChange={(e) => set({ paidAt: e.target.value })} />
      </Field>
      <Field label="Notes" name="notes" error={errors.notes} className="sm:col-span-2">
        <Textarea id="notes" rows={2} value={v.notes} onChange={(e) => set({ notes: e.target.value })} />
      </Field>
    </div>
  );
}

/** Today's date keeps the current time; a past date is recorded at noon Manila time. */
export const draftToBody = (v: PaymentDraft, driver: DriverPick | null) => ({
  driverId: driver?.id ?? null, type: v.type, method: v.method, amount: v.amount, referenceNo: v.referenceNo, notes: v.notes,
  paidAt: v.paidAt === toInputDate(new Date()) ? new Date().toISOString() : new Date(`${v.paidAt}T12:00:00+08:00`).toISOString(),
});

export function RecordPaymentDialog({ open, onOpenChange, onDone, initialDriver, initialType }: {
  open: boolean; onOpenChange: (o: boolean) => void; onDone: (p: { id: string; receiptNo: string }) => void; initialDriver?: DriverPick | null; initialType?: string;
}) {
  const [v, setV] = useState<PaymentDraft>(emptyDraft);
  const [driver, setDriver] = useState<DriverPick | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) { setV({ ...emptyDraft(), ...(initialType ? { type: initialType } : {}) }); setDriver(initialDriver ?? null); setErrors({}); }
  }, [open, initialDriver, initialType]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true); setErrors({});
    try {
      const p = await api.post<{ id: string; receiptNo: string }>('/finance/payments', draftToBody(v, driver));
      onDone(p);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(err.fields);
      else setErrors({ _: err instanceof Error ? err.message : 'Could not save' });
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Record payment" description="Issues an official receipt and applies it to the driver’s oldest unpaid charges of the same kind." className="max-w-xl">
      <form onSubmit={submit} className="space-y-4">
        <PaymentFields v={v} set={(p) => setV((x) => ({ ...x, ...p }))} errors={errors} driver={driver} setDriver={setDriver} />
        {errors._ && <p className="text-sm text-destructive">{errors._}</p>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" loading={busy}>Record and issue receipt</Button>
        </div>
      </form>
    </Dialog>
  );
}
