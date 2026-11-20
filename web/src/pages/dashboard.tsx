import { useState, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from 'recharts';
import { Users, Bike, Building2, ClipboardCheck, Route, Wallet, TrendingUp, AlertCircle, ArrowRight, CalendarClock, Radio, Table2, BarChart3 } from 'lucide-react';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { cn, daysUntil, fmtDate, label, num, peso, relTime } from '@/lib/utils';
import { Badge, Card, CardContent, CardDescription, CardHeader, CardTitle, EmptyState, ErrorState, PageHeader, Skeleton, StatusBadge } from '@/components/ui/misc';
import { Button } from '@/components/ui/button';

interface Summary {
  drivers: { total: number; active: number; inactive: number; suspended: number; pending: number; pendingApplications: number };
  vehicles: { total: number; byStatus: Record<string, number> };
  members: number;
  ridesToday: { total: number; pending: number; ongoing: number; completed: number; cancelled: number };
  finance: { collectionsToday: number; transactionsToday: number; monthIncome: number; monthExpenses: number; outstanding: number; outstandingCount: number } | null;
  live: { available: number; onTrip: number; onBreak: number; offline: number };
  licenseExpiringSoon: number;
}
interface Point { bucket: string; label: string; rides: number; completed: number; cancelled: number; fares: number; registrations: number; collections: number | null; expenses: number | null }
interface Feed {
  transactions: { id: string; receiptNo: string; type: string; method: string; amount: number; paidAt: string; driver: string | null; association: string }[];
  activities: { id: string; action: string; entity: string; entityId: string | null; summary: string; userEmail: string | null; createdAt: string }[];
  pending: { drivers: { id: string; driverCode: string; name: string; registeredAt: string; association: string }[]; driverDocuments: number; vehicleDocuments: number };
  expiring: { kind: string; id: string; label: string; document: string; expiresAt: string; link: string }[];
  liveDrivers: { id: string; name: string; availability: string; lastSeen: string | null; association: string | null }[];
}

function Stat({ icon: Icon, label, value, sub, to, tone = 'blue' }: { icon: typeof Users; label: string; value: ReactNode; sub?: ReactNode; to?: string; tone?: 'blue' | 'green' | 'amber' | 'red' | 'slate' }) {
  const body = (
    <Card className={cn('h-full p-4 transition-colors', to && 'hover:border-primary/40')}>
      <div className="flex items-start justify-between gap-2">
        <p className="text-sm text-muted-foreground">{label}</p>
        <div className={cn('rounded-md p-1.5', { blue: 'bg-blue-100 text-blue-700 dark:bg-blue-500/15 dark:text-blue-300', green: 'bg-emerald-100 text-emerald-700 dark:bg-emerald-500/15 dark:text-emerald-300', amber: 'bg-amber-100 text-amber-700 dark:bg-amber-500/15 dark:text-amber-300', red: 'bg-red-100 text-red-700 dark:bg-red-500/15 dark:text-red-300', slate: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300' }[tone])}>
          <Icon className="size-4" />
        </div>
      </div>
      <p className="mt-2 text-2xl font-semibold tracking-tight tabular">{value}</p>
      {sub && <div className="mt-1 text-xs text-muted-foreground">{sub}</div>}
    </Card>
  );
  return to ? <Link to={to} className="block focus:outline-none focus-visible:ring-2 focus-visible:ring-ring rounded-lg">{body}</Link> : body;
}

export function ChartTooltip({ active, payload, label: l, money }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string; money?: boolean }) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-md border bg-popover px-3 py-2 text-xs shadow-md">
      <div className="mb-1 font-medium">{l}</div>
      {payload.map((p) => (
        <div key={p.name} className="flex items-center gap-2">
          <span className="size-2 rounded-sm" style={{ background: p.color }} />
          <span className="text-muted-foreground">{p.name}</span>
          <span className="ml-auto pl-3 font-medium tabular">{money ? peso(p.value) : num(p.value)}</span>
        </div>
      ))}
    </div>
  );
}

export function Legend({ items }: { items: [string, string][] }) {
  return (
    <div className="flex flex-wrap gap-4 text-xs text-muted-foreground">
      {items.map(([name, color]) => (
        <span key={name} className="inline-flex items-center gap-1.5"><span className="size-2.5 rounded-sm" style={{ background: color }} />{name}</span>
      ))}
    </div>
  );
}

function SeriesTable({ data, cols }: { data: Point[]; cols: [keyof Point, string, boolean?][] }) {
  return (
    <div className="max-h-[260px] overflow-auto">
      <table className="w-full text-xs">
        <thead className="sticky top-0 bg-card"><tr className="border-b text-left text-muted-foreground"><th className="py-1.5 pr-2 font-medium">Period</th>{cols.map(([, h]) => <th key={h} className="py-1.5 pr-2 text-right font-medium">{h}</th>)}</tr></thead>
        <tbody>{data.map((d) => <tr key={d.bucket} className="border-b last:border-0"><td className="py-1.5 pr-2">{d.label}</td>{cols.map(([k, h, money]) => <td key={h} className="py-1.5 pr-2 text-right tabular">{money ? peso(d[k] as number) : num(d[k] as number)}</td>)}</tr>)}</tbody>
      </table>
    </div>
  );
}

const PERIODS = [['daily', 'Daily'], ['weekly', 'Weekly'], ['monthly', 'Monthly']] as const;

export default function Dashboard() {
  const { user, can } = useAuth();
  const [period, setPeriod] = useState<'daily' | 'weekly' | 'monthly'>('daily');
  const [asTable, setAsTable] = useState(false);
  const summary = useQuery({ queryKey: ['dashboard', 'summary'], queryFn: () => api.get<Summary>('/dashboard/summary'), refetchInterval: 60_000 });
  const activity = useQuery({ queryKey: ['dashboard', 'activity', period], queryFn: () => api.get<Point[]>(`/dashboard/activity?period=${period}`), placeholderData: (p) => p });
  const feed = useQuery({ queryKey: ['dashboard', 'feed'], queryFn: () => api.get<Feed>('/dashboard/feed'), refetchInterval: 60_000 });
  const s = summary.data;
  const hour = Number(new Intl.DateTimeFormat('en-PH', { hour: 'numeric', hour12: false, timeZone: 'Asia/Manila' }).format(new Date()));
  const greeting = hour < 12 ? 'Magandang umaga' : hour < 18 ? 'Magandang hapon' : 'Magandang gabi';

  const axis = { tick: { fontSize: 11, fill: 'hsl(var(--muted-foreground))' }, tickLine: false, axisLine: false } as const;

  return (
    <div>
      <PageHeader
        title={`${greeting}, ${user?.fullName.split(' ')[0]}`}
        description="Here's what's happening in the TODA today."
      />

      {summary.error ? <Card><ErrorState error={summary.error} onRetry={() => summary.refetch()} /></Card> : (
        <div className="grid grid-cols-2 gap-3 sm:gap-4 lg:grid-cols-4">
          {!s ? Array.from({ length: 8 }).map((_, i) => <Skeleton key={i} className="h-[112px]" />) : (
            <>
              <Stat icon={Users} label="Registered drivers" value={num(s.drivers.total)} to="/drivers"
                sub={<span><span className="text-emerald-600 dark:text-emerald-400">{s.drivers.active} active</span> · {s.drivers.inactive} inactive · <span className="text-red-600 dark:text-red-400">{s.drivers.suspended} suspended</span></span>} />
              <Stat icon={ClipboardCheck} tone="amber" label="Pending applications" value={num(s.drivers.pendingApplications)} to="/drivers?application=PENDING" sub="Waiting for approval" />
              <Stat icon={Bike} label="Registered tricycles" value={num(s.vehicles.total)} to="/vehicles"
                sub={`${s.vehicles.byStatus.OPERATIONAL ?? 0} operational · ${s.vehicles.byStatus.UNDER_MAINTENANCE ?? 0} in maintenance`} />
              <Stat icon={Building2} tone="slate" label="Active members" value={num(s.members)} to="/toda" sub="Of the TODA" />
              <Stat icon={Route} label="Rides today" value={num(s.ridesToday.total)}
                sub={`${s.ridesToday.ongoing} ongoing · ${s.ridesToday.completed} completed · ${s.ridesToday.cancelled} cancelled`} />
              {s.finance ? (
                <>
                  <Stat icon={Wallet} tone="green" label="Collections today" value={peso(s.finance.collectionsToday)} sub={`${s.finance.transactionsToday} transactions`} />
                  <Stat icon={TrendingUp} tone="green" label="Income this month" value={peso(s.finance.monthIncome)} sub={`Net of expenses: ${peso(s.finance.monthIncome - s.finance.monthExpenses)}`} />
                  <Stat icon={AlertCircle} tone="red" label="Outstanding payments" value={peso(s.finance.outstanding)} sub={`${s.finance.outstandingCount} unpaid dues`} />
                </>
              ) : (
                <>
                  <Stat icon={Radio} tone="green" label="Drivers online" value={num(s.live.available + s.live.onTrip + s.live.onBreak)} sub={`${s.live.available} available · ${s.live.onTrip} on trip`} />
                  <Stat icon={CalendarClock} tone="amber" label="Licenses expiring" value={num(s.licenseExpiringSoon)} sub="Within 30 days" to="/drivers?licenseExpiring=true" />
                </>
              )}
            </>
          )}
        </div>
      )}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-2">
        <div className="inline-flex rounded-md border bg-card p-0.5" role="tablist" aria-label="Chart period">
          {PERIODS.map(([k, l]) => (
            <button key={k} role="tab" aria-selected={period === k} onClick={() => setPeriod(k)} className={cn('rounded px-3 py-1 text-sm', period === k ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground')}>{l}</button>
          ))}
        </div>
        <Button variant="ghost" size="sm" onClick={() => setAsTable((t) => !t)}>{asTable ? <><BarChart3 /> Show charts</> : <><Table2 /> Show as table</>}</Button>
      </div>

      <div className={cn('mt-3 grid gap-4', can('finance.read') && 'lg:grid-cols-2')}>
        <Card>
          <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
            <div><CardTitle>Ride activity</CardTitle><CardDescription>Completed and cancelled bookings</CardDescription></div>
            <Legend items={[['Completed', 'var(--c1)'], ['Cancelled', 'var(--c-muted)']]} />
          </CardHeader>
          <CardContent>
            {!activity.data ? <Skeleton className="h-[260px]" /> : asTable ? <SeriesTable data={activity.data} cols={[['completed', 'Completed'], ['cancelled', 'Cancelled'], ['fares', 'Fares', true]]} /> : (
              <ResponsiveContainer width="100%" height={260}>
                <BarChart data={activity.data} margin={{ left: -16, right: 4, top: 8 }} barCategoryGap="22%">
                  <CartesianGrid vertical={false} stroke="var(--grid)" />
                  <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={12} />
                  <YAxis {...axis} allowDecimals={false} />
                  <Tooltip content={<ChartTooltip />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.6 }} />
                  <Bar isAnimationActive={false} dataKey="completed" name="Completed" stackId="r" fill="var(--c1)" stroke="hsl(var(--card))" strokeWidth={1} />
                  <Bar isAnimationActive={false} dataKey="cancelled" name="Cancelled" stackId="r" fill="var(--c-muted)" radius={[4, 4, 0, 0]} stroke="hsl(var(--card))" strokeWidth={1} />
                </BarChart>
              </ResponsiveContainer>
            )}
          </CardContent>
        </Card>
        {can('finance.read') && (
          <Card>
            <CardHeader className="flex-row items-start justify-between gap-2 space-y-0">
              <div><CardTitle>Financial performance</CardTitle><CardDescription>Collections vs expenses</CardDescription></div>
              <Legend items={[['Collections', 'var(--c2)'], ['Expenses', 'var(--c3)']]} />
            </CardHeader>
            <CardContent>
              {!activity.data ? <Skeleton className="h-[260px]" /> : asTable ? <SeriesTable data={activity.data} cols={[['collections', 'Collections', true], ['expenses', 'Expenses', true]]} /> : (
                <ResponsiveContainer width="100%" height={260}>
                  <BarChart data={activity.data} margin={{ left: 0, right: 4, top: 8 }} barGap={2} barCategoryGap="22%">
                    <CartesianGrid vertical={false} stroke="var(--grid)" />
                    <XAxis dataKey="label" {...axis} interval="preserveStartEnd" minTickGap={12} />
                    <YAxis {...axis} tickFormatter={(v) => (v >= 1000 ? `₱${Math.round(v / 1000)}k` : `₱${v}`)} />
                    <Tooltip content={<ChartTooltip money />} cursor={{ fill: 'hsl(var(--muted))', opacity: 0.6 }} />
                    <Bar isAnimationActive={false} dataKey="collections" name="Collections" fill="var(--c2)" radius={[4, 4, 0, 0]} />
                    <Bar isAnimationActive={false} dataKey="expenses" name="Expenses" fill="var(--c3)" radius={[4, 4, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <div className="mt-4 grid gap-4 lg:grid-cols-3">
        <Card>
          <CardHeader className="flex-row items-center justify-between space-y-0">
            <CardTitle>Pending approvals</CardTitle>
            {can('drivers.approve') && <Link to="/drivers?application=PENDING" className="text-xs text-primary hover:underline">View all</Link>}
          </CardHeader>
          <CardContent className="space-y-1">
            {!feed.data ? <Skeleton className="h-40" /> : (
              <>
                {feed.data.pending.drivers.length === 0 && <p className="py-4 text-sm text-muted-foreground">No driver applications waiting.</p>}
                {feed.data.pending.drivers.map((d) => (
                  <Link key={d.id} to={`/drivers/${d.id}`} className="-mx-2 flex items-center justify-between gap-2 rounded-md px-2 py-2 hover:bg-muted/60">
                    <div className="min-w-0">
                      <div className="truncate text-sm font-medium">{d.name}</div>
                      <div className="text-xs text-muted-foreground">Applied {relTime(d.registeredAt)}</div>
                    </div>
                    <ArrowRight className="size-4 shrink-0 text-muted-foreground" />
                  </Link>
                ))}
                {(feed.data.pending.driverDocuments > 0 || feed.data.pending.vehicleDocuments > 0) && (
                  <div className="mt-2 rounded-md bg-muted/60 px-3 py-2 text-xs text-muted-foreground">
                    {feed.data.pending.driverDocuments} driver and {feed.data.pending.vehicleDocuments} vehicle documents await verification.
                  </div>
                )}
              </>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Expiring documents</CardTitle><CardDescription>Within the next 30 days</CardDescription></CardHeader>
          <CardContent>
            {!feed.data ? <Skeleton className="h-40" /> : feed.data.expiring.length === 0 ? <p className="py-4 text-sm text-muted-foreground">Nothing expiring soon.</p> : (
              <ul className="divide-y">
                {feed.data.expiring.map((e, i) => {
                  const d = daysUntil(e.expiresAt)!;
                  return (
                    <li key={i}>
                      <Link to={e.link} className="flex items-center justify-between gap-2 py-2 hover:text-primary">
                        <div className="min-w-0">
                          <div className="truncate text-sm font-medium">{e.label}</div>
                          <div className="text-xs text-muted-foreground">{e.document} · {fmtDate(e.expiresAt)}</div>
                        </div>
                        <Badge tone={d < 0 ? 'red' : d <= 7 ? 'amber' : 'gray'}>{d < 0 ? `Expired ${-d}d ago` : d === 0 ? 'Today' : `${d}d left`}</Badge>
                      </Link>
                    </li>
                  );
                })}
              </ul>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader><CardTitle>Live driver activity</CardTitle><CardDescription>Based on the drivers' app status</CardDescription></CardHeader>
          <CardContent>
            {!s || !feed.data ? <Skeleton className="h-40" /> : (
              <>
                <div className="grid grid-cols-3 gap-2 text-center">
                  {([['Available', s.live.available, 'text-emerald-600 dark:text-emerald-400'], ['On trip', s.live.onTrip, 'text-blue-600 dark:text-blue-400'], ['On break', s.live.onBreak, 'text-amber-600 dark:text-amber-400']] as const).map(([l, v, c]) => (
                    <div key={l} className="rounded-md bg-muted/60 py-2"><div className={cn('text-xl font-semibold tabular', c)}>{v}</div><div className="text-xs text-muted-foreground">{l}</div></div>
                  ))}
                </div>
                <ul className="mt-3 divide-y">
                  {feed.data.liveDrivers.map((d) => (
                    <li key={d.id} className="flex items-center justify-between gap-2 py-2">
                      <Link to={`/drivers/${d.id}`} className="min-w-0 truncate text-sm hover:text-primary">{d.name}</Link>
                      <div className="flex shrink-0 items-center gap-2"><span className="text-xs text-muted-foreground">{relTime(d.lastSeen)}</span><StatusBadge status={d.availability} /></div>
                    </li>
                  ))}
                </ul>
                <p className="mt-2 text-xs text-muted-foreground">The live map arrives with Dispatch in Phase 3.</p>
              </>
            )}
          </CardContent>
        </Card>
      </div>

      <div className={cn('mt-4 grid gap-4', can('finance.read') && can('audit.read') && 'lg:grid-cols-2')}>
        {can('finance.read') && (
          <Card>
            <CardHeader><CardTitle>Recent transactions</CardTitle></CardHeader>
            <CardContent className="px-0 pb-2">
              {!feed.data ? <div className="px-5"><Skeleton className="h-48" /></div> : feed.data.transactions.length === 0 ? <EmptyState title="No transactions yet" /> : (
                <div className="overflow-x-auto">
                  <table className="w-full text-sm">
                    <tbody>
                      {feed.data.transactions.map((t) => (
                        <tr key={t.id} className="border-t">
                          <td className="px-5 py-2.5"><div className="font-medium">{t.driver ?? '—'}</div><div className="text-xs text-muted-foreground">{t.receiptNo}</div></td>
                          <td className="hidden px-2 py-2.5 text-muted-foreground sm:table-cell">{label(t.type)}</td>
                          <td className="hidden px-2 py-2.5 sm:table-cell"><Badge tone={t.method === 'CASH' ? 'gray' : 'blue'}>{label(t.method)}</Badge></td>
                          <td className="px-5 py-2.5 text-right"><div className="font-medium tabular">{peso(t.amount, 2)}</div><div className="text-xs text-muted-foreground">{relTime(t.paidAt)}</div></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>
        )}
        {can('audit.read') && (
          <Card>
            <CardHeader className="flex-row items-center justify-between space-y-0"><CardTitle>Recent activity</CardTitle><Link to="/audit" className="text-xs text-primary hover:underline">Audit log</Link></CardHeader>
            <CardContent>
              {!feed.data ? <Skeleton className="h-48" /> : feed.data.activities.length === 0 ? <p className="text-sm text-muted-foreground">No activity yet.</p> : (
                <ol className="space-y-3">
                  {feed.data.activities.map((a) => (
                    <li key={a.id} className="flex gap-3 text-sm">
                      <span className="mt-1.5 size-2 shrink-0 rounded-full bg-primary/60" />
                      <div className="min-w-0">
                        <p className="break-words">{a.summary}</p>
                        <p className="text-xs text-muted-foreground">{a.userEmail ?? 'System'} · {relTime(a.createdAt)}</p>
                      </div>
                    </li>
                  ))}
                </ol>
              )}
            </CardContent>
          </Card>
        )}
      </div>
    </div>
  );
}
