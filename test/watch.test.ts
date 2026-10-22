import { spawn } from 'node:child_process';
import { appendFile, mkdtemp, mkdir, readFile, rm, utimes, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { watchFolder, type Watcher } from '../src/cli/watch.js';
import { inspectFile } from '../src/core/index.js';
import { makeDocx } from './fixtures.js';

/*
 * [F-P3 2.6] ciirta watch: a folder looked at again and again, each file read
 * once it has stopped changing. Polling rather than file-system events, which
 * do not arrive from a network share or a container's mounted volume.
 */

let dir: string;
let watcher: Watcher | undefined;
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'ciirta-watch-'));
});
afterEach(async () => {
  await watcher?.stop();
  watcher = undefined;
  await rm(dir, { recursive: true, force: true });
});

function start(options: Partial<Parameters<typeof watchFolder>[0]> = {}) {
  const seen: Array<{ path: string; relative: string; bytes: string }> = [];
  watcher = watchFolder({
    root: dir,
    interval: 30,
    existing: true,
    onFile: async (path, relative) => {
      seen.push({ path, relative, bytes: await readFile(path, 'utf8') });
    },
    ...options,
  });
  return seen;
}

describe('[F-P3 2.6] watching a folder', () => {
  it('reads a file once it has stopped changing, and only then', async () => {
    // Looks 100ms apart; the file grows every 10ms, so no two looks find it the same while it does.
    const seen = start({ interval: 100 });
    const file = join(dir, 'note.txt');
    await writeFile(file, 'first half, ');
    for (let i = 0; i < 10; i++) {
      await new Promise((resolve) => setTimeout(resolve, 10));
      await appendFile(file, `${i}`);
    }
    await expect.poll(() => seen.length, { timeout: 5_000 }).toBe(1);
    expect(seen[0]!.bytes).toBe('first half, 0123456789');
    // And not again while it stays the same.
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(seen).toHaveLength(1);
  });

  it('reads it again when it changes, under its path from the folder', async () => {
    const seen = start();
    await mkdir(join(dir, 'deep', 'er'), { recursive: true });
    const file = join(dir, 'deep', 'er', 'note.md');
    await writeFile(file, 'one');
    await expect.poll(() => seen.length, { timeout: 5_000 }).toBe(1);
    expect(seen[0]!.relative.split('\\').join('/')).toBe('deep/er/note.md');
    await writeFile(file, 'two, longer');
    await expect.poll(() => seen.length, { timeout: 5_000 }).toBe(2);
    expect(seen[1]!.bytes).toBe('two, longer');
  });

  it('leaves out what the command line leaves out, files being downloaded, and its own output folder', async () => {
    const out = join(dir, 'clean');
    const seen = start({ ignore: out });
    await mkdir(join(dir, 'node_modules'), { recursive: true });
    await mkdir(out, { recursive: true });
    await writeFile(join(dir, 'node_modules', 'a.txt'), 'x');
    await writeFile(join(out, 'b.txt'), 'x');
    for (const name of ['c.part', 'd.crdownload', '.e.txt', '~$f.docx', 'g.exe', 'h.txt.tmp', 'i.swp']) await writeFile(join(dir, name), 'x');
    await writeFile(join(dir, 'kept.txt'), 'x');
    await expect.poll(() => seen.length, { timeout: 5_000 }).toBe(1);
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(seen.map((s) => s.relative)).toEqual(['kept.txt']);
  });

  it('takes the files already there, unless asked for new ones only', async () => {
    await writeFile(join(dir, 'old.txt'), 'old');
    // A date in the past, as a file left there earlier would have.
    await utimes(join(dir, 'old.txt'), new Date('2020-01-01'), new Date('2020-01-01'));
    const seen = start({ existing: false });
    await new Promise((resolve) => setTimeout(resolve, 200));
    expect(seen).toHaveLength(0);
    await writeFile(join(dir, 'new.txt'), 'new');
    await expect.poll(() => seen.map((s) => s.relative), { timeout: 5_000 }).toEqual(['new.txt']);
    await watcher!.stop();
    const again = start({ existing: true });
    await expect.poll(() => again.map((s) => s.relative).sort(), { timeout: 5_000 }).toEqual(['new.txt', 'old.txt']);
  });

  it('keeps going when a file cannot be handled, and one at a time', async () => {
    let running = 0;
    let most = 0;
    const handled: string[] = [];
    const errors: string[] = [];
    watcher = watchFolder({
      root: dir,
      interval: 30,
      existing: true,
      onFile: async (_path, relative) => {
        running++;
        most = Math.max(most, running);
        await new Promise((resolve) => setTimeout(resolve, 30));
        running--;
        if (relative === 'bad.txt') throw new Error('no');
        handled.push(relative);
      },
      onError: (error, relative) => errors.push(`${relative}: ${(error as Error).message}`),
    });
    for (const name of ['a.txt', 'bad.txt', 'c.txt']) await writeFile(join(dir, name), name);
    await expect.poll(() => handled.length + errors.length, { timeout: 5_000 }).toBe(3);
    expect(handled.sort()).toEqual(['a.txt', 'c.txt']);
    expect(errors).toEqual(['bad.txt: no']);
    expect(most).toBe(1);
  });
});

const cli = (args: string[]) => spawn(process.execPath, ['node_modules/vite-node/vite-node.mjs', '--root', '.', 'src/cli/index.ts', 'watch', ...args, '--lang', 'en'], { stdio: ['ignore', 'pipe', 'pipe'] });

async function stopped(child: ReturnType<typeof cli>): Promise<number | null> {
  const exit = new Promise<number | null>((resolve) => child.on('exit', resolve));
  child.kill('SIGTERM');
  return exit;
}

describe('[F-P3 2.6] ciirta watch from the command line', () => {
  it('inspects only by default: one JSON line per file, and the folder left as it was', async () => {
    const child = cli([dir, '--interval', '0.05', '--json']);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => (stdout += data));
    child.stderr.on('data', (data) => (stderr += data));
    // Two writes to stderr, which a pipe may deliver apart: wait for the second as well.
    await expect.poll(() => /Watching/.test(stderr) && /inspection only/i.test(stderr), { timeout: 30_000 }).toBe(true);
    // makeDocx() stamps the current time into the ZIP: the bytes written are the ones to compare with.
    const written = makeDocx();
    await writeFile(join(dir, 'letter.docx'), written);
    await expect.poll(() => stdout.split('\n').filter(Boolean).length, { timeout: 30_000 }).toBe(1);
    const line = JSON.parse(stdout.split('\n')[0]!);
    expect(line.schema).toMatch(/report/);
    expect(line.file.split('\\').join('/')).toBe('letter.docx');
    expect(line.result.findings.some((f: { label: string; confidence: string }) => f.label === 'Author' && f.confidence === 'confirmed')).toBe(true);
    const code = await stopped(child);
    if (process.platform !== 'win32') {
      expect(code).toBe(0);
      expect(stderr).toMatch(/Stopped\./);
    }
    expect(await readFile(join(dir, 'letter.docx'))).toEqual(Buffer.from(written));
  }, 60_000);

  it('with --clean, writes a cleaned copy to the output folder, and names a file it refuses', async () => {
    const out = join(dir, 'ready');
    const child = cli([dir, '--interval', '0.05', '--clean', '--output', out]);
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (data) => (stdout += data));
    child.stderr.on('data', (data) => (stderr += data));
    await expect.poll(() => /Watching/.test(stderr) && /Cleaning:/.test(stderr), { timeout: 30_000 }).toBe(true);
    await mkdir(join(dir, 'sub'), { recursive: true });
    await writeFile(join(dir, 'sub', 'letter.docx'), makeDocx());
    // A gzip: inspected only, so refused on cleaning.
    const { gzipSync } = await import('node:zlib');
    await writeFile(join(dir, 'notes.gz'), gzipSync(Buffer.from('hello')));
    await expect.poll(() => /letter\.docx/.test(stdout) && /notes\.gz/.test(stdout + stderr), { timeout: 30_000 }).toBe(true);
    const cleaned = await readFile(join(out, 'sub', 'letter.docx'));
    const after = await inspectFile(new Uint8Array(cleaned), 'letter.docx');
    expect(after.findings.some((f) => f.label === 'Author')).toBe(false);
    await expect(readFile(join(out, 'notes.gz'))).rejects.toThrow();
    expect(stdout + stderr).toMatch(/notes\.gz[\s\S]*(inspected but not rewritten|not rewritten|inspection only)/i);
    await stopped(child);
  }, 60_000);

  it('refuses what it cannot do safely: no folder, cleaning in place, a bad interval', async () => {
    const run = (args: string[]) =>
      new Promise<{ code: number | null; stderr: string }>((resolve) => {
        const child = cli(args);
        let stderr = '';
        child.stderr.on('data', (data) => (stderr += data));
        child.on('exit', (code) => resolve({ code, stderr }));
      });
    const missing = await run([join(dir, 'nope')]);
    expect(missing.code).toBe(2);
    expect(missing.stderr).toMatch(/not a folder/i);
    const inPlace = await run([dir, '--clean', '--in-place']);
    expect(inPlace.code).toBe(2);
    expect(inPlace.stderr).toMatch(/--output/);
    const noOutput = await run([dir, '--clean']);
    expect(noOutput.code).toBe(2);
    expect(noOutput.stderr).toMatch(/--output/);
    const interval = await run([dir, '--interval', 'soon']);
    expect(interval.code).toBe(2);
    expect(interval.stderr).toMatch(/interval/i);
  }, 60_000);
});
