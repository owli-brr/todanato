import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah, HttpError, notFound, optDate, optStr, orderBy, pageArgs, paged, paginationSchema, reqDate } from '../lib/http';
import { audit, diff } from '../lib/audit';
import { assertAssociationAccess, associationScope, requirePermission } from '../middleware/auth';
import { nextAssociationCode } from '../lib/codes';

export const associationsRouter = Router();

const money = z.coerce.number().min(0, 'Cannot be negative').max(1_000_000);

const assocBody = z.object({
  name: z.string().trim().min(3, 'Enter the association name').max(150),
  acronym: optStr(20),
  barangay: z.string().trim().min(2, 'Enter the barangay').max(100),
  city: z.string().trim().min(2, 'Enter the city or municipality').max(100),
  province: z.string().trim().min(2, 'Enter the province').max(100),
  address: optStr(250),
  terminalLocation: optStr(250),
  contactNumber: optStr(20),
  email: z.string().trim().email('Enter a valid email').optional().nullable().or(z.literal('').transform(() => null)),
  ltfrbAccreditation: optStr(60),
  dateEstablished: optDate,
  status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(),
  monthlyDues: money.optional(),
  dailyContribution: money.optional(),
  membershipFee: money.optional(),
  organizationId: z.string().uuid().optional(),
});

async function loadScoped(req: Express.Request, id: string) {
  const a = await prisma.association.findFirst({ where: { AND: [{ id, deletedAt: null }, associationScope(req as never)] } });
  if (!a) throw notFound('Association');
  return a;
}

associationsRouter.get(
  '/',
  requirePermission('associations.read'),
  ah(async (req, res) => {
    const p = paginationSchema.extend({ status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED']).optional(), all: z.coerce.boolean().optional() }).parse(req.query);
    const where: Prisma.AssociationWhereInput = {
      AND: [
        { deletedAt: null },
        associationScope(req),
        p.status ? { status: p.status } : {},
        p.q ? { OR: [{ name: { contains: p.q, mode: 'insensitive' } }, { code: { contains: p.q, mode: 'insensitive' } }, { barangay: { contains: p.q, mode: 'insensitive' } }, { acronym: { contains: p.q, mode: 'insensitive' } }] } : {},
      ],
    };
    // `all=true` returns a light list for dropdowns.
    if (p.all) {
      return res.json(await prisma.association.findMany({ where, select: { id: true, name: true, code: true, acronym: true }, orderBy: { name: 'asc' } }));
    }
    const ob = orderBy<Prisma.AssociationOrderByWithRelationInput>(p.sort, p.dir, {
      name: (d) => ({ name: d }), code: (d) => ({ code: d }), barangay: (d) => ({ barangay: d }), createdAt: (d) => ({ createdAt: d }),
      drivers: (d) => ({ drivers: { _count: d } }),
    }, { name: 'asc' });
    const [rows, total] = await Promise.all([
      prisma.association.findMany({
        where, orderBy: ob, ...pageArgs(p),
        include: {
          _count: { select: { drivers: { where: { deletedAt: null } }, vehicles: { where: { deletedAt: null } } } },
          officers: { where: { isActive: true, position: 'PRESIDENT' }, select: { name: true }, take: 1 },
        },
      }),
      prisma.association.count({ where }),
    ]);
    const ids = rows.map((r) => r.id);
    const active = await prisma.driver.groupBy({ by: ['associationId'], where: { associationId: { in: ids }, status: 'ACTIVE', deletedAt: null }, _count: true });
    const activeMap = new Map(active.map((a) => [a.associationId, a._count]));
    res.json(paged(rows.map(({ _count, officers, ...r }) => ({ ...r, driverCount: _count.drivers, vehicleCount: _count.vehicles, activeDrivers: activeMap.get(r.id) ?? 0, president: officers[0]?.name ?? null })), total, p));
  }),
);

associationsRouter.get(
  '/:id',
  requirePermission('associations.read'),
  ah(async (req, res) => {
    const a = await loadScoped(req, req.params.id);
    const [officers, driverStats, vehicleStats, membershipStats, pendingApplications, organization] = await Promise.all([
      prisma.associationOfficer.findMany({ where: { associationId: a.id }, orderBy: [{ isActive: 'desc' }, { termStart: 'desc' }] }),
      prisma.driver.groupBy({ by: ['status'], where: { associationId: a.id, deletedAt: null }, _count: true }),
      prisma.vehicle.groupBy({ by: ['status'], where: { associationId: a.id, deletedAt: null }, _count: true }),
      prisma.associationMembership.groupBy({ by: ['status'], where: { associationId: a.id }, _count: true }),
      prisma.driver.count({ where: { associationId: a.id, applicationStatus: 'PENDING', deletedAt: null } }),
      prisma.organization.findUnique({ where: { id: a.organizationId }, select: { id: true, name: true } }),
    ]);
    const toObj = (rows: { _count: number }[], key: string) => Object.fromEntries(rows.map((r) => [(r as unknown as Record<string, string>)[key], r._count]));
    res.json({
      ...a, organization, officers,
      stats: { drivers: toObj(driverStats, 'status'), vehicles: toObj(vehicleStats, 'status'), memberships: toObj(membershipStats, 'status'), pendingApplications },
    });
  }),
);

associationsRouter.patch(
  '/:id',
  requirePermission('associations.update'),
  ah(async (req, res) => {
    const before = await loadScoped(req, req.params.id);
    const { organizationId: _o, ...body } = assocBody.partial().parse(req.body);
    // Association officers may edit details but not change status.
    if (body.status && req.auth!.scope === 'ASSOCIATION') delete body.status;
    const after = await prisma.association.update({ where: { id: before.id }, data: body });
    const d = diff(before, after);
    await audit(req, { action: 'UPDATE', entity: 'Association', entityId: after.id, summary: `Updated ${after.name} (${d.changed.join(', ') || 'no changes'})`, before: d.before, after: d.after, associationId: after.id });
    res.json(after);
  }),
);

// ───── Officers ─────

const officerBody = z.object({
  name: z.string().trim().min(2, 'Enter the officer name').max(120),
  position: z.enum(['PRESIDENT', 'VICE_PRESIDENT', 'SECRETARY', 'TREASURER', 'AUDITOR', 'PRO', 'BOARD_MEMBER', 'DISPATCHER']),
  termStart: reqDate,
  termEnd: optDate,
  driverId: z.string().uuid().optional().nullable(),
  userId: z.string().uuid().optional().nullable(),
});

associationsRouter.post(
  '/:id/officers',
  requirePermission('associations.officers'),
  ah(async (req, res) => {
    const a = await loadScoped(req, req.params.id);
    const body = officerBody.parse(req.body);
    const officer = await prisma.$transaction(async (tx) => {
      // Only one active officer per single-seat position.
      if (body.position !== 'BOARD_MEMBER') {
        await tx.associationOfficer.updateMany({ where: { associationId: a.id, position: body.position, isActive: true }, data: { isActive: false, termEnd: body.termStart } });
      }
      return tx.associationOfficer.create({ data: { ...body, associationId: a.id } });
    });
    await audit(req, { action: 'CREATE', entity: 'AssociationOfficer', entityId: officer.id, summary: `Assigned ${officer.name} as ${officer.position.replace('_', ' ').toLowerCase()} of ${a.name}`, after: officer, associationId: a.id });
    res.status(201).json(officer);
  }),
);

associationsRouter.post(
  '/:id/officers/:officerId/end',
  requirePermission('associations.officers'),
  ah(async (req, res) => {
    const a = await loadScoped(req, req.params.id);
    const o = await prisma.associationOfficer.findFirst({ where: { id: req.params.officerId, associationId: a.id } });
    if (!o) throw notFound('Officer');
    await prisma.associationOfficer.update({ where: { id: o.id }, data: { isActive: false, termEnd: new Date() } });
    await audit(req, { action: 'UPDATE', entity: 'AssociationOfficer', entityId: o.id, summary: `Ended term of ${o.name} (${o.position}) in ${a.name}`, associationId: a.id });
    res.json({ ok: true });
  }),
);

// ───── Memberships ─────

associationsRouter.get(
  '/:id/members',
  requirePermission('memberships.read'),
  ah(async (req, res) => {
    const a = await loadScoped(req, req.params.id);
    const p = paginationSchema.extend({ status: z.enum(['PENDING', 'ACTIVE', 'INACTIVE', 'SUSPENDED', 'REJECTED', 'TERMINATED']).optional() }).parse(req.query);
    const where: Prisma.AssociationMembershipWhereInput = {
      associationId: a.id,
      ...(p.status ? { status: p.status } : {}),
      ...(p.q ? { OR: [{ membershipNo: { contains: p.q, mode: 'insensitive' } }, { driver: { OR: [{ firstName: { contains: p.q, mode: 'insensitive' } }, { lastName: { contains: p.q, mode: 'insensitive' } }, { driverCode: { contains: p.q, mode: 'insensitive' } }] } }] } : {}),
    };
    const [items, total] = await Promise.all([
      prisma.associationMembership.findMany({
        where, ...pageArgs(p), orderBy: [{ status: 'asc' }, { membershipNo: 'asc' }],
        include: { driver: { select: { id: true, driverCode: true, firstName: true, lastName: true, contactNumber: true, status: true, photoUrl: true } } },
      }),
      prisma.associationMembership.count({ where }),
    ]);
    res.json(paged(items, total, p));
  }),
);

associationsRouter.post(
  '/:id/members/:membershipId/status',
  requirePermission('memberships.manage'),
  ah(async (req, res) => {
    const a = await loadScoped(req, req.params.id);
    const { status, remarks } = z.object({ status: z.enum(['ACTIVE', 'INACTIVE', 'SUSPENDED', 'REJECTED', 'TERMINATED']), remarks: optStr(500) }).parse(req.body);
    const m = await prisma.associationMembership.findFirst({ where: { id: req.params.membershipId, associationId: a.id }, include: { driver: true } });
    if (!m) throw notFound('Membership');
    const now = new Date();
    const updated = await prisma.associationMembership.update({
      where: { id: m.id },
      data: {
        status, remarks: remarks ?? m.remarks,
        ...(status === 'ACTIVE' && !m.approvedAt ? { approvedAt: now, approvedById: req.auth!.userId, startDate: now } : {}),
        ...(['TERMINATED', 'INACTIVE'].includes(status) ? { endDate: now } : {}),
      },
    });
    await audit(req, { action: 'MEMBERSHIP_' + status, entity: 'AssociationMembership', entityId: m.id, summary: `Set membership ${m.membershipNo} (${m.driver.firstName} ${m.driver.lastName}) to ${status}`, before: { status: m.status }, after: { status, remarks }, associationId: a.id });
    res.json(updated);
  }),
);

export { assertAssociationAccess };
