/**
 * [F-P2 2.7] A folder cleaned at once: every file through the same cleaner,
 * with the same options, into one ZIP that keeps the folder's paths, and a
 * manifest beside them — the hashes before and after, what was found and
 * what is left, by label and never by value, and each file refused with the
 * reason.
 *
 * A file Ciirta cannot clean is not put in the archive as it was: it is
 * named in the manifest and left out. A cleaned folder that quietly carried
 * one untouched document would not be a cleaned folder.
 *
 * The cleaner and the inspector are passed in, so the page uses its worker
 * and a test uses the library directly.
 */

import { zipSync, strToU8 } from 'fflate';
import type { InspectOptions, InspectResult, RedactResult } from '../core/types.js';
import { manifest, manifestEntry, type Manifest, type ManifestEntry } from '../core/manifest.js';
import { ZIP_EPOCH } from '../core/zip.js';

export interface BatchFile {
  /** The path inside the folder, as the browser or the walk gives it. */
  path: string;
  data: Uint8Array;
}

export interface BatchDeps {
  inspect(data: Uint8Array, hint?: string): Promise<InspectResult>;
  redact(data: Uint8Array, hint?: string): Promise<RedactResult>;
}

export interface BatchRefusal {
  file: string;
  /** The refusal's code, when it has one: legacy-not-rewritable, encrypted-pdf… */
  code?: string;
  error: unknown;
}

export interface BatchOutcome {
  zip: Uint8Array;
  manifest: Manifest & { refused: Array<{ file: string; code?: string }> };
  refused: BatchRefusal[];
}

export const MANIFEST_NAME = 'ciirta-manifest.json';

/**
 * A path for inside the archive: forward slashes, no drive, no root, no
 * `..` — a cleaned folder that wrote outside itself when extracted would be
 * the zip slip this tool reports in other people's archives.
 */
export function batchPath(path: string): string {
  return path
    .replace(/\\/g, '/')
    .replace(/^[A-Za-z]:/, '')
    .split('/')
    .filter((part) => part && part !== '.' && part !== '..')
    .join('/');
}

/** `a.txt`, then `a (2).txt`: two files dropped under one name both reach the archive. */
function unique(path: string, taken: Set<string>): string {
  if (!taken.has(path)) return path;
  const slash = path.lastIndexOf('/');
  const dot = path.lastIndexOf('.');
  const cut = dot > slash + 1 ? dot : path.length;
  for (let n = 2; ; n++) {
    const candidate = `${path.slice(0, cut)} (${n})${path.slice(cut)}`;
    if (!taken.has(candidate)) return candidate;
  }
}

export async function cleanBatch(
  files: BatchFile[],
  deps: BatchDeps,
  { version, options, at = new Date() }: { version: string; options: InspectOptions; at?: Date },
): Promise<BatchOutcome> {
  const out: Record<string, Uint8Array> = {};
  const entries: ManifestEntry[] = [];
  const refused: BatchRefusal[] = [];
  const taken = new Set<string>([MANIFEST_NAME]);

  for (const file of files) {
    const path = unique(batchPath(file.path) || 'file', taken);
    taken.add(path);
    const name = path.slice(path.lastIndexOf('/') + 1);
    try {
      const before = await deps.inspect(file.data, name);
      const result = await deps.redact(file.data, name);
      const after = await deps.inspect(result.data!, name);
      out[path] = result.data!;
      entries.push(
        await manifestEntry({
          file: path,
          output: path,
          format: result.format,
          before: file.data,
          after: result.data!,
          findingsBefore: before.findings,
          findingsAfter: after.findings,
          notes: result.notes.map((note) => note.code),
        }),
      );
    } catch (error) {
      const code = (error as { code?: unknown } | null)?.code;
      refused.push({ file: path, code: typeof code === 'string' ? code : undefined, error });
    }
  }

  const written = {
    ...manifest(version, options, entries, at),
    refused: refused.map(({ file, code }) => (code ? { file, code } : { file })),
  };
  out[MANIFEST_NAME] = strToU8(`${JSON.stringify(written, null, 2)}\n`);
  return { zip: zipSync(out, { level: 6, mtime: ZIP_EPOCH }), manifest: written, refused };
}
