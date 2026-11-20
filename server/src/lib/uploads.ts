import multer from 'multer';
import path from 'node:path';
import crypto from 'node:crypto';
import fs from 'node:fs';
import { HttpError } from './http';

// Local disk storage for development. Files are never served statically:
// they go through /api/files/* which checks permissions and association scope.
// For production, swap this for S3 / GCS / Supabase Storage behind the same interface.
export const UPLOAD_DIR = path.resolve(process.env.UPLOAD_DIR || path.join(__dirname, '../../uploads'));
fs.mkdirSync(UPLOAD_DIR, { recursive: true });

const ALLOWED: Record<string, string> = {
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/webp': '.webp',
  'application/pdf': '.pdf',
};

export const upload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, cb) => cb(null, crypto.randomUUID() + ALLOWED[file.mimetype]),
  }),
  limits: { fileSize: 5 * 1024 * 1024, files: 1 },
  fileFilter: (_req, file, cb) => {
    if (!ALLOWED[file.mimetype]) return cb(new HttpError(400, 'Only JPG, PNG, WEBP or PDF files are allowed'));
    cb(null, true);
  },
});

/** Check the file's magic bytes so a renamed executable can't pass as a PDF/image. */
export function verifyMagic(filePath: string, mime: string) {
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(12);
  fs.readSync(fd, buf, 0, 12, 0);
  fs.closeSync(fd);
  const ok =
    (mime === 'application/pdf' && buf.subarray(0, 4).toString() === '%PDF') ||
    (mime === 'image/png' && buf[0] === 0x89 && buf.subarray(1, 4).toString() === 'PNG') ||
    (mime === 'image/jpeg' && buf[0] === 0xff && buf[1] === 0xd8) ||
    (mime === 'image/webp' && buf.subarray(0, 4).toString() === 'RIFF' && buf.subarray(8, 12).toString() === 'WEBP');
  if (!ok) {
    fs.rmSync(filePath, { force: true });
    throw new HttpError(400, 'The file content does not match its type');
  }
}

export function resolveStored(fileUrl: string) {
  const name = path.basename(fileUrl);
  const full = path.join(UPLOAD_DIR, name);
  if (!full.startsWith(UPLOAD_DIR)) throw new HttpError(400, 'Bad path');
  return full;
}

export function removeStored(fileUrl: string | null | undefined) {
  if (!fileUrl || fileUrl.startsWith('http')) return;
  fs.rmSync(resolveStored(fileUrl), { force: true });
}
