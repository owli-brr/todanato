import { useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Download, Plus, X } from 'lucide-react';
import { toast } from 'sonner';
import { api, download, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, useListParams } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { Select } from '@/components/ui/form';
import { Avatar, Card, PageHeader, StatusBadge, EmptyState } from '@/components/ui/misc';
import { DataTable, Pagination, type Column } from '@/components/ui/table';
import { AssociationSelect, ExpiryBadge, SearchBox, Toolbar } from '@/components/shared';

export interface DriverRow {
  id: string; driverCode: string; fullName: string; photoUrl: string | null; contactNumber: string; licenseNumber: string; licenseExpiry: string;
  status: string; applicationStatus: string; registeredAt: string;
  association: { id: string; name: string; acronym: string | null } | null;
  membership: { membershipNo: string; status: string } | null;
  vehicle: { id: string; plateNumber: string } | null;
}

export default function DriversList() {
  const { can, user } = useAuth();
  const nav = useNavigate();
  const lp = useListParams({ sort: 'name', dir: 'asc' });
  const [q, setQ] = useState(lp.get('q'));
  const dq = useDebounced(q);
  useEffect(() => { if (dq !== lp.get('q')) lp.set({ q: dq }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dq]);

  const query = { ...lp.params, pageSize: 20 };
  const { data, isLoading, isFetching, error, refetch } = useQuery({
    queryKey: ['drivers', query],
    queryFn: () => api.get<Paged<DriverRow>>(`/drivers${qs(query)}`),
    placeholderData: (p) => p,
  });
  const [exporting, setExporting] = useState(false);
  const filtersOn = ['status', 'application', 'associationId', 'licenseExpiring', 'q'].some((k) => lp.get(k));

  const columns: Column<DriverRow>[] = [
    {
      key: 'name', header: 'Driver', sortable: true,
      cell: (d) => (
        <div className="flex items-center gap-3">
          <Avatar name={d.fullName} src={d.photoUrl ? `/files/driver-photo/${d.id}` : null} />
          <div className="min-w-0">
            <div className="truncate font-medium">{d.fullName}</div>
            <div className="text-xs text-muted-foreground">{d.driverCode}{d.membership && ` · ${d.membership.membershipNo}`}</div>
          </div>
        </div>
      ),
    },
    { key: 'association', header: 'Association', sortable: true, hideBelow: 'lg', cell: (d) => d.association?.acronym ?? d.association?.name ?? <span className="text-muted-foreground">Unassigned</span> },
    { key: 'contact', header: 'Contact', hideBelow: 'md', cell: (d) => <span className="tabular">{d.contactNumber}</span> },
    { key: 'vehicle', header: 'Tricycle', hideBelow: 'md', cell: (d) => d.vehicle ? <Link onClick={(e) => e.stopPropagation()} to={`/vehicles/${d.vehicle.id}`} className="text-primary hover:underline">{d.vehicle.plateNumber}</Link> : <span className="text-muted-foreground">—</span> },
    { key: 'licenseExpiry', header: 'License expiry', sortable: true, hideBelow: 'lg', cell: (d) => <ExpiryBadge date={d.licenseExpiry} /> },
    { key: 'status', header: 'Status', sortable: true, cell: (d) => <div className="flex flex-wrap gap-1"><StatusBadge status={d.status} />{d.applicationStatus === 'PENDING' && d.status !== 'PENDING' && <StatusBadge status="PENDING" />}</div> },
  ];

  return (
    <div>
      <PageHeader
        title="Drivers"
        description={user?.association ? `Drivers of ${user.association.name}` : 'All registered tricycle drivers'}
        actions={
          <>
            {can('drivers.export') && (
              <Button variant="outline" loading={exporting} onClick={async () => {
                setExporting(true);
                try { await download(`/drivers/export${qs(lp.params)}`, `drivers-${new Date().toISOString().slice(0, 10)}.csv`); toast.success('Export downloaded'); }
                catch (e) { toast.error(e instanceof Error ? e.message : 'Export failed'); }
                finally { setExporting(false); }
              }}><Download /> Export CSV</Button>
            )}
            {can('drivers.create') && <Button asChild><Link to="/drivers/new"><Plus /> Add driver</Link></Button>}
          </>
        }
      />
      <Card>
        <Toolbar>
          <SearchBox value={q} onChange={setQ} placeholder="Search name, ID, license, phone…" />
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Select value={lp.get('status')} onChange={(e) => lp.set({ status: e.target.value })} aria-label="Status" className="sm:w-36">
              <option value="">All statuses</option>
              <option value="ACTIVE">Active</option><option value="PENDING">Pending</option><option value="INACTIVE">Inactive</option><option value="SUSPENDED">Suspended</option>
            </Select>
            <Select value={lp.get('application')} onChange={(e) => lp.set({ application: e.target.value })} aria-label="Application" className="sm:w-44">
              <option value="">All applications</option>
              <option value="PENDING">Pending approval</option><option value="APPROVED">Approved</option><option value="REJECTED">Rejected</option>
            </Select>
            {user?.role.scope !== 'ASSOCIATION' && <div className="col-span-2 sm:w-56"><AssociationSelect value={lp.get('associationId')} onChange={(v) => lp.set({ associationId: v })} /></div>}
            <label className="col-span-2 flex items-center gap-2 text-sm sm:col-span-1">
              <input type="checkbox" className="size-4 accent-[hsl(var(--primary))]" checked={lp.get('licenseExpiring') === 'true'} onChange={(e) => lp.set({ licenseExpiring: e.target.checked ? 'true' : undefined })} />
              License expiring ≤30 days
            </label>
          </div>
          {filtersOn && <Button variant="ghost" size="sm" onClick={() => { setQ(''); lp.set({ status: undefined, application: undefined, associationId: undefined, licenseExpiring: undefined, q: undefined }); }}><X /> Clear</Button>}
        </Toolbar>
        <DataTable
          columns={columns}
          rows={data?.items}
          loading={isLoading || isFetching}
          error={error}
          onRetry={refetch}
          sort={lp.get('sort')}
          dir={lp.get('dir') as 'asc' | 'desc'}
          onSort={lp.toggleSort}
          onRowClick={(d) => nav(`/drivers/${d.id}`)}
          empty={filtersOn ? undefined : <EmptyState title="No drivers yet" description="Register your first driver to get started." action={can('drivers.create') && <Button asChild size="sm"><Link to="/drivers/new"><Plus /> Add driver</Link></Button>} />}
        />
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={(p) => lp.set({ page: String(p) }, false)} />}
      </Card>
    </div>
  );
}
