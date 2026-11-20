import { Router, type NextFunction, type Request, type Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import rateLimit from 'express-rate-limit';
import { z } from 'zod';
import { prisma } from '../lib/prisma';
import { ah, HttpError, notFound, phPhone } from '../lib/http';
import { audit } from '../lib/audit';
import { sendStored } from '../lib/uploads';
import { isDemoDriver } from '../lib/demo';
import { JWT_SECRET } from '../middleware/auth';
import { passwordSchema } from './auth';
import { byPriority, liveWhere } from './announcements';
import { driverFullName } from './drivers';

// Driver portal: approved drivers sign in with their mobile number and see their own records.
// Separate from staff auth: its own cookie, token audience and MobileAccount table (shared later
// with the Phase 3 driver app).

export const driverPortalRouter = Router();

const COOKIE = 'todanato_drv';
const DAYS = 7;
const MAX_FAILED = 5;
const LOCK_MINUTES = 15;

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      driverAccount?: { id: string; driverId: string; phone: string };
    }
  }
}

function setCookie(res: Response, accountId: string, version: number) {
  const token = jwt.sign({ sub: accountId, ver: version }, JWT_SECRET, { audience: 'driver', expiresIn: `${DAYS}d` });
  res.cookie(COOKIE, token, { httpOnly: true, sameSite: 'strict', secure: process.env.NODE_ENV === 'production', path: '/api/driver', maxAge: DAYS * 86400 * 1000 });
}

async function requireDriver(req: Request, res: Response, next: NextFunction) {
  try {
    const token = req.cookies?.[COOKIE];
    if (!token) throw new HttpError(401, 'Please sign in');
    let p: { sub: string; ver: number };
    try { p = jwt.verify(token, JWT_SECRET, { audience: 'driver' }) as { sub: string; ver: number }; } catch { throw new HttpError(401, 'Your session has ended. Please sign in again.'); }
    const acc = await prisma.mobileAccount.findUnique({ where: { id: p.sub }, include: { driver: true } });
    if (!acc || acc.tokenVersion !== p.ver || !acc.driver || acc.driver.deletedAt || acc.driver.applicationStatus !== 'APPROVED') {
      res.clearCookie(COOKIE, { path: '/api/driver' });
      throw new HttpError(401, 'Your session has ended. Please sign in again.');
    }
    req.driverAccount = { id: acc.id, driverId: acc.driver.id, phone: acc.phone };
    next();
  } catch (e) { next(e); }
}

const loginLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many sign-in attempts. Try again in a few minutes.' } });
const activateLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 10, standardHeaders: true, legacyHeaders: false, message: { error: 'Too many attempts. Try again in an hour.' } });

/** First-time setup: prove you're the approved driver, then choose a password. */
driverPortalRouter.post('/activate', activateLimiter, ah(async (req, res) => {
  const body = z.object({
    reference: z.string().trim().toUpperCase().min(5, 'Enter your reference number'),
    licenseNumber: z.string().trim().toUpperCase().min(5, 'Enter your license number'),
    phone: phPhone,
    password: passwordSchema,
  }).parse(req.body);
  const d = await prisma.driver.findFirst({ where: { driverCode: body.reference, licenseNumber: body.licenseNumber, contactNumber: body.phone, deletedAt: null }, include: { mobileAccount: true } });
  // One message for every mismatch, so the details can't be guessed one at a time.
  if (!d) throw new HttpError(400, 'Those details don’t match an approved driver. Use the mobile number you gave the TODA.');
  if (d.applicationStatus !== 'APPROVED') throw new HttpError(409, 'Your application hasn’t been approved yet. Check your application status first.');
  if (d.mobileAccount) throw new HttpError(409, 'Your driver account is already set up. Sign in instead, or ask the TODA office to reset it.');
  if (await prisma.mobileAccount.findUnique({ where: { phone: body.phone } })) throw new HttpError(409, 'This mobile number is already used by another account. Ask the TODA office for help.');
  const acc = await prisma.mobileAccount.create({ data: { phone: body.phone, passwordHash: await bcrypt.hash(body.password, 12), kind: 'MOBILE_DRIVER', driverId: d.id, lastLoginAt: new Date() } });
  await audit(req, { action: 'CREATE', entity: 'Driver', entityId: d.id, summary: `${driverFullName(d)} set up their driver portal account`, associationId: d.associationId, userEmail: `driver ${d.driverCode}` });
  setCookie(res, acc.id, acc.tokenVersion);
  res.status(201).json({ ok: true });
}));

driverPortalRouter.post('/login', loginLimiter, ah(async (req, res) => {
  const { phone, password } = z.object({ phone: z.string().trim().min(1, 'Enter your mobile number'), password: z.string().min(1, 'Enter your password') }).parse(req.body);
  const acc = await prisma.mobileAccount.findUnique({ where: { phone }, include: { driver: true } });
  if (!acc || !acc.driver || acc.driver.deletedAt) {
    await bcrypt.compare(password, '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
    throw new HttpError(401, 'Incorrect mobile number or password');
  }
  if (acc.lockedUntil && acc.lockedUntil > new Date()) throw new HttpError(423, 'Too many failed attempts. Try again in 15 minutes.');
  if (!(await bcrypt.compare(password, acc.passwordHash))) {
    if (!isDemoDriver(acc.phone)) {
      const failed = acc.failedLogins + 1;
      await prisma.mobileAccount.update({ where: { id: acc.id }, data: { failedLogins: failed >= MAX_FAILED ? 0 : failed, lockedUntil: failed >= MAX_FAILED ? new Date(Date.now() + LOCK_MINUTES * 60000) : null } });
    }
    throw new HttpError(401, 'Incorrect mobile number or password');
  }
  if (acc.driver.applicationStatus !== 'APPROVED') throw new HttpError(403, 'Your driver account is not active. Contact the TODA office.');
  await prisma.mobileAccount.update({ where: { id: acc.id }, data: { failedLogins: 0, lockedUntil: null, lastLoginAt: new Date() } });
  setCookie(res, acc.id, acc.tokenVersion);
  res.json({ ok: true });
}));

driverPortalRouter.post('/logout', (_req, res) => {
  res.clearCookie(COOKIE, { path: '/api/driver' });
  res.json({ ok: true });
});

driverPortalRouter.get('/me', requireDriver, ah(async (req, res) => {
  const d = await prisma.driver.findUniqueOrThrow({
    where: { id: req.driverAccount!.driverId },
    include: {
      association: { select: { name: true, acronym: true, terminalLocation: true, contactNumber: true, email: true, monthlyDues: true, dailyContribution: true } },
      memberships: { orderBy: { appliedAt: 'desc' }, take: 1 },
      documents: { orderBy: { uploadedAt: 'desc' }, select: { id: true, type: true, documentNo: true, fileName: true, expiresAt: true, status: true, remarks: true, uploadedAt: true } },
      vehicleAssignments: { where: { unassignedAt: null }, take: 1, include: { vehicle: { select: { plateNumber: true, bodyNumber: true, make: true, model: true, color: true, status: true, registrationExpiry: true, franchiseExpiry: true, insuranceExpiry: true } } } },
    },
  });
  const v = d.vehicleAssignments[0]?.vehicle ?? null;
  const [openDues, payments, announcements] = await Promise.all([
    prisma.dueCharge.findMany({ where: { driverId: d.id, status: { in: ['UNPAID', 'PARTIAL', 'OVERDUE'] } }, orderBy: { dueDate: 'asc' }, select: { id: true, type: true, periodStart: true, amount: true, amountPaid: true, dueDate: true } }),
    prisma.payment.findMany({ where: { driverId: d.id, status: 'POSTED' }, orderBy: { paidAt: 'desc' }, take: 10, select: { id: true, receiptNo: true, type: true, method: true, amount: true, paidAt: true } }),
    prisma.announcement.findMany({ where: liveWhere(['ALL_DRIVERS', 'EVERYONE']), take: 10, select: { id: true, title: true, body: true, priority: true, publishAt: true, createdAt: true } }),
  ]);
  const balance = openDues.reduce((s, x) => s + Number(x.amount) - Number(x.amountPaid), 0);
  const in30 = Date.now() + 30 * 86400000;
  const reminders: { level: 'warning' | 'danger'; text: string }[] = [];
  const check = (label: string, date: Date | null | undefined) => {
    if (!date) return;
    if (date.getTime() < Date.now()) reminders.push({ level: 'danger', text: `${label} expired on ${date.toLocaleDateString('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' })}` });
    else if (date.getTime() < in30) reminders.push({ level: 'warning', text: `${label} expires on ${date.toLocaleDateString('en-PH', { dateStyle: 'medium', timeZone: 'Asia/Manila' })}` });
  };
  check('Your driver’s license', d.licenseExpiry);
  const overdue = openDues.filter((x) => x.dueDate.getTime() < Date.now());
  if (overdue.length) reminders.push({ level: 'danger', text: `You have ${overdue.length} overdue charge${overdue.length === 1 ? '' : 's'} totalling ₱${overdue.reduce((s, x) => s + Number(x.amount) - Number(x.amountPaid), 0).toLocaleString('en-PH')}. Please settle at the TODA office.` });
  if (v) { check(`Registration of ${v.plateNumber}`, v.registrationExpiry); check(`Franchise (MTOP) of ${v.plateNumber}`, v.franchiseExpiry); check(`Insurance of ${v.plateNumber}`, v.insuranceExpiry); }
  for (const doc of d.documents) if (doc.status !== 'REJECTED' && doc.type !== 'DRIVERS_LICENSE') check(`Your ${doc.type.replace(/_/g, ' ').toLowerCase()}`, doc.expiresAt);
  for (const doc of d.documents) if (doc.status === 'REJECTED') reminders.push({ level: 'danger', text: `Your ${doc.type.replace(/_/g, ' ').toLowerCase()} was rejected${doc.remarks ? `: ${doc.remarks}` : ''}. Bring a new copy to the TODA office.` });

  res.json({
    driver: {
      fullName: driverFullName(d), firstName: d.firstName, driverCode: d.driverCode, photo: !!d.photoUrl,
      status: d.status, suspensionReason: d.suspensionReason, suspendedUntil: d.suspendedUntil,
      contactNumber: d.contactNumber, email: d.email, address: d.address,
      licenseNumber: d.licenseNumber, licenseType: d.licenseType, licenseExpiry: d.licenseExpiry,
      approvedAt: d.approvedAt, rating: d.rating,
    },
    toda: d.association,
    membership: d.memberships[0] ? { membershipNo: d.memberships[0].membershipNo, status: d.memberships[0].status, memberType: d.memberships[0].memberType, since: d.memberships[0].startDate ?? d.memberships[0].approvedAt } : null,
    vehicle: v,
    documents: d.documents,
    reminders,
    announcements: announcements.sort(byPriority),
    finance: { balance: Math.round(balance * 100) / 100, openDues: openDues.map((x) => ({ ...x, balance: Number(x.amount) - Number(x.amountPaid), overdue: x.dueDate.getTime() < Date.now() })), payments },
  });
}));

driverPortalRouter.get('/documents/:id', requireDriver, ah(async (req, res) => {
  const doc = await prisma.driverDocument.findFirst({ where: { id: req.params.id, driverId: req.driverAccount!.driverId } });
  if (!doc) throw notFound('Document');
  await sendStored(res, doc.fileUrl, doc.fileName);
}));

driverPortalRouter.get('/photo', requireDriver, ah(async (req, res) => {
  const d = await prisma.driver.findUniqueOrThrow({ where: { id: req.driverAccount!.driverId } });
  if (!d.photoUrl) throw notFound('Photo');
  await sendStored(res, d.photoUrl, 'photo');
}));

driverPortalRouter.post('/change-password', requireDriver, ah(async (req, res) => {
  const { currentPassword, newPassword } = z.object({ currentPassword: z.string().min(1, 'Enter your current password'), newPassword: passwordSchema }).parse(req.body);
  const acc = await prisma.mobileAccount.findUniqueOrThrow({ where: { id: req.driverAccount!.id } });
  if (isDemoDriver(acc.phone)) throw new HttpError(403, 'This is the shared demo driver account, so its password can’t be changed.');
  if (!(await bcrypt.compare(currentPassword, acc.passwordHash))) throw new HttpError(400, 'Current password is incorrect', { fields: { currentPassword: 'Incorrect' } });
  const updated = await prisma.mobileAccount.update({ where: { id: acc.id }, data: { passwordHash: await bcrypt.hash(newPassword, 12), tokenVersion: { increment: 1 } } });
  setCookie(res, updated.id, updated.tokenVersion); // stay signed in here, sign out elsewhere
  res.json({ ok: true });
}));
