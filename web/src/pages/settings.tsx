import { useSearchParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { toast } from 'sonner';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { fmtDateTime, relTime } from '@/lib/utils';
import { Button } from '@/components/ui/button';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, DescList, PageHeader, Skeleton } from '@/components/ui/misc';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs';
import { ChangePasswordForm } from './auth';


function SecurityTab() {
  const sessions = useQuery({ queryKey: ['my-sessions'], queryFn: () => api.get<{ id: string; userAgent: string | null; ipAddress: string | null; lastUsedAt: string; createdAt: string; current: boolean }[]>('/auth/sessions') });
  const history = useQuery({ queryKey: ['my-logins'], queryFn: () => api.get<{ id: string; success: boolean; reason: string | null; ipAddress: string | null; createdAt: string }[]>('/auth/login-history') });
  return (
    <div className="grid gap-4 lg:grid-cols-2">
      <Card><CardHeader><CardTitle>Change password</CardTitle><CardDescription>You'll stay signed in here; other devices are signed out.</CardDescription></CardHeader><CardContent className="max-w-sm"><ChangePasswordForm /></CardContent></Card>
      <div className="space-y-4">
        <Card><CardHeader><CardTitle>Active sessions</CardTitle></CardHeader><CardContent>
          {!sessions.data ? <Skeleton className="h-24" /> : (
            <ul className="divide-y text-sm">{sessions.data.map((s) => (
              <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                <div className="min-w-0"><div className="truncate">{s.userAgent ?? 'Unknown device'}</div><div className="text-xs text-muted-foreground">{s.ipAddress} · active {relTime(s.lastUsedAt)}</div></div>
                {s.current ? <Badge tone="green">This device</Badge> : <Button size="sm" variant="outline" onClick={async () => { await api.del(`/auth/sessions/${s.id}`); toast.success('Session ended'); sessions.refetch(); }}>Sign out</Button>}
              </li>
            ))}</ul>
          )}
        </CardContent></Card>
        <Card><CardHeader><CardTitle>Recent sign-ins</CardTitle></CardHeader><CardContent>
          {!history.data ? <Skeleton className="h-24" /> : (
            <ul className="max-h-72 divide-y overflow-y-auto text-sm">{history.data.map((l) => (
              <li key={l.id} className="flex items-center justify-between py-2"><span>{fmtDateTime(l.createdAt)} <span className="text-xs text-muted-foreground">{l.ipAddress}</span></span>{l.success ? <Badge tone="green">Success</Badge> : <Badge tone="red">{l.reason ?? 'Failed'}</Badge>}</li>
            ))}</ul>
          )}
        </CardContent></Card>
      </div>
    </div>
  );
}

export default function SettingsPage() {
  const { user } = useAuth();
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') ?? 'account';
  return (
    <div>
      <PageHeader title="Settings" />
      <Tabs value={tab} onValueChange={(t) => setSp({ tab: t }, { replace: true })}>
        <TabsList><TabsTrigger value="account">My account</TabsTrigger><TabsTrigger value="security">Password & sessions</TabsTrigger></TabsList>
        <TabsContent value="account">
          <Card className="max-w-3xl"><CardHeader><CardTitle>My account</CardTitle><CardDescription>Ask an administrator to change your name, email or role.</CardDescription></CardHeader><CardContent>
            <DescList items={[['Name', user?.fullName], ['Email', user?.email], ['Mobile', user?.phone], ['Role', user?.role.name], ['TODA', user?.association?.name ?? 'Full access']]} />
            <div className="mt-6">
              <div className="mb-2 text-xs font-medium uppercase tracking-wide text-muted-foreground">What you can do</div>
              <div className="flex flex-wrap gap-1">{user?.permissions.map((p) => <Badge key={p} tone="gray">{p}</Badge>)}</div>
            </div>
          </CardContent></Card>
        </TabsContent>
        <TabsContent value="security"><SecurityTab /></TabsContent>
      </Tabs>
    </div>
  );
}
