import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { api, qs, type Paged } from '@/lib/api';
import { useDebounced, useListParams } from '@/lib/hooks';
import { fmtDateTime } from '@/lib/utils';
import { Input, Select } from '@/components/ui/form';
import { Badge, Card, PageHeader } from '@/components/ui/misc';
import { DataTable, Pagination, type Column } from '@/components/ui/table';
import { Dialog } from '@/components/ui/dialog';
import { SearchBox, Toolbar } from '@/components/shared';

interface Log { id: string; action: string; entity: string; entityId: string | null; summary: string; userEmail: string | null; ipAddress: string | null; createdAt: string; before: unknown; after: unknown }

const tone = (a: string) => (/DELETE|SUSPEND|REJECT|DEACTIVATE|REVOKE/.test(a) ? 'red' : /CREATE|APPROVE|ACTIVATE|VERIFY/.test(a) ? 'green' : /LOGIN|EXPORT/.test(a) ? 'gray' : 'blue') as 'red' | 'green' | 'gray' | 'blue';

export default function AuditPage() {
  const lp = useListParams({ dir: 'desc' });
  const [q, setQ] = useState(lp.get('q'));
  const dq = useDebounced(q);
  useEffect(() => { if (dq !== lp.get('q')) lp.set({ q: dq }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dq]);
  const query = { ...lp.params, pageSize: 30 };
  const { data, isLoading, isFetching, error, refetch } = useQuery({ queryKey: ['audit', query], queryFn: () => api.get<Paged<Log>>(`/audit-logs${qs(query)}`), placeholderData: (p) => p });
  const [open, setOpen] = useState<Log | null>(null);
  const columns: Column<Log>[] = [
    { key: 'createdAt', header: 'When', cell: (l) => <span className="whitespace-nowrap text-muted-foreground">{fmtDateTime(l.createdAt)}</span> },
    { key: 'user', header: 'User', hideBelow: 'md', cell: (l) => l.userEmail ?? 'System' },
    { key: 'action', header: 'Action', cell: (l) => <Badge tone={tone(l.action)}>{l.action.replace(/_/g, ' ')}</Badge> },
    { key: 'summary', header: 'Details', cell: (l) => <div className="max-w-xl"><div>{l.summary}</div><div className="text-xs text-muted-foreground">{l.entity}</div></div> },
  ];
  return (
    <div>
      <PageHeader title="Audit log" description="Every sign-in, change, approval and export. Entries cannot be edited or deleted." />
      <Card>
        <Toolbar>
          <SearchBox value={q} onChange={setQ} placeholder="Search details or user…" />
          <Select value={lp.get('entity')} onChange={(e) => lp.set({ entity: e.target.value })} className="sm:w-44" aria-label="Record type">
            <option value="">All records</option>{['Driver', 'Vehicle', 'Association', 'AssociationMembership', 'AssociationOfficer', 'User', 'Role', 'Organization'].map((e) => <option key={e} value={e}>{e.replace(/([a-z])([A-Z])/g, '$1 $2')}</option>)}
          </Select>
          <Select value={lp.get('action')} onChange={(e) => lp.set({ action: e.target.value })} className="sm:w-40" aria-label="Action">
            <option value="">All actions</option>{['LOGIN', 'CREATE', 'UPDATE', 'DELETE', 'APPROVE', 'REJECT', 'SUSPEND', 'ACTIVATE', 'DEACTIVATE', 'ASSIGN', 'UPLOAD', 'VERIFY', 'EXPORT', 'PASSWORD_RESET'].map((a) => <option key={a} value={a}>{a.replace(/_/g, ' ').toLowerCase()}</option>)}
          </Select>
          <div className="flex items-center gap-2 text-sm">
            <Input type="date" value={lp.get('from')} onChange={(e) => lp.set({ from: e.target.value })} aria-label="From date" className="w-auto" />
            <span className="text-muted-foreground">to</span>
            <Input type="date" value={lp.get('to')} onChange={(e) => lp.set({ to: e.target.value })} aria-label="To date" className="w-auto" />
          </div>
        </Toolbar>
        <DataTable columns={columns} rows={data?.items} loading={isLoading || isFetching} error={error} onRetry={refetch} onRowClick={setOpen} />
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={(p) => lp.set({ page: String(p) }, false)} />}
      </Card>
      <Dialog open={!!open} onOpenChange={(o) => !o && setOpen(null)} title="Audit entry" description={open ? fmtDateTime(open.createdAt) : ''} className="max-w-2xl">
        {open && (
          <div className="space-y-3 text-sm">
            <p>{open.summary}</p>
            <p className="text-muted-foreground">{open.userEmail ?? 'System'} · {open.ipAddress ?? 'no IP'} · {open.entity} {open.entityId}</p>
            {(open.before != null || open.after != null) && (
              <div className="grid gap-3 sm:grid-cols-2">
                <div><div className="mb-1 text-xs font-medium uppercase text-muted-foreground">Before</div><pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(open.before, null, 2) ?? '—'}</pre></div>
                <div><div className="mb-1 text-xs font-medium uppercase text-muted-foreground">After</div><pre className="max-h-64 overflow-auto rounded-md bg-muted p-2 text-xs">{JSON.stringify(open.after, null, 2) ?? '—'}</pre></div>
              </div>
            )}
          </div>
        )}
      </Dialog>
    </div>
  );
}
