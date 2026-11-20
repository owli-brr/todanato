import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { toast } from 'sonner';
import { CalendarPlus, MoreHorizontal, Pencil, Plus, ReceiptText, Trash2, X } from 'lucide-react';
import { api, ApiError, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, useListParams } from '@/lib/hooks';
import { fmtDate, fmtDateTime, label, num, peso, toInputDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, ErrorState, PageHeader, Skeleton, StatusBadge } from '@/components/ui/misc';
import { DataTable, Pagination, type Column } from '@/components/ui/table';
import { Menu, MenuContent, MenuItem, MenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { SearchBox, Toolbar } from '@/components/shared';
import { ChartTooltip, Legend } from '@/pages/dashboard';
import { chargeLabel, DriverPicker, METHODS, PAYMENT_TYPES, RecordPaymentDialog, type DriverPick } from './shared';

const TABS = ['overview', 'payments', 'dues', 'expenses'] as const;

export default function FinancePage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const tab = (TABS as readonly string[]).includes(sp.get('tab') ?? '') ? sp.get('tab')! : 'overview';
  const [pay, setPay] = useState<{ driver?: DriverPick | null; type?: string } | null>(null);
  return (
    <div>
      <PageHeader
        title="Finance"
        description="Collections, dues and expenses of the TODA"
        actions={can('finance.record') && <Button onClick={() => setPay({})}><ReceiptText /> Record payment</Button>}
      />
      <Tabs value={tab} onValueChange={(t) => setSp(t === 'overview' ? {} : { tab: t }, { replace: true })}>
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="payments">Payments</TabsTrigger>
          <TabsTrigger value="dues">Dues and charges</TabsTrigger>
          <TabsTrigger value="expenses">Expenses</TabsTrigger>
        </TabsList>
        <TabsContent value="overview"><Overview /></TabsContent>
        <TabsContent value="payments"><Payments /></TabsContent>
        <TabsContent value="dues"><Dues onPay={(driver, type) => setPay({ driver, type })} /></TabsContent>
        <TabsContent value="expenses"><Expenses /></TabsContent>
      </Tabs>
      <RecordPaymentDialog
        open={!!pay} onOpenChange={(o) => !o && setPay(null)} initialDriver={pay?.driver} initialType={pay?.type}
        onDone={(p) => { setPay(null); qc.invalidateQueries({ queryKey: ['finance'] }); toast.success(`Receipt ${p.receiptNo} issued`); nav(`/finance/payments/${p.id}`); }}
      />
    </div>
  );
}

// ───────────── Overview ─────────────

interface Summary {
  collected: number; receipts: number; spent: number; net: number; outstanding: number; openCharges: number; driversOverdue: number;
  byType: { type: string; amount: number; count: number }[]; byMethod: { method: string; amount: number; count: number }[];
  expensesByCategory: { category: string; amount: number; count: number }[];
  months: { month: string; collected: number; spent: number }[];
}

const PERIODS: Record<string, [string, () => { from?: string; to?: string }]> = {
  month: ['This month', () => { const d = new Date(); return { from: toInputDate(new Date(d.getFullYear(), d.getMonth(), 1)) }; }],
  last: ['Last month', () => { const d = new Date(); return { from: toInputDate(new Date(d.getFullYear(), d.getMonth() - 1, 1)), to: toInputDate(new Date(d.getFullYear(), d.getMonth(), 0)) }; }],
  year: ['This year', () => ({ from: `${new Date().getFullYear()}-01-01` })],
};

function Breakdown({ title, rows, total }: { title: string; rows: { key: string; label: string; amount: number; count: number }[]; total: number }) {
  return (
    <Card>
      <CardHeader><CardTitle>{title}</CardTitle></CardHeader>
      <CardContent className="space-y-3">
        {rows.length === 0 && <p className="text-sm text-muted-foreground">Nothing recorded in this period.</p>}
        {rows.map((r) => (
          <div key={r.key}>
            <div className="flex justify-between gap-3 text-sm"><span>{r.label} <span className="text-xs text-muted-foreground">· {num(r.count)}</span></span><span className="tabular font-medium">{peso(r.amount)}</span></div>
            <div className="mt-1 h-1.5 rounded-full bg-muted"><div className="h-1.5 rounded-full bg-[var(--c1)]" style={{ width: `${total ? Math.max(2, (r.amount / total) * 100) : 0}%` }} /></div>
          </div>
        ))}
      </CardContent>
    </Card>
  );
}

function Overview() {
  const [period, setPeriod] = useState('month');
  const { data, error, refetch } = useQuery({ queryKey: ['finance', 'summary', period], queryFn: () => api.get<Summary>(`/finance/summary${qs(PERIODS[period][1]())}`) });
  const axis = { tick: { fontSize: 11, fill: 'hsl(var(--muted-foreground))' }, tickLine: false, axisLine: false } as const;
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  const stats: [string, string, string?, boolean?][] = data ? [
    ['Collected', peso(data.collected), `${num(data.receipts)} receipts`],
    ['Expenses', peso(data.spent)],
    ['Net', peso(data.net), undefined, data.net < 0],
    ['Unpaid dues (all time)', peso(data.outstanding), `${num(data.driversOverdue)} drivers overdue`, data.outstanding > 0],
  ] : [];
  return (
    <div className="space-y-4">
      <div className="flex flex-wrap gap-2">
        {Object.entries(PERIODS).map(([k, [l]]) => <Button key={k} size="sm" variant={period === k ? 'default' : 'outline'} onClick={() => setPeriod(k)}>{l}</Button>)}
      </div>
      <div className="grid grid-cols-2 gap-4 lg:grid-cols-4">
        {!data ? Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-24" />) : stats.map(([l, v, sub, bad]) => (
          <Card key={l} className="p-4">
            <p className="text-sm text-muted-foreground">{l}</p>
            <p className={`mt-1 text-2xl font-semibold tabular ${bad ? 'text-destructive' : ''}`}>{v}</p>
            {sub && <p className="mt-0.5 text-xs text-muted-foreground">{sub}</p>}
          </Card>
        ))}
      </div>
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
          <div><CardTitle>Last 12 months</CardTitle><CardDescription>Collections vs expenses</CardDescription></div>
          <Legend items={[['Collections', 'var(--c2)'], ['Expenses', 'var(--c3)']]} />
        </CardHeader>
        <CardContent>
          {!data ? <Skeleton className="h-[260px]" /> : (
            <ResponsiveContainer width="100%" height={260}>
              <BarChart data={data.months.map((m) => ({ ...m, label: new Date(m.month).toLocaleDateString('en-PH', { month: 'short', timeZone: 'UTC' }) }))} margin={{ left: 0, right: 4, top: 8 }} barGap={2} barCategoryGap="22%">
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="label" {...axis} />
                <YAxis {...axis} tickFormatter={(v) => (v >= 1000 ? `₱${Math.round(v / 1000)}k` : `₱${v}`)} />
                <Tooltip content={<ChartTooltip money />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.6 }} />
                <Bar isAnimationActive={false} dataKey="collected" name="Collections" fill="var(--c2)" radius={[4, 4, 0, 0]} />
                <Bar isAnimationActive={false} dataKey="spent" name="Expenses" fill="var(--c3)" radius={[4, 4, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          )}
        </CardContent>
      </Card>
      {data && (
        <div className="grid gap-4 lg:grid-cols-3">
          <Breakdown title="Collections by type" total={data.collected} rows={data.byType.map((r) => ({ key: r.type, label: label(r.type), amount: r.amount, count: r.count }))} />
          <Breakdown title="Collections by method" total={data.collected} rows={data.byMethod.map((r) => ({ key: r.method, label: label(r.method), amount: r.amount, count: r.count }))} />
          <Breakdown title="Expenses by category" total={data.spent} rows={data.expensesByCategory.map((r) => ({ key: r.category, label: r.category, amount: r.amount, count: r.count }))} />
        </div>
      )}
    </div>
  );
}

// ───────────── Payments ─────────────

interface PaymentRow { id: string; receiptNo: string; type: string; method: string; amount: string; referenceNo: string | null; paidAt: string; status: string; driver: { id: string; fullName: string; driverCode: string } | null; recordedBy: string }

function useSearchParam(lp: ReturnType<typeof useListParams>) {
  const [q, setQ] = useState(lp.get('q'));
  const dq = useDebounced(q);
  useEffect(() => { if (dq !== lp.get('q')) lp.set({ q: dq }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dq]);
  return [q, setQ] as const;
}

function Payments() {
  const nav = useNavigate();
  const lp = useListParams({ sort: 'paidAt', dir: 'desc' });
  const [q, setQ] = useSearchParam(lp);
  const query = { ...lp.params, tab: undefined, pageSize: 20 };
  const { data, isLoading, isFetching, error, refetch } = useQuery({ queryKey: ['finance', 'payments', query], queryFn: () => api.get<Paged<PaymentRow> & { postedTotal: number }>(`/finance/payments${qs(query)}`), placeholderData: (p) => p });
  const filtersOn = ['type', 'method', 'status', 'from', 'to', 'q'].some((k) => lp.get(k));
  const columns: Column<PaymentRow>[] = [
    { key: 'receiptNo', header: 'Receipt', sortable: true, cell: (p) => <div><div className={`font-mono text-xs font-medium ${p.status === 'VOIDED' ? 'line-through text-muted-foreground' : ''}`}>{p.receiptNo}</div><div className="text-xs text-muted-foreground">{fmtDateTime(p.paidAt)}</div></div> },
    { key: 'driver', header: 'Paid by', cell: (p) => p.driver ? <div><div>{p.driver.fullName}</div><div className="text-xs text-muted-foreground">{p.driver.driverCode}</div></div> : <span className="text-muted-foreground">Walk-in / other</span> },
    { key: 'type', header: 'For', hideBelow: 'md', cell: (p) => label(p.type) },
    { key: 'method', header: 'Method', hideBelow: 'lg', cell: (p) => <div>{label(p.method)}{p.referenceNo && <div className="font-mono text-xs text-muted-foreground">{p.referenceNo}</div>}</div> },
    { key: 'amount', header: 'Amount', sortable: true, className: 'text-right', cell: (p) => <span className={`tabular font-medium ${p.status === 'VOIDED' ? 'line-through text-muted-foreground' : ''}`}>{peso(p.amount, 2)}</span> },
    { key: 'status', header: 'Status', hideBelow: 'sm', cell: (p) => p.status === 'VOIDED' ? <Badge tone="red">Void</Badge> : <Badge tone="green">Posted</Badge> },
  ];
  return (
    <Card>
      <Toolbar>
        <SearchBox value={q} onChange={setQ} placeholder="Search receipt, reference, driver…" />
        <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
          <Select value={lp.get('type')} onChange={(e) => lp.set({ type: e.target.value })} aria-label="Type" className="sm:w-44"><option value="">All types</option>{PAYMENT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select>
          <Select value={lp.get('method')} onChange={(e) => lp.set({ method: e.target.value })} aria-label="Method" className="sm:w-36"><option value="">All methods</option>{METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</Select>
          <Select value={lp.get('status')} onChange={(e) => lp.set({ status: e.target.value })} aria-label="Status" className="sm:w-32"><option value="">Any status</option><option value="POSTED">Posted</option><option value="VOIDED">Void</option></Select>
          <Input type="date" value={lp.get('from')} onChange={(e) => lp.set({ from: e.target.value })} aria-label="From" className="sm:w-40" />
          <Input type="date" value={lp.get('to')} onChange={(e) => lp.set({ to: e.target.value })} aria-label="To" className="sm:w-40" />
        </div>
        {filtersOn && <Button variant="ghost" size="sm" onClick={() => { setQ(''); lp.set({ type: undefined, method: undefined, status: undefined, from: undefined, to: undefined, q: undefined }); }}><X /> Clear</Button>}
      </Toolbar>
      {data && <div className="border-b px-4 py-2 text-sm text-muted-foreground">{num(data.total)} receipts · posted total <span className="font-medium text-foreground tabular">{peso(data.postedTotal, 2)}</span></div>}
      <DataTable columns={columns} rows={data?.items} loading={isLoading || isFetching} error={error} onRetry={refetch} sort={lp.get('sort')} dir={lp.get('dir') as 'asc' | 'desc'} onSort={lp.toggleSort} onRowClick={(p) => nav(`/finance/payments/${p.id}`)} />
      {data && <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={(p) => lp.set({ page: String(p) }, false)} />}
    </Card>
  );
}

// ───────────── Dues ─────────────

interface DueRow { id: string; type: string; periodStart: string; amount: string; amountPaid: string; balance: number; dueDate: string; status: string; overdue: boolean; driver: { id: string; fullName: string; driverCode: string; status: string } }

function Dues({ onPay }: { onPay: (d: DriverPick, type: string) => void }) {
  const { can } = useAuth();
  const qc = useQueryClient();
  const lp = useListParams({ status: 'OPEN' });
  const [q, setQ] = useSearchParam(lp);
  const query = { ...lp.params, tab: undefined, status: lp.get('status') === 'ALL' ? undefined : lp.get('status'), pageSize: 20 };
  const { data, isLoading, isFetching, error, refetch } = useQuery({ queryKey: ['finance', 'dues', query], queryFn: () => api.get<Paged<DueRow> & { totals: { amount: number; paid: number } }>(`/finance/dues${qs(query)}`), placeholderData: (p) => p });
  const [bill, setBill] = useState(false);
  const [charge, setCharge] = useState(false);
  const [waive, setWaive] = useState<DueRow | null>(null);
  const [reason, setReason] = useState('');
  const refresh = () => qc.invalidateQueries({ queryKey: ['finance'] });
  const open = (r: DueRow) => ['UNPAID', 'PARTIAL', 'OVERDUE'].includes(r.status);
  const columns: Column<DueRow>[] = [
    { key: 'driver', header: 'Driver', sortable: true, cell: (r) => <div><Link to={`/drivers/${r.driver.id}`} className="hover:text-primary">{r.driver.fullName}</Link><div className="text-xs text-muted-foreground">{r.driver.driverCode}</div></div> },
    { key: 'type', header: 'Charge', cell: (r) => chargeLabel(r) },
    { key: 'dueDate', header: 'Due', sortable: true, hideBelow: 'md', cell: (r) => <span className={r.overdue ? 'text-destructive' : ''}>{fmtDate(r.dueDate)}</span> },
    { key: 'amount', header: 'Amount', sortable: true, hideBelow: 'sm', className: 'text-right', cell: (r) => <span className="tabular">{peso(r.amount, 2)}</span> },
    { key: 'balance', header: 'Balance', className: 'text-right', cell: (r) => <span className={`tabular font-medium ${r.balance > 0 ? '' : 'text-muted-foreground'}`}>{peso(r.balance, 2)}</span> },
    { key: 'status', header: 'Status', cell: (r) => <StatusBadge status={r.overdue && r.status !== 'PARTIAL' ? 'OVERDUE' : r.status} /> },
    { key: 'actions', header: '', className: 'w-10', cell: (r) => open(r) && (can('finance.record') || can('finance.void')) ? (
      <Menu>
        <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Actions"><MoreHorizontal /></Button></MenuTrigger>
        <MenuContent>
          {can('finance.record') && <MenuItem onSelect={() => onPay({ id: r.driver.id, fullName: r.driver.fullName, driverCode: r.driver.driverCode }, r.type)}><ReceiptText /> Record payment</MenuItem>}
          {can('finance.void') && <MenuItem onSelect={() => { setReason(''); setWaive(r); }}><X /> Waive charge</MenuItem>}
        </MenuContent>
      </Menu>
    ) : null },
  ];
  return (
    <>
      <Card>
        <Toolbar>
          <SearchBox value={q} onChange={setQ} placeholder="Search driver…" />
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Select value={lp.get('status')} onChange={(e) => lp.set({ status: e.target.value || 'ALL' })} aria-label="Status" className="sm:w-40">
              <option value="OPEN">Unpaid (all)</option><option value="OVERDUE">Overdue</option><option value="PARTIAL">Partly paid</option><option value="PAID">Paid</option><option value="WAIVED">Waived</option><option value="ALL">Everything</option>
            </Select>
            <Select value={lp.get('type')} onChange={(e) => lp.set({ type: e.target.value })} aria-label="Type" className="sm:w-44"><option value="">All charges</option>{PAYMENT_TYPES.map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select>
            <Input type="month" value={lp.get('period')} onChange={(e) => lp.set({ period: e.target.value })} aria-label="Month" className="sm:w-44" />
          </div>
          {can('finance.record') && (
            <div className="flex gap-2 sm:ml-auto">
              <Button variant="outline" size="sm" onClick={() => setCharge(true)}><Plus /> Add charge</Button>
              <Button size="sm" onClick={() => setBill(true)}><CalendarPlus /> Bill monthly dues</Button>
            </div>
          )}
        </Toolbar>
        {data && <div className="border-b px-4 py-2 text-sm text-muted-foreground">{num(data.total)} charges · billed <span className="tabular text-foreground">{peso(data.totals.amount, 2)}</span> · paid <span className="tabular text-foreground">{peso(data.totals.paid, 2)}</span></div>}
        <DataTable columns={columns} rows={data?.items} loading={isLoading || isFetching} error={error} onRetry={refetch} sort={lp.get('sort')} dir={lp.get('dir') as 'asc' | 'desc'} onSort={lp.toggleSort} />
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={(p) => lp.set({ page: String(p) }, false)} />}
      </Card>
      <BillMonthDialog open={bill} onOpenChange={setBill} onDone={refresh} />
      <AddChargeDialog open={charge} onOpenChange={setCharge} onDone={refresh} />
      <ConfirmDialog
        open={!!waive} onOpenChange={(o) => !o && setWaive(null)} tone="destructive" confirmLabel="Waive charge"
        title="Waive this charge?" description={waive ? `${chargeLabel(waive)} of ${waive.driver.fullName}, balance ${peso(waive.balance, 2)}. The driver will no longer owe it. This is recorded in the audit log.` : ''}
        onConfirm={async () => {
          try { await api.post(`/finance/dues/${waive!.id}/waive`, { reason }); toast.success('Charge waived'); setWaive(null); refresh(); }
          catch (e) { toast.error(e instanceof ApiError && e.fields?.reason ? e.fields.reason : (e as Error).message); }
        }}
      >
        <Field label="Reason" name="reason" required><Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Approved by the board: hospitalized in March" /></Field>
      </ConfirmDialog>
    </>
  );
}

function BillMonthDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [month, setMonth] = useState(() => toInputDate(new Date()).slice(0, 7));
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try {
      const r = await api.post<{ created: number; skipped: number; amount: number; period: string }>('/finance/dues/generate', { month });
      toast.success(r.created ? `Billed ${r.period} dues to ${r.created} member${r.created === 1 ? '' : 's'}` : `Everyone already has ${r.period} dues`);
      onOpenChange(false); onDone();
    } catch (err) { toast.error((err as Error).message); } finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Bill monthly dues" description="Adds the month’s dues for every active or suspended member, at the amount set on the TODA profile. Members already billed for that month are skipped, so it’s safe to run again.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Month" name="month" required><Input id="month" type="month" value={month} onChange={(e) => setMonth(e.target.value)} /></Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" loading={busy}>Bill members</Button>
        </div>
      </form>
    </Dialog>
  );
}

function AddChargeDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [driver, setDriver] = useState<DriverPick | null>(null);
  const [v, setV] = useState({ type: 'PENALTY', amount: '', dueDate: toInputDate(new Date()), description: '' });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setDriver(null); setV({ type: 'PENALTY', amount: '', dueDate: toInputDate(new Date(Date.now() + 7 * 86400000)), description: '' }); setErrors({}); } }, [open]);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErrors({});
    try { await api.post('/finance/dues', { ...v, driverId: driver?.id ?? '' }); toast.success('Charge added'); onOpenChange(false); onDone(); }
    catch (err) { if (err instanceof ApiError && err.fields) setErrors(err.fields); toast.error((err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Add a charge" description="Bill one driver for a penalty, membership fee or other amount.">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Driver" name="driverId" required error={errors.driverId} className="sm:col-span-2"><DriverPicker value={driver} onChange={setDriver} invalid={!!errors.driverId} /></Field>
        <Field label="Charge for" name="type" required><Select id="type" value={v.type} onChange={(e) => setV({ ...v, type: e.target.value })}>{PAYMENT_TYPES.filter((t) => t !== 'DAILY_CONTRIBUTION').map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select></Field>
        <Field label="Amount (₱)" name="amount" required error={errors.amount}><Input id="amount" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value.replace(/[^0-9.]/g, '') })} /></Field>
        <Field label="Due date" name="dueDate" required error={errors.dueDate}><Input id="dueDate" type="date" value={v.dueDate} onChange={(e) => setV({ ...v, dueDate: e.target.value })} /></Field>
        <Field label="Note" name="description" error={errors.description}><Input id="description" value={v.description} onChange={(e) => setV({ ...v, description: e.target.value })} placeholder="Optional" /></Field>
        <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" loading={busy}>Add charge</Button>
        </div>
      </form>
    </Dialog>
  );
}

// ───────────── Expenses ─────────────

interface ExpenseRow { id: string; category: string; description: string; amount: string; method: string; payee: string | null; referenceNo: string | null; spentAt: string; recordedBy: string }
const DEFAULT_CATEGORIES = ['Terminal', 'Office', 'Welfare', 'Events', 'Permits and fees', 'Supplies', 'Repairs', 'Transportation', 'Other'];

function Expenses() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const lp = useListParams({ sort: 'spentAt', dir: 'desc' });
  const [q, setQ] = useSearchParam(lp);
  const query = { ...lp.params, tab: undefined, pageSize: 20 };
  const { data, isLoading, isFetching, error, refetch } = useQuery({ queryKey: ['finance', 'expenses', query], queryFn: () => api.get<Paged<ExpenseRow> & { total_amount: number; categories: string[] }>(`/finance/expenses${qs(query)}`), placeholderData: (p) => p });
  const [edit, setEdit] = useState<ExpenseRow | 'new' | null>(null);
  const [del, setDel] = useState<ExpenseRow | null>(null);
  const manage = can('expenses.manage');
  const filtersOn = ['category', 'from', 'to', 'q'].some((k) => lp.get(k));
  const categories = [...new Set([...(data?.categories ?? []), ...DEFAULT_CATEGORIES])].sort();
  const columns: Column<ExpenseRow>[] = [
    { key: 'spentAt', header: 'Date', sortable: true, cell: (e) => fmtDate(e.spentAt) },
    { key: 'description', header: 'Expense', cell: (e) => <div><div>{e.description}</div><div className="text-xs text-muted-foreground">{e.category}{e.payee && ` · ${e.payee}`}</div></div> },
    { key: 'method', header: 'Paid via', hideBelow: 'md', cell: (e) => <div>{label(e.method)}{e.referenceNo && <div className="font-mono text-xs text-muted-foreground">{e.referenceNo}</div>}</div> },
    { key: 'recordedBy', header: 'Recorded by', hideBelow: 'lg', cell: (e) => <span className="text-muted-foreground">{e.recordedBy}</span> },
    { key: 'amount', header: 'Amount', sortable: true, className: 'text-right', cell: (e) => <span className="tabular font-medium">{peso(e.amount, 2)}</span> },
    ...(manage ? [{ key: 'actions', header: '', className: 'w-10', cell: (e: ExpenseRow) => (
      <Menu>
        <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Actions"><MoreHorizontal /></Button></MenuTrigger>
        <MenuContent><MenuItem onSelect={() => setEdit(e)}><Pencil /> Edit</MenuItem><MenuItem danger onSelect={() => setDel(e)}><Trash2 /> Delete</MenuItem></MenuContent>
      </Menu>
    ) }] : []),
  ];
  return (
    <>
      <Card>
        <Toolbar>
          <SearchBox value={q} onChange={setQ} placeholder="Search description, payee, reference…" />
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Select value={lp.get('category')} onChange={(e) => lp.set({ category: e.target.value })} aria-label="Category" className="sm:w-40"><option value="">All categories</option>{(data?.categories ?? []).map((c) => <option key={c} value={c}>{c}</option>)}</Select>
            <Input type="date" value={lp.get('from')} onChange={(e) => lp.set({ from: e.target.value })} aria-label="From" className="sm:w-40" />
            <Input type="date" value={lp.get('to')} onChange={(e) => lp.set({ to: e.target.value })} aria-label="To" className="sm:w-40" />
          </div>
          {filtersOn && <Button variant="ghost" size="sm" onClick={() => { setQ(''); lp.set({ category: undefined, from: undefined, to: undefined, q: undefined }); }}><X /> Clear</Button>}
          {manage && <Button size="sm" className="sm:ml-auto" onClick={() => setEdit('new')}><Plus /> Record expense</Button>}
        </Toolbar>
        {data && <div className="border-b px-4 py-2 text-sm text-muted-foreground">{num(data.total)} expenses · total <span className="tabular font-medium text-foreground">{peso(data.total_amount, 2)}</span></div>}
        <DataTable columns={columns} rows={data?.items} loading={isLoading || isFetching} error={error} onRetry={refetch} sort={lp.get('sort')} dir={lp.get('dir') as 'asc' | 'desc'} onSort={lp.toggleSort} />
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={(p) => lp.set({ page: String(p) }, false)} />}
      </Card>
      <ExpenseDialog value={edit} categories={categories} onClose={() => setEdit(null)} onDone={() => { setEdit(null); qc.invalidateQueries({ queryKey: ['finance'] }); }} />
      <ConfirmDialog
        open={!!del} onOpenChange={(o) => !o && setDel(null)} tone="destructive" confirmLabel="Delete expense" title="Delete this expense?"
        description={del ? `${del.description} (${peso(del.amount, 2)} on ${fmtDate(del.spentAt)}). The deletion is kept in the audit log.` : ''}
        onConfirm={async () => { try { await api.del(`/finance/expenses/${del!.id}`); toast.success('Expense deleted'); setDel(null); qc.invalidateQueries({ queryKey: ['finance'] }); } catch (e) { toast.error((e as Error).message); } }}
      />
    </>
  );
}

function ExpenseDialog({ value, categories, onClose, onDone }: { value: ExpenseRow | 'new' | null; categories: string[]; onClose: () => void; onDone: () => void }) {
  const blank = { category: '', description: '', amount: '', method: 'CASH', payee: '', referenceNo: '', spentAt: toInputDate(new Date()) };
  const [v, setV] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setErrors({});
    if (value === 'new') setV(blank);
    else if (value) setV({ category: value.category, description: value.description, amount: String(Number(value.amount)), method: value.method, payee: value.payee ?? '', referenceNo: value.referenceNo ?? '', spentAt: toInputDate(value.spentAt) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErrors({});
    try {
      if (value === 'new') await api.post('/finance/expenses', v); else await api.patch(`/finance/expenses/${(value as ExpenseRow).id}`, v);
      toast.success(value === 'new' ? 'Expense recorded' : 'Expense updated'); onDone();
    } catch (err) { if (err instanceof ApiError && err.fields) setErrors(err.fields); toast.error((err as Error).message); }
    finally { setBusy(false); }
  };
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()} title={value === 'new' ? 'Record expense' : 'Edit expense'}>
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Category" name="category" required error={errors.category}>
          <Input id="category" list="expense-categories" value={v.category} onChange={set('category')} placeholder="e.g. Terminal" />
          <datalist id="expense-categories">{categories.map((c) => <option key={c} value={c} />)}</datalist>
        </Field>
        <Field label="Date" name="spentAt" required error={errors.spentAt}><Input id="spentAt" type="date" max={toInputDate(new Date())} value={v.spentAt} onChange={set('spentAt')} /></Field>
        <Field label="Description" name="description" required error={errors.description} className="sm:col-span-2"><Input id="description" value={v.description} onChange={set('description')} placeholder="e.g. Terminal shed electricity, October" /></Field>
        <Field label="Amount (₱)" name="amount" required error={errors.amount}><Input id="amount" inputMode="decimal" value={v.amount} onChange={(e) => setV({ ...v, amount: e.target.value.replace(/[^0-9.]/g, '') })} /></Field>
        <Field label="Paid via" name="method" required><Select id="method" value={v.method} onChange={set('method')}>{METHODS.map((m) => <option key={m} value={m}>{label(m)}</option>)}</Select></Field>
        <Field label="Paid to" name="payee" error={errors.payee}><Input id="payee" value={v.payee} onChange={set('payee')} placeholder="Optional" /></Field>
        <Field label="OR / reference no." name="referenceNo" error={errors.referenceNo}><Input id="referenceNo" value={v.referenceNo} onChange={set('referenceNo')} placeholder="Optional" /></Field>
        <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>{value === 'new' ? 'Record expense' : 'Save changes'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
