import { Router } from 'express';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah } from '../lib/http';
import { can, requirePermission } from '../middleware/auth';
import { driverFullName } from './drivers';

// Document centre: one queue across driver and tricycle documents, plus the
// expiry dates kept on the records themselves (license, OR/CR, MTOP, insurance).
export const documentsRouter = Router();

type View = 'pending' | 'expiring' | 'expired' | 'rejected';
interface Item {
  id: string; kind: 'driver' | 'vehicle'; source: 'document' | 'record';
  ownerId: string; ownerName: string; ownerCode: string;
  type: string; documentNo: string | null; fileName: string | null; mimeType: string | null;
  status: string | null; expiresAt: Date | null; uploadedAt: Date | null; remarks: string | null;
}

const DAY = 86400000;
const LIMIT = 1000;

async function collect(view: View, includeVehicles: boolean): Promise<Item[]> {
  const now = new Date();
  const soon = new Date(now.getTime() + 30 * DAY);
  const docWhere =
    view === 'pending' ? { status: 'PENDING' as const }
    : view === 'rejected' ? { status: 'REJECTED' as const }
    : view === 'expiring' ? { status: { not: 'REJECTED' as const }, expiresAt: { gte: now, lte: soon } }
    : { status: { not: 'REJECTED' as const }, expiresAt: { lt: now } };
  const liveDriver: Prisma.DriverWhereInput = { deletedAt: null, applicationStatus: { in: ['APPROVED', 'PENDING'] } };
  const liveVehicle: Prisma.VehicleWhereInput = { deletedAt: null, status: { not: 'INACTIVE' } };

  const [dDocs, vDocs] = await Promise.all([
    prisma.driverDocument.findMany({ where: { ...docWhere, driver: liveDriver }, include: { driver: true }, take: LIMIT, orderBy: { uploadedAt: 'asc' } }),
    includeVehicles ? prisma.vehicleDocument.findMany({ where: { ...docWhere, vehicle: liveVehicle }, include: { vehicle: true }, take: LIMIT, orderBy: { uploadedAt: 'asc' } }) : [],
  ]);
  const items: Item[] = [
    ...dDocs.map((d) => ({ id: d.id, kind: 'driver' as const, source: 'document' as const, ownerId: d.driverId, ownerName: driverFullName(d.driver), ownerCode: d.driver.driverCode, type: d.type, documentNo: d.documentNo, fileName: d.fileName, mimeType: d.mimeType, status: d.status, expiresAt: d.expiresAt, uploadedAt: d.uploadedAt, remarks: d.remarks })),
    ...vDocs.map((d) => ({ id: d.id, kind: 'vehicle' as const, source: 'document' as const, ownerId: d.vehicleId, ownerName: d.vehicle.plateNumber, ownerCode: d.vehicle.bodyNumber ? `Body ${d.vehicle.bodyNumber}` : d.vehicle.vehicleCode, type: d.type, documentNo: d.documentNo, fileName: d.fileName, mimeType: d.mimeType, status: d.status, expiresAt: d.expiresAt, uploadedAt: d.uploadedAt, remarks: d.remarks })),
  ];

  // Dates on the records, for the expiry views. Skipped when an uploaded document
  // of the same kind already shows the same expiry, so nothing is listed twice.
  if (view === 'expiring' || view === 'expired') {
    const day = (d: Date | null) => (d ? d.toISOString().slice(0, 10) : '');
    const covered = new Set(items.map((i) => `${i.ownerId}:${i.type}:${day(i.expiresAt)}`));
    const COVERS: Record<string, string[]> = {
      LICENSE_ON_RECORD: ['DRIVERS_LICENSE'], REGISTRATION_ON_RECORD: ['OFFICIAL_RECEIPT', 'CERTIFICATE_OF_REGISTRATION'],
      FRANCHISE_ON_RECORD: ['FRANCHISE_MTOP'], INSURANCE_ON_RECORD: ['INSURANCE'],
    };
    const push = (i: Item) => { if (!COVERS[i.type].some((t) => covered.has(`${i.ownerId}:${t}:${day(i.expiresAt)}`))) items.push(i); };
    const range = view === 'expiring' ? { gte: now, lte: soon } : { lt: now };
    const drivers = await prisma.driver.findMany({ where: { ...liveDriver, applicationStatus: 'APPROVED', status: { in: ['ACTIVE', 'SUSPENDED'] }, licenseExpiry: range }, take: LIMIT });
    drivers.map((d) => ({ id: `lic-${d.id}`, kind: 'driver' as const, source: 'record' as const, ownerId: d.id, ownerName: driverFullName(d), ownerCode: d.driverCode, type: 'LICENSE_ON_RECORD', documentNo: d.licenseNumber, fileName: null, mimeType: null, status: null, expiresAt: d.licenseExpiry, uploadedAt: null, remarks: null })).forEach(push);
    if (includeVehicles) {
      const vehicles = await prisma.vehicle.findMany({ where: { ...liveVehicle, OR: [{ registrationExpiry: range }, { franchiseExpiry: range }, { insuranceExpiry: range }] }, take: LIMIT });
      const inRange = (d: Date | null) => !!d && (view === 'expiring' ? d >= now && d <= soon : d < now);
      for (const v of vehicles) {
        const base = { kind: 'vehicle' as const, source: 'record' as const, ownerId: v.id, ownerName: v.plateNumber, ownerCode: v.bodyNumber ? `Body ${v.bodyNumber}` : v.vehicleCode, fileName: null, mimeType: null, status: null, uploadedAt: null, remarks: null };
        if (inRange(v.registrationExpiry)) push({ ...base, id: `reg-${v.id}`, type: 'REGISTRATION_ON_RECORD', documentNo: v.orNumber, expiresAt: v.registrationExpiry });
        if (inRange(v.franchiseExpiry)) push({ ...base, id: `mtop-${v.id}`, type: 'FRANCHISE_ON_RECORD', documentNo: v.franchiseNumber, expiresAt: v.franchiseExpiry });
        if (inRange(v.insuranceExpiry)) push({ ...base, id: `ins-${v.id}`, type: 'INSURANCE_ON_RECORD', documentNo: v.insurancePolicyNo, expiresAt: v.insuranceExpiry });
      }
    }
  }
  return items;
}

documentsRouter.get('/queue', requirePermission('drivers.read'), ah(async (req, res) => {
  const p = z.object({
    view: z.enum(['pending', 'expiring', 'expired', 'rejected']).default('pending'),
    kind: z.enum(['driver', 'vehicle']).optional(),
    q: z.string().trim().max(100).optional(),
  }).parse(req.query);
  const vehiclesOk = can(req, 'vehicles.read');
  const views = ['pending', 'expiring', 'expired', 'rejected'] as const;
  const all = await Promise.all(views.map((v) => collect(v, vehiclesOk)));
  const counts = Object.fromEntries(views.map((v, i) => [v, all[i].length]));
  let items = all[views.indexOf(p.view)];
  if (p.kind) items = items.filter((i) => i.kind === p.kind);
  if (p.q) { const q = p.q.toLowerCase(); items = items.filter((i) => `${i.ownerName} ${i.ownerCode} ${i.documentNo ?? ''} ${i.type}`.toLowerCase().includes(q)); }
  // Pending/rejected: oldest upload first (first in, first served). Expiry views: soonest/most overdue first.
  items.sort((a, b) => (p.view === 'pending' || p.view === 'rejected')
    ? (a.uploadedAt?.getTime() ?? 0) - (b.uploadedAt?.getTime() ?? 0)
    : (a.expiresAt?.getTime() ?? 0) - (b.expiresAt?.getTime() ?? 0));
  res.json({ counts, items, canVerify: can(req, 'documents.verify'), includesVehicles: vehiclesOk });
}));
