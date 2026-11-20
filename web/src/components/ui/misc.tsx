import { useEffect, useState, type HTMLAttributes, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Inbox, AlertTriangle } from 'lucide-react';
import { cn, initials } from '@/lib/utils';
import { fileUrl } from '@/lib/api';
import { Button } from './button';

export const Card = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn('rounded-lg border bg-card text-card-foreground shadow-sm', className)} {...p} />;
export const CardHeader = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn('flex flex-col gap-1 p-5 pb-3', className)} {...p} />;
export const CardTitle = ({ className, ...p }: HTMLAttributes<HTMLHeadingElement>) => <h3 className={cn('text-base font-semibold leading-tight', className)} {...p} />;
export const CardDescription = ({ className, ...p }: HTMLAttributes<HTMLParagraphElement>) => <p className={cn('text-sm text-muted-foreground', className)} {...p} />;
export const CardContent = ({ className, ...p }: HTMLAttributes<HTMLDivElement>) => <div className={cn('p-5 pt-0', className)} {...p} />;

const tones = {
  default: 'bg-secondary text-secondary-foreground',
  blue: 'bg-blue-100 text-blue-800 dark:bg-blue-500/15 dark:text-blue-300',
  green: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-500/15 dark:text-emerald-300',
  amber: 'bg-amber-100 text-amber-800 dark:bg-amber-500/15 dark:text-amber-300',
  red: 'bg-red-100 text-red-800 dark:bg-red-500/15 dark:text-red-300',
  gray: 'bg-slate-100 text-slate-700 dark:bg-slate-500/15 dark:text-slate-300',
  violet: 'bg-violet-100 text-violet-800 dark:bg-violet-500/15 dark:text-violet-300',
};
export type Tone = keyof typeof tones;

export function Badge({ tone = 'default', className, children }: { tone?: Tone; className?: string; children: ReactNode }) {
  return <span className={cn('inline-flex items-center gap-1 whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-medium', tones[tone], className)}>{children}</span>;
}

const STATUS_TONE: Record<string, Tone> = {
  ACTIVE: 'green', APPROVED: 'green', VERIFIED: 'green', OPERATIONAL: 'green', PASSED: 'green', COMPLETED: 'green', PAID: 'green', AVAILABLE: 'green',
  PENDING: 'amber', UNDER_MAINTENANCE: 'amber', PARTIAL: 'amber', BREAK: 'amber', UNPAID: 'amber',
  SUSPENDED: 'red', REJECTED: 'red', FAILED: 'red', EXPIRED: 'red', CANCELLED: 'red', OVERDUE: 'red', TERMINATED: 'red',
  INACTIVE: 'gray', OFFLINE: 'gray',
  ON_TRIP: 'blue', IN_TRANSIT: 'blue', ACCEPTED: 'blue', DRIVER_ASSIGNED: 'blue', DRIVER_ARRIVING: 'blue', PASSENGER_PICKED_UP: 'blue',
};
const STATUS_LABEL: Record<string, string> = { UNDER_MAINTENANCE: 'Maintenance', ON_TRIP: 'On trip', PASSENGER_PICKED_UP: 'Picked up', DRIVER_ASSIGNED: 'Assigned', DRIVER_ARRIVING: 'Arriving', IN_TRANSIT: 'In transit' };

export function StatusBadge({ status, className }: { status: string; className?: string }) {
  const t = STATUS_TONE[status] ?? 'default';
  return (
    <Badge tone={t} className={className}>
      <span className={cn('size-1.5 rounded-full', { green: 'bg-emerald-500', amber: 'bg-amber-500', red: 'bg-red-500', gray: 'bg-slate-400', blue: 'bg-blue-500', default: 'bg-slate-400', violet: 'bg-violet-500' }[t])} />
      {STATUS_LABEL[status] ?? status.charAt(0) + status.slice(1).toLowerCase().replace(/_/g, ' ')}
    </Badge>
  );
}

export const Skeleton = ({ className }: { className?: string }) => <div className={cn('animate-pulse rounded-md bg-muted', className)} />;

export function EmptyState({ title, description, action, icon: Icon = Inbox }: { title: string; description?: string; action?: ReactNode; icon?: typeof Inbox }) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 px-6 py-12 text-center">
      <div className="rounded-full bg-muted p-3"><Icon className="size-5 text-muted-foreground" /></div>
      <p className="text-sm font-medium">{title}</p>
      {description && <p className="max-w-sm text-sm text-muted-foreground">{description}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function ErrorState({ error, onRetry }: { error: unknown; onRetry?: () => void }) {
  return (
    <EmptyState
      icon={AlertTriangle}
      title="Couldn't load this"
      description={error instanceof Error ? error.message : 'Something went wrong.'}
      action={onRetry && <Button variant="outline" size="sm" onClick={onRetry}>Try again</Button>}
    />
  );
}

export function PageHeader({ title, description, actions, back }: { title: ReactNode; description?: ReactNode; actions?: ReactNode; back?: string }) {
  return (
    <div className="mb-6 flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
      <div className="min-w-0">
        {back && (
          <Link to={back} className="mb-2 inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground">
            <ArrowLeft className="size-4" /> Back
          </Link>
        )}
        <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
        {description && <div className="mt-1 text-sm text-muted-foreground">{description}</div>}
      </div>
      {actions && <div className="flex flex-wrap items-center gap-2">{actions}</div>}
    </div>
  );
}

/** Avatar that loads protected photos through the API. */
export function Avatar({ name, src, className }: { name: string; src?: string | null; className?: string }) {
  const [url, setUrl] = useState<string | null>(null);
  useEffect(() => {
    let revoke: string | null = null;
    setUrl(null);
    if (src) fileUrl(src).then((u) => { revoke = u; setUrl(u); }).catch(() => setUrl(null));
    return () => { if (revoke) URL.revokeObjectURL(revoke); };
  }, [src]);
  return (
    <div className={cn('flex size-9 shrink-0 items-center justify-center overflow-hidden rounded-full bg-accent text-xs font-semibold text-accent-foreground', className)}>
      {url ? <img src={url} alt={name} className="size-full object-cover" /> : initials(name)}
    </div>
  );
}

export function DescList({ items, cols = 2 }: { items: [string, ReactNode][]; cols?: 1 | 2 | 3 }) {
  return (
    <dl className={cn('grid gap-x-6 gap-y-4', cols === 2 && 'sm:grid-cols-2', cols === 3 && 'sm:grid-cols-2 lg:grid-cols-3')}>
      {items.map(([k, v]) => (
        <div key={k} className="min-w-0">
          <dt className="text-xs font-medium uppercase tracking-wide text-muted-foreground">{k}</dt>
          <dd className="mt-1 break-words text-sm">{v ?? '—'}</dd>
        </div>
      ))}
    </dl>
  );
}

export function Spinner({ className }: { className?: string }) {
  return <div className={cn('size-5 animate-spin rounded-full border-2 border-primary border-t-transparent', className)} />;
}
