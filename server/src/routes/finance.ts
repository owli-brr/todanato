import { Router, type Request } from 'express';
import { z } from 'zod';
import { Prisma, type DueStatus } from '@prisma/client';
import { prisma, table } from '../lib/prisma';
import { ah, HttpError, notFound, optStr, orderBy, pageArgs, paged, paginationSchema } from '../lib/http';
import { audit } from '../lib/audit';
import { assocScope, can, requirePermission } from '../middleware/auth';
import { theToda, todaId } from '../lib/toda';
import { driverFullName } from './drivers';

export const financeRouter = Router();

const PAYMENT_TYPES = ['MEMBERSHIP_FEE', 'DAILY_CONTRIBUTION', 'WEEKLY_CONTRIBUTION', 'MONTHLY_DUES', 'ASSOCIATION_FEE', 'RIDE_COMMISSION', 'PENALTY', 'OTHER'] as const;
const METHODS = ['CASH', 'GCASH', 'MAYA', 'BANK_TRANSFER', 'OTHER'] as const;
const OPEN: DueStatus[] = ['UNPAID', 'PARTIAL', 'OVERDUE'];
const money = (n: Prisma.Decimal | number | string | null | undefined) => Math.round(Number(n ?? 0) * 100) / 100;
const dateOnly = z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Use YYYY-MM-DD');

/** Status a charge should have given what is paid against it. WAIVED is set by hand and kept. */
export function dueStatus(amount: number, paid: number, dueDate: Date): DueStatus {
  if (paid >= amount) return 'PAID';
  if (paid > 0) return 'PARTIAL';
  return dueDate.getTime() < Date.now() ? 'OVERDUE' : 'UNPAID';
}

/** Re-derive amountPaid and status of charges from their posted allocations. */
async function settleDues(tx: Prisma.TransactionClient, dueIds: string[]) {
  for (const id of dueIds) {
    const due = await tx.dueCharge.findUniqueOrThrow({ where: { id } });
    const sum = await tx.paymentAllocation.aggregate({ where: { dueId: id, payment: { status: 'POSTED' } }, _sum: { amount: true } });
    const paid = money(sum._sum.amount);
    await tx.dueCharge.update({ where: { id }, data: { amountPaid: paid, status: due.status === 'WAIVED' ? 'WAIVED' : dueStatus(money(due.amount), paid, due.dueDate) } });
  }
}

/** Next official-receipt number for the year, e.g. OR-2026-000123. */
async function nextReceiptNo(tx: Prisma.TransactionClient, at: Date) {
  const prefix = `OR-${at.getUTCFullYear()}-`;
  const last = await tx.payment.findFirst({ where: { receiptNo: { startsWith: prefix } }, orderBy: { receiptNo: 'desc' }, select: { receiptNo: true } });
  const n = last ? parseInt(last.receiptNo.slice(prefix.length), 10) + 1 : 1;
  return prefix + String(n).padStart(6, '0');
}

const paymentBody = z.object({
  driverId: z.string().uuid().optional().nullable(),
  type: z.enum(PAYMENT_TYPES, { errorMap: () => ({ message: 'Choose what the payment is for' }) }),
  method: z.enum(METHODS, { errorMap: () => ({ message: 'Choose how it was paid' }) }),
  amount: z.coerce.number({ invalid_type_error: 'Enter the amount' }).positive('Enter an amount above zero').max(1_000_000, 'That amount looks too large'),
  referenceNo: optStr(60),
  paidAt: z.coerce.date().optional(),
  notes: optStr(300),
  dueIds: z.array(z.string().uuid()).optional(),
}).superRefine((b, ctx) => {
  if (['GCASH', 'MAYA', 'BANK_TRANSFER'].includes(b.method) && !b.referenceNo) ctx.addIssue({ code: 'custom', path: ['referenceNo'], message: 'Enter the transaction reference number' });
  if (b.paidAt && b.paidAt.getTime() > Date.now() + 5 * 60_000) ctx.addIssue({ code: 'custom', path: ['paidAt'], message: 'The payment date can’t be in the future' });
  if (!b.driverId && ['MONTHLY_DUES', 'DAILY_CONTRIBUTION', 'WEEKLY_CONTRIBUTION', 'MEMBERSHIP_FEE', 'PENALTY'].includes(b.type)) ctx.addIssue({ code: 'custom', path: ['driverId'], message: 'Choose the driver who paid' });
});
type PaymentInput = z.infer<typeof paymentBody>;

/** Creates a payment (with receipt number) and applies it to the driver's open charges of the same type, oldest first. */
async function createPayment(tx: Prisma.TransactionClient, req: Request, b: PaymentInput, replacesId?: string) {
  const associationId = await todaId();
  if (b.driverId) {
    const d = await tx.driver.findFirst({ where: { id: b.driverId, deletedAt: null, associationId } });
    if (!d) throw new HttpError(400, 'Driver not found', { fields: { driverId: 'Driver not found' } });
  }
  const paidAt = b.paidAt ?? new Date();
  const payment = await tx.payment.create({
    data: {
      receiptNo: await nextReceiptNo(tx, paidAt), driverId: b.driverId ?? null, associationId, type: b.type, method: b.method,
      amount: b.amount, referenceNo: b.referenceNo, paidAt, notes: b.notes, recordedById: req.auth!.userId, replacesId: replacesId ?? null,
    },
  });
  if (b.driverId) {
    const open = await tx.dueCharge.findMany({
      where: { driverId: b.driverId, status: { in: OPEN }, ...(b.dueIds?.length ? { id: { in: b.dueIds } } : { type: b.type }) },
      orderBy: { dueDate: 'asc' },
    });
    let left = b.amount;
    const touched: string[] = [];
    for (const due of open) {
      if (left <= 0) break;
      const apply = Math.min(left, money(due.amount) - money(due.amountPaid));
      if (apply <= 0) continue;
      await tx.paymentAllocation.create({ data: { paymentId: payment.id, dueId: due.id, amount: apply } });
      touched.push(due.id);
      left = money(left - apply);
    }
    await settleDues(tx, touched);
  }
  return payment;
}

const inTx = <T>(fn: (tx: Prisma.TransactionClient) => Promise<T>) =>
  (async () => {
    // Receipt numbers are sequential; retry if two clerks post at the same moment.
    for (let i = 0; ; i++) {
      try { return await prisma.$transaction(fn, { isolationLevel: 'Serializable', timeout: 15_000 }); }
      catch (e) {
        const retry = (e instanceof Prisma.PrismaClientKnownRequestError && ['P2002', 'P2034'].includes(e.code));
        if (!retry || i >= 4) throw e;
      }
    }
  })();

function range(q: { from?: string; to?: string }, fallbackDays?: number) {
  const from = q.from ? new Date(`${q.from}T00:00:00+08:00`) : fallbackDays ? new Date(Date.now() - fallbackDays * 86400000) : undefined;
  const to = q.to ? new Date(`${q.to}T23:59:59.999+08:00`) : undefined;
  return from || to ? { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } : undefined;
}

// ───────────── Summary ─────────────

financeRouter.get('/summary', requirePermission('finance.read'), ah(async (req, res) => {
  const q = z.object({ from: dateOnly.optional(), to: dateOnly.optional() }).parse(req.query);
  const manila = new Date(Date.now() + 8 * 3600000);
  const monthStart = new Date(Date.UTC(manila.getUTCFullYear(), manila.getUTCMonth(), 1) - 8 * 3600000);
  const now = new Date();
  const paidAt = range(q) ?? { gte: monthStart };
  const scope = assocScope(req);
  const posted = { AND: [scope as Prisma.PaymentWhereInput, { status: 'POSTED' as const, paidAt }] };
  const [byType, byMethod, expByCat, outstanding, overdueDrivers, months] = await Promise.all([
    prisma.payment.groupBy({ by: ['type'], where: posted, _sum: { amount: true }, _count: true }),
    prisma.payment.groupBy({ by: ['method'], where: posted, _sum: { amount: true }, _count: true }),
    prisma.expense.groupBy({ by: ['category'], where: { spentAt: paidAt }, _sum: { amount: true }, _count: true }),
    prisma.dueCharge.aggregate({ where: { AND: [scope as Prisma.DueChargeWhereInput, { status: { in: OPEN } }] }, _sum: { amount: true, amountPaid: true }, _count: true }),
    prisma.dueCharge.groupBy({ by: ['driverId'], where: { AND: [scope as Prisma.DueChargeWhereInput, { status: { in: OPEN }, dueDate: { lt: now } }] } }),
    prisma.$queryRaw<{ m: Date; collected: number | null; spent: number | null }[]>`
      SELECT m.m, c.total::float AS collected, e.total::float AS spent
      FROM generate_series(date_trunc('month', (now() AT TIME ZONE 'Asia/Manila') - interval '11 months'), date_trunc('month', now() AT TIME ZONE 'Asia/Manila'), interval '1 month') AS m(m)
      LEFT JOIN (SELECT date_trunc('month', "paidAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila') AS m, SUM(amount) AS total FROM ${table('Payment')} WHERE status = 'POSTED' GROUP BY 1) c ON c.m = m.m
      LEFT JOIN (SELECT date_trunc('month', "spentAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila') AS m, SUM(amount) AS total FROM ${table('Expense')} GROUP BY 1) e ON e.m = m.m
      ORDER BY m.m`,
  ]);
  const collected = byType.reduce((s, r) => s + money(r._sum.amount), 0);
  const spent = expByCat.reduce((s, r) => s + money(r._sum.amount), 0);
  res.json({
    from: paidAt.gte ?? null, to: paidAt.lte ?? null,
    collected: money(collected), receipts: byType.reduce((s, r) => s + r._count, 0), spent: money(spent), net: money(collected - spent),
    byType: byType.map((r) => ({ type: r.type, amount: money(r._sum.amount), count: r._count })).sort((a, b) => b.amount - a.amount),
    byMethod: byMethod.map((r) => ({ method: r.method, amount: money(r._sum.amount), count: r._count })).sort((a, b) => b.amount - a.amount),
    expensesByCategory: expByCat.map((r) => ({ category: r.category, amount: money(r._sum.amount), count: r._count })).sort((a, b) => b.amount - a.amount),
    outstanding: money(money(outstanding._sum.amount) - money(outstanding._sum.amountPaid)), openCharges: outstanding._count, driversOverdue: overdueDrivers.length,
    months: months.map((r) => ({ month: r.m, collected: money(r.collected), spent: money(r.spent) })),
  });
}));

// ───────────── Payments ─────────────

const paymentList = paginationSchema.extend({
  type: z.enum(PAYMENT_TYPES).optional(),
  method: z.enum(METHODS).optional(),
  status: z.enum(['POSTED', 'VOIDED']).optional(),
  driverId: z.string().uuid().optional(),
  from: dateOnly.optional(),
  to: dateOnly.optional(),
});

financeRouter.get('/payments', requirePermission('finance.read'), ah(async (req, res) => {
  const p = paymentList.parse(req.query);
  const q = p.q?.trim();
  const where: Prisma.PaymentWhereInput = {
    AND: [
      assocScope(req) as Prisma.PaymentWhereInput,
      p.type ? { type: p.type } : {}, p.method ? { method: p.method } : {}, p.status ? { status: p.status } : {}, p.driverId ? { driverId: p.driverId } : {},
      range(p) ? { paidAt: range(p) } : {},
      q ? { OR: [
        { receiptNo: { contains: q, mode: 'insensitive' } }, { referenceNo: { contains: q, mode: 'insensitive' } },
        { driver: { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { driverCode: { contains: q, mode: 'insensitive' } }] } },
      ] } : {},
    ],
  };
  const [rows, total, sum] = await Promise.all([
    prisma.payment.findMany({
      where, ...pageArgs(p),
      orderBy: orderBy<Prisma.PaymentOrderByWithRelationInput>(p.sort, p.dir, { paidAt: (d) => ({ paidAt: d }), amount: (d) => ({ amount: d }), receiptNo: (d) => ({ receiptNo: d }) }, { paidAt: 'desc' as const }),
      include: { driver: { select: { id: true, firstName: true, middleName: true, lastName: true, suffix: true, driverCode: true } }, recordedBy: { select: { fullName: true } } },
    }),
    prisma.payment.count({ where }),
    prisma.payment.aggregate({ where: { AND: [where, { status: 'POSTED' }] }, _sum: { amount: true } }),
  ]);
  res.json({
    ...paged(rows.map((r) => ({ ...r, driver: r.driver ? { id: r.driver.id, driverCode: r.driver.driverCode, fullName: driverFullName(r.driver) } : null, recordedBy: r.recordedBy.fullName })), total, p),
    postedTotal: money(sum._sum.amount),
  });
}));

async function loadPayment(req: Request, id: string) {
  const p = await prisma.payment.findFirst({
    where: { AND: [{ id }, assocScope(req) as Prisma.PaymentWhereInput] },
    include: {
      driver: { select: { id: true, firstName: true, middleName: true, lastName: true, suffix: true, driverCode: true, contactNumber: true } },
      recordedBy: { select: { fullName: true } },
      allocations: { include: { due: { select: { id: true, type: true, periodStart: true, periodEnd: true, amount: true, dueDate: true } } } },
      replaces: { select: { id: true, receiptNo: true } },
      replacedBy: { select: { id: true, receiptNo: true } },
      association: { select: { name: true, acronym: true, terminalLocation: true, contactNumber: true, email: true, city: true, barangay: true } },
    },
  });
  if (!p) throw notFound('Payment');
  return p;
}

financeRouter.get('/payments/:id', requirePermission('finance.read'), ah(async (req, res) => {
  const p = await loadPayment(req, req.params.id);
  res.json({ ...p, driver: p.driver ? { id: p.driver.id, driverCode: p.driver.driverCode, contactNumber: p.driver.contactNumber, fullName: driverFullName(p.driver) } : null, recordedBy: p.recordedBy.fullName });
}));

financeRouter.post('/payments', requirePermission('finance.record'), ah(async (req, res) => {
  const b = paymentBody.parse(req.body);
  const p = await inTx((tx) => createPayment(tx, req, b));
  await audit(req, { action: 'CREATE', entity: 'Payment', entityId: p.id, summary: `Recorded ${p.receiptNo}: ₱${money(p.amount).toLocaleString('en-PH')} ${b.type.replace(/_/g, ' ').toLowerCase()} (${b.method})`, after: p, associationId: p.associationId });
  res.status(201).json(p);
}));

financeRouter.post('/payments/:id/void', requirePermission('finance.void'), ah(async (req, res) => {
  const b = z.object({ reason: z.string().trim().min(5, 'Explain why this receipt is being voided').max(300), replacement: z.unknown().optional() }).parse(req.body);
  const replacement = b.replacement ? paymentBody.parse(b.replacement) : null;
  if (replacement && !can(req, 'finance.record')) throw new HttpError(403, 'You can void receipts but not record new ones');
  const orig = await loadPayment(req, req.params.id);
  if (orig.status === 'VOIDED') throw new HttpError(409, 'This receipt is already void');
  if (orig.bookingId) throw new HttpError(409, 'Ride payments are corrected from the ride record');
  const result = await inTx(async (tx) => {
    const n = await tx.payment.updateMany({ where: { id: orig.id, status: 'POSTED' }, data: { status: 'VOIDED', voidedAt: new Date(), voidReason: b.reason } });
    if (!n.count) throw new HttpError(409, 'This receipt is already void');
    await settleDues(tx, orig.allocations.map((a) => a.dueId));
    return replacement ? createPayment(tx, req, replacement, orig.id) : null;
  });
  await audit(req, { action: 'VOID', entity: 'Payment', entityId: orig.id, summary: `Voided ${orig.receiptNo}: ${b.reason}${result ? ` (replaced by ${result.receiptNo})` : ''}`, before: { status: 'POSTED' }, after: { status: 'VOIDED', voidReason: b.reason, replacedBy: result?.receiptNo }, associationId: orig.associationId });
  res.json({ ok: true, replacement: result });
}));

// ───────────── Dues (charges) ─────────────

const dueList = paginationSchema.extend({
  status: z.enum(['OPEN', 'OVERDUE', 'UNPAID', 'PARTIAL', 'PAID', 'WAIVED']).optional(),
  type: z.enum(PAYMENT_TYPES).optional(),
  driverId: z.string().uuid().optional(),
  period: z.string().regex(/^\d{4}-\d{2}$/).optional(),
});

financeRouter.get('/dues', requirePermission('finance.read'), ah(async (req, res) => {
  const p = dueList.parse(req.query);
  const now = new Date();
  const q = p.q?.trim();
  const statusWhere: Prisma.DueChargeWhereInput =
    p.status === 'OPEN' ? { status: { in: OPEN } }
    : p.status === 'OVERDUE' ? { status: { in: OPEN }, dueDate: { lt: now } }
    : p.status ? { status: p.status } : {};
  const where: Prisma.DueChargeWhereInput = {
    AND: [
      assocScope(req) as Prisma.DueChargeWhereInput, statusWhere,
      p.type ? { type: p.type } : {}, p.driverId ? { driverId: p.driverId } : {},
      p.period ? { periodStart: { gte: new Date(`${p.period}-01T00:00:00Z`), lt: new Date(Date.UTC(+p.period.slice(0, 4), +p.period.slice(5, 7), 1)) } } : {},
      q ? { driver: { OR: [{ firstName: { contains: q, mode: 'insensitive' } }, { lastName: { contains: q, mode: 'insensitive' } }, { driverCode: { contains: q, mode: 'insensitive' } }] } } : {},
    ],
  };
  const [rows, total, sums] = await Promise.all([
    prisma.dueCharge.findMany({
      where, ...pageArgs(p),
      orderBy: orderBy<Prisma.DueChargeOrderByWithRelationInput | Prisma.DueChargeOrderByWithRelationInput[]>(p.sort, p.dir, { dueDate: (d) => ({ dueDate: d }), amount: (d) => ({ amount: d }), driver: (d) => ({ driver: { lastName: d } }) }, [{ dueDate: 'desc' as const }, { driver: { lastName: 'asc' as const } }]),
      include: { driver: { select: { id: true, firstName: true, middleName: true, lastName: true, suffix: true, driverCode: true, status: true } } },
    }),
    prisma.dueCharge.count({ where }),
    prisma.dueCharge.aggregate({ where, _sum: { amount: true, amountPaid: true } }),
  ]);
  res.json({
    ...paged(rows.map((r) => ({
      ...r, balance: r.status === 'WAIVED' ? 0 : money(money(r.amount) - money(r.amountPaid)),
      overdue: OPEN.includes(r.status) && r.dueDate < now,
      driver: { id: r.driver.id, driverCode: r.driver.driverCode, status: r.driver.status, fullName: driverFullName(r.driver) },
    })), total, p),
    totals: { amount: money(sums._sum.amount), paid: money(sums._sum.amountPaid) },
  });
}));

/** Monthly dues for every active member for a month. Safe to run twice: existing charges are skipped. */
financeRouter.post('/dues/generate', requirePermission('finance.record'), ah(async (req, res) => {
  const { month } = z.object({ month: z.string().regex(/^\d{4}-\d{2}$/, 'Choose a month') }).parse(req.body);
  const [y, m] = month.split('-').map(Number);
  const periodStart = new Date(Date.UTC(y, m - 1, 1));
  const periodEnd = new Date(Date.UTC(y, m, 0));
  const now = new Date();
  if (periodStart > new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1))) throw new HttpError(400, 'You can only bill up to next month', { fields: { month: 'Too far ahead' } });
  const toda = await theToda();
  const amount = money(toda.monthlyDues);
  if (amount <= 0) throw new HttpError(400, 'Set the monthly dues amount on the TODA profile first');
  const members = await prisma.driver.findMany({
    where: { associationId: toda.id, deletedAt: null, applicationStatus: 'APPROVED', status: { in: ['ACTIVE', 'SUSPENDED'] }, memberships: { some: { associationId: toda.id, status: { in: ['ACTIVE', 'SUSPENDED'] } } } },
    select: { id: true },
  });
  const existing = new Set((await prisma.dueCharge.findMany({ where: { associationId: toda.id, type: 'MONTHLY_DUES', periodStart }, select: { driverId: true } })).map((d) => d.driverId));
  const dueDate = new Date(periodStart.getTime() + 14 * 86400000);
  const data = members.filter((d) => !existing.has(d.id)).map((d) => ({ driverId: d.id, associationId: toda.id, type: 'MONTHLY_DUES' as const, periodStart, periodEnd, amount, dueDate, status: dueStatus(amount, 0, dueDate) }));
  if (data.length) await prisma.dueCharge.createMany({ data });
  const label = periodStart.toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' });
  if (data.length) await audit(req, { action: 'CREATE', entity: 'DueCharge', summary: `Billed ${label} dues to ${data.length} member${data.length === 1 ? '' : 's'} (₱${amount} each)`, associationId: toda.id });
  res.status(201).json({ created: data.length, skipped: existing.size, amount, period: label });
}));

financeRouter.post('/dues', requirePermission('finance.record'), ah(async (req, res) => {
  const b = z.object({
    driverId: z.string().uuid({ message: 'Choose a driver' }),
    type: z.enum(PAYMENT_TYPES),
    amount: z.coerce.number().positive('Enter an amount above zero').max(1_000_000),
    dueDate: dateOnly,
    description: optStr(120),
  }).parse(req.body);
  const toda = await todaId();
  const d = await prisma.driver.findFirst({ where: { id: b.driverId, associationId: toda, deletedAt: null } });
  if (!d) throw new HttpError(400, 'Driver not found', { fields: { driverId: 'Driver not found' } });
  const due = new Date(`${b.dueDate}T23:59:59+08:00`);
  const start = new Date(`${b.dueDate}T00:00:00Z`);
  const c = await prisma.dueCharge.create({ data: { driverId: d.id, associationId: toda, type: b.type, periodStart: start, periodEnd: start, amount: b.amount, dueDate: due, status: dueStatus(b.amount, 0, due) } });
  await audit(req, { action: 'CREATE', entity: 'DueCharge', entityId: c.id, summary: `Charged ${driverFullName(d)} ₱${b.amount} ${b.type.replace(/_/g, ' ').toLowerCase()}${b.description ? `: ${b.description}` : ''}`, after: c, associationId: toda });
  res.status(201).json(c);
}));

financeRouter.post('/dues/:id/waive', requirePermission('finance.void'), ah(async (req, res) => {
  const { reason } = z.object({ reason: z.string().trim().min(5, 'Explain why this charge is waived').max(300) }).parse(req.body);
  const c = await prisma.dueCharge.findFirst({ where: { AND: [{ id: req.params.id }, assocScope(req) as Prisma.DueChargeWhereInput] }, include: { driver: true } });
  if (!c) throw notFound('Charge');
  if (!OPEN.includes(c.status)) throw new HttpError(409, c.status === 'WAIVED' ? 'This charge is already waived' : 'Only unpaid charges can be waived');
  await prisma.dueCharge.update({ where: { id: c.id }, data: { status: 'WAIVED' } });
  await audit(req, { action: 'WAIVE', entity: 'DueCharge', entityId: c.id, summary: `Waived ₱${money(money(c.amount) - money(c.amountPaid))} ${c.type.replace(/_/g, ' ').toLowerCase()} of ${driverFullName(c.driver)}: ${reason}`, before: { status: c.status }, after: { status: 'WAIVED', reason }, associationId: c.associationId });
  res.json({ ok: true });
}));

// ───────────── Expenses ─────────────

const expenseBody = z.object({
  category: z.string().trim().min(2, 'Choose or type a category').max(40),
  description: z.string().trim().min(3, 'Describe the expense').max(200),
  amount: z.coerce.number({ invalid_type_error: 'Enter the amount' }).positive('Enter an amount above zero').max(10_000_000),
  method: z.enum(METHODS),
  payee: optStr(120),
  referenceNo: optStr(60),
  spentAt: dateOnly,
}).superRefine((b, ctx) => {
  if (new Date(`${b.spentAt}T00:00:00+08:00`).getTime() > Date.now()) ctx.addIssue({ code: 'custom', path: ['spentAt'], message: 'The date can’t be in the future' });
});
const toExpenseData = (b: z.infer<typeof expenseBody>) => ({ ...b, spentAt: new Date(`${b.spentAt}T12:00:00+08:00`) });

const expenseList = paginationSchema.extend({ category: z.string().max(40).optional(), from: dateOnly.optional(), to: dateOnly.optional() });

financeRouter.get('/expenses', requirePermission('finance.read'), ah(async (req, res) => {
  const p = expenseList.parse(req.query);
  const q = p.q?.trim();
  const where: Prisma.ExpenseWhereInput = {
    AND: [
      p.category ? { category: p.category } : {}, range(p) ? { spentAt: range(p) } : {},
      q ? { OR: [{ description: { contains: q, mode: 'insensitive' } }, { payee: { contains: q, mode: 'insensitive' } }, { referenceNo: { contains: q, mode: 'insensitive' } }] } : {},
    ],
  };
  const [rows, total, sum, categories] = await Promise.all([
    prisma.expense.findMany({ where, ...pageArgs(p), orderBy: orderBy<Prisma.ExpenseOrderByWithRelationInput | Prisma.ExpenseOrderByWithRelationInput[]>(p.sort, p.dir, { spentAt: (d) => ({ spentAt: d }), amount: (d) => ({ amount: d }), category: (d) => ({ category: d }) }, [{ spentAt: 'desc' as const }, { createdAt: 'desc' as const }]), include: { recordedBy: { select: { fullName: true } } } }),
    prisma.expense.count({ where }),
    prisma.expense.aggregate({ where, _sum: { amount: true } }),
    prisma.expense.findMany({ distinct: ['category'], select: { category: true }, orderBy: { category: 'asc' } }),
  ]);
  res.json({ ...paged(rows.map((r) => ({ ...r, recordedBy: r.recordedBy.fullName })), total, p), total_amount: money(sum._sum.amount), categories: categories.map((c) => c.category) });
}));

financeRouter.post('/expenses', requirePermission('expenses.manage'), ah(async (req, res) => {
  const b = expenseBody.parse(req.body);
  const toda = await theToda();
  const e = await prisma.expense.create({ data: { ...toExpenseData(b), organizationId: toda.organizationId, associationId: toda.id, recordedById: req.auth!.userId } });
  await audit(req, { action: 'CREATE', entity: 'Expense', entityId: e.id, summary: `Recorded expense ₱${b.amount.toLocaleString('en-PH')}: ${b.description}`, after: e, associationId: toda.id });
  res.status(201).json(e);
}));

financeRouter.patch('/expenses/:id', requirePermission('expenses.manage'), ah(async (req, res) => {
  const b = expenseBody.parse(req.body);
  const before = await prisma.expense.findUnique({ where: { id: req.params.id } });
  if (!before) throw notFound('Expense');
  const e = await prisma.expense.update({ where: { id: before.id }, data: toExpenseData(b) });
  await audit(req, { action: 'UPDATE', entity: 'Expense', entityId: e.id, summary: `Updated expense: ${b.description}`, before, after: e, associationId: e.associationId });
  res.json(e);
}));

financeRouter.delete('/expenses/:id', requirePermission('expenses.manage'), ah(async (req, res) => {
  const e = await prisma.expense.findUnique({ where: { id: req.params.id } });
  if (!e) throw notFound('Expense');
  await prisma.expense.delete({ where: { id: e.id } });
  await audit(req, { action: 'DELETE', entity: 'Expense', entityId: e.id, summary: `Deleted expense ₱${money(e.amount).toLocaleString('en-PH')}: ${e.description}`, before: e, associationId: e.associationId });
  res.json({ ok: true });
}));
