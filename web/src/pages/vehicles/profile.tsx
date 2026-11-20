import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Edit, MoreHorizontal, Wrench, PlayCircle, PauseCircle, Archive, UserPlus, UserMinus, Plus, Trash2 } from 'lucide-react';
import { api, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, label, peso, toInputDate } from '@/lib/utils';
import { useDebounced, useForm } from '@/lib/hooks';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Avatar, Card, CardContent, CardHeader, CardTitle, DescList, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge } from '@/components/ui/misc';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ActivityList, DocumentsPanel, ExpiryBadge, type Doc } from '@/components/shared';

interface Vehicle {
  id: string; vehicleCode: string; plateNumber: string; franchiseNumber: string | null; franchiseExpiry: string | null; bodyNumber: string | null;
  ownerName: string; ownerContact: string | null; ownerAddress: string | null; make: string; model: string; year: number | null; color: string;
  engineNumber: string | null; chassisNumber: string | null; orNumber: string | null; crNumber: string | null; registrationExpiry: string | null;
  insuranceProvider: string | null; insurancePolicyNo: string | null; insuranceExpiry: string | null; inspectionStatus: string; lastInspectionAt: string | null;
  status: string; associationId: string | null; association: { id: string; name: string; acronym: string | null } | null;
  currentDriver: { id: string; fullName: string; driverCode: string; contactNumber: string; photoUrl: string | null; assignedAt: string } | null;
  assignments: { id: string; assignedAt: string; unassignedAt: string | null; remarks: string | null; driver: { id: string; firstName: string; lastName: string; driverCode: string } }[];
  documents: Doc[];
  maintenance: { id: string; type: string; description: string; shopName: string | null; cost: string; odometerKm: number | null; performedAt: string; nextDueAt: string | null }[];
  maintenanceTotal: number;
  history: { id: string; action: string; summary: string; userEmail: string | null; createdAt: string }[];
}
const DOC_TYPES = ['OFFICIAL_RECEIPT', 'CERTIFICATE_OF_REGISTRATION', 'FRANCHISE_MTOP', 'INSURANCE', 'INSPECTION_CERTIFICATE', 'DEED_OF_SALE', 'OTHER'];

function AssignDialog({ v, open, onOpenChange, onDone }: { v: Vehicle; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [driverId, setDriverId] = useState('');
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({
    queryKey: ['drivers', 'assignable', v.associationId, dq],
    queryFn: () => api.get<Paged<{ id: string; fullName: string; driverCode: string; vehicle: { plateNumber: string } | null }>>(`/drivers${qs({ status: 'ACTIVE', associationId: v.associationId, q: dq, pageSize: 50, sort: 'name' })}`),
    enabled: open,
  });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={v.currentDriver ? 'Reassign driver' : 'Assign driver'} description={`Only active drivers of ${v.association?.name ?? 'this association'} are listed. A driver already on another tricycle is moved here.`}
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button disabled={!driverId} loading={busy} onClick={async () => {
        setBusy(true);
        try { await api.post(`/vehicles/${v.id}/assign`, { driverId }); toast.success('Driver assigned'); onOpenChange(false); onDone(); }
        catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); } finally { setBusy(false); }
      }}>Assign</Button></>}>
      <Input placeholder="Search drivers…" value={q} onChange={(e) => setQ(e.target.value)} autoFocus />
      <ul className="max-h-72 divide-y overflow-y-auto rounded-md border">
        {data?.items.filter((d) => d.id !== v.currentDriver?.id).map((d) => (
          <li key={d.id}>
            <label className="flex cursor-pointer items-center gap-3 px-3 py-2 hover:bg-muted/60">
              <input type="radio" name="driver" checked={driverId === d.id} onChange={() => setDriverId(d.id)} />
              <div className="min-w-0 flex-1"><div className="text-sm font-medium">{d.fullName}</div><div className="text-xs text-muted-foreground">{d.driverCode}{d.vehicle && ` · currently on ${d.vehicle.plateNumber}`}</div></div>
            </label>
          </li>
        ))}
        {data?.items.length === 0 && <li className="p-4 text-center text-sm text-muted-foreground">No active drivers found.</li>}
      </ul>
    </Dialog>
  );
}

function MaintenanceDialog({ vid, open, onOpenChange, onDone }: { vid: string; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const f = useForm({ type: 'PREVENTIVE', description: '', shopName: '', cost: '', odometerKm: '', performedAt: toInputDate(new Date()), nextDueAt: '' });
  const [busy, setBusy] = useState(false);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Record maintenance or repair"
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={busy} onClick={async () => {
        setBusy(true);
        try {
          await api.post(`/vehicles/${vid}/maintenance`, { ...f.values, cost: f.values.cost || 0, odometerKm: f.values.odometerKm || null, nextDueAt: f.values.nextDueAt || null });
          toast.success('Maintenance recorded'); onOpenChange(false); onDone();
        } catch (e) { const err = e as { fields?: Record<string, string>; message: string }; if (err.fields) f.setErrors(err.fields); toast.error(err.message); }
        finally { setBusy(false); }
      }}>Save</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Type" name="type"><Select {...f.bind('type')}><option value="PREVENTIVE">Preventive</option><option value="REPAIR">Repair</option><option value="INSPECTION">Inspection</option><option value="ACCIDENT_REPAIR">Accident repair</option><option value="OTHER">Other</option></Select></Field>
        <Field label="Date" name="performedAt" required error={f.errors.performedAt}><Input type="date" {...f.bind('performedAt')} /></Field>
        <Field label="Work done" name="description" required error={f.errors.description} className="sm:col-span-2"><Textarea {...f.bind('description')} /></Field>
        <Field label="Shop" name="shopName"><Input {...f.bind('shopName')} /></Field>
        <Field label="Cost (₱)" name="cost" error={f.errors.cost}><Input type="number" min="0" step="0.01" inputMode="decimal" {...f.bind('cost')} /></Field>
        <Field label="Odometer (km)" name="odometerKm"><Input type="number" min="0" {...f.bind('odometerKm')} /></Field>
        <Field label="Next due" name="nextDueAt"><Input type="date" {...f.bind('nextDueAt')} /></Field>
      </div>
    </Dialog>
  );
}

export default function VehicleProfile() {
  const { id } = useParams();
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: v, error, refetch } = useQuery({ queryKey: ['vehicle', id], queryFn: () => api.get<Vehicle>(`/vehicles/${id}`) });
  const [assignOpen, setAssignOpen] = useState(false);
  const [maintOpen, setMaintOpen] = useState(false);
  const [confirm, setConfirm] = useState<null | 'OPERATIONAL' | 'UNDER_MAINTENANCE' | 'INACTIVE' | 'unassign' | 'archive' | { maintId: string }>(null);
  const refresh = () => { refetch(); qc.invalidateQueries({ queryKey: ['vehicles'] }); qc.invalidateQueries({ queryKey: ['drivers'] }); qc.invalidateQueries({ queryKey: ['driver'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); };

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!v) return <div className="space-y-4"><Skeleton className="h-28" /><Skeleton className="h-96" /></div>;

  const doConfirm = async () => {
    try {
      if (confirm === 'unassign') { await api.post(`/vehicles/${v.id}/assign`, { driverId: null }); toast.success('Driver unassigned'); }
      else if (confirm === 'archive') { await api.del(`/vehicles/${v.id}`); toast.success('Tricycle archived'); qc.invalidateQueries({ queryKey: ['vehicles'] }); nav('/vehicles'); return; }
      else if (typeof confirm === 'object' && confirm) { await api.del(`/vehicles/${v.id}/maintenance/${confirm.maintId}`); toast.success('Record deleted'); }
      else { await api.post(`/vehicles/${v.id}/status`, { status: confirm }); toast.success(`Marked as ${label(confirm!).toLowerCase()}`); }
      refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); throw e; }
  };
  const confirmCopy = typeof confirm === 'object' && confirm
    ? ['Delete maintenance record?', 'This removes the record. The deletion is logged.', 'Delete', true] as const
    : ({
        OPERATIONAL: ['Mark as operational?', 'The tricycle can be used for trips again.', 'Mark operational', false],
        UNDER_MAINTENANCE: ['Mark as under maintenance?', 'The tricycle will be flagged as not available for trips.', 'Mark under maintenance', false],
        INACTIVE: ['Mark as inactive?', 'Use this for units that are retired, sold or have a lapsed franchise.', 'Mark inactive', true],
        unassign: ['Unassign driver?', `${v.currentDriver?.fullName ?? 'The driver'} will no longer be linked to ${v.plateNumber}.`, 'Unassign', true],
        archive: ['Archive this tricycle?', 'The record is hidden from lists and any driver assignment ends. This is logged.', 'Archive', true],
      } as const)[confirm as string] ?? ['', '', '', false];

  return (
    <div>
      <PageHeader
        back="/vehicles"
        title={<span className="flex flex-wrap items-center gap-2">{v.plateNumber} <StatusBadge status={v.status} /></span>}
        description={`${v.vehicleCode} · ${v.make} ${v.model}${v.year ? ` (${v.year})` : ''} · ${v.color}${v.association ? ` · ${v.association.name}` : ''}`}
        actions={
          <>
            {can('maintenance.manage') && <Button variant="outline" onClick={() => setMaintOpen(true)}><Wrench /> Record maintenance</Button>}
            {can('vehicles.update') && <Button variant="outline" asChild><Link to={`/vehicles/${v.id}/edit`}><Edit /> Edit</Link></Button>}
            {(can('vehicles.update') || can('vehicles.delete')) && (
              <Menu>
                <MenuTrigger asChild><Button variant="outline" size="icon" aria-label="More actions"><MoreHorizontal /></Button></MenuTrigger>
                <MenuContent>
                  {can('vehicles.update') && (<>
                    {v.status !== 'OPERATIONAL' && <MenuItem onSelect={() => setConfirm('OPERATIONAL')}><PlayCircle /> Mark operational</MenuItem>}
                    {v.status !== 'UNDER_MAINTENANCE' && <MenuItem onSelect={() => setConfirm('UNDER_MAINTENANCE')}><Wrench /> Mark under maintenance</MenuItem>}
                    {v.status !== 'INACTIVE' && <MenuItem onSelect={() => setConfirm('INACTIVE')}><PauseCircle /> Mark inactive</MenuItem>}
                  </>)}
                  {can('vehicles.delete') && (<><MenuSeparator /><MenuItem danger onSelect={() => setConfirm('archive')}><Archive /> Archive</MenuItem></>)}
                </MenuContent>
              </Menu>
            )}
          </>
        }
      />

      <Tabs defaultValue="details">
        <TabsList>
          <TabsTrigger value="details">Details</TabsTrigger>
          <TabsTrigger value="driver">Driver</TabsTrigger>
          <TabsTrigger value="documents" count={v.documents.length}>Documents</TabsTrigger>
          <TabsTrigger value="maintenance" count={v.maintenance.length}>Maintenance</TabsTrigger>
          <TabsTrigger value="history">History</TabsTrigger>
        </TabsList>

        <TabsContent value="details">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2"><CardHeader><CardTitle>Vehicle & registration</CardTitle></CardHeader><CardContent>
              <DescList items={[
                ['Plate number', v.plateNumber], ['Body number', v.bodyNumber], ['Make & model', `${v.make} ${v.model}`], ['Year', v.year], ['Color', v.color],
                ['Engine no.', v.engineNumber], ['Chassis no.', v.chassisNumber], ['LTO OR no.', v.orNumber], ['LTO CR no.', v.crNumber],
                ['Registration expiry', <ExpiryBadge date={v.registrationExpiry} />],
                ['Insurance', v.insuranceProvider ? `${v.insuranceProvider} · ${v.insurancePolicyNo ?? ''}` : '—'], ['Insurance expiry', <ExpiryBadge date={v.insuranceExpiry} />],
              ]} />
            </CardContent></Card>
            <div className="space-y-4">
              <Card><CardHeader><CardTitle>Franchise</CardTitle></CardHeader><CardContent><DescList cols={1} items={[['MTOP / franchise no.', v.franchiseNumber], ['Expiry', <ExpiryBadge date={v.franchiseExpiry} />], ['Inspection', <span className="flex items-center gap-2"><StatusBadge status={v.inspectionStatus} /><span className="text-xs text-muted-foreground">{v.lastInspectionAt && `last ${fmtDate(v.lastInspectionAt)}`}</span></span>]]} /></CardContent></Card>
              <Card><CardHeader><CardTitle>Owner / operator</CardTitle></CardHeader><CardContent><DescList cols={1} items={[['Name', v.ownerName], ['Contact', v.ownerContact], ['Address', v.ownerAddress]]} /></CardContent></Card>
            </div>
          </div>
        </TabsContent>

        <TabsContent value="driver">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle>Current driver</CardTitle>
                {can('vehicles.assign') && v.status !== 'INACTIVE' && <div className="flex gap-2">
                  {v.currentDriver && <Button size="sm" variant="outline" onClick={() => setConfirm('unassign')}><UserMinus /> Unassign</Button>}
                  <Button size="sm" onClick={() => setAssignOpen(true)}><UserPlus /> {v.currentDriver ? 'Reassign' : 'Assign driver'}</Button>
                </div>}
              </CardHeader>
              <CardContent>
                {v.currentDriver ? (
                  <Link to={`/drivers/${v.currentDriver.id}`} className="flex items-center gap-4 rounded-md border p-4 hover:bg-muted/50">
                    <Avatar name={v.currentDriver.fullName} src={v.currentDriver.photoUrl ? `/files/driver-photo/${v.currentDriver.id}` : null} className="size-12" />
                    <div><div className="font-medium">{v.currentDriver.fullName}</div><div className="text-sm text-muted-foreground">{v.currentDriver.driverCode} · {v.currentDriver.contactNumber}</div><div className="text-xs text-muted-foreground">Assigned {fmtDate(v.currentDriver.assignedAt)}</div></div>
                  </Link>
                ) : <EmptyState title="No driver assigned" />}
              </CardContent>
            </Card>
            <Card><CardHeader><CardTitle>Driver history</CardTitle></CardHeader><CardContent>
              {v.assignments.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
                <ul className="space-y-3">{v.assignments.map((a) => (
                  <li key={a.id} className="text-sm"><Link to={`/drivers/${a.driver.id}`} className="font-medium hover:text-primary">{a.driver.firstName} {a.driver.lastName}</Link>
                    <div className="text-xs text-muted-foreground">{fmtDate(a.assignedAt)} – {a.unassignedAt ? fmtDate(a.unassignedAt) : 'present'}{a.remarks && ` · ${a.remarks}`}</div></li>
                ))}</ul>
              )}
            </CardContent></Card>
          </div>
        </TabsContent>

        <TabsContent value="documents">
          <Card><CardContent className="pt-5"><DocumentsPanel docs={v.documents} base={`/vehicles/${v.id}`} filePath="/files/vehicle-document" types={DOC_TYPES} onChange={refresh} /></CardContent></Card>
        </TabsContent>

        <TabsContent value="maintenance">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <div><CardTitle>Maintenance & repairs</CardTitle><p className="text-sm text-muted-foreground">Total spent: {peso(v.maintenanceTotal, 2)}</p></div>
              {can('maintenance.manage') && <Button size="sm" onClick={() => setMaintOpen(true)}><Plus /> Add record</Button>}
            </CardHeader>
            <CardContent className="px-0 pb-0">
              {v.maintenance.length === 0 ? <EmptyState icon={Wrench} title="No maintenance recorded" /> : (
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-y bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="px-4 py-2.5 font-medium">Date</th><th className="px-4 py-2.5 font-medium">Work</th><th className="hidden px-4 py-2.5 font-medium md:table-cell">Shop</th><th className="px-4 py-2.5 text-right font-medium">Cost</th><th className="w-10" /></tr></thead>
                  <tbody>{v.maintenance.map((m) => (
                    <tr key={m.id} className="border-b last:border-0">
                      <td className="whitespace-nowrap px-4 py-2.5">{fmtDate(m.performedAt)}</td>
                      <td className="px-4 py-2.5"><div>{m.description}</div><div className="text-xs text-muted-foreground">{label(m.type)}{m.odometerKm != null && ` · ${m.odometerKm.toLocaleString()} km`}{m.nextDueAt && ` · next ${fmtDate(m.nextDueAt)}`}</div></td>
                      <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{m.shopName ?? '—'}</td>
                      <td className="px-4 py-2.5 text-right tabular">{peso(m.cost, 2)}</td>
                      <td className="px-2">{can('maintenance.manage') && <Button variant="ghost" size="icon" className="size-8" aria-label="Delete record" onClick={() => setConfirm({ maintId: m.id })}><Trash2 /></Button>}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="history"><Card><CardContent className="pt-5"><ActivityList items={v.history} /></CardContent></Card></TabsContent>
      </Tabs>

      <AssignDialog v={v} open={assignOpen} onOpenChange={setAssignOpen} onDone={refresh} />
      <MaintenanceDialog vid={v.id} open={maintOpen} onOpenChange={setMaintOpen} onDone={refresh} />
      {confirm && <ConfirmDialog open onOpenChange={(o) => !o && setConfirm(null)} title={confirmCopy[0]} description={confirmCopy[1]} confirmLabel={confirmCopy[2]} tone={confirmCopy[3] ? 'destructive' : 'default'} onConfirm={doConfirm} />}
    </div>
  );
}
