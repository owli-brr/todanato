import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Edit, UserPlus, MoreHorizontal, Users, Bike } from 'lucide-react';
import { api, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useForm } from '@/lib/hooks';
import { fmtDate, label, num, peso, toInputDate } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Card, CardContent, CardHeader, CardTitle, DescList, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge } from '@/components/ui/misc';
import { Menu, MenuContent, MenuItem, MenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { Pagination } from '@/components/ui/table';
import { SearchBox } from '@/components/shared';

interface Assoc {
  id: string; code: string; name: string; acronym: string | null; barangay: string; city: string; province: string; address: string | null; terminalLocation: string | null;
  contactNumber: string | null; email: string | null; ltfrbAccreditation: string | null; dateEstablished: string | null; status: string;
  monthlyDues: string; dailyContribution: string; membershipFee: string; organization: { name: string } | null;
  officers: { id: string; name: string; position: string; termStart: string; termEnd: string | null; isActive: boolean; driverId: string | null }[];
  stats: { drivers: Record<string, number>; vehicles: Record<string, number>; memberships: Record<string, number>; pendingApplications: number };
}
interface Member { id: string; membershipNo: string; status: string; memberType: string; appliedAt: string; startDate: string | null; remarks: string | null; driver: { id: string; driverCode: string; firstName: string; lastName: string; contactNumber: string; status: string } }

const POSITIONS = ['PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY', 'TREASURER', 'AUDITOR', 'PRO', 'BOARD_MEMBER', 'DISPATCHER'];

function OfficerDialog({ a, open, onOpenChange, onDone }: { a: Assoc; open: boolean; onOpenChange: (o: boolean) => void; onDone: () => void }) {
  const f = useForm({ position: 'PRESIDENT', driverId: '', name: '', termStart: toInputDate(new Date()), termEnd: '' });
  const [busy, setBusy] = useState(false);
  const { data } = useQuery({ queryKey: ['drivers', 'officer-pick', a.id], queryFn: () => api.get<Paged<{ id: string; fullName: string; driverCode: string }>>(`/drivers${qs({ associationId: a.id, status: 'ACTIVE', pageSize: 100, sort: 'name' })}`), enabled: open });
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Assign officer" description="Assigning a single-seat position (e.g. President) ends the current holder's term."
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={busy} onClick={async () => {
        setBusy(true);
        try { await api.post(`/associations/${a.id}/officers`, { ...f.values, driverId: f.values.driverId || null, termEnd: f.values.termEnd || null }); toast.success('Officer assigned'); onOpenChange(false); onDone(); }
        catch (e) { const err = e as { fields?: Record<string, string>; message: string }; if (err.fields) f.setErrors(err.fields); toast.error(err.message); }
        finally { setBusy(false); }
      }}>Assign</Button></>}>
      <div className="grid gap-4 sm:grid-cols-2">
        <Field label="Position" name="position"><Select {...f.bind('position')}>{POSITIONS.map((p) => <option key={p} value={p}>{label(p)}</option>)}</Select></Field>
        <Field label="Member (optional)" name="driverId">
          <Select value={f.values.driverId} onChange={(e) => { const d = data?.items.find((x) => x.id === e.target.value); f.setValues((v) => ({ ...v, driverId: e.target.value, name: d ? d.fullName : v.name })); }}>
            <option value="">— Not a driver-member —</option>
            {data?.items.map((d) => <option key={d.id} value={d.id}>{d.fullName}</option>)}
          </Select>
        </Field>
        <Field label="Officer name" name="name" required error={f.errors.name} className="sm:col-span-2"><Input {...f.bind('name')} /></Field>
        <Field label="Term start" name="termStart" required error={f.errors.termStart}><Input type="date" {...f.bind('termStart')} /></Field>
        <Field label="Term end" name="termEnd"><Input type="date" {...f.bind('termEnd')} /></Field>
      </div>
    </Dialog>
  );
}

function MembersTab({ a }: { a: Assoc }) {
  const { can } = useAuth();
  const [q, setQ] = useState('');
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const [change, setChange] = useState<{ m: Member; status: string } | null>(null);
  const [remarks, setRemarks] = useState('');
  const { data, refetch, isLoading } = useQuery({ queryKey: ['members', a.id, q, status, page], queryFn: () => api.get<Paged<Member>>(`/associations/${a.id}/members${qs({ q, status, page, pageSize: 20 })}`), placeholderData: (p) => p });
  return (
    <Card>
      <div className="flex flex-col gap-2 border-b p-3 sm:flex-row">
        <SearchBox value={q} onChange={(v) => { setQ(v); setPage(1); }} placeholder="Search member or membership no." />
        <Select value={status} onChange={(e) => { setStatus(e.target.value); setPage(1); }} className="sm:w-44" aria-label="Membership status">
          <option value="">All memberships</option>{['PENDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'REJECTED', 'TERMINATED'].map((s) => <option key={s} value={s}>{label(s)}</option>)}
        </Select>
      </div>
      {isLoading ? <div className="p-4"><Skeleton className="h-40" /></div> : !data?.items.length ? <EmptyState title="No members found" /> : (
        <div className="overflow-x-auto"><table className="w-full text-sm">
          <thead><tr className="border-b bg-muted/40 text-left text-xs uppercase tracking-wide text-muted-foreground"><th className="px-4 py-2.5 font-medium">Member</th><th className="hidden px-4 py-2.5 font-medium sm:table-cell">Type</th><th className="hidden px-4 py-2.5 font-medium md:table-cell">Since</th><th className="px-4 py-2.5 font-medium">Status</th><th className="w-12" /></tr></thead>
          <tbody>{data.items.map((m) => (
            <tr key={m.id} className="border-b last:border-0">
              <td className="px-4 py-2.5"><Link to={`/drivers/${m.driver.id}`} className="font-medium hover:text-primary">{m.driver.firstName} {m.driver.lastName}</Link><div className="text-xs text-muted-foreground">{m.membershipNo} · {m.driver.contactNumber}</div></td>
              <td className="hidden px-4 py-2.5 sm:table-cell">{label(m.memberType)}</td>
              <td className="hidden px-4 py-2.5 text-muted-foreground md:table-cell">{fmtDate(m.startDate ?? m.appliedAt)}</td>
              <td className="px-4 py-2.5"><StatusBadge status={m.status} /></td>
              <td className="px-2">{can('memberships.manage') && (
                <Menu><MenuTrigger asChild><Button variant="ghost" size="icon" className="size-8" aria-label="Membership actions"><MoreHorizontal /></Button></MenuTrigger>
                  <MenuContent>{['ACTIVE', 'SUSPENDED', 'INACTIVE', 'TERMINATED'].filter((s) => s !== m.status).map((s) => <MenuItem key={s} danger={s !== 'ACTIVE'} onSelect={() => { setRemarks(''); setChange({ m, status: s }); }}>Set {label(s).toLowerCase()}</MenuItem>)}</MenuContent>
                </Menu>
              )}</td>
            </tr>
          ))}</tbody>
        </table></div>
      )}
      {data && <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
      {change && (
        <ConfirmDialog open onOpenChange={(o) => !o && setChange(null)} title={`Set membership to ${label(change.status).toLowerCase()}?`}
          description={`${change.m.driver.firstName} ${change.m.driver.lastName} (${change.m.membershipNo}). This changes the membership only, not the driver's operating status.`}
          confirmLabel="Confirm" tone={change.status === 'ACTIVE' ? 'default' : 'destructive'}
          onConfirm={async () => { try { await api.post(`/associations/${a.id}/members/${change.m.id}/status`, { status: change.status, remarks }); toast.success('Membership updated'); refetch(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); throw e; } }}>
          <Field label="Remarks" name="remarks"><Textarea id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} /></Field>
        </ConfirmDialog>
      )}
    </Card>
  );
}

export default function AssociationProfile({ id: idProp }: { id?: string } = {}) {
  const params = useParams();
  const id = idProp ?? params.id;
  const { can } = useAuth();
  const { data: a, error, refetch } = useQuery({ queryKey: ['association', id], queryFn: () => api.get<Assoc>(`/associations/${id}`) });
  const [officerOpen, setOfficerOpen] = useState(false);
  const [endOfficer, setEndOfficer] = useState<Assoc['officers'][number] | null>(null);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!a) return <Skeleton className="h-96" />;
  const totalDrivers = Object.values(a.stats.drivers).reduce((s, n) => s + n, 0);
  const totalVehicles = Object.values(a.stats.vehicles).reduce((s, n) => s + n, 0);
  const current = a.officers.filter((o) => o.isActive);
  const past = a.officers.filter((o) => !o.isActive);

  return (
    <div>
      <PageHeader
        title={<span className="flex flex-wrap items-center gap-2">{a.name} <StatusBadge status={a.status} /></span>}
        description={`${a.code}${a.acronym ? ` · ${a.acronym}` : ''} · Brgy. ${a.barangay}, ${a.city}, ${a.province}`}
        actions={<>
          {can('associations.update') && <Button variant="outline" asChild><Link to="/toda/edit"><Edit /> Edit</Link></Button>}
        </>}
      />
      <div className="mb-6 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Link to="/drivers"><Card className="p-4 hover:border-primary/40"><p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Users className="size-4" />Drivers</p><p className="mt-1 text-2xl font-semibold tabular">{num(totalDrivers)}</p><p className="text-xs text-muted-foreground">{a.stats.drivers.ACTIVE ?? 0} active · {a.stats.drivers.SUSPENDED ?? 0} suspended</p></Card></Link>
        <Link to="/vehicles"><Card className="p-4 hover:border-primary/40"><p className="flex items-center gap-1.5 text-sm text-muted-foreground"><Bike className="size-4" />Tricycles</p><p className="mt-1 text-2xl font-semibold tabular">{num(totalVehicles)}</p><p className="text-xs text-muted-foreground">{a.stats.vehicles.OPERATIONAL ?? 0} operational</p></Card></Link>
        <Card className="p-4"><p className="text-sm text-muted-foreground">Active members</p><p className="mt-1 text-2xl font-semibold tabular">{num(a.stats.memberships.ACTIVE ?? 0)}</p><p className="text-xs text-muted-foreground">{a.stats.memberships.PENDING ?? 0} pending</p></Card>
        <Link to="/drivers?application=PENDING"><Card className="p-4 hover:border-primary/40"><p className="text-sm text-muted-foreground">Pending applications</p><p className="mt-1 text-2xl font-semibold tabular">{num(a.stats.pendingApplications)}</p><p className="text-xs text-muted-foreground">Awaiting approval</p></Card></Link>
      </div>
      <Tabs defaultValue="overview">
        <TabsList>
          <TabsTrigger value="overview">Overview</TabsTrigger>
          <TabsTrigger value="officers" count={current.length}>Officers</TabsTrigger>
          {can('memberships.read') && <TabsTrigger value="members">Members</TabsTrigger>}
        </TabsList>
        <TabsContent value="overview">
          <div className="grid gap-4 lg:grid-cols-3">
            <Card className="lg:col-span-2"><CardHeader><CardTitle>Profile</CardTitle></CardHeader><CardContent>
              <DescList items={[['Terminal', a.terminalLocation], ['Office address', a.address], ['Contact', a.contactNumber], ['Email', a.email], ['Accreditation no.', a.ltfrbAccreditation], ['Established', fmtDate(a.dateEstablished)]]} />
            </CardContent></Card>
            <Card><CardHeader><CardTitle>Fees</CardTitle></CardHeader><CardContent>
              <DescList cols={1} items={[['Membership fee', peso(a.membershipFee, 2)], ['Monthly dues', peso(a.monthlyDues, 2)], ['Daily contribution', peso(a.dailyContribution, 2)]]} />
            </CardContent></Card>
          </div>
        </TabsContent>
        <TabsContent value="officers">
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle>Current officers</CardTitle>{can('associations.officers') && <Button size="sm" onClick={() => setOfficerOpen(true)}><UserPlus /> Assign officer</Button>}</CardHeader>
            <CardContent>
              {current.length === 0 ? <EmptyState title="No officers assigned" /> : (
                <ul className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{current.map((o) => (
                  <li key={o.id} className="flex items-start justify-between gap-2 rounded-md border p-3">
                    <div><div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{label(o.position)}</div>
                      <div className="font-medium">{o.driverId ? <Link to={`/drivers/${o.driverId}`} className="hover:text-primary">{o.name}</Link> : o.name}</div>
                      <div className="text-xs text-muted-foreground">{fmtDate(o.termStart)} – {o.termEnd ? fmtDate(o.termEnd) : 'present'}</div></div>
                    {can('associations.officers') && <Button variant="ghost" size="sm" className="text-xs" onClick={() => setEndOfficer(o)}>End term</Button>}
                  </li>
                ))}</ul>
              )}
              {past.length > 0 && (<>
                <h4 className="mb-2 mt-6 text-sm font-semibold">Past officers</h4>
                <ul className="divide-y text-sm">{past.map((o) => <li key={o.id} className="flex justify-between py-2"><span>{o.name} <span className="text-muted-foreground">· {label(o.position)}</span></span><span className="text-xs text-muted-foreground">{fmtDate(o.termStart)} – {fmtDate(o.termEnd)}</span></li>)}</ul>
              </>)}
            </CardContent>
          </Card>
        </TabsContent>
        {can('memberships.read') && <TabsContent value="members"><MembersTab a={a} /></TabsContent>}
      </Tabs>
      <OfficerDialog a={a} open={officerOpen} onOpenChange={setOfficerOpen} onDone={refetch} />
      {endOfficer && <ConfirmDialog open onOpenChange={(o) => !o && setEndOfficer(null)} title="End officer's term?" description={`${endOfficer.name} will no longer be listed as ${label(endOfficer.position)}.`} confirmLabel="End term" tone="destructive"
        onConfirm={async () => { try { await api.post(`/associations/${a.id}/officers/${endOfficer.id}/end`); toast.success('Term ended'); refetch(); } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); throw e; } }} />}
    </div>
  );
}
