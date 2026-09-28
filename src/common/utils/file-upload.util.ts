import { BadRequestException } from '@nestjs/common';
import { diskStorage, StorageEngine } from 'multer';
import { extname, join } from 'path';
import { v4 as uuidv4 } from 'uuid';
import { existsSync, mkdirSync } from 'fs';

export type MedicalUploadSubfolder = 'prescriptions' | 'bills' | 'package-images';

// ─────────────────────────────────────────────────────────
// Allowed MIME types for medical document uploads
// ─────────────────────────────────────────────────────────
export const ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/jpg',
  'image/png',
  'application/pdf',
];

export const ALLOWED_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.pdf'];

// Max file size: 5 MB
export const MAX_FILE_SIZE_BYTES = 5 * 1024 * 1024;

// ─────────────────────────────────────────────────────────
// Multer file filter — rejects bad MIME types immediately
// ─────────────────────────────────────────────────────────
export function medicalFileFilter(
  _req: Express.Request,
  file: Express.Multer.File,
  callback: (error: Error | null, acceptFile: boolean) => void,
): void {
  const ext = extname(file.originalname).toLowerCase();

  if (
    !ALLOWED_MIME_TYPES.includes(file.mimetype) ||
    !ALLOWED_EXTENSIONS.includes(ext)
  ) {
    callback(
      new BadRequestException(
        `Invalid file type "${file.mimetype}". ` +
          'Only JPG, PNG, and PDF files are accepted.',
      ),
      false,
    );
    return;
  }

  callback(null, true);
}

// ─────────────────────────────────────────────────────────
// Build Multer disk storage for a given subfolder
// Stores file as UUID + original extension
// e.g. uploads/prescriptions/550e8400-...jpg
// ─────────────────────────────────────────────────────────
export function buildDiskStorage(subfolder: MedicalUploadSubfolder): StorageEngine {
  const uploadDir = join(process.cwd(), 'uploads', subfolder);

  // Ensure directory exists at startup
  if (!existsSync(uploadDir)) {
    mkdirSync(uploadDir, { recursive: true });
  }

  return diskStorage({
    destination: (_req, _file, cb) => {
      cb(null, uploadDir);
    },
    filename: (_req, file, cb) => {
      const ext = extname(file.originalname).toLowerCase();
      const storedName = `${uuidv4()}${ext}`;
      cb(null, storedName);
    },
  });
}

// ─────────────────────────────────────────────────────────
// Build a safe relative path for storing in DB
// Never expose absolute server paths in API responses
// ─────────────────────────────────────────────────────────
export function buildRelativePath(
  subfolder: MedicalUploadSubfolder,
  storedName: string,
): string {
  return `uploads/${subfolder}/${storedName}`;
}

// ─────────────────────────────────────────────────────────
// Build a public-safe URL for serving the file
// Phase 5 will swap this for S3 pre-signed URLs
// ─────────────────────────────────────────────────────────
export function buildFileUrl(
  subfolder: MedicalUploadSubfolder,
  storedName: string,
): string {
  const baseUrl = process.env.API_BASE_URL ?? 'http://localhost:3001';
  return `${baseUrl}/uploads/${subfolder}/${storedName}`;
}
