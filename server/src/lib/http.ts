import type { NextFunction, Request, Response, RequestHandler } from 'express';
import { z, ZodError } from 'zod';
import { Prisma } from '@prisma/client';

export class HttpError extends Error {
  constructor(public status: number, message: string, public details?: unknown) {
    super(message);
  }
}

export const notFound = (what = 'Record') => new HttpError(404, `${what} not found`);
export const forbidden = (msg = 'You do not have permission to do this') => new HttpError(403, msg);

export const ah =
  (fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>): RequestHandler =>
  (req, res, next) =>
    fn(req, res, next).catch(next);

export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ZodError) {
    return res.status(400).json({
      error: 'Please check the highlighted fields',
      fields: Object.fromEntries(err.issues.map((i) => [i.path.join('.'), i.message])),
    });
  }
  if (err instanceof HttpError) {
    return res.status(err.status).json({ error: err.message, details: err.details });
  }
  if (err instanceof Prisma.PrismaClientKnownRequestError) {
    if (err.code === 'P2002') {
      const target = (err.meta?.target as string[] | undefined)?.join(', ') ?? 'field';
      return res.status(409).json({ error: `A record with this ${target} already exists`, fields: { [String(target)]: 'Already in use' } });
    }
    if (err.code === 'P2025') return res.status(404).json({ error: 'Record not found' });
    if (err.code === 'P2003') return res.status(409).json({ error: 'This record is still linked to other records' });
  }
  if ((err as { code?: string })?.code === 'LIMIT_FILE_SIZE') {
    return res.status(413).json({ error: 'File is too large (max 5 MB)' });
  }
  console.error(err);
  res.status(500).json({ error: 'Something went wrong on the server' });
}

export const paginationSchema = z.object({
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(20),
  q: z.string().trim().max(100).optional(),
  sort: z.string().max(40).optional(),
  dir: z.enum(['asc', 'desc']).default('asc'),
});

export function pageArgs(p: { page: number; pageSize: number }) {
  return { skip: (p.page - 1) * p.pageSize, take: p.pageSize };
}

export function paged<T>(items: T[], total: number, p: { page: number; pageSize: number }) {
  return { items, total, page: p.page, pageSize: p.pageSize, pages: Math.max(1, Math.ceil(total / p.pageSize)) };
}

/** Build a Prisma orderBy from a whitelist so clients cannot sort on arbitrary fields. */
export function orderBy<T>(
  sort: string | undefined,
  dir: 'asc' | 'desc',
  allowed: Record<string, (d: 'asc' | 'desc') => T>,
  fallback: T,
): T {
  if (sort && allowed[sort]) return allowed[sort](dir);
  return fallback;
}

// Shared Zod helpers
export const optStr = (max = 200) =>
  z.string().trim().max(max).optional().nullable().transform((v) => (v === '' ? null : v ?? null));
export const optDate = z
  .union([z.string(), z.date()])
  .optional()
  .nullable()
  .transform((v) => (v ? new Date(v) : null))
  .refine((d) => d === null || !isNaN(d.getTime()), 'Invalid date');
export const reqDate = z.coerce.date({ errorMap: () => ({ message: 'Enter a valid date' }) });
export const phPhone = z
  .string()
  .trim()
  .regex(/^(\+63|0)9\d{9}$/, 'Use a PH mobile number like 09171234567');
