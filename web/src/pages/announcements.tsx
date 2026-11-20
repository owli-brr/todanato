import { useEffect, useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Archive, Megaphone, MoreHorizontal, Pencil, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { api, ApiError, qs, type Paged } from '@/lib/api';
import { useDebounced } from '@/lib/hooks';
import { cn, fmtDateTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Select, Textarea } from '@/components/ui/form';
import { Badge, Card, EmptyState, ErrorState, PageHeader, Skeleton, type Tone } from '@/components/ui/misc';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/components/ui/tabs';
import { SearchBox, Toolbar } from '@/components/shared';

export interface Announcement {
  id: string; title: string; body: string; priority: 'NORMAL' | 'IMPORTANT' | 'EMERGENCY'; audience: string; status: string;
  state: 'DRAFT' | 'SCHEDULED' | 'LIVE' | 'EXPIRED' | 'ARCHIVED'; publishAt: string | null; expiresAt: string | null; createdAt: string; updatedAt: string; author: string;
}

export const AUDIENCE: Record<string, string> = { ALL_DRIVERS: 'Drivers', OFFICERS: 'Officers and staff', EVERYONE: 'Everyone' };
const STATE: Record<Announcement['state'], [string, Tone]> = {
  DRAFT: ['Draft', 'gray'], SCHEDULED: ['Scheduled', 'blue'], LIVE: ['Live', 'green'], EXPIRED: ['Ended', 'gray'], ARCHIVED: ['Taken down', 'gray'],
};
export const PRIORITY: Record<Announcement['priority'], [string, Tone]> = { NORMAL: ['Normal', 'gray'], IMPORTANT: ['Important', 'amber'], EMERGENCY: ['Urgent', 'red'] };

/** Announcement card used on the dashboard and in the driver portal. */
export function AnnouncementItem({ a }: { a: Pick<Announcement, 'title' | 'body' | 'priority' | 'publishAt' | 'createdAt'> }) {
  return (
    <div className={cn('rounded-md border p-3', a.priority === 'EMERGENCY' && 'border-red-300 bg-red-50 dark:border-red-500/30 dark:bg-red-500/10', a.priority === 'IMPORTANT' && 'border-amber-300 bg-amber-50 dark:border-amber-500/30 dark:bg-amber-500/10')}>
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-medium">{a.title}</span>
        {a.priority !== 'NORMAL' && <Badge tone={PRIORITY[a.priority][1]}>{PRIORITY[a.priority][0]}</Badge>}
      </div>
      <p className="mt-1 whitespace-pre-line text-sm text-muted-foreground">{a.body}</p>
      <p className="mt-1.5 text-xs text-muted-foreground">{fmtDateTime(a.publishAt ?? a.createdAt)}</p>
    </div>
  );
}

const STATES = ['', 'LIVE', 'SCHEDULED', 'DRAFT', 'EXPIRED', 'ARCHIVED'] as const;

export default function AnnouncementsPage() {
  const qc = useQueryClient();
  const [state, setState] = useState('');
  const [q, setQ] = useState('');
  const dq = useDebounced(q);
  const query = { state, q: dq, pageSize: 50 };
  const { data, error, refetch } = useQuery({ queryKey: ['announcements', query], queryFn: () => api.get<Paged<Announcement>>(`/announcements${qs(query)}`), placeholderData: (p) => p });
  const [edit, setEdit] = useState<Announcement | 'new' | null>(null);
  const [del, setDel] = useState<Announcement | null>(null);
  const refresh = () => qc.invalidateQueries({ queryKey: ['announcements'] });
  const archive = async (a: Announcement, archived: boolean) => {
    try { await api.post(`/announcements/${a.id}/archive`, { archived }); toast.success(archived ? 'Announcement taken down' : 'Announcement restored'); refresh(); }
    catch (e) { toast.error((e as Error).message); }
  };
  return (
    <div>
      <PageHeader title="Announcements" description="Post notices to drivers (they see them in the driver portal), to officers and staff, or to everyone." actions={<Button onClick={() => setEdit('new')}><Plus /> New announcement</Button>} />
      <Card>
        <Toolbar>
          <SearchBox value={q} onChange={setQ} placeholder="Search announcements…" />
          <Select value={state} onChange={(e) => setState(e.target.value)} aria-label="State" className="sm:w-40">
            {STATES.map((s) => <option key={s} value={s}>{s ? STATE[s][0] : 'All'}</option>)}
          </Select>
        </Toolbar>
        {error ? <ErrorState error={error} onRetry={refetch} /> : !data ? <div className="space-y-2 p-4">{Array.from({ length: 4 }).map((_, i) => <Skeleton key={i} className="h-20" />)}</div> : data.items.length === 0 ? (
          <EmptyState icon={Megaphone} title="No announcements" description={state || q ? 'Try a different filter.' : 'Post the first one.'} />
        ) : (
          <ul className="divide-y">
            {data.items.map((a) => (
              <li key={a.id} className="flex gap-3 p-4">
                <div className="min-w-0 flex-1">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="font-medium">{a.title}</span>
                    <Badge tone={STATE[a.state][1]}>{STATE[a.state][0]}</Badge>
                    {a.priority !== 'NORMAL' && <Badge tone={PRIORITY[a.priority][1]}>{PRIORITY[a.priority][0]}</Badge>}
                    <span className="text-xs text-muted-foreground">To {AUDIENCE[a.audience] ?? a.audience}</span>
                  </div>
                  <p className="mt-1 line-clamp-2 whitespace-pre-line text-sm text-muted-foreground">{a.body}</p>
                  <p className="mt-1 text-xs text-muted-foreground">
                    {a.state === 'DRAFT' ? `Draft by ${a.author}, last edited ${fmtDateTime(a.updatedAt)}` : `${a.state === 'SCHEDULED' ? 'Goes live' : 'Posted'} ${fmtDateTime(a.publishAt)} by ${a.author}`}
                    {a.expiresAt && ` · ${a.state === 'EXPIRED' ? 'ended' : 'until'} ${fmtDateTime(a.expiresAt)}`}
                  </p>
                </div>
                <Menu>
                  <MenuTrigger asChild><Button variant="ghost" size="icon" aria-label="Actions"><MoreHorizontal /></Button></MenuTrigger>
                  <MenuContent>
                    {a.state !== 'ARCHIVED' && <MenuItem onSelect={() => setEdit(a)}><Pencil /> Edit</MenuItem>}
                    {a.state !== 'DRAFT' && a.state !== 'ARCHIVED' && <MenuItem onSelect={() => archive(a, true)}><Archive /> Take down</MenuItem>}
                    {a.state === 'ARCHIVED' && <MenuItem onSelect={() => archive(a, false)}><RotateCcw /> Restore</MenuItem>}
                    {a.state === 'DRAFT' && <MenuItem danger onSelect={() => setDel(a)}><Trash2 /> Delete draft</MenuItem>}
                  </MenuContent>
                </Menu>
              </li>
            ))}
          </ul>
        )}
      </Card>
      <EditDialog value={edit} onClose={() => setEdit(null)} onDone={() => { setEdit(null); refresh(); }} />
      <ConfirmDialog open={!!del} onOpenChange={(o) => !o && setDel(null)} tone="destructive" confirmLabel="Delete" title="Delete this draft?" description={del?.title ?? ''}
        onConfirm={async () => { try { await api.del(`/announcements/${del!.id}`); toast.success('Draft deleted'); setDel(null); refresh(); } catch (e) { toast.error((e as Error).message); } }} />
    </div>
  );
}

const localInput = (d: string | Date | null) => {
  if (!d) return '';
  const x = new Date(d);
  return new Date(x.getTime() - x.getTimezoneOffset() * 60000).toISOString().slice(0, 16);
};

function EditDialog({ value, onClose, onDone }: { value: Announcement | 'new' | null; onClose: () => void; onDone: () => void }) {
  const blank = { title: '', body: '', priority: 'NORMAL', audience: 'ALL_DRIVERS', when: 'now', publishAt: '', expiresAt: '' };
  const [v, setV] = useState(blank);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);
  const existing = value && value !== 'new' ? value : null;
  const published = !!existing && existing.state !== 'DRAFT';
  useEffect(() => {
    setErrors({});
    if (value === 'new') setV(blank);
    else if (value) setV({ title: value.title, body: value.body, priority: value.priority, audience: value.audience, when: value.publishAt && new Date(value.publishAt) > new Date() ? 'later' : 'now', publishAt: localInput(value.publishAt), expiresAt: localInput(value.expiresAt) });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value]);
  const save = async (publish: boolean) => {
    setBusy(publish ? 'publish' : 'draft'); setErrors({});
    const payload = {
      title: v.title, body: v.body, priority: v.priority, audience: v.audience, publish,
      // "Right away": keep the original posting time if it is already live, otherwise now.
      publishAt: v.when === 'later' ? (v.publishAt ? new Date(v.publishAt).toISOString() : null)
        : !publish ? null
        : existing?.publishAt && new Date(existing.publishAt) <= new Date() ? existing.publishAt : new Date().toISOString(),
      expiresAt: v.expiresAt ? new Date(v.expiresAt).toISOString() : null,
    };
    if (v.when === 'later' && !v.publishAt) { setErrors({ publishAt: 'Choose when it goes live' }); setBusy(null); return; }
    try {
      if (existing) await api.patch(`/announcements/${existing.id}`, payload); else await api.post('/announcements', payload);
      toast.success(publish ? (v.when === 'later' ? 'Announcement scheduled' : 'Announcement posted') : 'Draft saved'); onDone();
    } catch (err) { if (err instanceof ApiError && err.fields) setErrors(err.fields); toast.error((err as Error).message); }
    finally { setBusy(null); }
  };
  const submit = (e: FormEvent) => { e.preventDefault(); save(true); };
  const set = (k: keyof typeof v) => (e: { target: { value: string } }) => setV({ ...v, [k]: e.target.value });
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()} title={existing ? 'Edit announcement' : 'New announcement'} className="max-w-xl">
      <form onSubmit={submit} className="grid gap-4 sm:grid-cols-2">
        <Field label="Title" name="title" required error={errors.title} className="sm:col-span-2"><Input id="title" value={v.title} onChange={set('title')} maxLength={120} /></Field>
        <Field label="Message" name="body" required error={errors.body} className="sm:col-span-2"><Textarea id="body" rows={6} value={v.body} onChange={set('body')} maxLength={5000} /></Field>
        <Field label="Who sees it" name="audience" required error={errors.audience}>
          <Select id="audience" value={v.audience} onChange={set('audience')}>{Object.entries(AUDIENCE).map(([k, l]) => <option key={k} value={k}>{l}</option>)}</Select>
        </Field>
        <Field label="Priority" name="priority">
          <Select id="priority" value={v.priority} onChange={set('priority')}><option value="NORMAL">Normal</option><option value="IMPORTANT">Important (highlighted)</option><option value="EMERGENCY">Urgent (shown first, in red)</option></Select>
        </Field>
        <Field label="Goes live" name="when">
          <Select id="when" value={v.when} onChange={set('when')}><option value="now">Right away</option><option value="later">At a set time</option></Select>
        </Field>
        {v.when === 'later' ? (
          <Field label="Live from" name="publishAt" required error={errors.publishAt}><Input id="publishAt" type="datetime-local" value={v.publishAt} onChange={set('publishAt')} /></Field>
        ) : <div className="hidden sm:block" />}
        <Field label="Take down automatically" name="expiresAt" error={errors.expiresAt} hint="Optional. Leave empty to keep it up until you take it down."><Input id="expiresAt" type="datetime-local" value={v.expiresAt} onChange={set('expiresAt')} /></Field>
        <div className="flex flex-col-reverse gap-2 sm:col-span-2 sm:flex-row sm:justify-end">
          <Button type="button" variant="outline" onClick={onClose}>Cancel</Button>
          {!published && <Button type="button" variant="outline" loading={busy === 'draft'} onClick={() => save(false)}>Save draft</Button>}
          <Button type="submit" loading={busy === 'publish'}>{published ? 'Save changes' : v.when === 'later' ? 'Schedule' : 'Post now'}</Button>
        </div>
      </form>
    </Dialog>
  );
}
