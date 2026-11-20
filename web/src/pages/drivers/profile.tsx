import { useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Camera, CheckCircle2, Edit, MoreHorizontal, PauseCircle, PlayCircle, Ban, XCircle, Archive, Bike, Phone, Mail, MapPin, IdCard } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDate, fmtDateTime, label, peso, num, toInputDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog } from '@/components/ui/dialog';
import { Field, Input, Textarea } from '@/components/ui/form';
import { Avatar, Badge, Card, CardContent, CardHeader, CardTitle, DescList, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge } from '@/components/ui/misc';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ActivityList, DocumentsPanel, ExpiryBadge, type Doc } from '@/components/shared';

interface Driver {
  id: string; driverCode: string; fullName: string; firstName: string; middleName: string | null; lastName: string; suffix: string | null; photoUrl: string | null;
  dateOfBirth: string | null; gender: string | null; contactNumber: string; email: string | null; address: string; barangay: string | null; city: string | null;
  emergencyName: string; emergencyRelation: string | null; emergencyPhone: string; licenseNumber: string; licenseType: string; licenseExpiry: string;
  status: string; applicationStatus: string; rejectionReason: string | null; suspensionReason: string | null; suspendedUntil: string | null;
  registeredAt: string; approvedAt: string | null; availability: string; rating: string | null; associationId: string | null;
  association: { id: string; name: string; code: string; acronym: string | null; barangay: string; city: string } | null;
  documents: Doc[];
  memberships: { id: string; membershipNo: string; status: string; memberType: string; appliedAt: string; approvedAt: string | null; startDate: string | null; endDate: string | null; remarks: string | null; association: { name: string; code: string } }[];
  vehicleAssignments: { id: string; assignedAt: string; unassignedAt: string | null; remarks: string | null; vehicle: { id: string; vehicleCode: string; plateNumber: string; make: string; model: string; color: string } }[];
  currentVehicle: { id: string; vehicleCode: string; plateNumber: string; franchiseNumber: string | null; make: string; model: string; color: string; status: string; registrationExpiry: string | null; insuranceExpiry: string | null; inspectionStatus: string; ownerName: string } | null;
  payments: { id: string; receiptNo: string; type: string; method: string; amount: string; paidAt: string; status: string; referenceNo: string | null }[];
  finance: { totalPaid: string | number; outstanding: number } | null;
  rides: { id: string; bookingCode: string; pickupAddress: string; dropoffAddress: string; requestedAt: string; status: string; actualFare: string | null; estimatedFare: string; paymentMethod: string }[];
  rideSummary: { total: number; completed: number; earnings: string | number };
  activity: { id: string; action: string; summary: string; userEmail: string | null; createdAt: string }[];
  portal?: { active: boolean; since?: string; lastLoginAt?: string | null; locked?: boolean };
}

const DRIVER_DOC_TYPES = ['DRIVERS_LICENSE', 'GOVERNMENT_ID', 'BARANGAY_CLEARANCE', 'NBI_CLEARANCE', 'POLICE_CLEARANCE', 'MEDICAL_CERTIFICATE', 'DRUG_TEST', 'MEMBERSHIP_FORM', 'OTHER'];

type Action = { kind: 'approve' | 'reject' | 'ACTIVE' | 'INACTIVE' | 'SUSPENDED' | 'archive' } | null;

export default function DriverProfile() {
  const { id } = useParams();
  const tabParam = useSearchParams()[0].get('tab') ?? undefined;
  const { can } = useAuth();
  const nav = useNavigate();
  const qc = useQueryClient();
  const { data: d, error, refetch } = useQuery({ queryKey: ['driver', id], queryFn: () => api.get<Driver>(`/drivers/${id}`) });
  const [action, setAction] = useState<Action>(null);
  const [reason, setReason] = useState('');
  const [until, setUntil] = useState('');
  const [resetPortal, setResetPortal] = useState(false);
  const photoRef = useRef<HTMLInputElement>(null);

  const refresh = () => { refetch(); qc.invalidateQueries({ queryKey: ['drivers'] }); qc.invalidateQueries({ queryKey: ['dashboard'] }); };

  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!d) return <div className="space-y-4"><Skeleton className="h-28" /><Skeleton className="h-96" /></div>;

  const membership = d.memberships[0];
  const pii = d.address !== '••••••';

  const run = async () => {
    const a = action!;
    try {
      if (a.kind === 'approve' || a.kind === 'reject') await api.post(`/drivers/${d.id}/application`, { decision: a.kind === 'approve' ? 'APPROVE' : 'REJECT', reason });
      else if (a.kind === 'archive') { await api.del(`/drivers/${d.id}`); toast.success('Driver archived'); qc.invalidateQueries({ queryKey: ['drivers'] }); nav('/drivers'); return; }
      else await api.post(`/drivers/${d.id}/status`, { status: a.kind, reason, suspendedUntil: until || null });
      toast.success({ approve: 'Application approved. Driver is now active.', reject: 'Application rejected', ACTIVE: 'Driver activated', INACTIVE: 'Driver deactivated', SUSPENDED: 'Driver suspended' }[a.kind]);
      refresh();
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Action failed'); throw e; }
  };

  const confirmText: Record<string, [string, string, string, boolean]> = {
    approve: ['Approve this application?', `${d.fullName} becomes an active driver and member of ${d.association?.name ?? 'the TODA'}. Check that the documents are verified first.`, 'Approve', false],
    reject: ['Reject this application?', 'The driver will be marked inactive and the membership rejected.', 'Reject application', true],
    ACTIVE: ['Activate driver?', `${d.fullName} will be able to operate and receive bookings.`, 'Activate', false],
    INACTIVE: ['Deactivate driver?', `${d.fullName} will no longer be able to operate or receive bookings.`, 'Deactivate', true],
    SUSPENDED: ['Suspend driver?', 'The driver goes offline and cannot receive bookings until reactivated.', 'Suspend', true],
    archive: ['Archive this driver record?', 'The record is hidden from lists and any tricycle assignment ends. This is logged and can be restored by a database administrator.', 'Archive', true],
  };

  return (
    <div>
      <PageHeader back="/drivers" title="" />
      <Card className="mb-6 -mt-4">
        <CardContent className="flex flex-col gap-5 pt-5 sm:flex-row sm:items-center">
          <div className="relative w-fit">
            <Avatar name={d.fullName} src={d.photoUrl ? `/files/driver-photo/${d.id}` : null} className="size-20 text-xl" />
            {can('drivers.update') && (
              <>
                <button onClick={() => photoRef.current?.click()} className="absolute -bottom-1 -right-1 rounded-full border bg-card p-1.5 shadow-sm hover:bg-accent" aria-label="Change photo"><Camera className="size-3.5" /></button>
                <input ref={photoRef} type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={async (e) => {
                  const f = e.target.files?.[0];
                  if (!f) return;
                  const fd = new FormData(); fd.append('file', f);
                  try { await api.post(`/drivers/${d.id}/photo`, fd); toast.success('Photo updated'); refresh(); } catch (err) { toast.error(err instanceof Error ? err.message : 'Upload failed'); }
                  e.target.value = '';
                }} />
              </>
            )}
          </div>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-2xl font-semibold tracking-tight">{d.fullName}</h1>
              <StatusBadge status={d.status} />
              {d.applicationStatus !== 'APPROVED' && d.status !== 'PENDING' && <Badge tone={d.applicationStatus === 'PENDING' ? 'amber' : 'red'}>Application {d.applicationStatus.toLowerCase()}</Badge>}
            </div>
            <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-muted-foreground">
              <span className="inline-flex items-center gap-1"><IdCard className="size-4" />{d.driverCode}{membership && ` · ${membership.membershipNo}`}</span>
              <span className="inline-flex items-center gap-1"><Phone className="size-4" />{d.contactNumber}</span>
              {d.association && <Link to="/toda" className="inline-flex items-center gap-1 hover:text-primary"><MapPin className="size-4" />{d.association.name}</Link>}
              {d.currentVehicle && <Link to={`/vehicles/${d.currentVehicle.id}`} className="inline-flex items-center gap-1 hover:text-primary"><Bike className="size-4" />{d.currentVehicle.plateNumber}</Link>}
            </div>
            {d.status === 'SUSPENDED' && d.suspensionReason && <p className="mt-2 text-sm text-destructive">Suspended{d.suspendedUntil && ` until ${fmtDate(d.suspendedUntil)}`}: {d.suspensionReason}</p>}
            {d.applicationStatus === 'REJECTED' && d.rejectionReason && <p className="mt-2 text-sm text-destructive">Rejected: {d.rejectionReason}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {d.applicationStatus === 'PENDING' && can('drivers.approve') && (
              <>
                <Button variant="success" onClick={() => { setReason(''); setAction({ kind: 'approve' }); }}><CheckCircle2 /> Approve</Button>
                <Button variant="outline" className="text-destructive" onClick={() => { setReason(''); setAction({ kind: 'reject' }); }}><XCircle /> Reject</Button>
              </>
            )}
            {can('drivers.update') && <Button variant="outline" asChild><Link to={`/drivers/${d.id}/edit`}><Edit /> Edit</Link></Button>}
            {(can('drivers.status') || can('drivers.delete')) && (
              <Menu>
                <MenuTrigger asChild><Button variant="outline" size="icon" aria-label="More actions"><MoreHorizontal /></Button></MenuTrigger>
                <MenuContent>
                  {can('drivers.status') && d.applicationStatus === 'APPROVED' && (
                    <>
                      {d.status !== 'ACTIVE' && <MenuItem onSelect={() => { setReason(''); setAction({ kind: 'ACTIVE' }); }}><PlayCircle /> Activate</MenuItem>}
                      {d.status !== 'INACTIVE' && <MenuItem onSelect={() => { setReason(''); setAction({ kind: 'INACTIVE' }); }}><PauseCircle /> Deactivate</MenuItem>}
                      {d.status !== 'SUSPENDED' && <MenuItem danger onSelect={() => { setReason(''); setUntil(''); setAction({ kind: 'SUSPENDED' }); }}><Ban /> Suspend</MenuItem>}
                    </>
                  )}
                  {can('drivers.delete') && (<><MenuSeparator /><MenuItem danger onSelect={() => setAction({ kind: 'archive' })}><Archive /> Archive record</MenuItem></>)}
                </MenuContent>
              </Menu>
            )}
          </div>
        </CardContent>
      </Card>

      <Tabs defaultValue={tabParam ?? "personal"}>
        <TabsList>
          <TabsTrigger value="personal">Personal</TabsTrigger>
          <TabsTrigger value="documents" count={d.documents.length}>Documents</TabsTrigger>
          <TabsTrigger value="vehicle">Tricycle</TabsTrigger>
          <TabsTrigger value="membership">Membership</TabsTrigger>
          {d.finance && <TabsTrigger value="payments">Payments</TabsTrigger>}
          <TabsTrigger value="rides">Rides</TabsTrigger>
          <TabsTrigger value="activity">Activity</TabsTrigger>
        </TabsList>

        <TabsContent value="personal">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>Personal information</CardTitle></CardHeader>
              <CardContent>
                {!pii && <p className="mb-4 rounded-md bg-muted px-3 py-2 text-xs text-muted-foreground">Some personal details are hidden for your role under the Data Privacy Act.</p>}
                <DescList items={[
                  ['Full name', [d.firstName, d.middleName, d.lastName, d.suffix].filter(Boolean).join(' ')],
                  ['Date of birth', d.dateOfBirth ? `${fmtDate(d.dateOfBirth)} (${Math.floor((Date.now() - new Date(d.dateOfBirth).getTime()) / (365.25 * 86400000))} yrs)` : '••••••'],
                  ['Gender', label(d.gender)],
                  ['Mobile', d.contactNumber],
                  ['Email', d.email ? <span className="inline-flex items-center gap-1"><Mail className="size-3.5" />{d.email}</span> : '—'],
                  ['Address', d.address],
                  ['Emergency contact', `${d.emergencyName}${d.emergencyRelation ? ` (${d.emergencyRelation})` : ''} · ${d.emergencyPhone}`],
                  ['Registered', fmtDate(d.registeredAt)],
                ]} />
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Driver's license</CardTitle></CardHeader>
              <CardContent>
                <DescList cols={1} items={[
                  ['License number', <span className="font-mono">{d.licenseNumber}</span>],
                  ['Type', label(d.licenseType)],
                  ['Expiry', <ExpiryBadge date={d.licenseExpiry} />],
                  ['Rating', d.rating ? `★ ${Number(d.rating).toFixed(2)}` : '—'],
                  ['Approved', fmtDate(d.approvedAt)],
                ]} />
              </CardContent>
            </Card>
            {d.applicationStatus === 'APPROVED' && (
              <Card className="lg:col-start-3">
                <CardHeader><CardTitle>Driver portal</CardTitle></CardHeader>
                <CardContent className="space-y-3 text-sm">
                  {d.portal?.active ? (
                    <>
                      <DescList cols={1} items={[
                        ['Status', d.portal.locked ? <Badge tone="amber">Temporarily locked</Badge> : <Badge tone="green">Active</Badge>],
                        ['Account set up', fmtDate(d.portal.since ?? null)],
                        ['Last sign-in', d.portal.lastLoginAt ? fmtDateTime(d.portal.lastLoginAt) : 'Never'],
                      ]} />
                      {can('drivers.update') && <Button size="sm" variant="outline" onClick={() => setResetPortal(true)}>Reset portal account</Button>}
                    </>
                  ) : (
                    <p className="text-muted-foreground">Not set up yet. The driver can set it up at <span className="font-mono">/driver/activate</span> with their application reference, license number and mobile number.</p>
                  )}
                </CardContent>
              </Card>
            )}
          </div>
        </TabsContent>

        <TabsContent value="documents">
          <Card><CardContent className="pt-5"><DocumentsPanel docs={d.documents} base={`/drivers/${d.id}`} filePath="/files/driver-document" types={DRIVER_DOC_TYPES} onChange={refresh} /></CardContent></Card>
        </TabsContent>

        <TabsContent value="vehicle">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2">
              <CardHeader><CardTitle>Assigned tricycle</CardTitle></CardHeader>
              <CardContent>
                {d.currentVehicle ? (
                  <DescList items={[
                    ['Plate number', <Link to={`/vehicles/${d.currentVehicle.id}`} className="font-medium text-primary hover:underline">{d.currentVehicle.plateNumber}</Link>],
                    ['Vehicle ID', d.currentVehicle.vehicleCode],
                    ['Make & model', `${d.currentVehicle.make} ${d.currentVehicle.model}`],
                    ['Color', d.currentVehicle.color],
                    ['Franchise (MTOP)', d.currentVehicle.franchiseNumber],
                    ['Owner / operator', d.currentVehicle.ownerName],
                    ['Registration expiry', <ExpiryBadge date={d.currentVehicle.registrationExpiry} />],
                    ['Insurance expiry', <ExpiryBadge date={d.currentVehicle.insuranceExpiry} />],
                    ['Status', <StatusBadge status={d.currentVehicle.status} />],
                    ['Inspection', <StatusBadge status={d.currentVehicle.inspectionStatus} />],
                  ]} />
                ) : <EmptyState icon={Bike} title="No tricycle assigned" description={can('vehicles.assign') ? 'Assign one from the tricycle’s page.' : undefined} action={can('vehicles.assign') && <Button size="sm" variant="outline" asChild><Link to={`/vehicles?unassigned=true${d.associationId ? `&associationId=${d.associationId}` : ''}`}>Find an unassigned tricycle</Link></Button>} />}
              </CardContent>
            </Card>
            <Card>
              <CardHeader><CardTitle>Assignment history</CardTitle></CardHeader>
              <CardContent>
                {d.vehicleAssignments.length === 0 ? <p className="text-sm text-muted-foreground">None.</p> : (
                  <ul className="space-y-3">{d.vehicleAssignments.map((a) => (
                    <li key={a.id} className="text-sm">
                      <Link to={`/vehicles/${a.vehicle.id}`} className="font-medium hover:text-primary">{a.vehicle.plateNumber}</Link> <span className="text-muted-foreground">· {a.vehicle.make} {a.vehicle.model}</span>
                      <div className="text-xs text-muted-foreground">{fmtDate(a.assignedAt)} – {a.unassignedAt ? fmtDate(a.unassignedAt) : 'present'}{a.remarks && ` · ${a.remarks}`}</div>
                    </li>
                  ))}</ul>
                )}
              </CardContent>
            </Card>
          </div>
        </TabsContent>

        <TabsContent value="membership">
          <Card>
            <CardContent className="px-0 pb-0">
              {d.memberships.length === 0 ? <EmptyState title="No membership record yet" /> : (
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="px-4 py-2.5 font-medium">Membership no.</th><th className="px-4 py-2.5 font-medium">TODA</th><th className="px-4 py-2.5 font-medium">Type</th><th className="px-4 py-2.5 font-medium">Period</th><th className="px-4 py-2.5 font-medium">Status</th></tr></thead>
                  <tbody>{d.memberships.map((m) => (
                    <tr key={m.id} className="border-b last:border-0">
                      <td className="px-4 py-3 font-mono">{m.membershipNo}</td>
                      <td className="px-4 py-3">{m.association.name}</td>
                      <td className="px-4 py-3">{label(m.memberType)}</td>
                      <td className="px-4 py-3 text-muted-foreground">{m.startDate ? fmtDate(m.startDate) : `Applied ${fmtDate(m.appliedAt)}`}{m.endDate && ` – ${fmtDate(m.endDate)}`}</td>
                      <td className="px-4 py-3"><StatusBadge status={m.status} />{m.remarks && <div className="mt-1 text-xs text-muted-foreground">{m.remarks}</div>}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </CardContent>
          </Card>
        </TabsContent>

        {d.finance && (
          <TabsContent value="payments">
            <div className="mb-4 grid gap-4 sm:grid-cols-2">
              <Card className="p-4"><p className="text-sm text-muted-foreground">Total paid</p><p className="mt-1 text-2xl font-semibold tabular">{peso(d.finance.totalPaid, 2)}</p></Card>
              <Card className="p-4"><p className="text-sm text-muted-foreground">Outstanding balance</p><p className={`mt-1 text-2xl font-semibold tabular ${d.finance.outstanding > 0 ? 'text-destructive' : ''}`}>{peso(d.finance.outstanding, 2)}</p><Link to={`/finance?tab=dues&q=${encodeURIComponent(d.driverCode)}`} className="mt-1 inline-block text-xs text-primary hover:underline">See charges</Link></Card>
            </div>
            <Card><CardContent className="px-0 pb-0">
              {d.payments.length === 0 ? <EmptyState title="No payments recorded" /> : (
                <div className="overflow-x-auto"><table className="w-full text-sm">
                  <thead><tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="px-4 py-2.5 font-medium">Receipt</th><th className="px-4 py-2.5 font-medium">Type</th><th className="hidden px-4 py-2.5 font-medium sm:table-cell">Method</th><th className="px-4 py-2.5 font-medium">Date</th><th className="px-4 py-2.5 text-right font-medium">Amount</th></tr></thead>
                  <tbody>{d.payments.map((p) => (
                    <tr key={p.id} className="border-b last:border-0">
                      <td className="px-4 py-2.5 font-mono text-xs"><Link to={`/finance/payments/${p.id}`} className={`hover:text-primary ${p.status === 'VOIDED' ? 'line-through text-muted-foreground' : ''}`}>{p.receiptNo}</Link>{p.status === 'VOIDED' && <Badge tone="red" className="ml-2 font-sans">Void</Badge>}</td>
                      <td className="px-4 py-2.5">{label(p.type)}</td>
                      <td className="hidden px-4 py-2.5 sm:table-cell">{label(p.method)}</td>
                      <td className="px-4 py-2.5 text-muted-foreground">{fmtDateTime(p.paidAt)}</td>
                      <td className="px-4 py-2.5 text-right font-medium tabular">{peso(p.amount, 2)}</td>
                    </tr>
                  ))}</tbody>
                </table></div>
              )}
            </CardContent></Card>
            <p className="mt-2 text-xs text-muted-foreground">Recording payments and issuing receipts comes with the Finance module in Phase 2.</p>
          </TabsContent>
        )}

        <TabsContent value="rides">
          <div className="mb-4 grid gap-4 sm:grid-cols-3">
            <Card className="p-4"><p className="text-sm text-muted-foreground">Total bookings</p><p className="mt-1 text-2xl font-semibold tabular">{num(d.rideSummary.total)}</p></Card>
            <Card className="p-4"><p className="text-sm text-muted-foreground">Completed rides</p><p className="mt-1 text-2xl font-semibold tabular">{num(d.rideSummary.completed)}</p></Card>
            <Card className="p-4"><p className="text-sm text-muted-foreground">Fare earnings</p><p className="mt-1 text-2xl font-semibold tabular">{peso(d.rideSummary.earnings)}</p></Card>
          </div>
          <Card><CardContent className="px-0 pb-0">
            {d.rides.length === 0 ? <EmptyState title="No rides yet" description="Rides booked through the mobile app will appear here." /> : (
              <div className="overflow-x-auto"><table className="w-full text-sm">
                <thead><tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="px-4 py-2.5 font-medium">Booking</th><th className="px-4 py-2.5 font-medium">Route</th><th className="hidden px-4 py-2.5 font-medium md:table-cell">Date</th><th className="px-4 py-2.5 font-medium">Status</th><th className="px-4 py-2.5 text-right font-medium">Fare</th></tr></thead>
                <tbody>{d.rides.map((r) => (
                  <tr key={r.id} className="border-b last:border-0">
                    <td className="px-4 py-2.5 font-mono text-xs">{r.bookingCode}</td>
                    <td className="px-4 py-2.5"><div className="max-w-[260px] truncate">{r.pickupAddress} → {r.dropoffAddress}</div></td>
                    <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{fmtDateTime(r.requestedAt)}</td>
                    <td className="px-4 py-2.5"><StatusBadge status={r.status} /></td>
                    <td className="px-4 py-2.5 text-right tabular">{peso(r.actualFare ?? r.estimatedFare)} <span className="text-xs text-muted-foreground">{label(r.paymentMethod)}</span></td>
                  </tr>
                ))}</tbody>
              </table></div>
            )}
          </CardContent></Card>
        </TabsContent>

        <TabsContent value="activity">
          <Card><CardContent className="pt-5"><ActivityList items={d.activity} /></CardContent></Card>
        </TabsContent>
      </Tabs>

      <ConfirmDialog
        open={resetPortal}
        onOpenChange={setResetPortal}
        title="Reset portal account?"
        description="This removes the driver's portal sign-in. They can set it up again with their application reference, license number and mobile number."
        confirmLabel="Reset account"
        tone="destructive"
        onConfirm={async () => {
          try { await api.del(`/drivers/${d.id}/portal-account`); toast.success('Portal account reset'); setResetPortal(false); refresh(); }
          catch (e) { toast.error((e as Error).message); }
        }}
      />

      {action && (
        <ConfirmDialog
          open
          onOpenChange={(o) => !o && setAction(null)}
          title={confirmText[action.kind][0]}
          description={confirmText[action.kind][1]}
          confirmLabel={confirmText[action.kind][2]}
          tone={confirmText[action.kind][3] ? 'destructive' : 'default'}
          onConfirm={run}
        >
          {['reject', 'SUSPENDED', 'INACTIVE'].includes(action.kind) && (
            <Field label="Reason" name="reason" required={action.kind !== 'INACTIVE'}>
              <Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} />
            </Field>
          )}
          {action.kind === 'SUSPENDED' && (
            <Field label="Suspended until (optional)" name="until"><Input id="until" type="date" min={toInputDate(new Date())} value={until} onChange={(e) => setUntil(e.target.value)} /></Field>
          )}
        </ConfirmDialog>
      )}
    </div>
  );
}
