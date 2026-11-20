import { useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Download, FileBarChart, Printer } from 'lucide-react';
import { api, download, qs } from '@/lib/api';
import { cn, fmtDate, fmtDateTime, label, num, peso, toInputDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/form';
import { Card, CardContent, EmptyState, ErrorState, PageHeader, Skeleton } from '@/components/ui/misc';
import { useToda } from '@/components/shared';

interface ReportDef { key: string; title: string; description: string; usesRange: boolean }
interface Col { key: string; label: string; type?: 'text' | 'money' | 'number' | 'date' | 'datetime' }
interface Report { title: string; description: string; columns: Col[]; rows: Record<string, unknown>[]; totals?: Record<string, number>; note?: string; truncated: boolean; generatedAt: string }

// Enum-like values (CASH, MONTHLY_DUES…) are shown with their friendly label.
const ENUMISH = /^[A-Z][A-Z_]+$/;
function cell(v: unknown, type?: Col['type']) {
  if (v === null || v === undefined || v === '') return <span className="text-muted-foreground">—</span>;
  if (type === 'money') return peso(Number(v), 2);
  if (type === 'number') return num(Number(v));
  if (type === 'date') return fmtDate(String(v));
  if (type === 'datetime') return fmtDateTime(String(v));
  const s = String(v);
  return ENUMISH.test(s) ? label(s) : s;
}

const presets: [string, () => [string, string]][] = [
  ['This month', () => { const d = new Date(); return [toInputDate(new Date(d.getFullYear(), d.getMonth(), 1)), toInputDate(d)]; }],
  ['Last month', () => { const d = new Date(); return [toInputDate(new Date(d.getFullYear(), d.getMonth() - 1, 1)), toInputDate(new Date(d.getFullYear(), d.getMonth(), 0))]; }],
  ['This year', () => { const d = new Date(); return [`${d.getFullYear()}-01-01`, toInputDate(d)]; }],
  ['Last 12 months', () => { const d = new Date(); return [toInputDate(new Date(d.getFullYear() - 1, d.getMonth() + 1, 1)), toInputDate(d)]; }],
];

export default function ReportsPage() {
  const [sp, setSp] = useSearchParams();
  const toda = useToda();
  const defs = useQuery({ queryKey: ['reports'], queryFn: () => api.get<ReportDef[]>('/reports') });
  const key = sp.get('r') ?? defs.data?.[0]?.key ?? '';
  const def = defs.data?.find((d) => d.key === key);
  const [from, to] = [sp.get('from') ?? presets[0][1]()[0], sp.get('to') ?? presets[0][1]()[1]];
  const params = def?.usesRange ? { from, to } : {};
  const report = useQuery({ queryKey: ['report', key, params], enabled: !!def, queryFn: () => api.get<Report>(`/reports/${key}${qs(params)}`) });
  const [busy, setBusy] = useState(false);
  const set = (patch: Record<string, string>) => setSp((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => n.set(k, v)); return n; }, { replace: true });
  const exportCsv = async () => {
    setBusy(true);
    try { await download(`/reports/${key}${qs({ ...params, format: 'csv' })}`, `${key}${def?.usesRange ? `_${from}_to_${to}` : ''}.csv`); }
    catch (e) { toast.error((e as Error).message); } finally { setBusy(false); }
  };

  if (defs.error) return <ErrorState error={defs.error} onRetry={defs.refetch} />;
  return (
    <div>
      <div className="print:hidden">
        <PageHeader title="Reports" description="Pick a report, set the period, then print or export to CSV for Excel or Google Sheets." />
        <div className="mb-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
          {!defs.data ? Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-20" />) : defs.data.map((d) => (
            <button key={d.key} onClick={() => set({ r: d.key })} className={cn('rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/60', d.key === key && 'border-primary ring-1 ring-primary')}>
              <div className="flex items-center gap-2 font-medium"><FileBarChart className="size-4 text-primary" />{d.title}</div>
              <div className="mt-1 text-xs text-muted-foreground">{d.description}</div>
            </button>
          ))}
        </div>
        {def && (
          <Card className="mb-4">
            <CardContent className="flex flex-col gap-3 pt-5 lg:flex-row lg:items-end lg:justify-between">
              {def.usesRange ? (
                <div className="flex flex-wrap items-end gap-2">
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">From</span><Input type="date" value={from} max={to} onChange={(e) => e.target.value && set({ from: e.target.value })} className="w-40" /></label>
                  <label className="text-sm"><span className="mb-1 block text-muted-foreground">To</span><Input type="date" value={to} min={from} onChange={(e) => e.target.value && set({ to: e.target.value })} className="w-40" /></label>
                  {presets.map(([l, f]) => <Button key={l} size="sm" variant="ghost" onClick={() => { const [a, b] = f(); set({ from: a, to: b }); }}>{l}</Button>)}
                </div>
              ) : <p className="text-sm text-muted-foreground">This report shows records as of today.</p>}
              <div className="flex gap-2">
                <Button variant="outline" onClick={() => window.print()} disabled={!report.data}><Printer /> Print</Button>
                <Button onClick={exportCsv} loading={busy} disabled={!report.data}><Download /> Export CSV</Button>
              </div>
            </CardContent>
          </Card>
        )}
      </div>

      {report.error ? <ErrorState error={report.error} onRetry={report.refetch} /> : !report.data ? (def && <Skeleton className="h-96" />) : (
        <Card className="print:border-0 print:shadow-none">
          <div className="border-b px-5 py-4">
            <div className="hidden text-sm text-muted-foreground print:block">{toda.data?.name}</div>
            <h2 className="text-lg font-semibold">{report.data.title}</h2>
            <p className="text-sm text-muted-foreground">
              {def?.usesRange ? `${fmtDate(from)} to ${fmtDate(to)}` : `As of ${fmtDate(report.data.generatedAt)}`} · {num(report.data.rows.length)} row{report.data.rows.length === 1 ? '' : 's'}
              {report.data.truncated && ' (first 10,000 shown; narrow the dates)'}
            </p>
          </div>
          {report.data.rows.length === 0 ? <EmptyState title="Nothing to report" description={def?.usesRange ? 'No records in this period.' : undefined} /> : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm print:text-[11px]">
                <thead><tr className="border-b bg-muted/40 text-left">
                  {report.data.columns.map((c) => <th key={c.key} className={cn('h-10 whitespace-nowrap px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground print:px-1', (c.type === 'money' || c.type === 'number') && 'text-right')}>{c.label}</th>)}
                </tr></thead>
                <tbody>
                  {report.data.rows.slice(0, 1000).map((r, i) => (
                    <tr key={i} className={cn('border-b last:border-0', r.status === 'VOIDED' && 'text-muted-foreground line-through')}>
                      {report.data!.columns.map((c) => <td key={c.key} className={cn('whitespace-nowrap px-4 py-2 print:px-1 print:py-0.5', (c.type === 'money' || c.type === 'number') && 'text-right tabular')}>{cell(r[c.key], c.type)}</td>)}
                    </tr>
                  ))}
                </tbody>
                {report.data.totals && (
                  <tfoot><tr className="border-t-2 font-semibold">
                    {report.data.columns.map((c, i) => <td key={c.key} className={cn('whitespace-nowrap px-4 py-2.5 print:px-1', (c.type === 'money' || c.type === 'number') && 'text-right tabular')}>{i === 0 ? 'Total' : c.key in report.data!.totals! ? cell(report.data!.totals![c.key], c.type) : ''}</td>)}
                  </tr></tfoot>
                )}
              </table>
            </div>
          )}
          {(report.data.rows.length > 1000 || report.data.note) && (
            <p className="border-t px-5 py-3 text-xs text-muted-foreground">
              {report.data.rows.length > 1000 && `Showing the first 1,000 rows on screen. The CSV export has all ${num(report.data.rows.length)}. `}{report.data.note}
            </p>
          )}
        </Card>
      )}
    </div>
  );
}
