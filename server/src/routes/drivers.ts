import { Router, type Request } from 'express';
import { z } from 'zod';
import { Prisma, type Driver } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah, HttpError, notFound, optDate, optStr, orderBy, pageArgs, paged, paginationSchema, phPhone, reqDate } from '../lib/http';
import { audit, diff } from '../lib/audit';
import { assertAssociationAccess, assocScope, can, requirePermission } from '../middleware/auth';
import { nextDriverCode, nextMembershipNo } from '../lib/codes';
import { todaId } from '../lib/toda';
import { removeStored, storeUpload, upload } from '../lib/uploads';

export const driversRouter = Router();

export const driverBody = z.object({
  firstName: z.string().trim().min(1, 'Enter the first name').max(60),
  middleName: optStr(60),
  lastName: z.string().trim().min(1, 'Enter the last name').max(60),
  suffix: optStr(10),
  dateOfBirth: reqDate.refine((d) => {
    const age = (Date.now() - d.getTime()) / (365.25 * 86400000);
    return age >= 18 && age <= 80;
  }, 'Driver must be 18 to 80 years old'),
  gender: z.enum(['MALE', 'FEMALE', 'OTHER', 'PREFER_NOT_TO_SAY']).optional().nullable(),
  contactNumber: phPhone,
  email: z.string().trim().toLowerCase().email('Enter a valid email').optional().nullable().or(z.literal('').transform(() => null)),
  address: z.string().trim().min(5, 'Enter the residential address').max(250),
  barangay: optStr(100),
  city: optStr(100),
  emergencyName: z.string().trim().min(2, 'Enter an emergency contact').max(120),
  emergencyRelation: optStr(40),
  emergencyPhone: phPhone,
  licenseNumber: z.string().trim().toUpperCase().regex(/^[A-Z]\d{2}-\d{2}-\d{6}$/, 'LTO format: A01-23-456789'),
  licenseType: z.enum(['PROFESSIONAL', 'NON_PROFESSIONAL']).default('PROFESSIONAL'),
  licenseExpiry: reqDate,
  memberType: z.enum(['DRIVER', 'OPERATOR', 'DRIVER_OPERATOR']).optional(),
});

const fullName = (d: Pick<Driver, 'firstName' | 'lastName' | 'middleName' | 'suffix'>) =>
  [d.firstName, d.middleName ? d.middleName[0] + '.' : null, d.lastName, d.suffix].filter(Boolean).join(' ');

/** Hide personal details from roles without drivers.pii (RA 10173: need-to-know). */
function maskPII<T extends Partial<Driver>>(req: Request, d: T): T {
  if (can(req, 'drivers.pii')) return d;
  return {
    ...d,
    dateOfBirth: null, address: '••••••', barangay: d.barangay, emergencyName: '••••••', emergencyRelation: null, emergencyPhone: '••••••',
    email: d.email ? d.email.replace(/^(.).*(@.*)$/, '$1•••$2') : null,
  };
}

/** Users without drivers.pii never see these fields, so ignore whatever they send back for them. */
function stripMasked(req: Request, body: Record<string, unknown>) {
  if (can(req, 'drivers.pii')) return body;
  const { dateOfBirth: _a, address: _b, emergencyName: _c, emergencyRelation: _d, emergencyPhone: _e, email: _f, ...rest } = body ?? {};
  return rest;
}

const listQuery = paginationSchema.extend({
  status: z.enum(['PENDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  application: z.enum(['PENDING', 'APPROVED', 'REJECTED']).optional(),
  associationId: z.string().uuid().optional(),
  licenseExpiring: z.coerce.boolean().optional(),
  unassigned: z.coerce.boolean().optional(),
});

function listWhere(req: Request, p: z.infer<typeof listQuery>): Prisma.DriverWhereInput {
  const in30 = new Date(Date.now() + 30 * 86400000);
  return {
    AND: [
      { deletedAt: null },
      assocScope(req) as Prisma.DriverWhereInput,
      p.status ? { status: p.status } : {},
      p.application ? { applicationStatus: p.application } : {},
      p.associationId ? { associationId: p.associationId } : {},
      p.licenseExpiring ? { licenseExpiry: { lte: in30 } } : {},
      p.unassigned ? { vehicleAssignments: { none: { unassignedAt: null } } } : {},
      p.q
        ? {
            OR: [
              { firstName: { contains: p.q, mode: 'insensitive' } },
              { lastName: { contains: p.q, mode: 'insensitive' } },
              { driverCode: { contains: p.q, mode: 'insensitive' } },
              { licenseNumber: { contains: p.q, mode: 'insensitive' } },
              { contactNumber: { contains: p.q } },
              { memberships: { some: { membershipNo: { contains: p.q, mode: 'insensitive' } } } },
            ],
          }
        : {},
    ],
  };
}

const listInclude = {
  association: { select: { id: true, name: true, code: true, acronym: true } },
  memberships: { orderBy: { appliedAt: 'desc' }, take: 1, select: { membershipNo: true, status: true } },
  vehicleAssignments: { where: { unassignedAt: null }, take: 1, select: { vehicle: { select: { id: true, plateNumber: true, vehicleCode: true } } } },
} satisfies Prisma.DriverInclude;

const driverOrder = (p: { sort?: string; dir: 'asc' | 'desc' }) =>
  orderBy<Prisma.DriverOrderByWithRelationInput | Prisma.DriverOrderByWithRelationInput[]>(p.sort, p.dir, {
    name: (d) => [{ lastName: d }, { firstName: d }],
    driverCode: (d) => ({ driverCode: d }),
    status: (d) => ({ status: d }),
    licenseExpiry: (d) => ({ licenseExpiry: d }),
    registeredAt: (d) => ({ registeredAt: d }),
    association: (d) => ({ association: { name: d } }),
  }, [{ lastName: 'asc' }, { firstName: 'asc' }]);

function shapeListRow(req: Request, d: Prisma.DriverGetPayload<{ include: typeof listInclude }>) {
  const { memberships, vehicleAssignments, ...rest } = d;
  return {
    ...maskPII(req, rest),
    fullName: fullName(d),
    membership: memberships[0] ?? null,
    vehicle: vehicleAssignments[0]?.vehicle ?? null,
  };
}

driversRouter.get(
  '/',
  requirePermission('drivers.read'),
  ah(async (req, res) => {
    const p = listQuery.parse(req.query);
    const where = listWhere(req, p);
    const [rows, total] = await Promise.all([
      prisma.driver.findMany({ where, include: listInclude, orderBy: driverOrder(p), ...pageArgs(p) }),
      prisma.driver.count({ where }),
    ]);
    res.json(paged(rows.map((d) => shapeListRow(req, d)), total, p));
  }),
);

driversRouter.get(
  '/export',
  requirePermission('drivers.export'),
  ah(async (req, res) => {
    const p = listQuery.parse({ ...req.query, page: 1, pageSize: 100 });
    const rows = await prisma.driver.findMany({ where: listWhere(req, p), include: listInclude, orderBy: driverOrder(p), take: 10000 });
    const pii = can(req, 'drivers.pii');
    const header = ['Driver ID', 'Membership No', 'Last name', 'First name', 'Middle name', 'Contact', 'Email', ...(pii ? ['Address', 'Date of birth'] : []), 'License no', 'License expiry', 'Association', 'Plate no', 'Status', 'Application', 'Registered'];
    const esc = (v: unknown) => {
      let s = v == null ? '' : String(v);
      if (/^[=+\-@]/.test(s)) s = "'" + s; // block CSV formula injection
      return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
    };
    const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
    const lines = rows.map((d) =>
      [d.driverCode, d.memberships[0]?.membershipNo, d.lastName, d.firstName, d.middleName, d.contactNumber, d.email, ...(pii ? [d.address, day(d.dateOfBirth)] : []), d.licenseNumber, day(d.licenseExpiry), d.association?.name, d.vehicleAssignments[0]?.vehicle.plateNumber, d.status, d.applicationStatus, day(d.registeredAt)].map(esc).join(','),
    );
    await audit(req, { action: 'EXPORT', entity: 'Driver', summary: `Exported ${rows.length} driver records${pii ? ' (with personal details)' : ''}` });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="drivers-${new Date().toISOString().slice(0, 10)}.csv"`);
    res.send('﻿' + [header.join(','), ...lines].join('\r\n'));
  }),
);

driversRouter.post(
  '/',
  requirePermission('drivers.create'),
  ah(async (req, res) => {
    const { memberType, ...body } = driverBody.parse(req.body);
    // Association-level users always register into their own association.
    const associationId = req.auth!.scope === 'ASSOCIATION' ? req.auth!.associationId : await todaId();
    await assertAssociationAccess(req, associationId);
    const driver = await prisma.$transaction(async (tx) => {
      const d = await tx.driver.create({ data: { ...body, associationId, driverCode: await nextDriverCode() } });
      if (associationId) {
        const assoc = await tx.association.findUniqueOrThrow({ where: { id: associationId } });
        await tx.associationMembership.create({
          data: { driverId: d.id, associationId, membershipNo: await nextMembershipNo(assoc.code), memberType: memberType ?? 'DRIVER' },
        });
      }
      return d;
    });
    await audit(req, { action: 'CREATE', entity: 'Driver', entityId: driver.id, summary: `Registered driver ${fullName(driver)} (${driver.driverCode})`, after: { driverCode: driver.driverCode, name: fullName(driver), associationId }, associationId });
    res.status(201).json(driver);
  }),
);

async function loadScoped(req: Request, id: string) {
  const d = await prisma.driver.findFirst({ where: { AND: [{ id, deletedAt: null }, assocScope(req) as Prisma.DriverWhereInput] } });
  if (!d) throw notFound('Driver');
  return d;
}

driversRouter.get(
  '/:id',
  requirePermission('drivers.read'),
  ah(async (req, res) => {
    const base = await loadScoped(req, req.params.id);
    const d = await prisma.driver.findUniqueOrThrow({
      where: { id: base.id },
      include: {
        association: { select: { id: true, name: true, code: true, acronym: true, barangay: true, city: true } },
        documents: { orderBy: { uploadedAt: 'desc' }, include: { verifiedBy: { select: { fullName: true } } } },
        memberships: { orderBy: { appliedAt: 'desc' }, include: { association: { select: { name: true, code: true } } } },
        vehicleAssignments: {
          orderBy: { assignedAt: 'desc' },
          include: { vehicle: { select: { id: true, vehicleCode: true, plateNumber: true, franchiseNumber: true, make: true, model: true, color: true, status: true, registrationExpiry: true, insuranceExpiry: true, inspectionStatus: true, ownerName: true } } },
        },
      },
    });
    const canFinance = can(req, 'finance.read');
    const [payments, paymentTotals, outstanding, rides, rideStats, activity] = await Promise.all([
      canFinance ? prisma.payment.findMany({ where: { driverId: d.id }, orderBy: { paidAt: 'desc' }, take: 50 }) : [],
      canFinance ? prisma.payment.aggregate({ where: { driverId: d.id, status: 'POSTED' }, _sum: { amount: true } }) : null,
      canFinance ? prisma.dueCharge.aggregate({ where: { driverId: d.id, status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } }, _sum: { amount: true, amountPaid: true } }) : null,
      prisma.booking.findMany({ where: { driverId: d.id }, orderBy: { requestedAt: 'desc' }, take: 50, select: { id: true, bookingCode: true, pickupAddress: true, dropoffAddress: true, requestedAt: true, completedAt: true, status: true, actualFare: true, estimatedFare: true, paymentMethod: true } }),
      prisma.booking.groupBy({ by: ['status'], where: { driverId: d.id }, _count: true, _sum: { actualFare: true } }),
      prisma.auditLog.findMany({ where: { entity: 'Driver', entityId: d.id }, orderBy: { createdAt: 'desc' }, take: 50, select: { id: true, action: true, summary: true, userEmail: true, createdAt: true } }),
    ]);
    const completed = rideStats.find((r) => r.status === 'COMPLETED');
    res.json({
      ...maskPII(req, d),
      fullName: fullName(d),
      currentVehicle: d.vehicleAssignments.find((a) => !a.unassignedAt)?.vehicle ?? null,
      payments,
      finance: canFinance
        ? { totalPaid: paymentTotals?._sum.amount ?? 0, outstanding: Number(outstanding?._sum.amount ?? 0) - Number(outstanding?._sum.amountPaid ?? 0) }
        : null,
      rides,
      rideSummary: { total: rideStats.reduce((s, r) => s + r._count, 0), completed: completed?._count ?? 0, earnings: completed?._sum.actualFare ?? 0 },
      activity,
    });
  }),
);

driversRouter.patch(
  '/:id',
  requirePermission('drivers.update'),
  ah(async (req, res) => {
    const before = await loadScoped(req, req.params.id);
    const { memberType: _m, ...body } = driverBody.partial().parse(stripMasked(req, req.body));
    const after = await prisma.driver.update({ where: { id: before.id }, data: body });
    const d = diff(before, after);
    await audit(req, { action: 'UPDATE', entity: 'Driver', entityId: after.id, summary: `Updated ${fullName(after)} (${d.changed.join(', ') || 'no changes'})`, before: d.before, after: d.after, associationId: after.associationId });
    res.json(after);
  }),
);

driversRouter.post(
  '/:id/application',
  requirePermission('drivers.approve'),
  ah(async (req, res) => {
    const { decision, reason } = z.object({ decision: z.enum(['APPROVE', 'REJECT']), reason: optStr(500) }).parse(req.body);
    const d = await loadScoped(req, req.params.id);
    if (d.applicationStatus !== 'PENDING') throw new HttpError(409, 'This application was already decided');
    if (decision === 'REJECT' && !reason) throw new HttpError(400, 'Give a reason for rejecting', { fields: { reason: 'Required' } });
        const now = new Date();
    await prisma.$transaction([
      prisma.driver.update({
        where: { id: d.id },
        data: decision === 'APPROVE'
          ? { applicationStatus: 'APPROVED', status: 'ACTIVE', approvedAt: now, rejectionReason: null }
          : { applicationStatus: 'REJECTED', status: 'INACTIVE', rejectionReason: reason },
      }),
      prisma.associationMembership.updateMany({
        where: { driverId: d.id, status: 'PENDING' },
        data: decision === 'APPROVE' ? { status: 'ACTIVE', approvedAt: now, approvedById: req.auth!.userId, startDate: now } : { status: 'REJECTED', remarks: reason },
      }),
    ]);
    await audit(req, { action: decision === 'APPROVE' ? 'APPROVE' : 'REJECT', entity: 'Driver', entityId: d.id, summary: `${decision === 'APPROVE' ? 'Approved' : 'Rejected'} application of ${fullName(d)}${reason ? `: ${reason}` : ''}`, associationId: d.associationId });
    res.json({ ok: true });
  }),
);

driversRouter.post(
  '/:id/status',
  requirePermission('drivers.status'),
  ah(async (req, res) => {
    const body = z
      .object({ status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']), reason: optStr(500), suspendedUntil: optDate })
      .parse(req.body);
    const d = await loadScoped(req, req.params.id);
    if (d.applicationStatus !== 'APPROVED' && body.status === 'ACTIVE') throw new HttpError(409, 'Approve the application before activating this driver');
    if (body.status === 'SUSPENDED' && !body.reason) throw new HttpError(400, 'Give a reason for the suspension', { fields: { reason: 'Required' } });
    const after = await prisma.driver.update({
      where: { id: d.id },
      data: {
        status: body.status,
        suspensionReason: body.status === 'SUSPENDED' ? body.reason : null,
        suspendedUntil: body.status === 'SUSPENDED' ? body.suspendedUntil : null,
        ...(body.status !== 'ACTIVE' ? { isOnline: false, availability: 'OFFLINE' } : {}),
      },
    });
    await prisma.associationMembership.updateMany({
      where: { driverId: d.id, status: { in: ['ACTIVE', 'SUSPENDED', 'INACTIVE'] } },
      data: { status: body.status },
    });
    const verb = { ACTIVE: 'Activated', INACTIVE: 'Deactivated', SUSPENDED: 'Suspended' }[body.status];
    await audit(req, { action: body.status === 'SUSPENDED' ? 'SUSPEND' : body.status === 'ACTIVE' ? 'ACTIVATE' : 'DEACTIVATE', entity: 'Driver', entityId: d.id, summary: `${verb} ${fullName(d)}${body.reason ? `: ${body.reason}` : ''}`, before: { status: d.status }, after: { status: after.status, reason: body.reason }, associationId: d.associationId });
    res.json(after);
  }),
);

driversRouter.delete(
  '/:id',
  requirePermission('drivers.delete'),
  ah(async (req, res) => {
    const d = await loadScoped(req, req.params.id);
    await prisma.$transaction([
      prisma.driver.update({ where: { id: d.id }, data: { deletedAt: new Date(), status: 'INACTIVE', isOnline: false } }),
      prisma.vehicleAssignment.updateMany({ where: { driverId: d.id, unassignedAt: null }, data: { unassignedAt: new Date(), remarks: 'Driver archived' } }),
    ]);
    await audit(req, { action: 'DELETE', entity: 'Driver', entityId: d.id, summary: `Archived driver ${fullName(d)} (${d.driverCode})`, associationId: d.associationId });
    res.json({ ok: true });
  }),
);

// ───── Photo & documents ─────

driversRouter.post(
  '/:id/photo',
  requirePermission('drivers.update'),
  upload.single('file'),
  ah(async (req, res) => {
    const d = await loadScoped(req, req.params.id);
    if (req.file && !req.file.mimetype.startsWith('image/')) throw new HttpError(400, 'Profile photo must be an image');
    const photoUrl = await storeUpload(req.file, 'Choose a photo');
    const updated = await prisma.driver.update({ where: { id: d.id }, data: { photoUrl } });
    await removeStored(d.photoUrl);
    await audit(req, { action: 'UPDATE', entity: 'Driver', entityId: d.id, summary: `Updated profile photo of ${fullName(d)}`, associationId: d.associationId });
    res.json({ photoUrl: updated.photoUrl });
  }),
);

const docBody = z.object({
  type: z.enum(['DRIVERS_LICENSE', 'GOVERNMENT_ID', 'BARANGAY_CLEARANCE', 'NBI_CLEARANCE', 'POLICE_CLEARANCE', 'MEDICAL_CERTIFICATE', 'DRUG_TEST', 'MEMBERSHIP_FORM', 'PHOTO', 'OTHER']),
  documentNo: optStr(60),
  issuedAt: optDate,
  expiresAt: optDate,
});

driversRouter.post(
  '/:id/documents',
  requirePermission('documents.upload'),
  upload.single('file'),
  ah(async (req, res) => {
    const d = await loadScoped(req, req.params.id);
    const body = docBody.parse(req.body);
    const fileUrl = await storeUpload(req.file);
    const file = req.file!;
    const doc = await prisma.driverDocument.create({
      data: { ...body, driverId: d.id, fileUrl, fileName: file.originalname.slice(0, 200), mimeType: file.mimetype, sizeBytes: file.size },
    });
    await audit(req, { action: 'UPLOAD', entity: 'Driver', entityId: d.id, summary: `Uploaded ${body.type.replace(/_/g, ' ').toLowerCase()} for ${fullName(d)}`, associationId: d.associationId });
    res.status(201).json(doc);
  }),
);

driversRouter.post(
  '/:id/documents/:docId/verify',
  requirePermission('documents.verify'),
  ah(async (req, res) => {
    const { status, remarks } = z.object({ status: z.enum(['VERIFIED', 'REJECTED']), remarks: optStr(500) }).parse(req.body);
    const d = await loadScoped(req, req.params.id);
    const doc = await prisma.driverDocument.findFirst({ where: { id: req.params.docId, driverId: d.id } });
    if (!doc) throw notFound('Document');
    if (status === 'REJECTED' && !remarks) throw new HttpError(400, 'Say why the document is rejected', { fields: { remarks: 'Required' } });
    const updated = await prisma.driverDocument.update({ where: { id: doc.id }, data: { status, remarks, verifiedById: req.auth!.userId, verifiedAt: new Date() } });
    await audit(req, { action: status === 'VERIFIED' ? 'VERIFY' : 'REJECT', entity: 'Driver', entityId: d.id, summary: `${status === 'VERIFIED' ? 'Verified' : 'Rejected'} ${doc.type.replace(/_/g, ' ').toLowerCase()} of ${fullName(d)}${remarks ? `: ${remarks}` : ''}`, associationId: d.associationId });
    res.json(updated);
  }),
);

driversRouter.delete(
  '/:id/documents/:docId',
  requirePermission('documents.upload'),
  ah(async (req, res) => {
    const d = await loadScoped(req, req.params.id);
    const doc = await prisma.driverDocument.findFirst({ where: { id: req.params.docId, driverId: d.id } });
    if (!doc) throw notFound('Document');
    if (doc.status === 'VERIFIED') throw new HttpError(409, 'Verified documents cannot be deleted');
    await prisma.driverDocument.delete({ where: { id: doc.id } });
    await removeStored(doc.fileUrl);
    await audit(req, { action: 'DELETE', entity: 'Driver', entityId: d.id, summary: `Deleted ${doc.type.replace(/_/g, ' ').toLowerCase()} (${doc.fileName}) of ${fullName(d)}`, associationId: d.associationId });
    res.json({ ok: true });
  }),
);

export { fullName as driverFullName, loadScoped as loadScopedDriver };
