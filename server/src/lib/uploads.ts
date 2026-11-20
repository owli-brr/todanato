import multer from 'multer';
import type { Response } from 'express';
import { HttpError, notFound } from './http';
import { prisma } from './prisma';

// Files are stored in the StoredFile table (bytea) so the app works on hosts
// without a permanent disk, such as Vercel. They are never served publicly:
// /api/files/* checks permissions and association scope first.
// `fileUrl` columns hold "db:<StoredFile id>".

const ALLOWED = new Set(['image/jpeg', 'image/png', 'image/webp', 'application/pdf']);

export const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 4 * 1024 * 1024, files: 1 }, // Vercel caps request bodies at 4.5 MB
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED.has(file.mimetype)) return cb(new HttpError(400, 'Only JPG, PNG, WEBP or PDF files are allowed'));
    cb(null, true);
  },
});

/** Check the file's magic bytes so a renamed executable can't pass as a PDF/image. */
export function verifyMagic(buf: Buffer, mime: string) {
  const ok =
    (mime === 'application/pdf' && buf.subarray(0, 4).toString() === '%PDF') ||
    (mime === 'image/png' && buf[0] === 0x89 && buf.subarray(1, 4).toString() === 'PNG') ||
    (mime === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8) ||
    (mime === 'image/webp' && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP');
  if (!ok) throw new HttpError(400, 'The file content does not match its type');
}

/** Validate and persist an uploaded file; returns the value to store in a fileUrl column. */
export async function storeUpload(file: Express.Multer.File | undefined, message = 'Choose a file to upload') {
  if (!file) throw new HttpError(400, message);
  verifyMagic(file.buffer, file.mimetype);
  const row = await prisma.storedFile.create({ data: { mimeType: file.mimetype, sizeBytes: file.size, data: new Uint8Array(file.buffer) } });
  return `db:${row.id}`;
}

export async function removeStored(fileUrl: string | null | undefined) {
  if (!fileUrl?.startsWith('db:')) return;
  // Sample files from the seed are shared by many records; keep a file while anything still points at it.
  const [a, b, c] = await Promise.all([
    prisma.driverDocument.count({ where: { fileUrl } }),
    prisma.vehicleDocument.count({ where: { fileUrl } }),
    prisma.driver.count({ where: { photoUrl: fileUrl } }),
  ]);
  if (a + b + c === 0) await prisma.storedFile.deleteMany({ where: { id: fileUrl.slice(3) } });
}

export async function sendStored(res: Response, fileUrl: string, name: string) {
  const f = fileUrl.startsWith('db:') ? await prisma.storedFile.findUnique({ where: { id: fileUrl.slice(3) } }) : null;
  if (!f) throw notFound('File');
  res.setHeader('Content-Type', f.mimeType);
  res.setHeader('Content-Length', String(f.sizeBytes));
  res.setHeader('Content-Disposition', `inline; filename="${name.replace(/[^\w.\- ]/g, '_')}"`);
  res.setHeader('Cache-Control', 'private, max-age=300');
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.end(Buffer.from(f.data));
}
