import { Router } from 'express';
import fs from 'node:fs';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah, notFound, pageArgs, paged, paginationSchema, optStr } from '../lib/http';
import { audit, diff } from '../lib/audit';
import { assocScope, requirePermission } from '../middleware/auth';
import { resolveStored } from '../lib/uploads';

// ───── Files: every download goes through a permission + scope check ─────

export const filesRouter = Router();

function send(res: import('express').Response, fileUrl: string, mime: string, name: string) {
  const full = resolveStored(fileUrl);
  if (!fs.existsSync(full)) throw notFound('File');
  res.setHeader('Content-Type', mime);
  res.setHeader('Content-Disposition', `inline; filename="${name.replace(/[^\w.\- ]/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  fs.createReadStream(full).pipe(res);
}

filesRouter.get('/driver-photo/:driverId', requirePermission('drivers.read'), ah(async (req, res) => {
  const d = await prisma.driver.findFirst({ where: { AND: [{ id: req.params.driverId }, assocScope(req) as Prisma.DriverWhereInput] } });
  if (!d?.photoUrl) throw notFound('Photo');
  send(res, d.photoUrl, d.photoUrl.endsWith('.png') ? 'image/png' : d.photoUrl.endsWith('.webp') ? 'image/webp' : 'image/jpeg', 'photo');
}));

filesRouter.get('/driver-document/:docId', requirePermission('drivers.read'), ah(async (req, res) => {
  const doc = await prisma.driverDocument.findFirst({ where: { id: req.params.docId, driver: assocScope(req) as Prisma.DriverWhereInput } });
  if (!doc) throw notFound('Document');
  send(res, doc.fileUrl, doc.mimeType, doc.fileName);
}));

filesRouter.get('/vehicle-document/:docId', requirePermission('vehicles.read'), ah(async (req, res) => {
  const doc = await prisma.vehicleDocument.findFirst({ where: { id: req.params.docId, vehicle: assocScope(req) as Prisma.VehicleWhereInput } });
  if (!doc) throw notFound('Document');
  send(res, doc.fileUrl, doc.mimeType, doc.fileName);
}));

// ───── Audit log (read-only) ─────

export const auditRouter = Router();

auditRouter.get('/', requirePermission('audit.read'), ah(async (req, res) => {
  const p = paginationSchema.extend({ entity: z.string().max(40).optional(), action: z.string().max(40).optional(), from: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((d) => new Date(`${d}T00:00:00+08:00`)).optional(), to: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).transform((d) => new Date(`${d}T23:59:59.999+08:00`)).optional() }).parse(req.query);
  const a = req.auth!;
  let assocFilter: Prisma.AuditLogWhereInput = {};
  if (a.scope === 'ASSOCIATION') assocFilter = { associationId: a.associationId ?? '__none__' };
  if (a.scope === 'ORGANIZATION') {
    const ids = (await prisma.association.findMany({ where: { organizationId: a.organizationId ?? '__none__' }, select: { id: true } })).map((x) => x.id);
    assocFilter = { OR: [{ associationId: { in: ids } }, { associationId: null, user: { organizationId: a.organizationId } }] };
  }
  const where: Prisma.AuditLogWhereInput = {
    AND: [
      assocFilter,
      p.entity ? { entity: p.entity } : {},
      p.action ? { action: p.action } : {},
      p.from || p.to ? { createdAt: { ...(p.from ? { gte: p.from } : {}), ...(p.to ? { lte: p.to } : {}) } } : {},
      p.q ? { OR: [{ summary: { contains: p.q, mode: 'insensitive' } }, { userEmail: { contains: p.q, mode: 'insensitive' } }] } : {},
    ],
  };
  const [items, total] = await Promise.all([
    prisma.auditLog.findMany({ where, orderBy: { createdAt: p.dir === 'asc' ? 'asc' : 'desc' }, ...pageArgs(p) }),
    prisma.auditLog.count({ where }),
  ]);
  res.json(paged(items, total, p));
}));

// ───── Organization profile (Settings) ─────

export const orgRouter = Router();

orgRouter.get('/', ah(async (req, res) => {
  const a = req.auth!;
  const orgs = await prisma.organization.findMany({ where: a.scope === 'GLOBAL' ? {} : { id: a.organizationId ?? '__none__' }, orderBy: { name: 'asc' } });
  res.json(orgs);
}));

orgRouter.patch('/:id', requirePermission('settings.manage'), ah(async (req, res) => {
  const a = req.auth!;
  if (a.scope !== 'GLOBAL' && a.organizationId !== req.params.id) throw notFound('Organization');
  const body = z.object({ name: z.string().trim().min(3).max(150), shortName: optStr(30), address: optStr(250), contactEmail: optStr(120), contactPhone: optStr(30) }).partial().parse(req.body);
  const before = await prisma.organization.findUniqueOrThrow({ where: { id: req.params.id } });
  const after = await prisma.organization.update({ where: { id: before.id }, data: body });
  const d = diff(before, after);
  await audit(req, { action: 'UPDATE', entity: 'Organization', entityId: after.id, summary: `Updated organization profile (${d.changed.join(', ') || 'no changes'})`, before: d.before, after: d.after });
  res.json(after);
}));

export { paged };
