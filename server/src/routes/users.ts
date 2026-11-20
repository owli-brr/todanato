import { Router } from 'express';
import bcrypt from 'bcryptjs';
import crypto from 'node:crypto';
import { z } from 'zod';
import { Prisma } from '@prisma/client';
import { prisma } from '../lib/prisma';
import { ah, HttpError, forbidden, notFound, orderBy, pageArgs, paged, paginationSchema, optStr } from '../lib/http';
import { audit, diff } from '../lib/audit';
import { assertAssociationAccess, assocScope, requirePermission } from '../middleware/auth';
import { passwordSchema } from './auth';
import { PERMISSIONS } from '../lib/permissions';
import { guardDemo, guardDemoAccount } from '../lib/demo';
import { todaId } from '../lib/toda';

export const usersRouter = Router();

const userSelect = {
  id: true, email: true, fullName: true, phone: true, isActive: true, lastLoginAt: true, createdAt: true,
  mustChangePassword: true, lockedUntil: true,
  role: { select: { id: true, key: true, name: true, scope: true } },
  association: { select: { id: true, name: true, code: true } },
} satisfies Prisma.UserSelect;

const ROLE_RANK: Record<string, number> = { SUPER_ADMIN: 100, AUDITOR: 50, ASSOC_PRESIDENT: 40, SECRETARY: 30, TREASURER: 30, DISPATCHER: 20 };

/** Users can only grant roles at or below their own rank, and only Super Admins create Super Admins. */
async function assertCanGrantRole(req: Express.Request, roleId: string) {
  const role = await prisma.role.findUnique({ where: { id: roleId } });
  if (!role) throw new HttpError(400, 'Unknown role');
  const mine = ROLE_RANK[req.auth!.roleKey] ?? 0;
  const theirs = ROLE_RANK[role.key] ?? 0;
  if (req.auth!.roleKey !== 'SUPER_ADMIN' && (theirs >= mine || role.scope === 'GLOBAL')) {
    throw forbidden(`You cannot assign the ${role.name} role`);
  }
  return role;
}

usersRouter.get(
  '/',
  requirePermission('users.read'),
  ah(async (req, res) => {
    const p = paginationSchema.extend({ roleId: z.string().optional(), status: z.enum(['active', 'inactive']).optional(), associationId: z.string().optional() }).parse(req.query);
    const where: Prisma.UserWhereInput = {
      AND: [
        { deletedAt: null },
        req.auth!.scope === 'GLOBAL' ? {} : req.auth!.scope === 'ORGANIZATION' ? { organizationId: req.auth!.organizationId } : (assocScope(req) as Prisma.UserWhereInput),
        p.q ? { OR: [{ fullName: { contains: p.q, mode: 'insensitive' } }, { email: { contains: p.q, mode: 'insensitive' } }] } : {},
        p.roleId ? { roleId: p.roleId } : {},
        p.associationId ? { associationId: p.associationId } : {},
        p.status ? { isActive: p.status === 'active' } : {},
      ],
    };
    const ob = orderBy<Prisma.UserOrderByWithRelationInput>(p.sort, p.dir, {
      fullName: (d) => ({ fullName: d }), email: (d) => ({ email: d }), lastLoginAt: (d) => ({ lastLoginAt: { sort: d, nulls: 'last' } }), createdAt: (d) => ({ createdAt: d }),
    }, { fullName: 'asc' });
    const [items, total] = await Promise.all([prisma.user.findMany({ where, select: userSelect, orderBy: ob, ...pageArgs(p) }), prisma.user.count({ where })]);
    res.json(paged(items, total, p));
  }),
);

const userBody = z.object({
  fullName: z.string().trim().min(2, 'Enter the full name').max(120),
  email: z.string().trim().toLowerCase().email('Enter a valid email'),
  phone: optStr(20),
  roleId: z.string().uuid('Choose a role'),
  associationId: z.string().uuid().optional().nullable(),
});

async function loadScopedUser(req: Express.Request, id: string) {
  const u = await prisma.user.findFirst({ where: { id, deletedAt: null }, include: { role: true } });
  if (!u) throw notFound('User');
  const a = req.auth!;
  if (a.scope === 'ORGANIZATION' && u.organizationId !== a.organizationId) throw notFound('User');
  if (a.scope === 'ASSOCIATION' && u.associationId !== a.associationId) throw notFound('User');
  return u;
}

usersRouter.post(
  '/',
  requirePermission('users.manage'),
  ah(async (req, res) => {
    const body = userBody.extend({ password: passwordSchema.optional() }).parse(req.body);
    const role = await assertCanGrantRole(req, body.roleId);
    const associationId = role.scope === 'ASSOCIATION' ? await todaId() : null;
    await assertAssociationAccess(req, associationId);
    let organizationId = req.auth!.organizationId;
    if (associationId) organizationId = (await prisma.association.findUniqueOrThrow({ where: { id: associationId } })).organizationId;

    // No password given → generate a temporary one the admin hands over; user must change it on first login.
    const temp = body.password ?? crypto.randomBytes(9).toString('base64url') + '7a';
    const user = await prisma.user.create({
      data: {
        fullName: body.fullName, email: body.email, phone: body.phone, roleId: role.id, associationId, organizationId,
        passwordHash: await bcrypt.hash(temp, 12), mustChangePassword: true,
      },
      select: userSelect,
    });
    await audit(req, { action: 'CREATE', entity: 'User', entityId: user.id, summary: `Created user ${user.email} as ${role.name}`, after: user, associationId });
    res.status(201).json({ user, temporaryPassword: body.password ? undefined : temp });
  }),
);

usersRouter.get('/:id', requirePermission('users.read'), ah(async (req, res) => {
  await loadScopedUser(req, req.params.id);
  const user = await prisma.user.findUniqueOrThrow({ where: { id: req.params.id }, select: userSelect });
  const loginHistory = await prisma.loginHistory.findMany({ where: { userId: user.id }, orderBy: { createdAt: 'desc' }, take: 20 });
  const sessions = req.auth!.permissions.has('sessions.manage')
    ? await prisma.session.findMany({ where: { userId: user.id, revokedAt: null, expiresAt: { gt: new Date() } }, select: { id: true, userAgent: true, ipAddress: true, lastUsedAt: true, createdAt: true }, orderBy: { lastUsedAt: 'desc' } })
    : [];
  res.json({ ...user, loginHistory, sessions });
}));

usersRouter.patch(
  '/:id',
  requirePermission('users.manage'),
  ah(async (req, res) => {
    const before = await loadScopedUser(req, req.params.id);
    if (before.role.key === 'SUPER_ADMIN' && req.auth!.roleKey !== 'SUPER_ADMIN') throw forbidden();
    const body = userBody.partial().parse(req.body);
    if ((body.email && body.email !== before.email) || (body.roleId && body.roleId !== before.roleId)) guardDemoAccount(before.email, 'change its email or role');
    let associationId = before.associationId;
    if (body.roleId && body.roleId !== before.roleId) {
      if (before.id === req.auth!.userId) throw forbidden('You cannot change your own role');
      const role = await assertCanGrantRole(req, body.roleId);
      if (role.scope !== 'ASSOCIATION') associationId = null;
    }
    const role = await prisma.role.findUniqueOrThrow({ where: { id: body.roleId ?? before.roleId } });
    if (role.scope === 'ASSOCIATION') associationId = await todaId();
    await assertAssociationAccess(req, associationId);
    const user = await prisma.user.update({
      where: { id: before.id },
      data: { fullName: body.fullName, email: body.email, phone: body.phone, roleId: body.roleId, associationId },
      select: userSelect,
    });
    const d = diff(before as unknown as Record<string, unknown>, { ...user, roleId: user.role.id, associationId: user.association?.id ?? null });
    await audit(req, { action: 'UPDATE', entity: 'User', entityId: user.id, summary: `Updated user ${user.email} (${d.changed.join(', ') || 'no changes'})`, before: d.before, after: d.after });
    res.json(user);
  }),
);

usersRouter.post(
  '/:id/status',
  requirePermission('users.manage'),
  ah(async (req, res) => {
    const { active } = z.object({ active: z.boolean() }).parse(req.body);
    const before = await loadScopedUser(req, req.params.id);
    if (before.id === req.auth!.userId) throw forbidden('You cannot deactivate your own account');
    guardDemoAccount(before.email, 'deactivate it');
    if (before.role.key === 'SUPER_ADMIN' && req.auth!.roleKey !== 'SUPER_ADMIN') throw forbidden();
    await prisma.$transaction([
      prisma.user.update({ where: { id: before.id }, data: { isActive: active } }),
      ...(active ? [] : [prisma.session.updateMany({ where: { userId: before.id, revokedAt: null }, data: { revokedAt: new Date() } })]),
    ]);
    await audit(req, { action: active ? 'ACTIVATE' : 'DEACTIVATE', entity: 'User', entityId: before.id, summary: `${active ? 'Activated' : 'Deactivated'} user ${before.email}` });
    res.json({ ok: true });
  }),
);

usersRouter.post(
  '/:id/reset-password',
  requirePermission('users.manage'),
  ah(async (req, res) => {
    const before = await loadScopedUser(req, req.params.id);
    if (before.role.key === 'SUPER_ADMIN' && req.auth!.roleKey !== 'SUPER_ADMIN') throw forbidden();
    guardDemoAccount(before.email, 'reset its password');
    const temp = crypto.randomBytes(9).toString('base64url') + '7a';
    await prisma.$transaction([
      prisma.user.update({ where: { id: before.id }, data: { passwordHash: await bcrypt.hash(temp, 12), mustChangePassword: true, failedLogins: 0, lockedUntil: null } }),
      prisma.session.updateMany({ where: { userId: before.id, revokedAt: null }, data: { revokedAt: new Date() } }),
    ]);
    await audit(req, { action: 'PASSWORD_RESET', entity: 'User', entityId: before.id, summary: `Issued a temporary password for ${before.email}` });
    res.json({ temporaryPassword: temp });
  }),
);

usersRouter.delete(
  '/:id/sessions',
  requirePermission('sessions.manage'),
  ah(async (req, res) => {
    const u = await loadScopedUser(req, req.params.id);
    const r = await prisma.session.updateMany({ where: { userId: u.id, revokedAt: null }, data: { revokedAt: new Date() } });
    await audit(req, { action: 'REVOKE_SESSIONS', entity: 'User', entityId: u.id, summary: `Signed out ${u.email} from ${r.count} session(s)` });
    res.json({ revoked: r.count });
  }),
);

// ───── Roles & permissions ─────

export const rolesRouter = Router();

rolesRouter.get('/', ah(async (_req, res) => {
  const roles = await prisma.role.findMany({ include: { permissions: { include: { permission: true } }, _count: { select: { users: true } } }, orderBy: { name: 'asc' } });
  res.json(roles.map((r) => ({ id: r.id, key: r.key, name: r.name, description: r.description, scope: r.scope, userCount: r._count.users, permissions: r.permissions.map((p) => p.permission.key).sort() })));
}));

rolesRouter.get('/permissions', ah(async (_req, res) => {
  res.json(Object.entries(PERMISSIONS).map(([key, [module, description]]) => ({ key, module, description })));
}));

rolesRouter.put(
  '/:id/permissions',
  requirePermission('roles.manage'),
  ah(async (req, res) => {
    guardDemo('Editing role permissions');
    const { permissions } = z.object({ permissions: z.array(z.string()) }).parse(req.body);
    const role = await prisma.role.findUnique({ where: { id: req.params.id }, include: { permissions: { include: { permission: true } } } });
    if (!role) throw notFound('Role');
    if (role.key === 'SUPER_ADMIN') throw forbidden('Super Administrator always has every permission');
    const valid = await prisma.permission.findMany({ where: { key: { in: permissions } } });
    await prisma.$transaction([
      prisma.rolePermission.deleteMany({ where: { roleId: role.id } }),
      prisma.rolePermission.createMany({ data: valid.map((p) => ({ roleId: role.id, permissionId: p.id })) }),
    ]);
    const before = role.permissions.map((p) => p.permission.key).sort();
    const after = valid.map((p) => p.key).sort();
    await audit(req, {
      action: 'UPDATE', entity: 'Role', entityId: role.id,
      summary: `Changed permissions of ${role.name}: +${after.filter((k) => !before.includes(k)).join(', ') || 'none'} / -${before.filter((k) => !after.includes(k)).join(', ') || 'none'}`,
      before: { permissions: before }, after: { permissions: after },
    });
    res.json({ ok: true, permissions: after });
  }),
);
