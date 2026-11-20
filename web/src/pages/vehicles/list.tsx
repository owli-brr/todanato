import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Plus, X } from 'lucide-react';
import { api, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, useListParams } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Card, PageHeader, StatusBadge } from '@/components/ui/misc';
import { DataTable, Pagination, type Column } from '@/components/ui/table';
import { AssociationSelect, ExpiryBadge, SearchBox, Toolbar } from '@/components/shared';

interface VehicleRow {
  id: string; vehicleCode: string; plateNumber: string; franchiseNumber: string | null; bodyNumber: string | null; make: string; model: string; color: string;
  ownerName: string; status: string; inspectionStatus: string; registrationExpiry: string | null;
  association: { id: string; name: string; acronym: string | null } | null;
  driver: { id: string; fullName: string; driverCode: string } | null;
}

export default function VehiclesList() {
  const { can, user } = useAuth();
  const nav = useNavigate();
  const lp = useListParams({ sort: 'vehicleCode', dir: 'asc' });
  const [q, setQ] = useState(lp.get('q'));
  const dq = useDebounced(q);
  useEffect(() => { if (dq !== lp.get('q')) lp.set({ q: dq }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dq]);
  const query = { ...lp.params, pageSize: 20 };
  const { data, isLoading, isFetching, error, refetch } = useQuery({ queryKey: ['vehicles', query], queryFn: () => api.get<Paged<VehicleRow>>(`/vehicles${qs(query)}`), placeholderData: (p) => p });
  const filtersOn = ['status', 'associationId', 'inspection', 'expiring', 'unassigned', 'q'].some((k) => lp.get(k));

  const columns: Column<VehicleRow>[] = [
    { key: 'plateNumber', header: 'Tricycle', sortable: true, cell: (v) => <div><div className="font-medium">{v.plateNumber}</div><div className="text-xs text-muted-foreground">{v.vehicleCode}{v.bodyNumber && ` · Body ${v.bodyNumber}`}</div></div> },
    { key: 'make', header: 'Make / model', hideBelow: 'md', cell: (v) => <div><div>{v.make} {v.model}</div><div className="text-xs text-muted-foreground">{v.color}</div></div> },
    { key: 'driver', header: 'Driver', cell: (v) => v.driver ? <Link onClick={(e) => e.stopPropagation()} to={`/drivers/${v.driver.id}`} className="text-primary hover:underline">{v.driver.fullName}</Link> : <span className="text-muted-foreground">Unassigned</span> },
    { key: 'ownerName', header: 'Owner', sortable: true, hideBelow: 'lg', cell: (v) => v.ownerName },
    { key: 'association', header: 'Association', sortable: true, hideBelow: 'lg', cell: (v) => v.association?.acronym ?? v.association?.name ?? '—' },
    { key: 'registrationExpiry', header: 'Registration', sortable: true, hideBelow: 'md', cell: (v) => <ExpiryBadge date={v.registrationExpiry} /> },
    { key: 'status', header: 'Status', sortable: true, cell: (v) => <StatusBadge status={v.status} /> },
  ];

  return (
    <div>
      <PageHeader title="Tricycles" description="Registered units, franchises and assignments" actions={can('vehicles.create') && <Button asChild><Link to="/vehicles/new"><Plus /> Register tricycle</Link></Button>} />
      <Card>
        <Toolbar>
          <SearchBox value={q} onChange={setQ} placeholder="Search plate, MTOP, body no., owner…" />
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Select value={lp.get('status')} onChange={(e) => lp.set({ status: e.target.value })} aria-label="Status" className="sm:w-44">
              <option value="">All statuses</option><option value="OPERATIONAL">Operational</option><option value="UNDER_MAINTENANCE">Under maintenance</option><option value="INACTIVE">Inactive</option>
            </Select>
            <Select value={lp.get('inspection')} onChange={(e) => lp.set({ inspection: e.target.value })} aria-label="Inspection" className="sm:w-40">
              <option value="">Any inspection</option><option value="PASSED">Passed</option><option value="PENDING">Pending</option><option value="FAILED">Failed</option><option value="EXPIRED">Expired</option>
            </Select>
            {user?.role.scope !== 'ASSOCIATION' && <div className="col-span-2 sm:w-56"><AssociationSelect value={lp.get('associationId')} onChange={(v) => lp.set({ associationId: v })} /></div>}
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={lp.get('expiring') === 'true'} onChange={(e) => lp.set({ expiring: e.target.checked ? 'true' : undefined })} />Expiring docs</label>
            <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={lp.get('unassigned') === 'true'} onChange={(e) => lp.set({ unassigned: e.target.checked ? 'true' : undefined })} />No driver</label>
          </div>
          {filtersOn && <Button variant="ghost" size="sm" onClick={() => { setQ(''); lp.set({ status: undefined, associationId: undefined, inspection: undefined, expiring: undefined, unassigned: undefined, q: undefined }); }}><X /> Clear</Button>}
        </Toolbar>
        <DataTable columns={columns} rows={data?.items} loading={isLoading || isFetching} error={error} onRetry={refetch} sort={lp.get('sort')} dir={lp.get('dir') as 'asc' | 'desc'} onSort={lp.toggleSort} onRowClick={(v) => nav(`/vehicles/${v.id}`)} />
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={(p) => lp.set({ page: String(p) }, false)} />}
      </Card>
    </div>
  );
}
