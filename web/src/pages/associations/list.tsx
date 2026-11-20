import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus } from 'lucide-react';
import { api, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, useListParams } from '@/lib/hooks';
import { num } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Card, PageHeader, StatusBadge } from '@/components/ui/misc';
import { DataTable, Pagination, type Column } from '@/components/ui/table';
import { SearchBox, Toolbar } from '@/components/shared';

interface Row { id: string; code: string; name: string; acronym: string | null; barangay: string; city: string; status: string; driverCount: number; activeDrivers: number; vehicleCount: number; president: string | null; terminalLocation: string | null }

export default function AssociationsList() {
  const { can } = useAuth();
  const nav = useNavigate();
  const lp = useListParams({ sort: 'name', dir: 'asc' });
  const [q, setQ] = useState(lp.get('q'));
  const dq = useDebounced(q);
  useEffect(() => { if (dq !== lp.get('q')) lp.set({ q: dq }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dq]);
  const query = { ...lp.params, pageSize: 20 };
  const { data, isLoading, isFetching, error, refetch } = useQuery({ queryKey: ['associations', query], queryFn: () => api.get<Paged<Row>>(`/associations${qs(query)}`), placeholderData: (p) => p });

  const columns: Column<Row>[] = [
    { key: 'name', header: 'Association', sortable: true, cell: (a) => <div><div className="font-medium">{a.name}</div><div className="text-xs text-muted-foreground">{a.code}{a.acronym && ` · ${a.acronym}`}</div></div> },
    { key: 'barangay', header: 'Location', sortable: true, hideBelow: 'md', cell: (a) => <div><div>Brgy. {a.barangay}</div><div className="text-xs text-muted-foreground">{a.city}</div></div> },
    { key: 'president', header: 'President', hideBelow: 'lg', cell: (a) => a.president ?? <span className="text-muted-foreground">—</span> },
    { key: 'drivers', header: 'Drivers', sortable: true, cell: (a) => <span className="tabular">{num(a.activeDrivers)} <span className="text-muted-foreground">/ {num(a.driverCount)}</span></span> },
    { key: 'vehicles', header: 'Tricycles', hideBelow: 'sm', cell: (a) => <span className="tabular">{num(a.vehicleCount)}</span> },
    { key: 'status', header: 'Status', cell: (a) => <StatusBadge status={a.status} /> },
  ];

  return (
    <div>
      <PageHeader title="Associations" description="TODAs under your organization" actions={can('associations.create') && <Button asChild><Link to="/associations/new"><Plus /> Register association</Link></Button>} />
      <Card>
        <Toolbar>
          <SearchBox value={q} onChange={setQ} placeholder="Search name, code, barangay…" />
          <Select value={lp.get('status')} onChange={(e) => lp.set({ status: e.target.value })} aria-label="Status" className="sm:w-40">
            <option value="">All statuses</option><option value="ACTIVE">Active</option><option value="INACTIVE">Inactive</option><option value="SUSPENDED">Suspended</option>
          </Select>
        </Toolbar>
        <DataTable columns={columns} rows={data?.items} loading={isLoading || isFetching} error={error} onRetry={refetch} sort={lp.get('sort')} dir={lp.get('dir') as 'asc' | 'desc'} onSort={lp.toggleSort} onRowClick={(a) => nav(`/associations/${a.id}`)} />
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={(p) => lp.set({ page: String(p) }, false)} />}
      </Card>
      <p className="mt-2 text-xs text-muted-foreground">Drivers column shows active / total.</p>
    </div>
  );
}
