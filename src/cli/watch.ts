/**
 * [F-P3 2.6] `ciirta watch <folder>`: the folder is looked at again every
 * interval, and each file is handed over once it has stopped changing.
 *
 * Polling, not file-system events. Events do not arrive from a network share,
 * a container's mounted volume or some synced folders — the places an outbox
 * tends to live — and a missed event is a file that leaves unread. A folder
 * walk a second costs little next to that.
 *
 * A file is ready when its size and modification time are the same on two
 * looks in a row: a copy in progress grows between them. Files are handled one
 * at a time, in the order they settled; one that fails is reported and the
 * watch goes on. Seen again with another size or date, a file is handled
 * again.
 */

import { readdir, stat } from 'node:fs/promises';
import { join, relative, resolve, sep } from 'node:path';
import { isSupportedFile, isWalkedDirectory, SKIP_DIRECTORIES, SUPPORTED_NAMES } from '../shared/files.js';

export interface WatchOptions {
  root: string;
  /** Milliseconds between two looks. */
  interval: number;
  /** Handle the files already there on the first look; otherwise only what arrives or changes after. */
  existing: boolean;
  /** A folder inside the watched one that is never looked at: where cleaned copies go. */
  ignore?: string;
  skip?: ReadonlySet<string>;
  onFile: (path: string, relative: string) => Promise<void>;
  onError?: (error: unknown, relative: string) => void;
}

export interface Watcher {
  stop(): Promise<void>;
}

/*
 * What arrives in a folder and is not a document yet, or not one to send: a
 * download in progress, an editor's lock or swap file, a hidden file — but not
 * the credential files the command line reads on purpose (.env, .npmrc…).
 */
const PENDING = /\.(?:part|partial|crdownload|download|tmp|temp|swp|swx)$/i;
const ignoredName = (name: string): boolean =>
  PENDING.test(name) || name.startsWith('~$') || (name.startsWith('.') && !SUPPORTED_NAMES.has(name.toLowerCase())) || !isSupportedFile(name);

type Seen = { size: number; mtime: number };

export function watchFolder(options: WatchOptions): Watcher {
  const root = resolve(options.root);
  const ignore = options.ignore === undefined ? undefined : resolve(options.ignore);
  const skip = options.skip ?? SKIP_DIRECTORIES;
  /** Last look: what each file was. */
  const last = new Map<string, Seen>();
  /** What each file was when it was handled. */
  const handled = new Map<string, Seen>();
  let first = true;
  let stopped = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let running: Promise<void> = Promise.resolve();

  async function walk(dir: string, found: Map<string, Seen>): Promise<void> {
    let entries;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // Removed between two looks, or not readable: nothing to hand over from it.
      return;
    }
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (!isWalkedDirectory(entry.name, skip)) continue;
        if (ignore && (path === ignore || path.startsWith(ignore + sep))) continue;
        await walk(path, found);
      } else if (entry.isFile() && !ignoredName(entry.name)) {
        try {
          const info = await stat(path);
          found.set(path, { size: info.size, mtime: info.mtimeMs });
        } catch {
          // Gone already.
        }
      }
    }
  }

  async function look(): Promise<void> {
    const now = new Map<string, Seen>();
    await walk(root, now);
    const ready: string[] = [];
    for (const [path, info] of now) {
      const before = last.get(path);
      if (first && !options.existing) {
        handled.set(path, info);
        continue;
      }
      const settled = before !== undefined && before.size === info.size && before.mtime === info.mtime;
      const done = handled.get(path);
      if (settled && (!done || done.size !== info.size || done.mtime !== info.mtime)) ready.push(path);
    }
    // A file deleted and later put back is new again.
    for (const path of handled.keys()) if (!now.has(path)) handled.delete(path);
    last.clear();
    for (const [path, info] of now) last.set(path, info);
    first = false;

    for (const path of ready.sort()) {
      if (stopped) return;
      handled.set(path, now.get(path)!);
      const name = relative(root, path);
      try {
        await options.onFile(path, name);
      } catch (error) {
        options.onError?.(error, name);
      }
    }
  }

  const tick = (): void => {
    if (stopped) return;
    running = look().finally(() => {
      if (!stopped) timer = setTimeout(tick, options.interval);
    });
  };
  tick();

  return {
    async stop() {
      stopped = true;
      if (timer) clearTimeout(timer);
      await running.catch(() => {});
    },
  };
}
