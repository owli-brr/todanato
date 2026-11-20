import { Router, type Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah, HttpError, notFound, optDate, optStr, orderBy, pageArgs, paged, paginationSchema, reqDate } from '../lib/http';
import { audit, diff } from '../lib/audit';
import { assertAssociationAccess, assocScope, requirePermission } from '../middleware/auth';
import { nextVehicleCode } from '../lib/codes';
import { removeStored, upload, verifyMagic } from '../lib/uploads';
import { driverFullName } from './drivers';

export const vehiclesRouter = Router();

const vehicleBody = z.object({
  plateNumber: z.string().trim().toUpperCase().regex(/^[A-Z0-9]{2,4}[ -]?[A-Z0-9]{2,5}$/, 'Enter a valid plate (e.g. 123ABC or AB 1234)'),
  franchiseNumber: optStr(40),
  franchiseExpiry: optDate,
  bodyNumber: optStr(20),
  associationId: z.string().uuid().optional().nullable(),
  ownerName: z.string().trim().min(2, "Enter the owner's name").max(120),
  ownerContact: optStr(20),
  ownerAddress: optStr(250),
  ownerDriverId: z.string().uuid().optional().nullable(),
  make: z.string().trim().min(2, 'Enter the make').max(60),
  model: z.string().trim().min(1, 'Enter the model').max(60),
  year: z.coerce.number().int().min(1980).max(new Date().getFullYear() + 1).optional().nullable(),
  color: z.string().trim().min(2, 'Enter the color').max(40),
  engineNumber: optStr(40),
  chassisNumber: optStr(40),
  orNumber: optStr(40),
  crNumber: optStr(40),
  registrationExpiry: optDate,
  insuranceProvider: optStr(100),
  insurancePolicyNo: optStr(60),
  insuranceExpiry: optDate,
  inspectionStatus: z.enum(['PENDING', 'PASSED', 'FAILED', 'EXPIRED']).optional(),
  lastInspectionAt: optDate,
});

const listQuery = paginationSchema.extend({
  status: z.enum(['OPERATIONAL', 'UNDER_MAINTENANCE', 'INACTIVE']).optional(),
  associationId: z.string().uuid().optional(),
  inspection: z.enum(['PENDING', 'PASSED', 'FAILED', 'EXPIRED']).optional(),
  expiring: z.coerce.boolean().optional(),
  unassigned: z.coerce.boolean().optional(),
});

async function loadScoped(req: Request, id: string) {
  const v = await prisma.vehicle.findFirst({ where: { AND: [{ id, deletedAt: null }, assocScope(req) as Prisma.VehicleWhereInput] } });
  if (!v) throw notFound('Vehicle');
  return v;
}

vehiclesRouter.get(
  '/',
  requirePermission('vehicles.read'),
  ah(async (req, res) => {
    const p = listQuery.parse(req.query);
    const in30 = new Date(Date.now() + 30 * 86400000);
    const where: Prisma.VehicleWhereInput = {
      AND: [
        { deletedAt: null },
        assocScope(req) as Prisma.VehicleWhereInput,
        p.status ? { status: p.status } : {},
        p.associationId ? { associationId: p.associationId } : {},
        p.inspection ? { inspectionStatus: p.inspection } : {},
        p.unassigned ? { assignments: { none: { unassignedAt: null } } } : {},
        p.expiring ? { OR: [{ registrationExpiry: { lte: in30 } }, { insuranceExpiry: { lte: in30 } }, { franchiseExpiry: { lte: in30 } }] } : {},
        p.q ? { OR: [{ plateNumber: { contains: p.q, mode: 'insensitive' } }, { vehicleCode: { contains: p.q, mode: 'insensitive' } }, { franchiseNumber: { contains: p.q, mode: 'insensitive' } }, { ownerName: { contains: p.q, mode: 'insensitive' } }, { bodyNumber: { contains: p.q, mode: 'insensitive' } }] } : {},
      ],
    };
    const ob = orderBy<Prisma.VehicleOrderByWithRelationInput>(p.sort, p.dir, {
      plateNumber: (d) => ({ plateNumber: d }), vehicleCode: (d) => ({ vehicleCode: d }), ownerName: (d) => ({ ownerName: d }), status: (d) => ({ status: d }),
      registrationExpiry: (d) => ({ registrationExpiry: { sort: d, nulls: 'last' } }), association: (d) => ({ association: { name: d } }),
    }, { vehicleCode: 'asc' });
    const [rows, total] = await Promise.all([
      prisma.vehicle.findMany({
        where, orderBy: ob, ...pageArgs(p),
        include: {
          association: { select: { id: true, name: true, code: true, acronym: true } },
          assignments: { where: { unassignedAt: null }, take: 1, include: { driver: { select: { id: true, driverCode: true, firstName: true, lastName: true, middleName: true, suffix: true } } } },
        },
      }),
      prisma.vehicle.count({ where }),
    ]);
    res.json(paged(rows.map(({ assignments, ...v }) => ({ ...v, driver: assignments[0] ? { ...assignments[0].driver, fullName: driverFullName(assignments[0].driver) } : null })), total, p));
  }),
);

vehiclesRouter.post(
  '/',
  requirePermission('vehicles.create'),
  ah(async (req, res) => {
    const body = vehicleBody.extend({ driverId: z.string().uuid().optional().nullable() }).parse(req.body);
    const { driverId, ...data } = body;
    const associationId = req.auth!.scope === 'ASSOCIATION' ? req.auth!.associationId : data.associationId ?? null;
    await assertAssociationAccess(req, associationId);
    const v = await prisma.$transaction(async (tx) => {
      const created = await tx.vehicle.create({ data: { ...data, associationId, vehicleCode: await nextVehicleCode() } });
      if (driverId) await assign(req, tx, created.id, driverId, associationId);
      return created;
    });
    await audit(req, { action: 'CREATE', entity: 'Vehicle', entityId: v.id, summary: `Registered tricycle ${v.plateNumber} (${v.vehicleCode})`, after: v, associationId });
    res.status(201).json(v);
  }),
);

async function assign(req: Request, tx: Prisma.TransactionClient, vehicleId: string, driverId: string, associationId: string | null, remarks?: string | null) {
  const driver = await tx.driver.findFirst({ where: { AND: [{ id: driverId, deletedAt: null }, assocScope(req) as Prisma.DriverWhereInput] } });
  if (!driver) throw new HttpError(400, 'Driver not found');
  if (driver.status !== 'ACTIVE') throw new HttpError(409, `${driverFullName(driver)} is not an active driver`);
  if (associationId && driver.associationId !== associationId) throw new HttpError(409, 'Driver belongs to a different association');
  const now = new Date();
  // A driver drives one tricycle at a time, and a tricycle has one assigned driver.
  await tx.vehicleAssignment.updateMany({ where: { OR: [{ vehicleId }, { driverId }], unassignedAt: null }, data: { unassignedAt: now, remarks: 'Reassigned' } });
  await tx.vehicleAssignment.create({ data: { vehicleId, driverId, assignedById: req.auth!.userId, remarks } });
  return driver;
}

vehiclesRouter.get(
  '/:id',
  requirePermission('vehicles.read'),
  ah(async (req, res) => {
    const base = await loadScoped(req, req.params.id);
    const v = await prisma.vehicle.findUniqueOrThrow({
      where: { id: base.id },
      include: {
        association: { select: { id: true, name: true, code: true, acronym: true } },
        ownerDriver: { select: { id: true, firstName: true, lastName: true, driverCode: true } },
        assignments: { orderBy: { assignedAt: 'desc' }, include: { driver: { select: { id: true, driverCode: true, firstName: true, lastName: true, middleName: true, suffix: true, contactNumber: true, status: true, photoUrl: true } } } },
        documents: { orderBy: { uploadedAt: 'desc' }, include: { verifiedBy: { select: { fullName: true } } } },
        maintenance: { orderBy: { performedAt: 'desc' } },
      },
    });
    const history = await prisma.auditLog.findMany({ where: { entity: 'Vehicle', entityId: v.id }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, action: true, summary: true, userEmail: true, createdAt: true } });
    const current = v.assignments.find((a) => !a.unassignedAt);
    res.json({ ...v, currentDriver: current ? { ...current.driver, fullName: driverFullName(current.driver), assignedAt: current.assignedAt } : null, history, maintenanceTotal: v.maintenance.reduce((s, m) => s + Number(m.cost), 0) });
  }),
);

vehiclesRouter.patch(
  '/:id',
  requirePermission('vehicles.update'),
  ah(async (req, res) => {
    const before = await loadScoped(req, req.params.id);
    const body = vehicleBody.partial().parse(req.body);
    if (body.associationId !== undefined && body.associationId !== before.associationId) {
      if (req.auth!.scope === 'ASSOCIATION') throw new HttpError(403, 'Only organization administrators can move tricycles between associations');
      await assertAssociationAccess(req, body.associationId);
    }
    const after = await prisma.$transaction(async (tx) => {
      const u = await tx.vehicle.update({ where: { id: before.id }, data: body });
      if (body.associationId !== undefined && body.associationId !== before.associationId) {
        await tx.vehicleAssignment.updateMany({ where: { vehicleId: u.id, unassignedAt: null }, data: { unassignedAt: new Date(), remarks: 'Moved to another association' } });
      }
      return u;
    });
    const d = diff(before, after);
    await audit(req, { action: 'UPDATE', entity: 'Vehicle', entityId: after.id, summary: `Updated ${after.plateNumber} (${d.changed.join(', ') || 'no changes'})`, before: d.before, after: d.after, associationId: after.associationId });
    res.json(after);
  }),
);

vehiclesRouter.post(
  '/:id/status',
  requirePermission('vehicles.update'),
  ah(async (req, res) => {
    const { status, remarks } = z.object({ status: z.enum(['OPERATIONAL', 'UNDER_MAINTENANCE', 'INACTIVE']), remarks: optStr(300) }).parse(req.body);
    const v = await loadScoped(req, req.params.id);
    await prisma.vehicle.update({ where: { id: v.id }, data: { status } });
    const label = { OPERATIONAL: 'operational', UNDER_MAINTENANCE: 'under maintenance', INACTIVE: 'inactive' }[status];
    await audit(req, { action: 'STATUS', entity: 'Vehicle', entityId: v.id, summary: `Marked ${v.plateNumber} as ${label}${remarks ? `: ${remarks}` : ''}`, before: { status: v.status }, after: { status }, associationId: v.associationId });
    res.json({ ok: true });
  }),
);

vehiclesRouter.post(
  '/:id/assign',
  requirePermission('vehicles.assign'),
  ah(async (req, res) => {
    const { driverId, remarks } = z.object({ driverId: z.string().uuid().nullable(), remarks: optStr(300) }).parse(req.body);
    const v = await loadScoped(req, req.params.id);
    if (driverId && v.status === 'INACTIVE') throw new HttpError(409, 'Reactivate this tricycle before assigning a driver');
    const driver = await prisma.$transaction(async (tx) => {
      if (!driverId) {
        await tx.vehicleAssignment.updateMany({ where: { vehicleId: v.id, unassignedAt: null }, data: { unassignedAt: new Date(), remarks } });
        return null;
      }
      return assign(req, tx, v.id, driverId, v.associationId, remarks);
    });
    const summary = driver ? `Assigned ${driverFullName(driver)} to ${v.plateNumber}` : `Unassigned driver from ${v.plateNumber}`;
    await audit(req, { action: 'ASSIGN', entity: 'Vehicle', entityId: v.id, summary, associationId: v.associationId });
    if (driver) await audit(req, { action: 'ASSIGN', entity: 'Driver', entityId: driver.id, summary, associationId: v.associationId });
    res.json({ ok: true });
  }),
);

vehiclesRouter.delete(
  '/:id',
  requirePermission('vehicles.delete'),
  ah(async (req, res) => {
    const v = await loadScoped(req, req.params.id);
    await prisma.$transaction([
      prisma.vehicle.update({ where: { id: v.id }, data: { deletedAt: new Date(), status: 'INACTIVE' } }),
      prisma.vehicleAssignment.updateMany({ where: { vehicleId: v.id, unassignedAt: null }, data: { unassignedAt: new Date(), remarks: 'Vehicle archived' } }),
    ]);
    await audit(req, { action: 'DELETE', entity: 'Vehicle', entityId: v.id, summary: `Archived tricycle ${v.plateNumber}`, associationId: v.associationId });
    res.json({ ok: true });
  }),
);

// ───── Maintenance ─────

const maintBody = z.object({
  type: z.enum(['PREVENTIVE', 'REPAIR', 'INSPECTION', 'ACCIDENT_REPAIR', 'OTHER']),
  description: z.string().trim().min(3, 'Describe the work done').max(500),
  shopName: optStr(120),
  cost: z.coerce.number().min(0).max(1_000_000),
  odometerKm: z.coerce.number().int().min(0).optional().nullable(),
  performedAt: reqDate,
  nextDueAt: optDate,
});

vehiclesRouter.post(
  '/:id/maintenance',
  requirePermission('maintenance.manage'),
  ah(async (req, res) => {
    const v = await loadScoped(req, req.params.id);
    const body = maintBody.parse(req.body);
    const m = await prisma.maintenanceRecord.create({ data: { ...body, vehicleId: v.id, createdById: req.auth!.userId } });
    if (body.type === 'INSPECTION') await prisma.vehicle.update({ where: { id: v.id }, data: { lastInspectionAt: body.performedAt } });
    await audit(req, { action: 'MAINTENANCE', entity: 'Vehicle', entityId: v.id, summary: `Recorded ${body.type.toLowerCase().replace('_', ' ')} on ${v.plateNumber}: ${body.description} (₱${body.cost.toFixed(2)})`, after: m, associationId: v.associationId });
    res.status(201).json(m);
  }),
);

vehiclesRouter.delete(
  '/:id/maintenance/:mid',
  requirePermission('maintenance.manage'),
  ah(async (req, res) => {
    const v = await loadScoped(req, req.params.id);
    const m = await prisma.maintenanceRecord.findFirst({ where: { id: req.params.mid, vehicleId: v.id } });
    if (!m) throw notFound('Maintenance record');
    await prisma.maintenanceRecord.delete({ where: { id: m.id } });
    await audit(req, { action: 'DELETE', entity: 'Vehicle', entityId: v.id, summary: `Deleted maintenance record "${m.description}" on ${v.plateNumber}`, before: m, associationId: v.associationId });
    res.json({ ok: true });
  }),
);

// ───── Documents ─────

vehiclesRouter.post(
  '/:id/documents',
  requirePermission('documents.upload'),
  upload.single('file'),
  ah(async (req, res) => {
    const v = await loadScoped(req, req.params.id).catch((e) => {
      if (req.file) removeStored(req.file.filename);
      throw e;
    });
    if (!req.file) throw new HttpError(400, 'Choose a file to upload');
    verifyMagic(req.file.path, req.file.mimetype);
    const body = z.object({ type: z.enum(['OFFICIAL_RECEIPT', 'CERTIFICATE_OF_REGISTRATION', 'FRANCHISE_MTOP', 'INSURANCE', 'INSPECTION_CERTIFICATE', 'DEED_OF_SALE', 'OTHER']), documentNo: optStr(60), expiresAt: optDate }).parse(req.body);
    const doc = await prisma.vehicleDocument.create({ data: { ...body, vehicleId: v.id, fileUrl: req.file.filename, fileName: req.file.originalname.slice(0, 200), mimeType: req.file.mimetype, sizeBytes: req.file.size } });
    await audit(req, { action: 'UPLOAD', entity: 'Vehicle', entityId: v.id, summary: `Uploaded ${body.type.replace(/_/g, ' ').toLowerCase()} for ${v.plateNumber}`, associationId: v.associationId });
    res.status(201).json(doc);
  }),
);

vehiclesRouter.post(
  '/:id/documents/:docId/verify',
  requirePermission('documents.verify'),
  ah(async (req, res) => {
    const { status, remarks } = z.object({ status: z.enum(['VERIFIED', 'REJECTED']), remarks: optStr(500) }).parse(req.body);
    const v = await loadScoped(req, req.params.id);
    const doc = await prisma.vehicleDocument.findFirst({ where: { id: req.params.docId, vehicleId: v.id } });
    if (!doc) throw notFound('Document');
    if (status === 'REJECTED' && !remarks) throw new HttpError(400, 'Say why the document is rejected', { fields: { remarks: 'Required' } });
    const updated = await prisma.vehicleDocument.update({ where: { id: doc.id }, data: { status, remarks, verifiedById: req.auth!.userId, verifiedAt: new Date() } });
    await audit(req, { action: status === 'VERIFIED' ? 'VERIFY' : 'REJECT', entity: 'Vehicle', entityId: v.id, summary: `${status === 'VERIFIED' ? 'Verified' : 'Rejected'} ${doc.type.replace(/_/g, ' ').toLowerCase()} of ${v.plateNumber}`, associationId: v.associationId });
    res.json(updated);
  }),
);

vehiclesRouter.delete(
  '/:id/documents/:docId',
  requirePermission('documents.upload'),
  ah(async (req, res) => {
    const v = await loadScoped(req, req.params.id);
    const doc = await prisma.vehicleDocument.findFirst({ where: { id: req.params.docId, vehicleId: v.id } });
    if (!doc) throw notFound('Document');
    if (doc.status === 'VERIFIED') throw new HttpError(409, 'Verified documents cannot be deleted');
    await prisma.vehicleDocument.delete({ where: { id: doc.id } });
    removeStored(doc.fileUrl);
    await audit(req, { action: 'DELETE', entity: 'Vehicle', entityId: v.id, summary: `Deleted ${doc.type.replace(/_/g, ' ').toLowerCase()} of ${v.plateNumber}`, associationId: v.associationId });
    res.json({ ok: true });
  }),
);
