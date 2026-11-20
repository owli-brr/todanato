import { Router } from 'express';
import { z } from 'zod';
import { Prisma, type Audience } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah, HttpError, notFound, pageArgs, paged, paginationSchema } from '../lib/http';
import { audit } from '../lib/audit';
import { requirePermission } from '../middleware/auth';
import { theToda } from '../lib/toda';

export const announcementsRouter = Router();

// Stored status is DRAFT, PUBLISHED or ARCHIVED. "Scheduled" and "Expired" are
// derived from publishAt / expiresAt so nothing needs a background job.
export type AnnState = 'DRAFT' | 'SCHEDULED' | 'LIVE' | 'EXPIRED' | 'ARCHIVED';
export function annState(a: { status: string; publishAt: Date | null; expiresAt: Date | null }, now = new Date()): AnnState {
  if (a.status === 'DRAFT') return 'DRAFT';
  if (a.status === 'ARCHIVED') return 'ARCHIVED';
  if (a.publishAt && a.publishAt > now) return 'SCHEDULED';
  if (a.expiresAt && a.expiresAt <= now) return 'EXPIRED';
  return 'LIVE';
}

/** Prisma filter for announcements live right now for the given audiences. */
export const liveWhere = (audiences: Audience[], now = new Date()): Prisma.AnnouncementWhereInput => ({
  status: 'PUBLISHED',
  audience: { in: audiences },
  OR: [{ publishAt: null }, { publishAt: { lte: now } }],
  AND: [{ OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] }],
});

const PRIORITY_ORDER = { EMERGENCY: 0, IMPORTANT: 1, NORMAL: 2 } as const;
export const byPriority = <T extends { priority: keyof typeof PRIORITY_ORDER; publishAt: Date | null; createdAt: Date }>(a: T, b: T) =>
  PRIORITY_ORDER[a.priority] - PRIORITY_ORDER[b.priority] || (b.publishAt ?? b.createdAt).getTime() - (a.publishAt ?? a.createdAt).getTime();

const body = z.object({
  title: z.string().trim().min(3, 'Enter a title').max(120),
  body: z.string().trim().min(3, 'Write the message').max(5000),
  priority: z.enum(['NORMAL', 'IMPORTANT', 'EMERGENCY']).default('NORMAL'),
  audience: z.enum(['ALL_DRIVERS', 'OFFICERS', 'EVERYONE'], { errorMap: () => ({ message: 'Choose who should see this' }) }),
  publishAt: z.coerce.date().optional().nullable(),
  expiresAt: z.coerce.date().optional().nullable(),
  publish: z.boolean().default(false),
}).superRefine((b, ctx) => {
  if (b.expiresAt && b.expiresAt <= (b.publishAt ?? new Date())) ctx.addIssue({ code: 'custom', path: ['expiresAt'], message: 'The end must be after the start' });
});

const select = { include: { author: { select: { fullName: true } } } } as const;
const shape = <T extends { status: string; publishAt: Date | null; expiresAt: Date | null; author: { fullName: string } }>(a: T) => ({ ...a, state: annState(a), author: a.author.fullName });

/** Live announcements for staff (dashboard). Any signed-in user. */
announcementsRouter.get('/feed', ah(async (_req, res) => {
  const rows = await prisma.announcement.findMany({ where: liveWhere(['OFFICERS', 'EVERYONE']), take: 20, ...select });
  res.json(rows.sort(byPriority).map(shape));
}));

announcementsRouter.get('/', requirePermission('announcements.manage'), ah(async (req, res) => {
  const p = paginationSchema.extend({ state: z.enum(['DRAFT', 'SCHEDULED', 'LIVE', 'EXPIRED', 'ARCHIVED']).optional() }).parse(req.query);
  const now = new Date();
  const stateWhere: Record<AnnState, Prisma.AnnouncementWhereInput> = {
    DRAFT: { status: 'DRAFT' }, ARCHIVED: { status: 'ARCHIVED' },
    SCHEDULED: { status: 'PUBLISHED', publishAt: { gt: now } },
    LIVE: liveWhere(['ALL_DRIVERS', 'OFFICERS', 'EVERYONE', 'ASSOCIATIONS', 'PASSENGERS'], now),
    EXPIRED: { status: 'PUBLISHED', expiresAt: { lte: now } },
  };
  const where: Prisma.AnnouncementWhereInput = {
    AND: [p.state ? stateWhere[p.state] : {}, p.q ? { OR: [{ title: { contains: p.q, mode: 'insensitive' } }, { body: { contains: p.q, mode: 'insensitive' } }] } : {}],
  };
  const [rows, total] = await Promise.all([
    prisma.announcement.findMany({ where, ...pageArgs(p), orderBy: [{ updatedAt: 'desc' }], ...select }),
    prisma.announcement.count({ where }),
  ]);
  res.json(paged(rows.map(shape), total, p));
}));

announcementsRouter.post('/', requirePermission('announcements.manage'), ah(async (req, res) => {
  const b = body.parse(req.body);
  const toda = await theToda();
  const a = await prisma.announcement.create({
    data: {
      organizationId: toda.organizationId, title: b.title, body: b.body, priority: b.priority, audience: b.audience,
      publishAt: b.publish ? b.publishAt ?? new Date() : b.publishAt ?? null, expiresAt: b.expiresAt ?? null,
      status: b.publish ? 'PUBLISHED' : 'DRAFT', authorId: req.auth!.userId, targets: { create: { associationId: toda.id } },
    },
    ...select,
  });
  await audit(req, { action: b.publish ? 'PUBLISH' : 'CREATE', entity: 'Announcement', entityId: a.id, summary: `${b.publish ? (annState(a) === 'SCHEDULED' ? 'Scheduled' : 'Published') : 'Drafted'} announcement “${a.title}”`, associationId: toda.id });
  res.status(201).json(shape(a));
}));

announcementsRouter.patch('/:id', requirePermission('announcements.manage'), ah(async (req, res) => {
  const b = body.parse(req.body);
  const before = await prisma.announcement.findUnique({ where: { id: req.params.id } });
  if (!before) throw notFound('Announcement');
  if (before.status === 'ARCHIVED') throw new HttpError(409, 'Restore this announcement before editing it');
  const publishing = b.publish || before.status === 'PUBLISHED';
  const a = await prisma.announcement.update({
    where: { id: before.id },
    data: {
      title: b.title, body: b.body, priority: b.priority, audience: b.audience, expiresAt: b.expiresAt ?? null,
      publishAt: publishing ? b.publishAt ?? before.publishAt ?? new Date() : b.publishAt ?? null,
      status: publishing ? 'PUBLISHED' : 'DRAFT',
    },
    ...select,
  });
  await audit(req, { action: before.status === 'DRAFT' && publishing ? 'PUBLISH' : 'UPDATE', entity: 'Announcement', entityId: a.id, summary: `${before.status === 'DRAFT' && publishing ? 'Published' : 'Edited'} announcement “${a.title}”`, before: { title: before.title, status: before.status }, after: { title: a.title, status: a.status } });
  res.json(shape(a));
}));

announcementsRouter.post('/:id/archive', requirePermission('announcements.manage'), ah(async (req, res) => {
  const { archived } = z.object({ archived: z.boolean().default(true) }).parse(req.body ?? {});
  const a = await prisma.announcement.findUnique({ where: { id: req.params.id } });
  if (!a) throw notFound('Announcement');
  const updated = await prisma.announcement.update({ where: { id: a.id }, data: { status: archived ? 'ARCHIVED' : a.publishAt ? 'PUBLISHED' : 'DRAFT' }, ...select });
  await audit(req, { action: archived ? 'ARCHIVE' : 'RESTORE', entity: 'Announcement', entityId: a.id, summary: `${archived ? 'Took down' : 'Restored'} announcement “${a.title}”` });
  res.json(shape(updated));
}));

announcementsRouter.delete('/:id', requirePermission('announcements.manage'), ah(async (req, res) => {
  const a = await prisma.announcement.findUnique({ where: { id: req.params.id } });
  if (!a) throw notFound('Announcement');
  if (a.status !== 'DRAFT') throw new HttpError(409, 'Only drafts can be deleted. Take a published announcement down instead, so there is a record of it.');
  await prisma.announcement.delete({ where: { id: a.id } });
  await audit(req, { action: 'DELETE', entity: 'Announcement', entityId: a.id, summary: `Deleted draft announcement “${a.title}”` });
  res.json({ ok: true });
}));
