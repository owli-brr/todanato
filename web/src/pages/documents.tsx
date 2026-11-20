import { useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Bike, CheckCircle2, Eye, FileText, User, XCircle } from 'lucide-react';
import { api, fileUrl, qs } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { cn, daysUntil, fmtDate, label } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, Select, Textarea } from '@/components/ui/form';
import { Card, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge } from '@/components/ui/misc';
import { SearchBox, Toolbar } from '@/components/shared';

interface Item {
  id: string; kind: 'driver' | 'vehicle'; source: 'document' | 'record'; ownerId: string; ownerName: string; ownerCode: string;
  type: string; documentNo: string | null; fileName: string | null; mimeType: string | null; status: string | null; expiresAt: string | null; uploadedAt: string | null; remarks: string | null;
}
interface Queue { counts: Record<string, number>; items: Item[]; canVerify: boolean; includesVehicles: boolean }

const VIEWS: [string, string, string][] = [
  ['pending', 'Waiting for review', 'Uploaded documents nobody has checked yet. Oldest first.'],
  ['expiring', 'Expiring in 30 days', 'Documents and record dates that run out within 30 days.'],
  ['expired', 'Expired', 'Past their expiry date. The driver or operator needs to bring a renewed copy.'],
  ['rejected', 'Rejected', 'Sent back with a reason. Waiting for a new copy.'],
];

function Due({ date }: { date: string | null }) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  const d = daysUntil(date) ?? 0;
  return <div><div>{fmtDate(date)}</div><div className={cn('text-xs', d < 0 ? 'text-destructive' : d <= 30 ? 'text-amber-700 dark:text-amber-300' : 'text-muted-foreground')}>{d < 0 ? `${-d} day${d === -1 ? '' : 's'} ago` : d === 0 ? 'today' : `in ${d} day${d === 1 ? '' : 's'}`}</div></div>;
}

export default function DocumentsPage() {
  const qc = useQueryClient();
  const [sp, setSp] = useSearchParams();
  const view = VIEWS.some(([k]) => k === sp.get('view')) ? sp.get('view')! : 'pending';
  const kind = sp.get('kind') ?? '';
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const { data, error, refetch, isFetching } = useQuery({ queryKey: ['doc-queue', view, kind, dq], queryFn: () => api.get<Queue>(`/documents/queue${qs({ view, kind, q: dq })}`), placeholderData: (p) => p });
  const [act, setAct] = useState<{ item: Item; status: 'VERIFIED' | 'REJECTED' } | null>(null);
  const [remarks, setRemarks] = useState('');
  const set = (patch: Record<string, string>) => setSp((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); return n; }, { replace: true });

  const view_ = async (i: Item) => {
    try { window.open(await fileUrl(`/files/${i.kind}-document/${i.id}`), '_blank', 'noopener'); }
    catch (e) { toast.error((e as Error).message); }
  };
  const owner = (i: Item) => (
    <Link to={`/${i.kind === 'driver' ? 'drivers' : 'vehicles'}/${i.ownerId}${i.source === 'document' ? '?tab=documents' : ''}`} className="flex items-center gap-2 hover:text-primary">
      {i.kind === 'driver' ? <User className="size-4 shrink-0 text-muted-foreground" /> : <Bike className="size-4 shrink-0 text-muted-foreground" />}
      <span><span className="font-medium">{i.ownerName}</span><span className="block text-xs text-muted-foreground">{i.ownerCode}</span></span>
    </Link>
  );

  return (
    <div>
      <PageHeader title="Document centre" description="Requirements that need checking or renewing, across all drivers and tricycles." />
      <div className="mb-4 grid grid-cols-2 gap-2 lg:grid-cols-4">
        {VIEWS.map(([k, l]) => (
          <button key={k} onClick={() => set({ view: k === 'pending' ? '' : k })} className={cn('rounded-lg border bg-card p-4 text-left transition-colors hover:border-primary/60', view === k && 'border-primary ring-1 ring-primary')}>
            <div className="text-sm text-muted-foreground">{l}</div>
            <div className={cn('mt-1 text-2xl font-semibold tabular', (k === 'expired' || k === 'rejected') && (data?.counts[k] ?? 0) > 0 && 'text-destructive')}>{data ? data.counts[k] : <Skeleton className="h-8 w-12" />}</div>
          </button>
        ))}
      </div>
      <Card>
        <Toolbar>
          <SearchBox value={q} onChange={setQ} placeholder="Search name, plate, code, document no.…" />
          {data?.includesVehicles && (
            <Select value={kind} onChange={(e) => set({ kind: e.target.value })} aria-label="Whose documents" className="sm:w-44">
              <option value="">Drivers and tricycles</option><option value="driver">Drivers only</option><option value="vehicle">Tricycles only</option>
            </Select>
          )}
        </Toolbar>
        <p className="border-b px-4 py-2 text-sm text-muted-foreground">{VIEWS.find(([k]) => k === view)![2]}</p>
        {error ? <ErrorState error={error} onRetry={refetch} /> : !data ? <div className="space-y-2 p-4">{Array.from({ length: 6 }).map((_, i) => <Skeleton key={i} className="h-12" />)}</div> : data.items.length === 0 ? (
          <EmptyState icon={CheckCircle2} title={view === 'pending' ? 'Nothing waiting for review' : 'Nothing here'} description={q ? 'Try a different search.' : 'All caught up.'} />
        ) : (
          <div className={cn('overflow-x-auto', isFetching && 'opacity-60')}>
            <table className="w-full text-sm">
              <thead><tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground">
                <th className="h-10 px-4 font-medium">Driver / tricycle</th><th className="px-4 font-medium">Document</th>
                <th className="hidden px-4 font-medium md:table-cell">{view === 'pending' || view === 'rejected' ? 'Uploaded' : 'Expires'}</th>
                <th className="hidden px-4 font-medium sm:table-cell">Status</th><th className="px-4" />
              </tr></thead>
              <tbody>
                {data.items.map((i) => (
                  <tr key={`${i.kind}-${i.id}`} className="border-b last:border-0">
                    <td className="px-4 py-3">{owner(i)}</td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1.5">{i.source === 'document' && <FileText className="size-3.5 text-muted-foreground" />}{label(i.type)}</div>
                      {i.documentNo && <div className="font-mono text-xs text-muted-foreground">{i.documentNo}</div>}
                      {i.remarks && <div className="text-xs text-destructive">{i.remarks}</div>}
                      <div className="text-xs text-muted-foreground md:hidden">{view === 'pending' || view === 'rejected' ? `Uploaded ${fmtDate(i.uploadedAt)}` : `Expires ${fmtDate(i.expiresAt)}`}</div>
                    </td>
                    <td className="hidden px-4 py-3 md:table-cell">{view === 'pending' || view === 'rejected' ? fmtDate(i.uploadedAt) : <Due date={i.expiresAt} />}</td>
                    <td className="hidden px-4 py-3 sm:table-cell">{i.status ? <StatusBadge status={i.status} /> : <span className="text-xs text-muted-foreground">Date on record</span>}</td>
                    <td className="px-4 py-3">
                      <div className="flex justify-end gap-1">
                        {i.source === 'document' && <Button variant="outline" size="sm" onClick={() => view_(i)}><Eye /> <span className="hidden lg:inline">View</span></Button>}
                        {i.source === 'document' && data.canVerify && i.status === 'PENDING' && (
                          <>
                            <Button variant="outline" size="sm" className="text-emerald-700 dark:text-emerald-400" onClick={() => { setRemarks(''); setAct({ item: i, status: 'VERIFIED' }); }}><CheckCircle2 /> <span className="hidden lg:inline">Verify</span></Button>
                            <Button variant="outline" size="sm" className="text-destructive" onClick={() => { setRemarks(''); setAct({ item: i, status: 'REJECTED' }); }}><XCircle /> <span className="hidden lg:inline">Reject</span></Button>
                          </>
                        )}
                        {i.source === 'record' && <Button variant="outline" size="sm" asChild><Link to={`/${i.kind === 'driver' ? 'drivers' : 'vehicles'}/${i.ownerId}/edit`}>Update date</Link></Button>}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <ConfirmDialog
        open={!!act} onOpenChange={(o) => !o && setAct(null)}
        title={act?.status === 'VERIFIED' ? 'Verify document?' : 'Reject document?'}
        description={act ? `${label(act.item.type)} of ${act.item.ownerName}. Check the file against the original first.` : ''}
        confirmLabel={act?.status === 'VERIFIED' ? 'Mark verified' : 'Reject'} tone={act?.status === 'REJECTED' ? 'destructive' : 'default'}
        onConfirm={async () => {
          try {
            await api.post(`/${act!.item.kind === 'driver' ? 'drivers' : 'vehicles'}/${act!.item.ownerId}/documents/${act!.item.id}/verify`, { status: act!.status, remarks });
            toast.success(act!.status === 'VERIFIED' ? 'Document verified' : 'Document rejected');
            setAct(null); qc.invalidateQueries({ queryKey: ['doc-queue'] });
          } catch (e) { toast.error((e as Error).message); }
        }}
      >
        <Field label={act?.status === 'REJECTED' ? 'Reason (the driver sees this)' : 'Remarks (optional)'} name="remarks" required={act?.status === 'REJECTED'}>
          <Textarea id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={act?.status === 'REJECTED' ? 'e.g. Photo is blurry; bring the original to the office' : ''} />
        </Field>
      </ConfirmDialog>
    </div>
  );
}
