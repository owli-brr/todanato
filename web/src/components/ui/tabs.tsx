import * as T from '@radix-ui/react-tabs';
import * as M from '@radix-ui/react-dropdown-menu';
import type { ReactNode } from 'react';
import { cn } from '@/lib/utils';

export const Tabs = T.Root;
export const TabsContent = ({ className, ...p }: T.TabsContentProps) => <T.Content className={cn('mt-4 focus-visible:outline-none', className)} {...p} />;

export function TabsList({ children }: { children: ReactNode }) {
  return (
    <div className="-mx-4 overflow-x-auto px-4 sm:mx-0 sm:px-0">
      <T.List className="inline-flex min-w-full gap-1 border-b sm:min-w-0">{children}</T.List>
    </div>
  );
}
export function TabsTrigger({ value, children, count }: { value: string; children: ReactNode; count?: number }) {
  return (
    <T.Trigger
      value={value}
      className="-mb-px inline-flex items-center gap-1.5 whitespace-nowrap border-b-2 border-transparent px-3 py-2 text-sm font-medium text-muted-foreground transition-colors hover:text-foreground data-[state=active]:border-primary data-[state=active]:text-foreground"
    >
      {children}
      {count !== undefined && <span className="rounded-full bg-muted px-1.5 text-xs tabular">{count}</span>}
    </T.Trigger>
  );
}

export const Menu = M.Root;
export const MenuTrigger = M.Trigger;
export function MenuContent({ children, align = 'end' }: { children: ReactNode; align?: 'start' | 'end' }) {
  return (
    <M.Portal>
      <M.Content align={align} sideOffset={6} className="z-50 min-w-[200px] overflow-hidden rounded-md border bg-popover p-1 text-popover-foreground shadow-md">
        {children}
      </M.Content>
    </M.Portal>
  );
}
export function MenuItem({ children, onSelect, danger, disabled }: { children: ReactNode; onSelect?: () => void; danger?: boolean; disabled?: boolean }) {
  return (
    <M.Item
      disabled={disabled}
      onSelect={onSelect}
      className={cn('flex cursor-pointer select-none items-center gap-2 rounded-sm px-2 py-1.5 text-sm outline-none data-[disabled]:pointer-events-none data-[highlighted]:bg-accent data-[disabled]:opacity-50 [&_svg]:size-4', danger && 'text-destructive data-[highlighted]:bg-destructive/10')}
    >
      {children}
    </M.Item>
  );
}
export const MenuSeparator = () => <M.Separator className="-mx-1 my-1 h-px bg-border" />;
export const MenuLabel = ({ children }: { children: ReactNode }) => <M.Label className="px-2 py-1.5 text-xs text-muted-foreground">{children}</M.Label>;
