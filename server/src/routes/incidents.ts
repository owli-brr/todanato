import { Router, type Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah, HttpError, notFound, optStr, orderBy, pageArgs, paged, paginationSchema } from '../lib/http';
import { audit } from '../lib/audit';
import { can, requirePermission } from '../middleware/auth';
import { todaId } from '../lib/toda';
import { removeStored, sendStored, storeUpload, upload } from '../lib/uploads';
import { driverFullName } from './drivers';

export const incidentsRouter = Router();

const TYPES = ['PASSENGER_COMPLAINT', 'DRIVER_COMPLAINT', 'ACCIDENT', 'LOST_AND_FOUND', 'VIOLATION', 'OTHER'] as const;
const STATUSES = ['OPEN', 'INVESTIGATING', 'RESOLVED', 'DISMISSED'] as const;
const SEVERITIES = ['LOW', 'MEDIUM', 'HIGH', 'CRITICAL'] as const;
const driverSel = { select: { id: true, firstName: true, middleName: true, lastName: true, suffix: true, driverCode: true, status: true } } as const;
type DriverLite = { id: string; firstName: string; middleName: string | null; lastName: string; suffix: string | null; driverCode: string; status: string };
const liteDriver = (d: DriverLite | null) => (d ? { id: d.id, driverCode: d.driverCode, status: d.status, fullName: driverFullName(d) } : null);

async function nextCaseNo(tx: Prisma.TransactionClient) {
  const prefix = `INC-${new Date().getFullYear()}-`;
  const last = await tx.incident.findFirst({ where: { caseNo: { startsWith: prefix } }, orderBy: { caseNo: 'desc' }, select: { caseNo: true } });
  return prefix + String(last ? parseInt(last.caseNo.slice(prefix.length), 10) + 1 : 1).padStart(4, '0');
}

const incidentBody = z.object({
  type: z.enum(TYPES, { errorMap: () => ({ message: 'Choose the kind of incident' }) }),
  title: z.string().trim().min(5, 'Give a short summary').max(150),
  description: z.string().trim().min(10, 'Describe what happened').max(5000),
  occurredAt: z.coerce.date({ errorMap: () => ({ message: 'Enter when it happened' }) }).refine((d) => d.getTime() <= Date.now() + 5 * 60_000, 'This can’t be in the future'),
  location: optStr(200),
  driverId: z.string().uuid().optional().nullable().transform((v) => v || null),
  complainantName: optStr(120),
  complainantPhone: optStr(20),
  severity: z.enum(SEVERITIES).default('LOW'),
  assignedToId: z.string().uuid().optional().nullable().transform((v) => v || null),
});

async function checkRefs(b: { driverId?: string | null; assignedToId?: string | null }) {
  if (b.driverId && !(await prisma.driver.findFirst({ where: { id: b.driverId, deletedAt: null } }))) throw new HttpError(400, 'Driver not found', { fields: { driverId: 'Driver not found' } });
  if (b.assignedToId) {
    const u = await prisma.user.findFirst({ where: { id: b.assignedToId, deletedAt: null, isActive: true, role: { permissions: { some: { permission: { key: 'incidents.manage' } } } } } });
    if (!u) throw new HttpError(400, 'Choose an officer who handles incidents', { fields: { assignedToId: 'Not allowed to handle incidents' } });
  }
}

async function load(id: string) {
  const i = await prisma.incident.findUnique({
    where: { id },
    include: {
      driver: driverSel,
      reportedBy: { select: { id: true, fullName: true } }, assignedTo: { select: { id: true, fullName: true } },
      notes: { orderBy: { createdAt: 'asc' }, include: { author: { select: { fullName: true } } } },
      attachments: { orderBy: { uploadedAt: 'asc' }, select: { id: true, fileName: true, mimeType: true, uploadedAt: true } },
    },
  });
  if (!i) throw notFound('Incident');
  return i;
}
const present = (i: Awaited<ReturnType<typeof load>>, req: Request) => ({
  ...i, driver: liteDriver(i.driver),
  // Complainant contact details are personal data; only handlers see the phone number.
  complainantPhone: can(req, 'incidents.manage') ? i.complainantPhone : i.complainantPhone ? '••••' + i.complainantPhone.slice(-4) : null,
  notes: i.notes.map((n) => ({ id: n.id, body: n.body, createdAt: n.createdAt, author: n.author.fullName })),
});

// ───────────── List / summary ─────────────

incidentsRouter.get('/', requirePermission('incidents.read'), ah(async (req, res) => {
  const p = paginationSchema.extend({
    status: z.enum([...STATUSES, 'ACTIVE']).optional(),
    type: z.enum(TYPES).optional(),
    severity: z.enum(SEVERITIES).optional(),
    driverId: z.string().uuid().optional(),
    mine: z.coerce.boolean().optional(),
  }).parse(req.query);
  const q = p.q?.trim();
  const where: Prisma.IncidentWhereInput = {
    AND: [
      p.status === 'ACTIVE' ? { status: { in: ['OPEN', 'INVESTIGATING'] } } : p.status ? { status: p.status } : {},
      p.type ? { type: p.type } : {}, p.severity ? { severity: p.severity } : {}, p.driverId ? { driverId: p.driverId } : {},
      p.mine ? { assignedToId: req.auth!.userId } : {},
      q ? { OR: [
        { caseNo: { contains: q, mode: 'insensitive' } }, { title: { contains: q, mode: 'insensitive' } }, { location: { contains: q, mode: 'insensitive' } },
        { complainantName: { contains: q, mode: 'insensitive' } },
        { driver: { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { driverCode: { contains: q, mode: 'insensitive' } }] } },
      ] } : {},
    ],
  };
  const [rows, total, byStatus] = await Promise.all([
    prisma.incident.findMany({
      where, ...pageArgs(p),
      orderBy: orderBy<Prisma.IncidentOrderByWithRelationInput | Prisma.IncidentOrderByWithRelationInput[]>(p.sort, p.dir, { occurredAt: (d) => ({ occurredAt: d }), caseNo: (d) => ({ caseNo: d }), severity: (d) => ({ severity: d }) }, [{ occurredAt: 'desc' }]),
      include: { driver: driverSel, assignedTo: { select: { fullName: true } }, _count: { select: { notes: true } } },
    }),
    prisma.incident.count({ where }),
    prisma.incident.groupBy({ by: ['status'], _count: true }),
  ]);
  res.json({
    ...paged(rows.map((i) => ({ id: i.id, caseNo: i.caseNo, type: i.type, title: i.title, occurredAt: i.occurredAt, location: i.location, status: i.status, severity: i.severity, driver: liteDriver(i.driver), assignedTo: i.assignedTo?.fullName ?? null, notes: i._count.notes, complainantName: i.complainantName })), total, p),
    counts: Object.fromEntries(STATUSES.map((s) => [s, byStatus.find((b) => b.status === s)?._count ?? 0])),
  });
}));

/** Officers who can be assigned a case. */
incidentsRouter.get('/assignees', requirePermission('incidents.read'), ah(async (_req, res) => {
  const users = await prisma.user.findMany({
    where: { deletedAt: null, isActive: true, role: { permissions: { some: { permission: { key: 'incidents.manage' } } } } },
    select: { id: true, fullName: true, role: { select: { name: true } } }, orderBy: { fullName: 'asc' },
  });
  res.json(users.map((u) => ({ id: u.id, fullName: u.fullName, role: u.role.name })));
}));

incidentsRouter.get('/:id', requirePermission('incidents.read'), ah(async (req, res) => {
  res.json(present(await load(req.params.id), req));
}));

// ───────────── Changes ─────────────

incidentsRouter.post('/', requirePermission('incidents.manage'), ah(async (req, res) => {
  const b = incidentBody.parse(req.body);
  await checkRefs(b);
  const associationId = await todaId();
  const created = await (async () => {
    for (let i = 0; ; i++) {
      try {
        return await prisma.$transaction(async (tx) => tx.incident.create({ data: { ...b, caseNo: await nextCaseNo(tx), associationId, reportedById: req.auth!.userId, status: b.assignedToId ? 'INVESTIGATING' : 'OPEN' } }));
      } catch (e) { if (!(e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') || i >= 4) throw e; }
    }
  })();
  await audit(req, { action: 'CREATE', entity: 'Incident', entityId: created.id, summary: `Logged ${created.caseNo}: ${created.title}`, after: { type: b.type, severity: b.severity, driverId: b.driverId }, associationId });
  res.status(201).json(present(await load(created.id), req));
}));

incidentsRouter.patch('/:id', requirePermission('incidents.manage'), ah(async (req, res) => {
  const before = await load(req.params.id);
  const b = incidentBody.partial().extend({ status: z.enum(['OPEN', 'INVESTIGATING']).optional() }).parse(req.body);
  if (['RESOLVED', 'DISMISSED'].includes(before.status) && Object.keys(b).some((k) => k !== 'assignedToId')) throw new HttpError(409, 'Reopen the case before changing it');
  await checkRefs(b);
  const data: Prisma.IncidentUncheckedUpdateInput = { ...b };
  if (b.assignedToId && before.status === 'OPEN' && !b.status) data.status = 'INVESTIGATING';
  await prisma.incident.update({ where: { id: before.id }, data });
  const changes: string[] = [];
  if (b.status && b.status !== before.status) changes.push(`status ${b.status.toLowerCase()}`);
  if (b.severity && b.severity !== before.severity) changes.push(`severity ${b.severity.toLowerCase()}`);
  if (b.assignedToId !== undefined && b.assignedToId !== before.assignedToId) changes.push(b.assignedToId ? 'reassigned' : 'unassigned');
  await audit(req, { action: 'UPDATE', entity: 'Incident', entityId: before.id, summary: `Updated ${before.caseNo}${changes.length ? `: ${changes.join(', ')}` : ''}`, associationId: before.associationId });
  res.json(present(await load(before.id), req));
}));

incidentsRouter.post('/:id/notes', requirePermission('incidents.manage'), ah(async (req, res) => {
  const { body } = z.object({ body: z.string().trim().min(2, 'Write a note').max(3000) }).parse(req.body);
  const i = await load(req.params.id);
  await prisma.incidentNote.create({ data: { incidentId: i.id, authorId: req.auth!.userId, body } });
  if (i.status === 'OPEN') await prisma.incident.update({ where: { id: i.id }, data: { status: 'INVESTIGATING' } });
  await audit(req, { action: 'NOTE', entity: 'Incident', entityId: i.id, summary: `Added a note to ${i.caseNo}`, associationId: i.associationId });
  res.status(201).json(present(await load(i.id), req));
}));

incidentsRouter.post('/:id/resolve', requirePermission('incidents.manage'), ah(async (req, res) => {
  const b = z.object({
    outcome: z.enum(['RESOLVED', 'DISMISSED']),
    resolution: z.string().trim().min(10, 'Explain how it was settled (or why it was dismissed)').max(3000),
    disciplinaryAction: optStr(500),
  }).parse(req.body);
  const i = await load(req.params.id);
  if (['RESOLVED', 'DISMISSED'].includes(i.status)) throw new HttpError(409, 'This case is already closed');
  await prisma.incident.update({ where: { id: i.id }, data: { status: b.outcome, resolution: b.resolution, disciplinaryAction: b.disciplinaryAction, resolvedAt: new Date() } });
  await audit(req, { action: b.outcome === 'RESOLVED' ? 'RESOLVE' : 'DISMISS', entity: 'Incident', entityId: i.id, summary: `${b.outcome === 'RESOLVED' ? 'Resolved' : 'Dismissed'} ${i.caseNo}${b.disciplinaryAction ? `; action: ${b.disciplinaryAction}` : ''}`, after: b, associationId: i.associationId });
  res.json(present(await load(i.id), req));
}));

incidentsRouter.post('/:id/reopen', requirePermission('incidents.manage'), ah(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(5, 'Say why the case is reopened').max(500) }).parse(req.body);
  const i = await load(req.params.id);
  if (!['RESOLVED', 'DISMISSED'].includes(i.status)) throw new HttpError(409, 'This case is still open');
  await prisma.$transaction([
    prisma.incident.update({ where: { id: i.id }, data: { status: 'INVESTIGATING', resolvedAt: null } }),
    prisma.incidentNote.create({ data: { incidentId: i.id, authorId: req.auth!.userId, body: `Reopened: ${reason}` } }),
  ]);
  await audit(req, { action: 'REOPEN', entity: 'Incident', entityId: i.id, summary: `Reopened ${i.caseNo}: ${reason}`, associationId: i.associationId });
  res.json(present(await load(i.id), req));
}));

// ───────────── Attachments (photos, statements) ─────────────

incidentsRouter.post('/:id/attachments', requirePermission('incidents.manage'), upload.single('file'), ah(async (req, res) => {
  const i = await load(req.params.id);
  const fileUrl = await storeUpload(req.file);
  const f = req.file!;
  await prisma.incidentAttachment.create({ data: { incidentId: i.id, fileUrl, fileName: f.originalname.slice(0, 200), mimeType: f.mimetype } });
  await audit(req, { action: 'UPLOAD', entity: 'Incident', entityId: i.id, summary: `Attached ${f.originalname.slice(0, 80)} to ${i.caseNo}`, associationId: i.associationId });
  res.status(201).json(present(await load(i.id), req));
}));

incidentsRouter.get('/:id/attachments/:aid', requirePermission('incidents.read'), ah(async (req, res) => {
  const a = await prisma.incidentAttachment.findFirst({ where: { id: req.params.aid, incidentId: req.params.id } });
  if (!a) throw notFound('Attachment');
  await sendStored(res, a.fileUrl, a.fileName);
}));

incidentsRouter.delete('/:id/attachments/:aid', requirePermission('incidents.manage'), ah(async (req, res) => {
  const i = await load(req.params.id);
  if (['RESOLVED', 'DISMISSED'].includes(i.status)) throw new HttpError(409, 'Attachments of a closed case are kept');
  const a = await prisma.incidentAttachment.findFirst({ where: { id: req.params.aid, incidentId: i.id } });
  if (!a) throw notFound('Attachment');
  await prisma.incidentAttachment.delete({ where: { id: a.id } });
  await removeStored(a.fileUrl);
  await audit(req, { action: 'DELETE', entity: 'Incident', entityId: i.id, summary: `Removed attachment ${a.fileName} from ${i.caseNo}`, associationId: i.associationId });
  res.json({ ok: true });
}));
