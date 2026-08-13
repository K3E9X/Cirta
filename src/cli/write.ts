/**
 * Writing an output file without being able to lose the input.
 *
 * `--in-place` used to write straight over the original. Two ways that ends
 * badly: the process dies between truncate and last byte, and the only copy of
 * the document is a partial file; or the destination is a symlink, and the write
 * lands on whatever it points at. Neither is exotic — the first is a laptop
 * closing, the second is a path in a shared or downloads directory.
 *
 * So every write goes to a temporary file in the destination's own directory —
 * the same filesystem, so the rename is atomic — and is then renamed into place.
 * `rename` replaces a symlink rather than following it, and the explicit check
 * turns that into a clear refusal instead of a surprise. In-place writes keep a
 * `.bak` of the original, made through the same path before anything is
 * replaced.
 */

import { writeFile, rename, lstat, copyFile, unlink } from 'node:fs/promises';
import { dirname, basename, join } from 'node:path';

export class UnsafeDestinationError extends Error {
  constructor(destination: string) {
    super(`refusing to write through a symlink: ${destination}`);
    this.name = 'UnsafeDestinationError';
  }
}

async function isSymlink(path: string): Promise<boolean> {
  try {
    return (await lstat(path)).isSymbolicLink();
  } catch {
    return false; // Missing is fine; anything else surfaces on the write itself.
  }
}

/** Write bytes to `destination` atomically, refusing a symlinked target. */
export async function safeWrite(destination: string, data: Uint8Array): Promise<void> {
  if (await isSymlink(destination)) throw new UnsafeDestinationError(destination);

  const temporary = join(
    dirname(destination),
    `.${basename(destination)}.${process.pid}.${Date.now()}.tmp`,
  );
  try {
    await writeFile(temporary, data);
    await rename(temporary, destination);
  } catch (error) {
    await unlink(temporary).catch(() => {});
    throw error;
  }
}

/**
 * Copy `path` to `path.bak` before it is replaced.
 *
 * Returns the backup path so the caller can name it in its report — a backup
 * nobody is told about is a backup nobody uses.
 */
export async function backup(path: string): Promise<string> {
  const destination = `${path}.bak`;
  if (await isSymlink(destination)) throw new UnsafeDestinationError(destination);
  await copyFile(path, destination);
  return destination;
}
