import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { CheckCircle2, Eye, MapPin, Paperclip, Plus, RotateCcw, Trash2, User, X } from 'lucide-react';
import { api, ApiError, fileUrl, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced } from '@/lib/hooks';
import { cn, fmtDateTime, relTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, Card, CardContent, CardHeader, CardTitle, DescList, EmptyState, ErrorState, PageHeader, Skeleton, type Tone } from '@/components/ui/misc';
import { DataTable, Pagination, type Column } from '@/components/ui/table';
import { SearchBox, Toolbar } from '@/components/shared';
import { DriverPicker, type DriverPick } from '@/pages/finance/shared';

const TYPES = ['PASSENGER_COMPLAINT', 'DRIVER_COMPLAINT', 'ACCIDENT', 'LOST_AND_FOUND', 'VIOLATION', 'OTHER'];
const TYPE_LABEL: Record<string, string> = { PASSENGER_COMPLAINT: 'Passenger complaint', DRIVER_COMPLAINT: 'Driver complaint', ACCIDENT: 'Accident', LOST_AND_FOUND: 'Lost and found', VIOLATION: 'Violation', OTHER: 'Other' };
const STATUS: Record<string, [string, Tone]> = { OPEN: ['Open', 'blue'], INVESTIGATING: ['Investigating', 'amber'], RESOLVED: ['Resolved', 'green'], DISMISSED: ['Dismissed', 'gray'] };
const SEVERITY: Record<string, [string, Tone]> = { LOW: ['Low', 'gray'], MEDIUM: ['Medium', 'amber'], HIGH: ['High', 'red'], CRITICAL: ['Critical', 'red'] };
const StatusPill = ({ s }: { s: string }) => <Badge tone={STATUS[s]?.[1] ?? 'gray'}>{STATUS[s]?.[0] ?? s}</Badge>;
const SeverityPill = ({ s }: { s: string }) => <Badge tone={SEVERITY[s]?.[1] ?? 'gray'} className={s === 'CRITICAL' ? 'font-semibold uppercase' : ''}>{SEVERITY[s]?.[0] ?? s}</Badge>;

interface Row { id: string; caseNo: string; type: string; title: string; occurredAt: string; location: string | null; status: string; severity: string; driver: { id: string; fullName: string; driverCode: string } | null; assignedTo: string | null; notes: number; complainantName: string | null }
interface Assignee { id: string; fullName: string; role: string }

const localInput = (d: Date) => new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16);

export default function IncidentsPage() {
  const { can } = useAuth();
  const nav = useNavigate();
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') ?? 'ACTIVE';
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const [page, setPage] = useState(1);
  const query = { status: status === 'ALL' ? undefined : status, type: sp.get('type') ?? undefined, severity: sp.get('severity') ?? undefined, mine: sp.get('mine') ?? undefined, q: dq, page, pageSize: 20 };
  useEffect(() => setPage(1), [status, dq, sp]);
  const { data, isLoading, isFetching, error, refetch } = useQuery({ queryKey: ['incidents', query], queryFn: () => api.get<Paged<Row> & { counts: Record<string, number> }>(`/incidents${qs(query)}`), placeholderData: (p) => p });
  const [logOpen, setLogOpen] = useState(false);
  const set = (patch: Record<string, string>) => setSp((p) => { const n = new URLSearchParams(p); Object.entries(patch).forEach(([k, v]) => (v ? n.set(k, v) : n.delete(k))); return n; }, { replace: true });
  const tabs: [string, string, number | undefined][] = [
    ['ACTIVE', 'Needs action', data ? data.counts.OPEN + data.counts.INVESTIGATING : undefined],
    ['OPEN', 'Open', data?.counts.OPEN], ['INVESTIGATING', 'Investigating', data?.counts.INVESTIGATING],
    ['RESOLVED', 'Resolved', data?.counts.RESOLVED], ['DISMISSED', 'Dismissed', data?.counts.DISMISSED], ['ALL', 'All', undefined],
  ];
  const columns: Column<Row>[] = [
    { key: 'caseNo', header: 'Case', sortable: false, cell: (r) => <div><div className="font-medium">{r.title}</div><div className="text-xs text-muted-foreground"><span className="font-mono">{r.caseNo}</span> · {TYPE_LABEL[r.type]}</div></div> },
    { key: 'driver', header: 'Driver', hideBelow: 'md', cell: (r) => r.driver ? <div>{r.driver.fullName}<div className="text-xs text-muted-foreground">{r.driver.driverCode}</div></div> : <span className="text-muted-foreground">—</span> },
    { key: 'occurredAt', header: 'When', hideBelow: 'lg', cell: (r) => <div>{fmtDateTime(r.occurredAt)}{r.location && <div className="text-xs text-muted-foreground">{r.location}</div>}</div> },
    { key: 'severity', header: 'Severity', hideBelow: 'sm', cell: (r) => <SeverityPill s={r.severity} /> },
    { key: 'status', header: 'Status', cell: (r) => <div><StatusPill s={r.status} />{r.assignedTo && <div className="mt-0.5 text-xs text-muted-foreground">{r.assignedTo}</div>}</div> },
  ];
  return (
    <div>
      <PageHeader title="Incidents" description="Complaints, accidents, violations and lost items, from report to resolution." actions={can('incidents.manage') && <Button onClick={() => setLogOpen(true)}><Plus /> Log incident</Button>} />
      <div className="mb-4 flex gap-1 overflow-x-auto border-b">
        {tabs.map(([k, l, n]) => (
          <button key={k} onClick={() => set({ status: k === 'ACTIVE' ? '' : k })} className={cn('-mb-px flex shrink-0 items-center gap-1.5 border-b-2 px-3 py-2 text-sm', status === k ? 'border-primary font-medium text-foreground' : 'border-transparent text-muted-foreground hover:text-foreground')}>
            {l}{n !== undefined && <span className="rounded-full bg-muted px-1.5 text-xs tabular">{n}</span>}
          </button>
        ))}
      </div>
      <Card>
        <Toolbar>
          <SearchBox value={q} onChange={setQ} placeholder="Search case no., title, driver, place…" />
          <div className="grid grid-cols-2 gap-2 sm:flex sm:flex-wrap">
            <Select value={sp.get('type') ?? ''} onChange={(e) => set({ type: e.target.value })} aria-label="Type" className="sm:w-48"><option value="">All kinds</option>{TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</Select>
            <Select value={sp.get('severity') ?? ''} onChange={(e) => set({ severity: e.target.value })} aria-label="Severity" className="sm:w-36"><option value="">Any severity</option>{Object.entries(SEVERITY).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>
            {can('incidents.manage') && <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="size-4" checked={sp.get('mine') === 'true'} onChange={(e) => set({ mine: e.target.checked ? 'true' : '' })} />Assigned to me</label>}
          </div>
        </Toolbar>
        <DataTable columns={columns} rows={data?.items} loading={isLoading || isFetching} error={error} onRetry={refetch} onRowClick={(r) => nav(`/incidents/${r.id}`)}
          empty={<EmptyState icon={CheckCircle2} title={status === 'ACTIVE' ? 'No open cases' : 'No incidents found'} description={status === 'ACTIVE' ? 'Nothing needs action right now.' : 'Try changing the filters.'} />} />
        {data && <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={setPage} />}
      </Card>
      <LogDialog open={logOpen} onOpenChange={setLogOpen} onDone={(id) => nav(`/incidents/${id}`)} />
    </div>
  );
}

function useAssignees() {
  return useQuery({ queryKey: ['incident-assignees'], queryFn: () => api.get<Assignee[]>('/incidents/assignees'), staleTime: 5 * 60_000 });
}

function LogDialog({ open, onOpenChange, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; onDone: (id: string) => void }) {
  const qc = useQueryClient();
  const assignees = useAssignees();
  const blank = () => ({ type: 'PASSENGER_COMPLAINT', title: '', description: '', occurredAt: localInput(new Date()), location: '', complainantName: '', complainantPhone: '', severity: 'LOW', assignedToId: '' });
  const [v, setV] = useState(blank);
  const [driver, setDriver] = useState<DriverPick | null>(null);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (open) { setV(blank()); setDriver(null); setErrors({}); } }, [open]);
  const set = (k: keyof ReturnType<typeof blank>) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErrors({});
    try {
      const r = await api.post<{ id: string; caseNo: string }>('/incidents', { ...v, occurredAt: new Date(v.occurredAt).toISOString(), driverId: driver?.id ?? null });
      toast.success(`${r.caseNo} logged`); qc.invalidateQueries({ queryKey: ['incidents'] }); onOpenChange(false); onDone(r.id);
    } catch (err) { if (err instanceof ApiError && err.fields) setErrors(err.fields); toast.error((err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title="Log an incident" className="max-w-2xl">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Kind" name="type" required><Select id="type" value={v.type} onChange={set('type')}>{TYPES.map((t) => <option key={t} value={t}>{TYPE_LABEL[t]}</option>)}</Select></Field>
        <Field label="Severity" name="severity" required><Select id="severity" value={v.severity} onChange={set('severity')}>{Object.entries(SEVERITY).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
        <Field label="Summary" name="title" required error={errors.title} className="sm:col-span-2"><Input id="title" value={v.title} onChange={set('title')} placeholder="e.g. Overcharged from market to Cathedral" maxLength={150} /></Field>
        <Field label="What happened" name="description" required error={errors.description} className="sm:col-span-2"><Textarea id="description" rows={4} value={v.description} onChange={set('description')} /></Field>
        <Field label="When" name="occurredAt" required error={errors.occurredAt}><Input id="occurredAt" type="datetime-local" max={localInput(new Date())} value={v.occurredAt} onChange={set('occurredAt')} /></Field>
        <Field label="Where" name="location" error={errors.location}><Input id="location" value={v.location} onChange={set('location')} placeholder="Optional" /></Field>
        <Field label="Driver involved" name="driverId" error={errors.driverId} className="sm:col-span-2" hint="Optional"><DriverPicker value={driver} onChange={setDriver} /></Field>
        <Field label="Reported by (name)" name="complainantName" error={errors.complainantName} hint="Passenger, driver or other person, if any"><Input id="complainantName" value={v.complainantName} onChange={set('complainantName')} /></Field>
        <Field label="Their mobile" name="complainantPhone" error={errors.complainantPhone}><Input id="complainantPhone" inputMode="tel" value={v.complainantPhone} onChange={set('complainantPhone')} /></Field>
        <Field label="Assign to" name="assignedToId" error={errors.assignedToId}>
          <Select id="assignedToId" value={v.assignedToId} onChange={set('assignedToId')}><option value="">Nobody yet</option>{assignees.data?.map((a) => <option key={a.id} value={a.id}>{a.fullName} ({a.role})</option>)}</Select>
        </Field>
        <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" loading={busy}>Log incident</Button>
        </div>
      </form>
    </Dialog>
  );
}

// ───────────── Case page ─────────────

interface Incident {
  id: string; caseNo: string; type: string; title: string; description: string; occurredAt: string; location: string | null; status: string; severity: string;
  driver: { id: string; fullName: string; driverCode: string; status: string } | null; complainantName: string | null; complainantPhone: string | null;
  reportedBy: { fullName: string } | null; assignedTo: { id: string; fullName: string } | null; resolution: string | null; disciplinaryAction: string | null; resolvedAt: string | null; createdAt: string;
  notes: { id: string; body: string; createdAt: string; author: string }[];
  attachments: { id: string; fileName: string; mimeType: string; uploadedAt: string }[];
}

export function IncidentPage() {
  const { id } = useParams();
  const { can } = useAuth();
  const qc = useQueryClient();
  const manage = can('incidents.manage');
  const { data: i, error, refetch } = useQuery({ queryKey: ['incident', id], queryFn: () => api.get<Incident>(`/incidents/${id}`) });
  const assignees = useAssignees();
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const [closing, setClosing] = useState<'RESOLVED' | 'DISMISSED' | null>(null);
  const [reopen, setReopen] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!i) return <Skeleton className="h-96" />;
  const closed = i.status === 'RESOLVED' || i.status === 'DISMISSED';
  const apply = (r: Incident) => { qc.setQueryData(['incident', id], r); qc.invalidateQueries({ queryKey: ['incidents'] }); };
  const run = async (key: string, fn: () => Promise<Incident>, ok?: string) => {
    setBusy(key);
    try { apply(await fn()); if (ok) toast.success(ok); return true; }
    catch (e) { toast.error((e as Error).message); return false; }
    finally { setBusy(null); }
  };
  const patch = (body: Record<string, unknown>, ok: string) => run('patch', () => api.patch<Incident>(`/incidents/${i.id}`, body), ok);
  const addNote = async (e: FormEvent) => { e.preventDefault(); if (await run('note', () => api.post<Incident>(`/incidents/${i.id}/notes`, { body: note }))) setNote(''); };
  const upload = async (f: File) => {
    const fd = new FormData(); fd.append('file', f);
    await run('upload', () => api.post<Incident>(`/incidents/${i.id}/attachments`, fd), 'File attached');
    if (fileRef.current) fileRef.current.value = '';
  };
  const open = async (aid: string) => { try { window.open(await fileUrl(`/incidents/${i.id}/attachments/${aid}`), '_blank', 'noopener'); } catch (e) { toast.error((e as Error).message); } };
  const removeFile = async (aid: string) => { setBusy('rm'); try { await api.del(`/incidents/${i.id}/attachments/${aid}`); refetch(); toast.success('Attachment removed'); } catch (e) { toast.error((e as Error).message); } finally { setBusy(null); } };

  return (
    <div>
      <PageHeader back="/incidents" title={i.title} description={<span className="flex flex-wrap items-center gap-2"><span className="font-mono">{i.caseNo}</span><span>· {TYPE_LABEL[i.type]}</span><StatusPill s={i.status} /><SeverityPill s={i.severity} /></span>}
        actions={manage && (closed
          ? <Button variant="outline" onClick={() => setReopen(true)}><RotateCcw /> Reopen</Button>
          : <><Button variant="outline" onClick={() => setClosing('DISMISSED')}><X /> Dismiss</Button><Button onClick={() => setClosing('RESOLVED')}><CheckCircle2 /> Resolve</Button></>)} />
      <div className="grid gap-4 lg:grid-cols-3">
        <div className="space-y-4 lg:col-span-2">
          <Card>
            <CardHeader><CardTitle>What happened</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <p className="whitespace-pre-line text-sm">{i.description}</p>
              <div className="flex flex-wrap gap-x-6 gap-y-1 text-sm text-muted-foreground">
                <span>{fmtDateTime(i.occurredAt)}</span>{i.location && <span className="inline-flex items-center gap-1"><MapPin className="size-3.5" />{i.location}</span>}
              </div>
            </CardContent>
          </Card>
          {closed && (
            <Card className={i.status === 'RESOLVED' ? 'border-emerald-300 dark:border-emerald-500/30' : ''}>
              <CardHeader><CardTitle>{i.status === 'RESOLVED' ? 'Resolution' : 'Dismissed'}</CardTitle></CardHeader>
              <CardContent className="space-y-2 text-sm">
                <p className="whitespace-pre-line">{i.resolution}</p>
                {i.disciplinaryAction && <p><span className="font-medium">Action taken:</span> {i.disciplinaryAction}</p>}
                <p className="text-xs text-muted-foreground">Closed {fmtDateTime(i.resolvedAt)}</p>
              </CardContent>
            </Card>
          )}
          <Card>
            <CardHeader><CardTitle>Notes and follow-up</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              {i.notes.length === 0 && <p className="text-sm text-muted-foreground">No notes yet.</p>}
              <ol className="space-y-3">
                {i.notes.map((n) => (
                  <li key={n.id} className="rounded-md border p-3 text-sm">
                    <p className="whitespace-pre-line">{n.body}</p>
                    <p className="mt-1 text-xs text-muted-foreground">{n.author} · <span title={fmtDateTime(n.createdAt)}>{relTime(n.createdAt)}</span></p>
                  </li>
                ))}
              </ol>
              {manage && !closed && (
                <form onSubmit={addNote} className="space-y-2">
                  <Textarea value={note} onChange={(e) => setNote(e.target.value)} rows={3} placeholder="Add what was done, who was talked to, what’s next…" aria-label="New note" />
                  <div className="flex justify-end"><Button type="submit" size="sm" loading={busy === 'note'} disabled={note.trim().length < 2}>Add note</Button></div>
                </form>
              )}
            </CardContent>
          </Card>
        </div>
        <div className="space-y-4">
          <Card>
            <CardHeader><CardTitle>Case details</CardTitle></CardHeader>
            <CardContent className="space-y-4">
              <DescList cols={1} items={[
                ['Driver involved', i.driver ? <Link to={`/drivers/${i.driver.id}`} className="inline-flex items-center gap-1 text-primary hover:underline"><User className="size-3.5" />{i.driver.fullName} · {i.driver.driverCode}</Link> : '—'],
                ['Reported by', i.complainantName ? <span>{i.complainantName}{i.complainantPhone && <span className="block text-muted-foreground">{i.complainantPhone}</span>}</span> : '—'],
                ['Logged', `${fmtDateTime(i.createdAt)}${i.reportedBy ? ` by ${i.reportedBy.fullName}` : ''}`],
              ]} />
              {manage && !closed ? (
                <div className="space-y-3 border-t pt-4">
                  <Field label="Handled by" name="assign">
                    <Select id="assign" value={i.assignedTo?.id ?? ''} disabled={busy === 'patch'} onChange={(e) => patch({ assignedToId: e.target.value || null }, e.target.value ? 'Case assigned' : 'Case unassigned')}>
                      <option value="">Nobody yet</option>{assignees.data?.map((a) => <option key={a.id} value={a.id}>{a.fullName}</option>)}
                    </Select>
                  </Field>
                  <Field label="Severity" name="sev">
                    <Select id="sev" value={i.severity} disabled={busy === 'patch'} onChange={(e) => patch({ severity: e.target.value }, 'Severity updated')}>{Object.entries(SEVERITY).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select>
                  </Field>
                  {i.status === 'OPEN' && <Button variant="outline" size="sm" className="w-full" loading={busy === 'patch'} onClick={() => patch({ status: 'INVESTIGATING' }, 'Marked as investigating')}>Start investigating</Button>}
                </div>
              ) : <DescList cols={1} items={[['Handled by', i.assignedTo?.fullName ?? '—']]} />}
              {i.driver && i.status === 'RESOLVED' && i.disciplinaryAction && can('drivers.status') && i.driver.status !== 'SUSPENDED' && (
                <p className="rounded-md bg-muted p-2 text-xs text-muted-foreground">To suspend the driver, use <Link to={`/drivers/${i.driver.id}`} className="text-primary hover:underline">Change status on their profile</Link>.</p>
              )}
            </CardContent>
          </Card>
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0">
              <CardTitle>Photos and files</CardTitle>
              {manage && !closed && <>
                <input ref={fileRef} type="file" accept="image/jpeg,image/png,image/webp,application/pdf" className="hidden" onChange={(e) => e.target.files?.[0] && upload(e.target.files[0])} />
                <Button size="sm" variant="outline" loading={busy === 'upload'} onClick={() => fileRef.current?.click()}><Paperclip /> Attach</Button>
              </>}
            </CardHeader>
            <CardContent>
              {i.attachments.length === 0 ? <p className="text-sm text-muted-foreground">Photos, blotter copies, written statements.</p> : (
                <ul className="divide-y text-sm">
                  {i.attachments.map((a) => (
                    <li key={a.id} className="flex items-center justify-between gap-2 py-2">
                      <span className="min-w-0 truncate">{a.fileName}</span>
                      <span className="flex shrink-0 gap-1">
                        <Button variant="ghost" size="icon" className="size-8" aria-label={`Open ${a.fileName}`} onClick={() => open(a.id)}><Eye /></Button>
                        {manage && !closed && <Button variant="ghost" size="icon" className="size-8" aria-label={`Remove ${a.fileName}`} disabled={busy === 'rm'} onClick={() => removeFile(a.id)}><Trash2 /></Button>}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
            </CardContent>
          </Card>
        </div>
      </div>
      <CloseDialog outcome={closing} onClose={() => setClosing(null)} incident={i} onDone={(r) => { apply(r); setClosing(null); }} />
      <ReopenDialog open={reopen} onOpenChange={setReopen} incident={i} onDone={(r) => { apply(r); setReopen(false); }} />
    </div>
  );
}

function CloseDialog({ outcome, onClose, incident: i, onDone }: { outcome: 'RESOLVED' | 'DISMISSED' | null; onClose: () => void; incident: Incident; onDone: (r: Incident) => void }) {
  const [resolution, setResolution] = useState('');
  const [action, setAction] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  useEffect(() => { if (outcome) { setResolution(''); setAction(''); setErrors({}); } }, [outcome]);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true); setErrors({});
    try { onDone(await api.post<Incident>(`/incidents/${i.id}/resolve`, { outcome, resolution, disciplinaryAction: action })); toast.success(outcome === 'RESOLVED' ? 'Case resolved' : 'Case dismissed'); }
    catch (err) { if (err instanceof ApiError && err.fields) setErrors(err.fields); toast.error((err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={!!outcome} onOpenChange={(o) => !o && onClose()} title={outcome === 'RESOLVED' ? `Resolve ${i.caseNo}` : `Dismiss ${i.caseNo}`} description={outcome === 'RESOLVED' ? 'Record how the case was settled. This closes the case.' : 'Record why no action is needed. This closes the case.'}>
      <form onSubmit={submit} className="space-y-4">
        <Field label={outcome === 'RESOLVED' ? 'How it was settled' : 'Why it is dismissed'} name="resolution" required error={errors.resolution}><Textarea id="resolution" rows={4} value={resolution} onChange={(e) => setResolution(e.target.value)} /></Field>
        {outcome === 'RESOLVED' && i.driver && <Field label="Action taken against the driver" name="disciplinaryAction" hint="Optional, e.g. warning, penalty, suspension. A penalty can be billed under Finance → Add charge." error={errors.disciplinaryAction}><Input id="disciplinaryAction" value={action} onChange={(e) => setAction(e.target.value)} /></Field>}
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          <Button type="submit" loading={busy}>{outcome === 'RESOLVED' ? 'Resolve case' : 'Dismiss case'}</Button>
        </div>
      </form>
    </Dialog>
  );
}

function ReopenDialog({ open, onOpenChange, incident: i, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; incident: Incident; onDone: (r: Incident) => void }) {
  const [reason, setReason] = useState('');
  const [busy, setBusy] = useState(false);
  const submit = async (e: FormEvent) => {
    e.preventDefault(); setBusy(true);
    try { onDone(await api.post<Incident>(`/incidents/${i.id}/reopen`, { reason })); setReason(''); toast.success('Case reopened'); }
    catch (err) { toast.error(err instanceof ApiError && err.fields?.reason ? err.fields.reason : (err as Error).message); }
    finally { setBusy(false); }
  };
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={`Reopen ${i.caseNo}?`} description="The reason is added to the case notes.">
      <form onSubmit={submit} className="space-y-4">
        <Field label="Reason" name="reason" required><Textarea id="reason" value={reason} onChange={(e) => setReason(e.target.value)} placeholder="e.g. Complainant came back with new evidence" /></Field>
        <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button type="submit" loading={busy}>Reopen case</Button>
        </div>
      </form>
    </Dialog>
  );
}
