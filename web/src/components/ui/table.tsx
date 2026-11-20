import type { ReactNode } from 'react';
import { ArrowDown, ArrowUp, ArrowUpDown, ChevronLeft, ChevronRight } from 'lucide-react';
import { cn, num } from '@/lib/utils';
import { Button } from './button';
import { EmptyState, ErrorState, Skeleton } from './misc';

export interface Column<T> {
  key: string;
  header: ReactNode;
  cell: (row: T) => ReactNode;
  sortable?: boolean;
  className?: string;
  hideBelow?: 'sm' | 'md' | 'lg';
}

const hide = { sm: 'hidden sm:table-cell', md: 'hidden md:table-cell', lg: 'hidden lg:table-cell' };

export function DataTable<T extends { id: string }>({
  columns, rows, loading, error, onRetry, sort, dir, onSort, onRowClick, empty,
}: {
  columns: Column<T>[]; rows: T[] | undefined; loading?: boolean; error?: unknown; onRetry?: () => void;
  sort?: string; dir?: 'asc' | 'desc'; onSort?: (key: string) => void; onRowClick?: (row: T) => void; empty?: ReactNode;
}) {
  if (error) return <ErrorState error={error} onRetry={onRetry} />;
  return (
    <div className="overflow-x-auto">
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b bg-muted/40 text-left">
            {columns.map((c) => (
              <th key={c.key} className={cn('h-10 whitespace-nowrap px-4 text-xs font-medium uppercase tracking-wide text-muted-foreground', c.hideBelow && hide[c.hideBelow], c.className)}>
                {c.sortable && onSort ? (
                  <button className="inline-flex items-center gap-1 uppercase tracking-wide hover:text-foreground" onClick={() => onSort(c.key)}>
                    {c.header}
                    {sort === c.key ? (dir === 'asc' ? <ArrowUp className="size-3.5" /> : <ArrowDown className="size-3.5" />) : <ArrowUpDown className="size-3.5 opacity-40" />}
                  </button>
                ) : c.header}
              </th>
            ))}
          </tr>
        </thead>
        <tbody>
          {loading && !rows
            ? Array.from({ length: 8 }).map((_, i) => (
                <tr key={i} className="border-b">
                  {columns.map((c) => <td key={c.key} className={cn('px-4 py-3', c.hideBelow && hide[c.hideBelow])}><Skeleton className="h-4 w-full max-w-[160px]" /></td>)}
                </tr>
              ))
            : rows?.map((r) => (
                <tr key={r.id} onClick={onRowClick ? () => onRowClick(r) : undefined} className={cn('border-b transition-colors last:border-0', onRowClick && 'cursor-pointer hover:bg-muted/50', loading && 'opacity-60')}>
                  {columns.map((c) => <td key={c.key} className={cn('px-4 py-3 align-middle', c.hideBelow && hide[c.hideBelow], c.className)}>{c.cell(r)}</td>)}
                </tr>
              ))}
        </tbody>
      </table>
      {!loading && rows?.length === 0 && (empty ?? <EmptyState title="No records found" description="Try changing the search or filters." />)}
    </div>
  );
}

export function Pagination({ page, pages, total, pageSize, onPage }: { page: number; pages: number; total: number; pageSize: number; onPage: (p: number) => void }) {
  if (!total) return null;
  const from = (page - 1) * pageSize + 1;
  const to = Math.min(total, page * pageSize);
  return (
    <div className="flex items-center justify-between gap-2 border-t px-4 py-3 text-sm text-muted-foreground">
      <span className="tabular">{num(from)}–{num(to)} of {num(total)}</span>
      <div className="flex items-center gap-1">
        <Button variant="outline" size="sm" disabled={page <= 1} onClick={() => onPage(page - 1)} aria-label="Previous page"><ChevronLeft /></Button>
        <span className="px-2 tabular">Page {page} of {pages}</span>
        <Button variant="outline" size="sm" disabled={page >= pages} onClick={() => onPage(page + 1)} aria-label="Next page"><ChevronRight /></Button>
      </div>
    </div>
  );
}
