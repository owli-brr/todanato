import { Router } from 'express';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah, HttpError } from '../lib/http';
import { audit } from '../lib/audit';
import { nextDriverCode, nextMembershipNo } from '../lib/codes';
import { storeUpload, upload } from '../lib/uploads';
import { driverBody } from './drivers';

// Public, unauthenticated endpoints: driver applicants apply online and check their status.
// Applications land as PENDING drivers that association officers review in Drivers.

export const publicRouter = Router();

const applyLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many applications from this connection. Try again in an hour.' } });
const statusLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many lookups. Try again in a few minutes.' } });

publicRouter.get('/associations', ah(async (_req, res) => {
  res.json(await prisma.association.findMany({
    where: { status: 'ACTIVE', deletedAt: null },
    select: { id: true, name: true, acronym: true, barangay: true, city: true },
    orderBy: { name: 'asc' },
  }));
}));

const applicationBody = driverBody.omit({ memberType: true }).extend({
  associationId: z.string({ required_error: 'Choose the TODA you want to join' }).uuid('Choose the TODA you want to join'),
  memberType: z.enum(['DRIVER', 'DRIVER_OPERATOR']).default('DRIVER'),
  consent: z.literal('true', { errorMap: () => ({ message: 'You need to agree before applying' }) }),
  website: z.string().max(0).optional(), // honeypot: real people never fill this hidden field
});

publicRouter.post(
  '/driver-applications',
  applyLimiter,
  upload.single('license'),
  ah(async (req, res) => {
    const { consent: _c, website: _w, memberType, ...body } = applicationBody.parse(req.body);
    const assoc = await prisma.association.findFirst({ where: { id: body.associationId, status: 'ACTIVE', deletedAt: null } });
    if (!assoc) throw new HttpError(400, 'Choose the TODA you want to join', { fields: { associationId: 'Choose a TODA' } });
    if (req.file && !['image/jpeg', 'image/png', 'image/webp', 'application/pdf'].includes(req.file.mimetype)) throw new HttpError(400, 'Upload a photo or PDF of your license');
    if (await prisma.driver.findUnique({ where: { licenseNumber: body.licenseNumber } })) {
      throw new HttpError(409, 'An application with this license number already exists. Check its status instead.', { fields: { licenseNumber: 'Already applied' } });
    }
    const fileUrl = req.file ? await storeUpload(req.file) : null;

    const driver = await prisma.$transaction(async (tx) => {
      const d = await tx.driver.create({ data: { ...body, driverCode: await nextDriverCode() } });
      await tx.associationMembership.create({
        data: { driverId: d.id, associationId: assoc.id, membershipNo: await nextMembershipNo(assoc.code), memberType, remarks: 'Applied online' },
      });
      if (fileUrl && req.file) {
        await tx.driverDocument.create({
          data: { driverId: d.id, type: 'DRIVERS_LICENSE', documentNo: body.licenseNumber, expiresAt: body.licenseExpiry, fileUrl, fileName: req.file.originalname.slice(0, 200), mimeType: req.file.mimetype, sizeBytes: req.file.size },
        });
      }
      return d;
    }).catch((e) => {
      if (e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002') throw new HttpError(409, 'Please submit again.');
      throw e;
    });

    await audit(req, {
      action: 'APPLY', entity: 'Driver', entityId: driver.id,
      summary: `Online driver application from ${driver.firstName} ${driver.lastName} (${driver.driverCode}) to ${assoc.acronym ?? assoc.name}`,
      associationId: assoc.id, userEmail: driver.email ?? 'online application',
    });
    res.status(201).json({ reference: driver.driverCode, association: assoc.name });
  }),
);

publicRouter.post(
  '/driver-applications/status',
  statusLimiter,
  ah(async (req, res) => {
    const { reference, licenseNumber } = z.object({
      reference: z.string().trim().toUpperCase().min(5, 'Enter your reference number'),
      licenseNumber: z.string().trim().toUpperCase().min(5, 'Enter your license number'),
    }).parse(req.body);
    const d = await prisma.driver.findFirst({
      where: { driverCode: reference, licenseNumber, deletedAt: null },
      include: { memberships: { orderBy: { appliedAt: 'desc' }, take: 1, include: { association: { select: { name: true } } } } },
    });
    // Same message whether the reference or the license is wrong, so neither can be guessed one at a time.
    if (!d) throw new HttpError(404, 'No application matches that reference and license number');
    res.json({
      reference: d.driverCode,
      firstName: d.firstName,
      association: d.memberships[0]?.association.name ?? null,
      status: d.applicationStatus,
      reason: d.applicationStatus === 'REJECTED' ? d.rejectionReason : null,
      appliedAt: d.registeredAt,
      decidedAt: d.applicationStatus === 'APPROVED' ? d.approvedAt : d.applicationStatus === 'REJECTED' ? d.updatedAt : null,
    });
  }),
);
