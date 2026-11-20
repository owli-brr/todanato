import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma, table } from '../lib/prisma';
import { ah, HttpError } from '../lib/http';
import { audit } from '../lib/audit';
import { requirePermission } from '../middleware/auth';
import { theToda } from '../lib/toda';
import { driverFullName } from './drivers';

export const reportsRouter = Router();

type ColType = 'text' | 'money' | 'number' | 'date' | 'datetime';
interface Col { key: string; label: string; type?: ColType }
interface Report { title: string; description: string; columns: Col[]; rows: Record<string, unknown>[]; totals?: Record<string, number>; note?: string }
type Range = { from?: Date; to?: Date };

const MAX_ROWS = 10_000;
const money = (n: Prisma.Decimal | number | null | undefined) => Math.round(Number(n ?? 0) * 100) / 100;
const between = (r: Range) => (r.from || r.to ? { ...(r.from ? { gte: r.from } : {}), ...(r.to ? { lte: r.to } : {}) } : undefined);
const sum = (rows: Record<string, unknown>[], key: string) => money(rows.reduce((s, r) => s + Number(r[key] ?? 0), 0));

const REPORTS: Record<string, { title: string; description: string; usesRange: boolean; perm?: 'finance.read'; build: (r: Range) => Promise<Omit<Report, 'title' | 'description'>> }> = {
  collections: {
    title: 'Collections', description: 'Every receipt issued in the period, including voided ones.', usesRange: true, perm: 'finance.read',
    async build(r) {
      const rows = await prisma.payment.findMany({ where: { paidAt: between(r) }, orderBy: { paidAt: 'asc' }, take: MAX_ROWS, include: { driver: true, recordedBy: { select: { fullName: true } } } });
      const out = rows.map((p) => ({
        receiptNo: p.receiptNo, paidAt: p.paidAt, driver: p.driver ? driverFullName(p.driver) : 'Walk-in / other', driverCode: p.driver?.driverCode ?? '',
        type: p.type, method: p.method, referenceNo: p.referenceNo ?? '', amount: money(p.amount), status: p.status, receivedBy: p.recordedBy.fullName,
      }));
      return {
        columns: [
          { key: 'receiptNo', label: 'Receipt' }, { key: 'paidAt', label: 'Date', type: 'datetime' }, { key: 'driver', label: 'Paid by' }, { key: 'driverCode', label: 'Driver code' },
          { key: 'type', label: 'For' }, { key: 'method', label: 'Method' }, { key: 'referenceNo', label: 'Reference' }, { key: 'amount', label: 'Amount', type: 'money' },
          { key: 'status', label: 'Status' }, { key: 'receivedBy', label: 'Received by' },
        ],
        rows: out,
        totals: { amount: sum(out.filter((x) => x.status === 'POSTED'), 'amount') },
        note: 'The total counts posted receipts only.',
      };
    },
  },
  income: {
    title: 'Income and expenses by month', description: 'Posted collections and recorded expenses, month by month.', usesRange: true, perm: 'finance.read',
    async build(r) {
      const from = r.from ?? new Date(Date.now() - 365 * 86400000);
      const to = r.to ?? new Date();
      const rows = await prisma.$queryRaw<{ m: Date; collected: number | null; spent: number | null }[]>`
        SELECT m.m, c.total::float AS collected, e.total::float AS spent
        FROM generate_series(date_trunc('month', ${from}::timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila'), date_trunc('month', ${to}::timestamp AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila'), interval '1 month') AS m(m)
        LEFT JOIN (SELECT date_trunc('month', "paidAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila') AS m, SUM(amount) AS total FROM ${table('Payment')} WHERE status = 'POSTED' AND "paidAt" BETWEEN ${from} AND ${to} GROUP BY 1) c ON c.m = m.m
        LEFT JOIN (SELECT date_trunc('month', "spentAt" AT TIME ZONE 'UTC' AT TIME ZONE 'Asia/Manila') AS m, SUM(amount) AS total FROM ${table('Expense')} WHERE "spentAt" BETWEEN ${from} AND ${to} GROUP BY 1) e ON e.m = m.m
        ORDER BY m.m`;
      const out = rows.map((x) => ({
        month: new Date(x.m).toLocaleDateString('en-PH', { month: 'long', year: 'numeric', timeZone: 'UTC' }),
        collected: money(x.collected), spent: money(x.spent), net: money(money(x.collected) - money(x.spent)),
      }));
      return {
        columns: [{ key: 'month', label: 'Month' }, { key: 'collected', label: 'Collections', type: 'money' }, { key: 'spent', label: 'Expenses', type: 'money' }, { key: 'net', label: 'Net', type: 'money' }],
        rows: out, totals: { collected: sum(out, 'collected'), spent: sum(out, 'spent'), net: sum(out, 'net') },
      };
    },
  },
  delinquency: {
    title: 'Unpaid dues by driver', description: 'Drivers who still owe, with their oldest unpaid charge. As of today; the date range does not apply.', usesRange: false, perm: 'finance.read',
    async build() {
      const dues = await prisma.dueCharge.findMany({ where: { status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } }, include: { driver: true }, orderBy: { dueDate: 'asc' } });
      const by = new Map<string, { driver: string; driverCode: string; contact: string; driverStatus: string; charges: number; overdue: number; oldestDue: Date; balance: number }>();
      const now = Date.now();
      for (const d of dues) {
        const row = by.get(d.driverId) ?? { driver: driverFullName(d.driver), driverCode: d.driver.driverCode, contact: d.driver.contactNumber, driverStatus: d.driver.status, charges: 0, overdue: 0, oldestDue: d.dueDate, balance: 0 };
        row.charges++; if (d.dueDate.getTime() < now) row.overdue++;
        row.balance = money(row.balance + money(d.amount) - money(d.amountPaid));
        by.set(d.driverId, row);
      }
      const out = [...by.values()].sort((a, b) => b.balance - a.balance);
      return {
        columns: [
          { key: 'driver', label: 'Driver' }, { key: 'driverCode', label: 'Driver code' }, { key: 'contact', label: 'Mobile' }, { key: 'driverStatus', label: 'Status' },
          { key: 'charges', label: 'Unpaid charges', type: 'number' }, { key: 'overdue', label: 'Overdue', type: 'number' }, { key: 'oldestDue', label: 'Oldest due', type: 'date' }, { key: 'balance', label: 'Balance', type: 'money' },
        ],
        rows: out, totals: { charges: out.reduce((s, r) => s + r.charges, 0), overdue: out.reduce((s, r) => s + r.overdue, 0), balance: sum(out, 'balance') },
      };
    },
  },
  expenses: {
    title: 'Expenses', description: 'Every expense recorded in the period.', usesRange: true, perm: 'finance.read',
    async build(r) {
      const rows = await prisma.expense.findMany({ where: { spentAt: between(r) }, orderBy: { spentAt: 'asc' }, take: MAX_ROWS, include: { recordedBy: { select: { fullName: true } } } });
      const out = rows.map((e) => ({ spentAt: e.spentAt, category: e.category, description: e.description, payee: e.payee ?? '', method: e.method, referenceNo: e.referenceNo ?? '', amount: money(e.amount), recordedBy: e.recordedBy.fullName }));
      return {
        columns: [
          { key: 'spentAt', label: 'Date', type: 'date' }, { key: 'category', label: 'Category' }, { key: 'description', label: 'Description' }, { key: 'payee', label: 'Paid to' },
          { key: 'method', label: 'Method' }, { key: 'referenceNo', label: 'Reference' }, { key: 'amount', label: 'Amount', type: 'money' }, { key: 'recordedBy', label: 'Recorded by' },
        ],
        rows: out, totals: { amount: sum(out, 'amount') },
      };
    },
  },
  drivers: {
    title: 'Driver roster', description: 'All approved drivers with membership, license and tricycle. As of today.', usesRange: false,
    async build() {
      const rows = await prisma.driver.findMany({
        where: { deletedAt: null, applicationStatus: 'APPROVED' }, orderBy: [{ lastName: 'asc' }, { firstName: 'asc' }], take: MAX_ROWS,
        include: { memberships: { orderBy: { appliedAt: 'desc' }, take: 1 }, vehicleAssignments: { where: { unassignedAt: null }, take: 1, include: { vehicle: { select: { plateNumber: true, bodyNumber: true } } } } },
      });
      const out = rows.map((d) => ({
        driverCode: d.driverCode, name: driverFullName(d), status: d.status, membershipNo: d.memberships[0]?.membershipNo ?? '', memberType: d.memberships[0]?.memberType ?? '',
        contact: d.contactNumber, barangay: d.barangay ?? '', licenseNumber: d.licenseNumber, licenseExpiry: d.licenseExpiry,
        plate: d.vehicleAssignments[0]?.vehicle.plateNumber ?? '', bodyNumber: d.vehicleAssignments[0]?.vehicle.bodyNumber ?? '', approvedAt: d.approvedAt,
      }));
      return {
        columns: [
          { key: 'driverCode', label: 'Driver code' }, { key: 'name', label: 'Name' }, { key: 'status', label: 'Status' }, { key: 'membershipNo', label: 'Membership no.' }, { key: 'memberType', label: 'Member type' },
          { key: 'contact', label: 'Mobile' }, { key: 'barangay', label: 'Barangay' }, { key: 'licenseNumber', label: 'License no.' }, { key: 'licenseExpiry', label: 'License expiry', type: 'date' },
          { key: 'plate', label: 'Plate' }, { key: 'bodyNumber', label: 'Body no.' }, { key: 'approvedAt', label: 'Approved', type: 'date' },
        ],
        rows: out,
      };
    },
  },
  tricycles: {
    title: 'Tricycle registry', description: 'All tricycles with franchise, registration, insurance and current driver. As of today.', usesRange: false,
    async build() {
      const rows = await prisma.vehicle.findMany({
        where: { deletedAt: null }, orderBy: { plateNumber: 'asc' }, take: MAX_ROWS,
        include: { assignments: { where: { unassignedAt: null }, take: 1, include: { driver: true } } },
      });
      const out = rows.map((v) => ({
        plate: v.plateNumber, bodyNumber: v.bodyNumber ?? '', unit: `${v.make} ${v.model}`, color: v.color, status: v.status, owner: v.ownerName,
        driver: v.assignments[0] ? driverFullName(v.assignments[0].driver) : '', franchiseNumber: v.franchiseNumber ?? '', franchiseExpiry: v.franchiseExpiry,
        registrationExpiry: v.registrationExpiry, insuranceExpiry: v.insuranceExpiry, inspection: v.inspectionStatus,
      }));
      return {
        columns: [
          { key: 'plate', label: 'Plate' }, { key: 'bodyNumber', label: 'Body no.' }, { key: 'unit', label: 'Unit' }, { key: 'color', label: 'Color' }, { key: 'status', label: 'Status' },
          { key: 'owner', label: 'Owner' }, { key: 'driver', label: 'Driver' }, { key: 'franchiseNumber', label: 'MTOP no.' }, { key: 'franchiseExpiry', label: 'MTOP expiry', type: 'date' },
          { key: 'registrationExpiry', label: 'Registration expiry', type: 'date' }, { key: 'insuranceExpiry', label: 'Insurance expiry', type: 'date' }, { key: 'inspection', label: 'Inspection' },
        ],
        rows: out,
      };
    },
  },
};

reportsRouter.get('/', requirePermission('reports.view'), (req, res) => {
  res.json(Object.entries(REPORTS)
    .filter(([, r]) => !r.perm || req.auth!.permissions.has(r.perm))
    .map(([key, r]) => ({ key, title: r.title, description: r.description, usesRange: r.usesRange })));
});

const fmtManila = (d: Date, withTime: boolean) => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Manila', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d).map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}${withTime ? ` ${p.hour}:${p.minute}` : ''}`;
};

/** Quote for CSV, and neutralise values a spreadsheet would run as a formula. */
function csvCell(v: unknown, type?: ColType) {
  let s: string;
  if (v === null || v === undefined || v === '') s = '';
  else if (v instanceof Date) s = fmtManila(v, type === 'datetime');
  else if (type === 'money') s = Number(v).toFixed(2);
  else s = String(v);
  if (type !== 'money' && type !== 'number' && /^[=+\-@\t\r]/.test(s)) s = `'${s}`;
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

reportsRouter.get('/:key', requirePermission('reports.view'), ah(async (req, res) => {
  const def = REPORTS[req.params.key];
  if (!def) throw new HttpError(404, 'Report not found');
  if (def.perm && !req.auth!.permissions.has(def.perm)) throw new HttpError(403, 'You do not have permission to view this report');
  const q = z.object({
    from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    format: z.enum(['json', 'csv']).default('json'),
  }).parse(req.query);
  const range: Range = def.usesRange ? { from: q.from ? new Date(`${q.from}T00:00:00+08:00`) : undefined, to: q.to ? new Date(`${q.to}T23:59:59.999+08:00`) : undefined } : {};
  if (range.from && range.to && range.from > range.to) throw new HttpError(400, 'The start date is after the end date');
  const built = await def.build(range);
  const report: Report = { title: def.title, description: def.description, ...built };

  if (q.format === 'csv') {
    const toda = await theToda();
    const lines = [report.columns.map((c) => csvCell(c.label)).join(',')];
    for (const r of report.rows) lines.push(report.columns.map((c) => csvCell(r[c.key], c.type)).join(','));
    if (report.totals) lines.push(report.columns.map((c, i) => (i === 0 ? 'Total' : c.key in report.totals! ? csvCell(report.totals![c.key], c.type) : '')).join(','));
    const period = def.usesRange ? `${q.from ?? 'start'}_to_${q.to ?? fmtManila(new Date(), false)}` : fmtManila(new Date(), false);
    const name = `${(toda.acronym ?? 'TODA').replace(/[^A-Za-z0-9]+/g, '')}_${req.params.key}_${period}.csv`;
    await audit(req, { action: 'EXPORT', entity: 'Report', entityId: req.params.key, summary: `Exported ${def.title} report (${report.rows.length} rows)`, associationId: toda.id });
    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${name}"`);
    return res.send('﻿' + lines.join('\r\n'));
  }
  res.json({ ...report, truncated: report.rows.length >= MAX_ROWS, generatedAt: new Date() });
}));
