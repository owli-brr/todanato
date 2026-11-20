import { useRef, useState, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Search, Upload, FileText, Image as ImageIcon, CheckCircle2, XCircle, Trash2, Eye } from 'lucide-react';
import { toast } from 'sonner';
import { api, fileUrl } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { daysUntil, fmtDate, fmtDateTime, label } from '@/lib/utils';
import { Input, Select, Field, Textarea } from './ui/form';
import { Button } from './ui/button';
import { Dialog, ConfirmDialog } from './ui/dialog';
import { Badge, EmptyState, StatusBadge } from './ui/misc';

export interface AssocOption { id: string; name: string; code: string; acronym: string | null }

export function useAssociations() {
  return useQuery({ queryKey: ['associations', 'options'], queryFn: () => api.get<AssocOption[]>('/associations?all=true'), staleTime: 5 * 60_000 });
}

/** TODAnaTo serves one TODA; this is it. */
export function useToda() {
  const q = useAssociations();
  return { ...q, data: q.data?.[0] };
}

export function AssociationSelect({ value, onChange, allLabel = 'All associations', id, required, invalid }: { value: string; onChange: (v: string) => void; allLabel?: string | null; id?: string; required?: boolean; invalid?: boolean }) {
  const { data } = useAssociations();
  return (
    <Select id={id} value={value} onChange={(e) => onChange(e.target.value)} required={required} aria-invalid={invalid || undefined}>
      {allLabel !== null && <option value="">{allLabel}</option>}
      {data?.map((a) => <option key={a.id} value={a.id}>{a.acronym ? `${a.acronym} — ` : ''}{a.name}</option>)}
    </Select>
  );
}

export function SearchBox({ value, onChange, placeholder }: { value: string; onChange: (v: string) => void; placeholder: string }) {
  return (
    <div className="relative w-full sm:max-w-xs">
      <Search className="pointer-events-none absolute left-2.5 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
      <Input type="search" value={value} onChange={(e) => onChange(e.target.value)} placeholder={placeholder} className="pl-8" aria-label={placeholder} />
    </div>
  );
}

export function Toolbar({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-2 border-b p-3 sm:flex-row sm:flex-wrap sm:items-center">{children}</div>;
}

export function ExpiryBadge({ date }: { date: string | null | undefined }) {
  if (!date) return <span className="text-muted-foreground">—</span>;
  const d = daysUntil(date)!;
  return (
    <span className="inline-flex items-center gap-1.5">
      <span className="tabular">{fmtDate(date)}</span>
      {d < 0 ? <Badge tone="red">Expired</Badge> : d <= 30 ? <Badge tone="amber">{d}d</Badge> : null}
    </span>
  );
}

export interface Doc {
  id: string; type: string; documentNo: string | null; fileName: string; mimeType: string; sizeBytes: number;
  expiresAt: string | null; status: string; remarks: string | null; uploadedAt: string; verifiedAt: string | null; verifiedBy: { fullName: string } | null;
}

/** Document list with upload / view / verify / delete. `base` is e.g. `/drivers/:id`. */
export function DocumentsPanel({ docs, base, filePath, types, onChange }: { docs: Doc[]; base: string; filePath: string; types: string[]; onChange: () => void }) {
  const { can } = useAuth();
  const [uploadOpen, setUploadOpen] = useState(false);
  const [verify, setVerify] = useState<{ doc: Doc; status: 'VERIFIED' | 'REJECTED' } | null>(null);
  const [remarks, setRemarks] = useState('');
  const [del, setDel] = useState<Doc | null>(null);

  const view = async (d: Doc) => {
    try {
      const url = await fileUrl(`${filePath}/${d.id}`);
      window.open(url, '_blank', 'noopener');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Could not open file'); }
  };

  return (
    <div>
      <div className="mb-3 flex items-center justify-between">
        <p className="text-sm text-muted-foreground">{docs.length} document{docs.length === 1 ? '' : 's'}</p>
        {can('documents.upload') && <Button size="sm" onClick={() => setUploadOpen(true)}><Upload /> Upload document</Button>}
      </div>
      {docs.length === 0 ? <EmptyState title="No documents yet" description="Upload IDs, clearances and other requirements here." /> : (
        <ul className="divide-y rounded-md border">
          {docs.map((d) => (
            <li key={d.id} className="flex flex-col gap-3 p-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-start gap-3">
                <div className="rounded-md bg-muted p-2">{d.mimeType.startsWith('image/') ? <ImageIcon className="size-4" /> : <FileText className="size-4" />}</div>
                <div className="min-w-0">
                  <div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{label(d.type)}</span><StatusBadge status={d.status} /></div>
                  <div className="truncate text-xs text-muted-foreground">
                    {d.documentNo && <>No. {d.documentNo} · </>}{d.fileName} · {(d.sizeBytes / 1024).toFixed(0)} KB · uploaded {fmtDate(d.uploadedAt)}
                  </div>
                  {d.expiresAt && <div className="mt-0.5 text-xs">Expires: <ExpiryBadge date={d.expiresAt} /></div>}
                  {d.verifiedBy && <div className="text-xs text-muted-foreground">{d.status === 'VERIFIED' ? 'Verified' : 'Reviewed'} by {d.verifiedBy.fullName} on {fmtDateTime(d.verifiedAt)}</div>}
                  {d.remarks && <div className="text-xs text-destructive">{d.remarks}</div>}
                </div>
              </div>
              <div className="flex shrink-0 gap-1">
                <Button variant="outline" size="sm" onClick={() => view(d)}><Eye /> View</Button>
                {can('documents.verify') && d.status === 'PENDING' && (
                  <>
                    <Button variant="outline" size="sm" className="text-emerald-700 dark:text-emerald-400" onClick={() => { setRemarks(''); setVerify({ doc: d, status: 'VERIFIED' }); }}><CheckCircle2 /> Verify</Button>
                    <Button variant="outline" size="sm" className="text-destructive" onClick={() => { setRemarks(''); setVerify({ doc: d, status: 'REJECTED' }); }}><XCircle /> Reject</Button>
                  </>
                )}
                {can('documents.upload') && d.status !== 'VERIFIED' && <Button variant="ghost" size="icon" className="size-8" aria-label="Delete document" onClick={() => setDel(d)}><Trash2 /></Button>}
              </div>
            </li>
          ))}
        </ul>
      )}

      <UploadDialog open={uploadOpen} onOpenChange={setUploadOpen} url={`${base}/documents`} types={types} onDone={onChange} />

      <ConfirmDialog
        open={!!verify}
        onOpenChange={(o) => !o && setVerify(null)}
        title={verify?.status === 'VERIFIED' ? 'Verify document?' : 'Reject document?'}
        description={verify ? `${label(verify.doc.type)} · ${verify.doc.fileName}. Make sure you have checked the file against the original.` : ''}
        confirmLabel={verify?.status === 'VERIFIED' ? 'Mark verified' : 'Reject'}
        tone={verify?.status === 'REJECTED' ? 'destructive' : 'default'}
        onConfirm={async () => {
          try {
            await api.post(`${base}/documents/${verify!.doc.id}/verify`, { status: verify!.status, remarks });
            toast.success(verify!.status === 'VERIFIED' ? 'Document verified' : 'Document rejected');
            onChange();
          } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); throw e; }
        }}
      >
        <Field label={verify?.status === 'REJECTED' ? 'Reason (shown to the driver)' : 'Remarks (optional)'} name="remarks" required={verify?.status === 'REJECTED'}>
          <Textarea id="remarks" value={remarks} onChange={(e) => setRemarks(e.target.value)} placeholder={verify?.status === 'REJECTED' ? 'e.g. Photo is blurry, please re-upload' : ''} />
        </Field>
      </ConfirmDialog>

      <ConfirmDialog
        open={!!del}
        onOpenChange={(o) => !o && setDel(null)}
        title="Delete this document?"
        description={del ? `${label(del.type)} (${del.fileName}) will be removed. This is recorded in the audit log.` : ''}
        confirmLabel="Delete"
        tone="destructive"
        onConfirm={async () => {
          try { await api.del(`${base}/documents/${del!.id}`); toast.success('Document deleted'); onChange(); }
          catch (e) { toast.error(e instanceof Error ? e.message : 'Failed'); throw e; }
        }}
      />
    </div>
  );
}

function UploadDialog({ open, onOpenChange, url, types, onDone }: { open: boolean; onOpenChange: (o: boolean) => void; url: string; types: string[]; onDone: () => void }) {
  const [type, setType] = useState(types[0]);
  const [no, setNo] = useState('');
  const [expires, setExpires] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [busy, setBusy] = useState(false);
  const ref = useRef<HTMLInputElement>(null);
  const reset = () => { setType(types[0]); setNo(''); setExpires(''); setFile(null); if (ref.current) ref.current.value = ''; };
  return (
    <Dialog
      open={open}
      onOpenChange={(o) => { if (!o) reset(); onOpenChange(o); }}
      title="Upload document"
      description="JPG, PNG, WEBP or PDF up to 5 MB."
      footer={
        <>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Cancel</Button>
          <Button
            loading={busy}
            disabled={!file}
            onClick={async () => {
              if (!file) return;
              if (file.size > 5 * 1024 * 1024) return toast.error('File is larger than 5 MB');
              const fd = new FormData();
              fd.append('type', type);
              if (no) fd.append('documentNo', no);
              if (expires) fd.append('expiresAt', expires);
              fd.append('file', file);
              setBusy(true);
              try { await api.post(url, fd); toast.success('Document uploaded'); reset(); onOpenChange(false); onDone(); }
              catch (e) { toast.error(e instanceof Error ? e.message : 'Upload failed'); }
              finally { setBusy(false); }
            }}
          >
            Upload
          </Button>
        </>
      }
    >
      <div className="grid gap-4">
        <Field label="Document type" name="docType" required>
          <Select id="docType" value={type} onChange={(e) => setType(e.target.value)}>{types.map((t) => <option key={t} value={t}>{label(t)}</option>)}</Select>
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Document number" name="docNo"><Input id="docNo" value={no} onChange={(e) => setNo(e.target.value)} /></Field>
          <Field label="Expiry date" name="docExp"><Input id="docExp" type="date" value={expires} onChange={(e) => setExpires(e.target.value)} /></Field>
        </div>
        <Field label="File" name="docFile" required>
          <Input ref={ref} id="docFile" type="file" accept="image/jpeg,image/png,image/webp,application/pdf" onChange={(e) => setFile(e.target.files?.[0] ?? null)} />
        </Field>
      </div>
    </Dialog>
  );
}

export function ActivityList({ items }: { items: { id: string; summary: string; userEmail: string | null; createdAt: string }[] }) {
  if (!items.length) return <EmptyState title="No recorded activity yet" />;
  return (
    <ol className="relative space-y-4 border-l pl-5">
      {items.map((a) => (
        <li key={a.id} className="relative">
          <span className="absolute -left-[25px] top-1.5 size-2.5 rounded-full border-2 border-card bg-primary" />
          <p className="text-sm">{a.summary}</p>
          <p className="text-xs text-muted-foreground">{a.userEmail ?? 'System'} · {fmtDateTime(a.createdAt)}</p>
        </li>
      ))}
    </ol>
  );
}
