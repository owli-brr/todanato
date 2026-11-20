import { useEffect, useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { toast } from 'sonner';
import { Plus, MoreHorizontal, KeyRound, Power, LogOut, Edit, Copy, ShieldCheck, Save } from 'lucide-react';
import { api, qs, type Paged } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { useDebounced, useForm, useListParams } from '@/lib/hooks';
import { fmtDateTime, relTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { ConfirmDialog, Dialog } from '@/components/ui/dialog';
import { Field, Input, Select } from '@/components/ui/form';
import { Avatar, Badge, Card, CardContent, CardHeader, CardTitle, ErrorState, PageHeader, Skeleton, StatusBadge } from '@/components/ui/misc';
import { DataTable, Pagination, type Column } from '@/components/ui/table';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger, Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { AssociationSelect, SearchBox, Toolbar } from '@/components/shared';

interface Role { id: string; key: string; name: string; description: string | null; scope: string; userCount: number; permissions: string[] }
interface UserRow { id: string; email: string; fullName: string; phone: string | null; isActive: boolean; lastLoginAt: string | null; lockedUntil: string | null; role: { id: string; key: string; name: string; scope: string }; association: { id: string; name: string; code: string } | null }
interface UserDetail extends UserRow { loginHistory: { id: string; success: boolean; reason: string | null; ipAddress: string | null; userAgent: string | null; createdAt: string }[]; sessions: { id: string; userAgent: string | null; ipAddress: string | null; lastUsedAt: string }[] }

const useRoles = () => useQuery({ queryKey: ['roles'], queryFn: () => api.get<Role[]>('/roles') });

function TempPassword({ value, onClose }: { value: string | null; onClose: () => void }) {
  return (
    <Dialog open={!!value} onOpenChange={(o) => !o && onClose()} title="Temporary password" description="Give this to the user privately. They must change it when they first sign in. It won't be shown again."
      footer={<Button onClick={onClose}>Done</Button>}>
      <div className="flex items-center gap-2 rounded-md border bg-muted p-3 font-mono text-sm">
        <span className="flex-1 break-all">{value}</span>
        <Button size="sm" variant="outline" onClick={() => { navigator.clipboard.writeText(value ?? ''); toast.success('Copied'); }}><Copy /> Copy</Button>
      </div>
    </Dialog>
  );
}

function UserDialog({ user, open, onOpenChange, onSaved }: { user: UserRow | null; open: boolean; onOpenChange: (o: boolean) => void; onSaved: (temp?: string) => void }) {
  const { data: roles } = useRoles();
  const { user: me } = useAuth();
  const f = useForm({ fullName: '', email: '', phone: '', roleId: '', associationId: '' });
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    if (open) f.setValues({ fullName: user?.fullName ?? '', email: user?.email ?? '', phone: user?.phone ?? '', roleId: user?.role.id ?? '', associationId: user?.association?.id ?? (me?.role.scope === 'ASSOCIATION' ? me.association?.id ?? '' : '') });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open, user]);
  const role = roles?.find((r) => r.id === f.values.roleId);
  return (
    <Dialog open={open} onOpenChange={onOpenChange} title={user ? 'Edit user' : 'Add user'} description={user ? undefined : 'A temporary password is generated. The user sets their own on first sign-in.'}
      footer={<><Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button><Button loading={busy} onClick={async () => {
        setBusy(true);
        try {
          const body = { ...f.values, phone: f.values.phone || null, associationId: f.values.associationId || null };
          if (user) { await api.patch(`/users/${user.id}`, body); toast.success('User updated'); onSaved(); }
          else { const r = await api.post<{ temporaryPassword?: string }>('/users', body); toast.success('User created'); onSaved(r.temporaryPassword); }
          onOpenChange(false);
        } catch (e) { const err = e as { fields?: Record<string, string>; message: string }; if (err.fields) f.setErrors(err.fields); toast.error(err.message); }
        finally { setBusy(false); }
      }}>{user ? 'Save' : 'Create user'}</Button></>}>
      <div className="grid gap-4">
        <Field label="Full name" name="fullName" required error={f.errors.fullName}><Input {...f.bind('fullName')} /></Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Email" name="email" required error={f.errors.email}><Input type="email" {...f.bind('email')} /></Field>
          <Field label="Mobile" name="phone" error={f.errors.phone}><Input type="tel" {...f.bind('phone')} /></Field>
        </div>
        <Field label="Role" name="roleId" required error={f.errors.roleId}>
          <Select {...f.bind('roleId')} disabled={user?.id === me?.id}><option value="">Choose a role…</option>{roles?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
        </Field>
        {role?.description && <p className="-mt-2 text-xs text-muted-foreground">{role.description}</p>}
        {role?.scope === 'ASSOCIATION' && (
          <Field label="Association" name="associationId" required error={f.errors.associationId} hint="This user will only see this association's records.">
            {me?.role.scope === 'ASSOCIATION' ? <Input value={me.association?.name ?? ''} disabled /> : <AssociationSelect id="associationId" value={f.values.associationId} onChange={(v) => f.set('associationId', v)} allLabel="Choose…" invalid={!!f.errors.associationId} />}
          </Field>
        )}
      </div>
    </Dialog>
  );
}

function UserDetailDialog({ id, onClose }: { id: string | null; onClose: () => void }) {
  const { data } = useQuery({ queryKey: ['user', id], queryFn: () => api.get<UserDetail>(`/users/${id}`), enabled: !!id });
  return (
    <Dialog open={!!id} onOpenChange={(o) => !o && onClose()} title={data?.fullName ?? 'User'} description={data?.email} className="max-w-2xl">
      {!data ? <Skeleton className="h-48" /> : (
        <div className="space-y-5">
          <div className="flex flex-wrap gap-2 text-sm"><Badge tone="blue">{data.role.name}</Badge>{data.association && <Badge>{data.association.name}</Badge>}<StatusBadge status={data.isActive ? 'ACTIVE' : 'INACTIVE'} /></div>
          {data.sessions.length > 0 && (
            <div><h4 className="mb-2 text-sm font-semibold">Active sessions</h4>
              <ul className="divide-y rounded-md border text-sm">{data.sessions.map((s) => <li key={s.id} className="px-3 py-2"><div className="truncate">{s.userAgent ?? 'Unknown device'}</div><div className="text-xs text-muted-foreground">{s.ipAddress} · last active {relTime(s.lastUsedAt)}</div></li>)}</ul>
            </div>
          )}
          <div><h4 className="mb-2 text-sm font-semibold">Login history</h4>
            {data.loginHistory.length === 0 ? <p className="text-sm text-muted-foreground">No sign-ins yet.</p> : (
              <ul className="max-h-64 divide-y overflow-y-auto rounded-md border text-sm">{data.loginHistory.map((l) => (
                <li key={l.id} className="flex items-center justify-between gap-2 px-3 py-2"><div className="min-w-0"><div>{fmtDateTime(l.createdAt)}</div><div className="truncate text-xs text-muted-foreground">{l.ipAddress} · {l.userAgent}</div></div>{l.success ? <Badge tone="green">Success</Badge> : <Badge tone="red">{l.reason ?? 'Failed'}</Badge>}</li>
              ))}</ul>
            )}
          </div>
        </div>
      )}
    </Dialog>
  );
}

function UsersTab() {
  const { can, user: me } = useAuth();
  const qc = useQueryClient();
  const lp = useListParams({ sort: 'fullName', dir: 'asc' });
  const [q, setQ] = useState(lp.get('q'));
  const dq = useDebounced(q);
  useEffect(() => { if (dq !== lp.get('q')) lp.set({ q: dq }); /* eslint-disable-next-line react-hooks/exhaustive-deps */ }, [dq]);
  const { data: roles } = useRoles();
  const query = { q: lp.get('q'), roleId: lp.get('roleId'), status: lp.get('status'), sort: lp.get('sort'), dir: lp.get('dir'), page: lp.page, pageSize: 20 };
  const { data, isLoading, isFetching, error, refetch } = useQuery({ queryKey: ['users', query], queryFn: () => api.get<Paged<UserRow>>(`/users${qs(query)}`), placeholderData: (p) => p });
  const [edit, setEdit] = useState<{ user: UserRow | null } | null>(null);
  const [temp, setTemp] = useState<string | null>(null);
  const [detail, setDetail] = useState<string | null>(null);
  const [confirm, setConfirm] = useState<{ kind: 'toggle' | 'reset' | 'signout'; u: UserRow } | null>(null);
  const reload = () => { qc.invalidateQueries({ queryKey: ['users'] }); qc.invalidateQueries({ queryKey: ['roles'] }); };

  const columns: Column<UserRow>[] = [
    { key: 'fullName', header: 'User', sortable: true, cell: (u) => <div className="flex items-center gap-3"><Avatar name={u.fullName} /><div className="min-w-0"><div className="truncate font-medium">{u.fullName}{u.id === me?.id && <span className="ml-1 text-xs text-muted-foreground">(you)</span>}</div><div className="truncate text-xs text-muted-foreground">{u.email}</div></div></div> },
    { key: 'role', header: 'Role', cell: (u) => <div><div>{u.role.name}</div>{u.association && <div className="text-xs text-muted-foreground">{u.association.name}</div>}</div> },
    { key: 'lastLoginAt', header: 'Last sign-in', sortable: true, hideBelow: 'md', cell: (u) => <span className="text-muted-foreground">{relTime(u.lastLoginAt)}</span> },
    { key: 'status', header: 'Status', cell: (u) => <div className="flex gap-1"><StatusBadge status={u.isActive ? 'ACTIVE' : 'INACTIVE'} />{u.lockedUntil && new Date(u.lockedUntil) > new Date() && <Badge tone="red">Locked</Badge>}</div> },
    {
      key: 'actions', header: '', className: 'w-12', cell: (u) => can('users.manage') && u.id !== me?.id ? (
        <div onClick={(e) => e.stopPropagation()}>
          <Menu><MenuTrigger asChild><Button variant="ghost" size="icon" className="size-8" aria-label="User actions"><MoreHorizontal /></Button></MenuTrigger>
            <MenuContent>
              <MenuItem onSelect={() => setEdit({ user: u })}><Edit /> Edit</MenuItem>
              <MenuItem onSelect={() => setConfirm({ kind: 'reset', u })}><KeyRound /> Reset password</MenuItem>
              {can('sessions.manage') && <MenuItem onSelect={() => setConfirm({ kind: 'signout', u })}><LogOut /> Sign out everywhere</MenuItem>}
              <MenuSeparator />
              <MenuItem danger={u.isActive} onSelect={() => setConfirm({ kind: 'toggle', u })}><Power /> {u.isActive ? 'Deactivate' : 'Activate'}</MenuItem>
            </MenuContent>
          </Menu>
        </div>
      ) : null,
    },
  ];

  const copy = confirm && {
    toggle: [confirm.u.isActive ? 'Deactivate user?' : 'Activate user?', confirm.u.isActive ? `${confirm.u.fullName} will be signed out and can no longer sign in.` : `${confirm.u.fullName} will be able to sign in again.`, confirm.u.isActive ? 'Deactivate' : 'Activate'],
    reset: ['Reset password?', `A new temporary password will be generated for ${confirm.u.fullName} and all their sessions end.`, 'Reset password'],
    signout: ['Sign out everywhere?', `${confirm.u.fullName} will be signed out of every device.`, 'Sign out'],
  }[confirm.kind];

  return (
    <Card>
      <Toolbar>
        <SearchBox value={q} onChange={setQ} placeholder="Search name or email…" />
        <Select value={lp.get('roleId')} onChange={(e) => lp.set({ roleId: e.target.value })} className="sm:w-52" aria-label="Role"><option value="">All roles</option>{roles?.map((r) => <option key={r.id} value={r.id}>{r.name}</option>)}</Select>
        <Select value={lp.get('status')} onChange={(e) => lp.set({ status: e.target.value })} className="sm:w-36" aria-label="Status"><option value="">Any status</option><option value="active">Active</option><option value="inactive">Inactive</option></Select>
        <div className="sm:ml-auto">{can('users.manage') && <Button onClick={() => setEdit({ user: null })}><Plus /> Add user</Button>}</div>
      </Toolbar>
      <DataTable columns={columns} rows={data?.items} loading={isLoading || isFetching} error={error} onRetry={refetch} sort={lp.get('sort')} dir={lp.get('dir') as 'asc' | 'desc'} onSort={lp.toggleSort} onRowClick={(u) => setDetail(u.id)} />
      {data && <Pagination page={data.page} pages={data.pages} total={data.total} pageSize={data.pageSize} onPage={(p) => lp.set({ page: String(p) }, false)} />}
      <UserDialog open={!!edit} user={edit?.user ?? null} onOpenChange={(o) => !o && setEdit(null)} onSaved={(t) => { reload(); if (t) setTemp(t); }} />
      <TempPassword value={temp} onClose={() => setTemp(null)} />
      <UserDetailDialog id={detail} onClose={() => setDetail(null)} />
      {confirm && copy && (
        <ConfirmDialog open onOpenChange={(o) => !o && setConfirm(null)} title={copy[0]} description={copy[1]} confirmLabel={copy[2]} tone={confirm.kind === 'toggle' && !confirm.u.isActive ? 'default' : 'destructive'}
          onConfirm={async () => {
            try {
              if (confirm.kind === 'toggle') { await api.post(`/users/${confirm.u.id}/status`, { active: !confirm.u.isActive }); toast.success(confirm.u.isActive ? 'User deactivated' : 'User activated'); }
              if (confirm.kind === 'reset') { const r = await api.post<{ temporaryPassword: string }>(`/users/${confirm.u.id}/reset-password`); setTemp(r.temporaryPassword); }
              if (confirm.kind === 'signout') { const r = await api.del<{ revoked: number }>(`/users/${confirm.u.id}/sessions`); toast.success(`Ended ${r.revoked} session(s)`); }
              reload();
            } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); throw e; }
          }} />
      )}
    </Card>
  );
}

function RolesTab() {
  const { can } = useAuth();
  const qc = useQueryClient();
  const { data: roles, error, refetch } = useRoles();
  const { data: catalog } = useQuery({ queryKey: ['permissions'], queryFn: () => api.get<{ key: string; module: string; description: string }[]>('/roles/permissions') });
  const [roleId, setRoleId] = useState('');
  const role = roles?.find((r) => r.id === roleId) ?? roles?.[0];
  const [sel, setSel] = useState<Set<string>>(new Set());
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (role) setSel(new Set(role.permissions)); }, [role]);
  const groups = useMemo(() => {
    const g = new Map<string, { key: string; description: string }[]>();
    catalog?.forEach((p) => g.set(p.module, [...(g.get(p.module) ?? []), p]));
    return [...g.entries()];
  }, [catalog]);
  if (error) return <ErrorState error={error} onRetry={refetch} />;
  if (!roles || !catalog || !role) return <Skeleton className="h-96" />;
  const editable = can('roles.manage') && role.key !== 'SUPER_ADMIN';
  const dirty = role.permissions.length !== sel.size || role.permissions.some((p) => !sel.has(p));
  const scopeText = { GLOBAL: 'All organizations', ORGANIZATION: 'All associations in the organization', ASSOCIATION: 'Only their assigned association' }[role.scope];
  return (
    <div className="grid gap-4 lg:grid-cols-[260px_1fr]">
      <Card className="h-fit p-2">
        <ul>{roles.map((r) => (
          <li key={r.id}><button onClick={() => setRoleId(r.id)} className={`w-full rounded-md px-3 py-2 text-left text-sm ${r.id === role.id ? 'bg-accent font-medium text-accent-foreground' : 'hover:bg-muted'}`}>
            <div className="flex items-center justify-between">{r.name}<span className="text-xs text-muted-foreground">{r.userCount}</span></div>
          </button></li>
        ))}</ul>
      </Card>
      <Card>
        <CardHeader className="flex-row items-start justify-between gap-4 space-y-0">
          <div><CardTitle>{role.name}</CardTitle><p className="mt-1 text-sm text-muted-foreground">{role.description}</p><p className="mt-1 text-xs"><span className="font-medium">Data access:</span> {scopeText}</p></div>
          {editable && <Button disabled={!dirty} loading={saving} onClick={async () => {
            setSaving(true);
            try { await api.put(`/roles/${role.id}/permissions`, { permissions: [...sel] }); toast.success(`Permissions for ${role.name} saved`); qc.invalidateQueries({ queryKey: ['roles'] }); }
            catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); } finally { setSaving(false); }
          }}><Save /> Save changes</Button>}
        </CardHeader>
        <CardContent>
          {role.key === 'SUPER_ADMIN' && <p className="mb-4 rounded-md bg-muted px-3 py-2 text-sm text-muted-foreground">Super Administrators always have every permission.</p>}
          <div className="grid gap-6 md:grid-cols-2">
            {groups.map(([module, perms]) => (
              <fieldset key={module}>
                <legend className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">{module}</legend>
                <ul className="space-y-1.5">{perms.map((p) => (
                  <li key={p.key}><label className="flex items-start gap-2 text-sm">
                    <input type="checkbox" className="mt-0.5 size-4" disabled={!editable} checked={sel.has(p.key)} onChange={(e) => setSel((s) => { const n = new Set(s); if (e.target.checked) n.add(p.key); else n.delete(p.key); return n; })} />
                    <span>{p.description}</span>
                  </label></li>
                ))}</ul>
              </fieldset>
            ))}
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

export default function UsersPage() {
  return (
    <div>
      <PageHeader title="Users & roles" description="Accounts that can sign in to TOMS, and what each role may do." />
      <Tabs defaultValue="users">
        <TabsList><TabsTrigger value="users">Users</TabsTrigger><TabsTrigger value="roles"><ShieldCheck className="size-4" /> Roles & permissions</TabsTrigger></TabsList>
        <TabsContent value="users"><UsersTab /></TabsContent>
        <TabsContent value="roles"><RolesTab /></TabsContent>
      </Tabs>
    </div>
  );
}
