import { BadRequestException } from '@nestjs/common';
import { promises as fs } from 'fs';

/**
 * Defence-in-depth: validate the actual binary signature ("magic bytes")
 * of an uploaded file *after* multer has accepted its claimed MIME type.
 *
 * This protects against:
 *   - Renamed executables (`malware.exe` → `malware.jpg`).
 *   - Mismatched Content-Type headers from spoofed clients.
 *
 * Magic-byte references:
 *   JPEG : FF D8 FF
 *   PNG  : 89 50 4E 47 0D 0A 1A 0A
 *   PDF  : 25 50 44 46 2D            ("%PDF-")
 */
const SIGNATURES: Record<string, number[][]> = {
  'image/jpeg': [[0xff, 0xd8, 0xff]],
  'image/jpg': [[0xff, 0xd8, 0xff]],
  'image/png': [[0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]],
  'application/pdf': [[0x25, 0x50, 0x44, 0x46, 0x2d]],
};

function matches(buf: Buffer, signature: number[]): boolean {
  if (buf.length < signature.length) return false;
  for (let i = 0; i < signature.length; i++) {
    if (buf[i] !== signature[i]) return false;
  }
  return true;
}

/**
 * Reads the first 16 bytes of `filePath` and asserts that they match the
 * binary signature for `claimedMime`. Throws BadRequestException on mismatch.
 */
export async function assertFileSignature(
  filePath: string,
  claimedMime: string,
): Promise<void> {
  const allowed = SIGNATURES[claimedMime.toLowerCase()];
  if (!allowed) {
    throw new BadRequestException(`Unsupported MIME type: ${claimedMime}`);
  }

  let handle: fs.FileHandle | undefined;
  try {
    handle = await fs.open(filePath, 'r');
    const { buffer } = await handle.read(Buffer.alloc(16), 0, 16, 0);
    const matched = allowed.some((sig) => matches(buffer, sig));
    if (!matched) {
      throw new BadRequestException(
        'File content does not match its declared type. Upload rejected.',
      );
    }
  } finally {
    await handle?.close();
  }
}
