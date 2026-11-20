import { useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Ban, Printer } from 'lucide-react';
import { api, ApiError } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDateTime, label, peso, toInputDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Textarea } from '@/components/ui/form';
import { Badge, Card, CardContent, ErrorState, PageHeader, Skeleton } from '@/components/ui/misc';
import { chargeLabel, draftToBody, PaymentFields, type DriverPick, type PaymentDraft } from './shared';

interface Payment {
  id: string; receiptNo: string; type: string; method: string; amount: string; referenceNo: string | null; paidAt: string; notes: string | null;
  status: string; voidedAt: string | null; voidReason: string | null; recordedBy: string;
  driver: { id: string; fullName: string; driverCode: string; contactNumber: string } | null;
  allocations: { amount: string; due: { id: string; type: string; periodStart: string; periodEnd: string; amount: string; dueDate: string } }[];
  replaces: { id: string; receiptNo: string } | null; replacedBy: { id: string; receiptNo: string } | null;
  association: { name: string; acronym: string | null; terminalLocation: string | null; contactNumber: string | null; email: string | null; city: string; barangay: string };
}

export default function PaymentReceiptPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data: p, error, refetch } = useQuery({ queryKey: ['finance', 'payment', id], queryFn: () => api.get<Payment>(`/finance/payments/${id}`) });
  const [voiding, setVoiding] = useState(false);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!p) return <Skeleton className="h-96" />;
  const allocated = p.allocations.reduce((s, a) => s + Number(a.amount), 0);
  const advance = Number(p.amount) - allocated;
  const voided = p.status === 'VOIDED';
  return (
    <div className="mx-auto max-w-2xl">
      <div className="print:hidden">
        <PageHeader
          back="/finance?tab=payments"
          title={`Receipt ${p.receiptNo}`}
          actions={<>
            <Button variant="outline" onClick={() => window.print()}><Printer /> Print</Button>
            {!voided && can('finance.void') && <Button variant="outline" onClick={() => setVoiding(true)}><Ban /> Void</Button>}
          </>}
        />
        {voided && (
          <div className="mb-4 rounded-lg border border-red-300 bg-red-50 p-4 text-sm text-red-900 dark:border-red-500/30 dark:bg-red-500/10 dark:text-red-200">
            <div className="font-medium">This receipt was voided on {fmtDateTime(p.voidedAt)}.</div>
            <div>Reason: {p.voidReason}</div>
            {p.replacedBy && <div className="mt-1">Corrected by <Link className="font-medium underline" to={`/finance/payments/${p.replacedBy.id}`}>{p.replacedBy.receiptNo}</Link>.</div>}
          </div>
        )}
        {p.replaces && <p className="mb-4 text-sm text-muted-foreground">This receipt corrects <Link className="text-primary hover:underline" to={`/finance/payments/${p.replaces.id}`}>{p.replaces.receiptNo}</Link>, which was voided.</p>}
      </div>

      <Card className="relative overflow-hidden print:border-0 print:shadow-none">
        {voided && <div className="pointer-events-none absolute inset-0 flex items-center justify-center"><span className="-rotate-12 rounded border-4 border-red-500/60 px-6 py-2 text-5xl font-bold tracking-widest text-red-500/60">VOID</span></div>}
        <CardContent className="space-y-6 p-6 sm:p-8">
          <div className="flex flex-col gap-4 border-b pb-5 sm:flex-row sm:items-start sm:justify-between">
            <div>
              <div className="text-lg font-semibold">{p.association.name}</div>
              <div className="text-sm text-muted-foreground">{p.association.terminalLocation ?? `${p.association.barangay}, ${p.association.city}`}</div>
              {(p.association.contactNumber || p.association.email) && <div className="text-sm text-muted-foreground">{[p.association.contactNumber, p.association.email].filter(Boolean).join(' · ')}</div>}
            </div>
            <div className="sm:text-right">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Official receipt</div>
              <div className="font-mono text-lg font-semibold">{p.receiptNo}</div>
              <div className="text-sm text-muted-foreground">{fmtDateTime(p.paidAt)}</div>
            </div>
          </div>
          <div className="grid gap-4 text-sm sm:grid-cols-2">
            <div><div className="text-xs uppercase tracking-wide text-muted-foreground">Received from</div><div className="mt-1 font-medium">{p.driver ? <Link to={`/drivers/${p.driver.id}`} className="hover:text-primary">{p.driver.fullName}</Link> : 'Walk-in / other'}</div>{p.driver && <div className="text-muted-foreground">{p.driver.driverCode}</div>}</div>
            <div><div className="text-xs uppercase tracking-wide text-muted-foreground">Payment</div><div className="mt-1">{label(p.type)}</div><div className="text-muted-foreground">{label(p.method)}{p.referenceNo && <> · ref <span className="font-mono">{p.referenceNo}</span></>}</div></div>
          </div>
          <div>
            <div className="mb-2 text-xs uppercase tracking-wide text-muted-foreground">Applied to</div>
            <table className="w-full text-sm">
              <tbody>
                {p.allocations.map((a) => (
                  <tr key={a.due.id} className="border-b last:border-0"><td className="py-2">{chargeLabel(a.due)}<div className="text-xs text-muted-foreground">Due {fmtDate(a.due.dueDate)}</div></td><td className="py-2 text-right tabular">{peso(a.amount, 2)}</td></tr>
                ))}
                {advance > 0.004 && <tr className="border-b last:border-0"><td className="py-2">{p.allocations.length ? 'Advance (no more unpaid charges)' : p.driver ? `${label(p.type)}, advance (no unpaid charge yet)` : label(p.type)}</td><td className="py-2 text-right tabular">{peso(advance, 2)}</td></tr>}
              </tbody>
              <tfoot><tr className="border-t-2"><td className="pt-3 font-semibold">Total received</td><td className="pt-3 text-right text-lg font-semibold tabular">{peso(p.amount, 2)}</td></tr></tfoot>
            </table>
          </div>
          {p.notes && <div className="text-sm"><span className="text-muted-foreground">Notes:</span> {p.notes}</div>}
          <div className="flex items-end justify-between gap-4 border-t pt-5 text-sm">
            <div className="text-muted-foreground">Received by {p.recordedBy}</div>
            {voided ? <Badge tone="red">Void</Badge> : <Badge tone="green">Posted</Badge>}
          </div>
        </CardContent>
      </Card>
      <VoidDialog open={voiding} onOpenChange={setVoiding} payment={p} />
    </div>
  );
}

function VoidDialog({ open, onOpenChange, payment: p }: { open: boolean; onOpenChange: (o: boolean) => void; payment: Payment }) {
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [reason, setReason] = useState('');
  const [correct, setCorrect] = useState(false);
  const [v, setV] = useState<PaymentDraft>(() => ({ type: p.type, method: p.method, amount: String(Number(p.amount)), referenceNo: p.referenceNo ?? '', paidAt: toInputDate(p.paidAt), notes: p.notes ?? '' }));
  const driver: DriverPick | null = p.driver ? { id: p.driver.id, fullName: p.driver.fullName, driverCode: p.driver.driverCode } : null;
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErrors({});
    try {
      const r = await api.post<{ replacement: { id: string; receiptNo: string } | null }>(`/finance/payments/${p.id}/void`, { reason, ...(correct ? { replacement: draftToBody(v, driver) } : {}) });
      qc.invalidateQueries({ queryKey: ['finance'] });
      onOpenChange(false);
      if (r.replacement) { toast.success(`${p.receiptNo} voided and replaced by ${r.replacement.receiptNo}`); nav(`/finance/payments/${r.replacement.id}`); }
      else toast.success(`${p.receiptNo} voided`);
    } catch (err) {
      if (err instanceof ApiError && err.fields) setErrors(Object.fromEntries(Object.entries(err.fields).map(([k, m]) => [k.replace(/^replacement\./, ''), m])));
      toast.error((err as Error).message);
    } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Void ${p.receiptNo}?`} description="A posted receipt is never edited. Voiding keeps it on record, marked VOID, and takes it off the driver’s payments. If the details were wrong, issue a corrected receipt at the same time." className="max-w-xl">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Reason" name="reason" required error={errors.reason}><Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Wrong amount entered; driver paid ₱150, not ₱1,500" /></Field>
        {can('finance.record') && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={correct} onChange={(e) => setCorrect(e.target.checked)} />Issue a corrected receipt</label>}
        {correct && <PaymentFields v={v} set={(x) => setV((o) => ({ ...o, ...x }))} errors={errors} driver={driver} setDriver={() => undefined} lockDriver />}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" variant="destructive" loading={busy}>{correct ? 'Void and issue correction' : 'Void receipt'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
