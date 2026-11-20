import { useState, type ReactNode } from 'react';
import * as D from '@radix-ui/react-dialog';
import * as A from '@radix-ui/react-alert-dialog';
import { X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { Button } from './button';

const overlay = 'fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=open]:fade-in-0';
const content = 'fixed left-1/2 top-1/2 z-50 grid max-h-[90vh] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 gap-4 overflow-y-auto rounded-lg border bg-card p-6 shadow-lg';

export function Dialog({ open, onOpenChange, title, description, children, footer, className }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description?: ReactNode; children: ReactNode; footer?: ReactNode; className?: string;
}) {
  return (
    <D.Root open={open} onOpenChange={onOpenChange}>
      <D.Portal>
        <D.Overlay className={overlay} />
        <D.Content className={cn(content, 'max-w-lg', className)}>
          <div className="space-y-1 pr-6">
            <D.Title className="text-lg font-semibold">{title}</D.Title>
            {description ? <D.Description className="text-sm text-muted-foreground">{description}</D.Description> : <D.Description className="sr-only">{title}</D.Description>}
          </div>
          {children}
          {footer && <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">{footer}</div>}
          <D.Close className="absolute right-4 top-4 rounded-sm opacity-70 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-ring" aria-label="Close">
            <X className="size-4" />
          </D.Close>
        </D.Content>
      </D.Portal>
    </D.Root>
  );
}

/** Confirmation for sensitive actions. `onConfirm` may be async; the dialog stays open until it settles. */
export function ConfirmDialog({ open, onOpenChange, title, description, confirmLabel = 'Confirm', tone = 'default', onConfirm, children }: {
  open: boolean; onOpenChange: (o: boolean) => void; title: string; description: ReactNode; confirmLabel?: string;
  tone?: 'default' | 'destructive'; onConfirm: () => Promise<unknown> | void; children?: ReactNode;
}) {
  const [busy, setBusy] = useState(false);
  return (
    <A.Root open={open} onOpenChange={(o) => !busy && onOpenChange(o)}>
      <A.Portal>
        <A.Overlay className={overlay} />
        <A.Content className={cn(content, 'max-w-md')}>
          <div className="space-y-2">
            <A.Title className="text-lg font-semibold">{title}</A.Title>
            <A.Description className="text-sm text-muted-foreground">{description}</A.Description>
          </div>
          {children}
          <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <A.Cancel asChild><Button variant="outline" disabled={busy}>Cancel</Button></A.Cancel>
            <Button
              variant={tone === 'destructive' ? 'destructive' : 'default'}
              loading={busy}
              onClick={async () => {
                setBusy(true);
                try { await onConfirm(); onOpenChange(false); } catch { /* caller shows toast */ } finally { setBusy(false); }
              }}
            >
              {confirmLabel}
            </Button>
          </div>
        </A.Content>
      </A.Portal>
    </A.Root>
  );
}
