import { Router, type Request } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/http';
import { assocScope, can, requirePermission } from '../middleware/auth';
import { driverFullName } from './drivers';

export const dashboardRouter = Router();
const TZ = 'Asia/Manila';

/** null = no restriction (Super Admin); otherwise the association ids this user may see. */
async function allowedAssociationIds(req: Request): Promise<string[] | null> {
  const a = req.auth!;
  if (a.scope === 'GLOBAL') return null;
  if (a.scope === 'ASSOCIATION') return a.associationId ? [a.associationId] : [];
  const rows = await prisma.association.findMany({ where: { organizationId: a.organizationId ?? '__none__' }, select: { id: true } });
  return rows.map((r) => r.id);
}

/** Start of today in Manila, as a UTC Date. */
function manilaStartOfDay(offsetDays = 0) {
  const now = new Date();
  const ymd = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(now);
  const d = new Date(`${ymd}T00:00:00+08:00`);
  d.setUTCDate(d.getUTCDate() + offsetDays);
  return d;
}
function manilaStartOfMonth() {
  const ym = new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit' }).format(new Date());
  return new Date(`${ym}-01T00:00:00+08:00`);
}

const num = (v: Prisma.Decimal | number | null | undefined) => Number(v ?? 0);

dashboardRouter.get(
  '/summary',
  requirePermission('dashboard.view'),
  ah(async (req, res) => {
    const scope = assocScope(req);
    const dScope = { AND: [{ deletedAt: null }, scope] } as Prisma.DriverWhereInput;
    const today = manilaStartOfDay();
    const monthStart = manilaStartOfMonth();
    const in30 = new Date(Date.now() + 30 * 86400000);
    const finance = can(req, 'finance.read');
    const ids = await allowedAssociationIds(req);

    const [
      driverByStatus, pendingApps, vehicles, vehiclesByStatus, associations,
      ridesToday, collectionsToday, collectionsMonth, expensesMonth, outstanding, onlineDrivers,
    ] = await Promise.all([
      prisma.driver.groupBy({ by: ['status'], where: dScope, _count: true }),
      prisma.driver.count({ where: { AND: [dScope, { applicationStatus: 'PENDING' }] } }),
      prisma.vehicle.count({ where: { AND: [{ deletedAt: null }, scope as Prisma.VehicleWhereInput] } }),
      prisma.vehicle.groupBy({ by: ['status'], where: { AND: [{ deletedAt: null }, scope as Prisma.VehicleWhereInput] }, _count: true }),
      prisma.association.count({ where: { deletedAt: null, ...(ids ? { id: { in: ids } } : {}) } }),
      prisma.booking.groupBy({ by: ['status'], where: { AND: [scope as Prisma.BookingWhereInput, { requestedAt: { gte: today } }] }, _count: true }),
      finance ? prisma.payment.aggregate({ where: { AND: [scope as Prisma.PaymentWhereInput, { status: 'POSTED', paidAt: { gte: today } }] }, _sum: { amount: true }, _count: true }) : null,
      finance ? prisma.payment.aggregate({ where: { AND: [scope as Prisma.PaymentWhereInput, { status: 'POSTED', paidAt: { gte: monthStart } }] }, _sum: { amount: true } }) : null,
      finance ? prisma.expense.aggregate({ where: { spentAt: { gte: monthStart }, ...(ids ? { OR: [{ associationId: { in: ids } }, ...(req.auth!.scope === 'ORGANIZATION' ? [{ associationId: null, organizationId: req.auth!.organizationId! }] : [])] } : {}) }, _sum: { amount: true } }) : null,
      finance ? prisma.dueCharge.aggregate({ where: { AND: [scope as Prisma.DueChargeWhereInput, { status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } }] }, _sum: { amount: true, amountPaid: true }, _count: true }) : null,
      prisma.driver.groupBy({ by: ['availability'], where: { AND: [dScope, { status: 'ACTIVE' }] }, _count: true }),
    ]);

    const byStatus = Object.fromEntries(driverByStatus.map((r) => [r.status, r._count]));
    const rides = Object.fromEntries(ridesToday.map((r) => [r.status, r._count]));
    const ongoing = ['ACCEPTED', 'DRIVER_ASSIGNED', 'DRIVER_ARRIVING', 'PASSENGER_PICKED_UP', 'IN_TRANSIT'].reduce((s, k) => s + (rides[k] ?? 0), 0);
    const avail = Object.fromEntries(onlineDrivers.map((r) => [r.availability, r._count]));

    res.json({
      drivers: {
        total: driverByStatus.reduce((s, r) => s + r._count, 0),
        active: byStatus.ACTIVE ?? 0, inactive: byStatus.INACTIVE ?? 0, suspended: byStatus.SUSPENDED ?? 0, pending: byStatus.PENDING ?? 0,
        pendingApplications: pendingApps,
      },
      vehicles: { total: vehicles, byStatus: Object.fromEntries(vehiclesByStatus.map((r) => [r.status, r._count])) },
      associations,
      ridesToday: {
        total: ridesToday.reduce((s, r) => s + r._count, 0),
        pending: rides.PENDING ?? 0, ongoing, completed: rides.COMPLETED ?? 0, cancelled: rides.CANCELLED ?? 0,
      },
      finance: finance
        ? {
            collectionsToday: num(collectionsToday?._sum.amount), transactionsToday: collectionsToday?._count ?? 0,
            monthIncome: num(collectionsMonth?._sum.amount), monthExpenses: num(expensesMonth?._sum.amount),
            outstanding: num(outstanding?._sum.amount) - num(outstanding?._sum.amountPaid), outstandingCount: outstanding?._count ?? 0,
          }
        : null,
      live: { available: avail.AVAILABLE ?? 0, onTrip: avail.ON_TRIP ?? 0, onBreak: avail.BREAK ?? 0, offline: avail.OFFLINE ?? 0 },
      licenseExpiringSoon: await prisma.driver.count({ where: { AND: [dScope, { status: { not: 'INACTIVE' } }, { licenseExpiry: { lte: in30 } }] } }),
    });
  }),
);

dashboardRouter.get(
  '/activity',
  requirePermission('dashboard.view'),
  ah(async (req, res) => {
    const { period } = z.object({ period: z.enum(['daily', 'weekly', 'monthly']).default('daily') }).parse(req.query);
    const ids = await allowedAssociationIds(req);
    const unit = { daily: 'day', weekly: 'week', monthly: 'month' }[period];
    const count = { daily: 14, weekly: 12, monthly: 12 }[period];
    const since = new Date(Date.now() - (period === 'daily' ? 14 : period === 'weekly' ? 84 : 366) * 86400000);
    const filter = ids ? Prisma.sql`AND "associationId" = ANY(${ids}::text[])` : Prisma.empty;
    const bucket = Prisma.raw(`date_trunc('${unit}', (ts AT TIME ZONE 'UTC') AT TIME ZONE '${TZ}')`);

    const rides = await prisma.$queryRaw<{ b: Date; completed: bigint; cancelled: bigint; total: bigint; fares: number | null }[]>`
      SELECT ${bucket} AS b,
        COUNT(*) FILTER (WHERE status = 'COMPLETED') AS completed,
        COUNT(*) FILTER (WHERE status = 'CANCELLED') AS cancelled,
        COUNT(*) AS total,
        SUM("actualFare") FILTER (WHERE status = 'COMPLETED')::float AS fares
      FROM (SELECT "requestedAt" AS ts, status, "actualFare", "associationId" FROM "Booking") x
      WHERE ts >= ${since} ${filter}
      GROUP BY 1 ORDER BY 1`;
    const regs = await prisma.$queryRaw<{ b: Date; n: bigint }[]>`
      SELECT ${bucket} AS b, COUNT(*) AS n
      FROM (SELECT "registeredAt" AS ts, "associationId" FROM "Driver" WHERE "deletedAt" IS NULL) x
      WHERE ts >= ${since} ${filter}
      GROUP BY 1 ORDER BY 1`;
    const finance = can(req, 'finance.read');
    const pay = finance
      ? await prisma.$queryRaw<{ b: Date; amount: number }[]>`
      SELECT ${bucket} AS b, SUM(amount)::float AS amount
      FROM (SELECT "paidAt" AS ts, amount, "associationId", status FROM "Payment") x
      WHERE ts >= ${since} AND status = 'POSTED' ${filter}
      GROUP BY 1 ORDER BY 1`
      : [];
    const exp = finance
      ? await prisma.$queryRaw<{ b: Date; amount: number }[]>`
      SELECT ${bucket} AS b, SUM(amount)::float AS amount
      FROM (SELECT "spentAt" AS ts, amount, "associationId" FROM "Expense") x
      WHERE ts >= ${since} ${ids ? Prisma.sql`AND ("associationId" = ANY(${ids}::text[]) ${req.auth!.scope === 'ORGANIZATION' ? Prisma.sql`OR "associationId" IS NULL` : Prisma.empty})` : Prisma.empty}
      GROUP BY 1 ORDER BY 1`
      : [];

    // Build a continuous series so empty buckets show as zero.
    const key = (d: Date) => d.toISOString().slice(0, 10);
    const buckets: Date[] = [];
    const now = new Date(new Intl.DateTimeFormat('en-CA', { timeZone: TZ }).format(new Date()) + 'T00:00:00Z');
    for (let i = count - 1; i >= 0; i--) {
      const d = new Date(now);
      if (period === 'daily') d.setUTCDate(d.getUTCDate() - i);
      if (period === 'weekly') { d.setUTCDate(d.getUTCDate() - ((d.getUTCDay() + 6) % 7) - i * 7); }
      if (period === 'monthly') { d.setUTCDate(1); d.setUTCMonth(d.getUTCMonth() - i); }
      buckets.push(d);
    }
    const m = <T extends { b: Date }>(rows: T[]) => new Map(rows.map((r) => [key(new Date(r.b)), r]));
    const rm = m(rides), gm = m(regs), pm = m(pay), em = m(exp);
    const label = (d: Date) =>
      period === 'monthly' ? d.toLocaleDateString('en-PH', { month: 'short', year: '2-digit', timeZone: 'UTC' })
        : d.toLocaleDateString('en-PH', { month: 'short', day: 'numeric', timeZone: 'UTC' });
    res.json(
      buckets.map((d) => {
        const k = key(d);
        const r = rm.get(k);
        return {
          bucket: k, label: label(d),
          rides: Number(r?.total ?? 0), completed: Number(r?.completed ?? 0), cancelled: Number(r?.cancelled ?? 0), fares: Number(r?.fares ?? 0),
          registrations: Number(gm.get(k)?.n ?? 0),
          collections: finance ? Number(pm.get(k)?.amount ?? 0) : null,
          expenses: finance ? Number(em.get(k)?.amount ?? 0) : null,
        };
      }),
    );
  }),
);

dashboardRouter.get(
  '/feed',
  requirePermission('dashboard.view'),
  ah(async (req, res) => {
    const scope = assocScope(req);
    const ids = await allowedAssociationIds(req);
    const in30 = new Date(Date.now() + 30 * 86400000);
    const dScope = { AND: [{ deletedAt: null }, scope] } as Prisma.DriverWhereInput;
    const vScope = { AND: [{ deletedAt: null }, scope] } as Prisma.VehicleWhereInput;
    const finance = can(req, 'finance.read');

    const [transactions, activities, pendingDrivers, pendingDriverDocs, pendingVehicleDocs, expLicenses, expVehicles, liveDrivers] = await Promise.all([
      finance
        ? prisma.payment.findMany({ where: { AND: [scope as Prisma.PaymentWhereInput, { status: 'POSTED' }] }, orderBy: { paidAt: 'desc' }, take: 8, include: { driver: { select: { firstName: true, lastName: true, middleName: true, suffix: true } }, association: { select: { acronym: true, name: true } } } })
        : [],
      can(req, 'audit.read')
        ? prisma.auditLog.findMany({ where: { action: { not: 'LOGIN' }, ...(ids ? { associationId: { in: ids } } : {}) }, orderBy: { createdAt: 'desc' }, take: 10, select: { id: true, action: true, entity: true, entityId: true, summary: true, userEmail: true, createdAt: true } })
        : [],
      prisma.driver.findMany({ where: { AND: [dScope, { applicationStatus: 'PENDING' }] }, orderBy: { registeredAt: 'asc' }, take: 6, select: { id: true, driverCode: true, firstName: true, lastName: true, middleName: true, suffix: true, registeredAt: true, association: { select: { acronym: true, name: true } } } }),
      prisma.driverDocument.count({ where: { status: 'PENDING', driver: dScope } }),
      prisma.vehicleDocument.count({ where: { status: 'PENDING', vehicle: vScope } }),
      prisma.driver.findMany({ where: { AND: [dScope, { status: { not: 'INACTIVE' } }, { licenseExpiry: { lte: in30 } }] }, orderBy: { licenseExpiry: 'asc' }, take: 8, select: { id: true, firstName: true, lastName: true, middleName: true, suffix: true, driverCode: true, licenseExpiry: true } }),
      prisma.vehicle.findMany({ where: { AND: [vScope, { status: { not: 'INACTIVE' } }, { OR: [{ registrationExpiry: { lte: in30 } }, { insuranceExpiry: { lte: in30 } }, { franchiseExpiry: { lte: in30 } }] }] }, take: 20, select: { id: true, plateNumber: true, registrationExpiry: true, insuranceExpiry: true, franchiseExpiry: true } }),
      prisma.driver.findMany({ where: { AND: [dScope, { status: 'ACTIVE' }, { availability: { not: 'OFFLINE' } }] }, orderBy: { lastLocationAt: 'desc' }, take: 8, select: { id: true, firstName: true, lastName: true, middleName: true, suffix: true, availability: true, lastLocationAt: true, association: { select: { acronym: true } } } }),
    ]);

    type Exp = { kind: string; id: string; label: string; document: string; expiresAt: Date; link: string };
    const expiring: Exp[] = [
      ...expLicenses.map((d) => ({ kind: 'driver', id: d.id, label: driverFullName(d), document: "Driver's license", expiresAt: d.licenseExpiry, link: `/drivers/${d.id}` })),
      ...expVehicles.flatMap((v) =>
        ([['Registration', v.registrationExpiry], ['Insurance', v.insuranceExpiry], ['Franchise', v.franchiseExpiry]] as const)
          .filter(([, d]) => d && d <= in30)
          .map(([doc, d]) => ({ kind: 'vehicle', id: v.id, label: v.plateNumber, document: doc, expiresAt: d!, link: `/vehicles/${v.id}` })),
      ),
    ].sort((a, b) => a.expiresAt.getTime() - b.expiresAt.getTime()).slice(0, 10);

    res.json({
      transactions: transactions.map((t) => ({ id: t.id, receiptNo: t.receiptNo, type: t.type, method: t.method, amount: num(t.amount), paidAt: t.paidAt, driver: t.driver ? driverFullName(t.driver) : null, association: t.association.acronym ?? t.association.name })),
      activities,
      pending: {
        drivers: pendingDrivers.map((d) => ({ id: d.id, driverCode: d.driverCode, name: driverFullName(d), registeredAt: d.registeredAt, association: d.association?.acronym ?? d.association?.name ?? 'Unassigned' })),
        driverDocuments: pendingDriverDocs,
        vehicleDocuments: pendingVehicleDocs,
      },
      expiring,
      liveDrivers: liveDrivers.map((d) => ({ id: d.id, name: driverFullName(d), availability: d.availability, lastSeen: d.lastLocationAt, association: d.association?.acronym })),
    });
  }),
);
