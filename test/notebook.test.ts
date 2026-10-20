import { describe, expect, it } from 'vitest';
import { detectFormat, inspectFile, redactFile } from '../src/core/index.js';
import { jpegWith, tiff } from './helpers/tiff.js';
import { makePng } from './fixtures.js';

const enc = (value: unknown) => new TextEncoder().encode(typeof value === 'string' ? value : JSON.stringify(value, null, 1));
const b64 = (bytes: Uint8Array) => Buffer.from(bytes).toString('base64');
const find = (findings: Array<{ label: string; value: string }>, label: string) => findings.find((f) => f.label === label)?.value;

const photo = jpegWith(tiff([{ tag: 0x013b, ascii: 'Jeanne Dupont' }], [], [{ tag: 1, ascii: 'N' }, { tag: 2, rational: [[48, 1], [51, 1], [29, 1]] }, { tag: 3, ascii: 'E' }, { tag: 4, rational: [[2, 1], [17, 1], [40, 1]] }]));

function notebook() {
  return {
    cells: [
      {
        cell_type: 'markdown',
        id: 'a1',
        metadata: {},
        source: ['# Analyse\n', 'Données clients'],
      },
      {
        cell_type: 'code',
        id: 'b2',
        execution_count: 3,
        metadata: { tags: ['parameters'], execution: { 'iopub.execute_input': '2026-10-01T09:14:58.120Z', 'shell.execute_reply': '2026-10-01T09:15:00.002Z' }, collapsed: false },
        source: ['import pandas as pd\n', "df = pd.read_csv('clients.csv')"],
        outputs: [
          { output_type: 'stream', name: 'stdout', text: ['Lecture de /home/jdupont/projets/clients/data.csv\n'] },
          {
            output_type: 'error',
            ename: 'FileNotFoundError',
            evalue: "[Errno 2] No such file or directory: 'clients.csv'",
            traceback: [
              '\u001b[0;31mFileNotFoundError\u001b[0m Traceback (most recent call last)',
              'File \u001b[0;32mC:\\Users\\mleroy\\AppData\\Local\\Programs\\Python\\Python312\\Lib\\site-packages\\pandas\\io\\parsers.py:912\u001b[0m',
            ],
          },
          { output_type: 'display_data', metadata: {}, data: { 'image/jpeg': b64(photo), 'text/plain': ['<Figure>'] } },
          { output_type: 'execute_result', execution_count: 3, metadata: {}, data: { 'text/plain': ["{'token': 'ghp_AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA'}"] } },
        ],
      },
    ],
    metadata: {
      kernelspec: { display_name: 'Python 3 (ipykernel)', language: 'python', name: 'python3' },
      language_info: { name: 'python', version: '3.12.4' },
      authors: [{ name: 'Jeanne Dupont' }],
      papermill: { input_path: '/home/jdupont/projets/rapport.ipynb', output_path: '/home/jdupont/projets/out.ipynb' },
      colab: { provenance: [], name: 'Rapport.ipynb' },
    },
    nbformat: 4,
    nbformat_minor: 5,
  };
}

describe('[F-2.2] Jupyter notebooks', () => {
  it('is told from other JSON by its shape, and by its name', () => {
    expect(detectFormat(enc(notebook()))).toBe('ipynb');
    expect(detectFormat(enc(notebook()), 'rapport.ipynb')).toBe('ipynb');
    expect(detectFormat(enc({ cells: 3, nbformat: 'x' }))).toBe('text');
    expect(detectFormat(enc('{ not json'), 'cassé.ipynb')).toBe('text');
  });

  it('reports the metadata, the paths and accounts in outputs and tracebacks, the secrets and the pictures', async () => {
    const result = await inspectFile(enc(notebook()), 'rapport.ipynb');
    expect(result.format).toBe('ipynb');
    const f = result.findings;
    expect(find(f, 'Kernel')).toBe('Python 3 (ipykernel)');
    expect(find(f, 'Author')).toBe('Jeanne Dupont');
    expect(f.filter((x) => x.label === 'Notebook metadata').map((x) => x.location).sort()).toEqual(['metadata.colab', 'metadata.papermill']);
    expect(find(f, 'Execution time')).toBe('2026-10-01T09:14:58.120Z');
    const paths = f.filter((x) => x.label === 'Local path in an output').map((x) => x.value);
    expect(paths).toContain('/home/jdupont/projets/clients/data.csv');
    expect(paths.some((p) => p.startsWith('C:\\Users\\mleroy\\AppData'))).toBe(true);
    // The escape codes of a coloured traceback are not part of the path.
    expect(paths.every((p) => !p.includes('\u001b'))).toBe(true);
    // Frames are separate strings: a path ends where its frame does.
    expect(paths.some((p) => p.includes('Traceback') || p.includes('FileNotFound'))).toBe(false);
    expect(f.filter((x) => x.label === 'Linux account').map((x) => x.value)).toEqual(['jdupont']);
    expect(find(f, 'Windows account')).toBe('mleroy (drive C:)');
    expect(f.some((x) => /Credential/.test(x.label) && x.location === 'cells[1].outputs[3]')).toBe(true);
    expect(f.find((x) => x.label === 'Exif with GPS coordinates')?.location).toMatch(/^cells\[1\]\.outputs\[2\] → image\/jpeg/);
    expect(result.notes.map((n) => n.code)).toContain('scope:notebook');
  });

  it('cleans the metadata and the pictures, keeps the outputs, and names what they still say', async () => {
    const result = await redactFile(enc(notebook()), 'rapport.ipynb');
    const nb = JSON.parse(new TextDecoder().decode(result.data));
    expect(Object.keys(nb.metadata).sort()).toEqual(['kernelspec', 'language_info']);
    expect(nb.cells[1].metadata).toEqual({ tags: ['parameters'], collapsed: false });
    expect(nb.cells[1].outputs).toHaveLength(4);
    expect(nb.nbformat).toBe(4);
    // The picture is still a picture, without its Exif.
    const inspected = await inspectFile(enc(nb), 'rapport.ipynb');
    expect(inspected.findings.some((x) => x.label === 'Exif with GPS coordinates')).toBe(false);
    expect(Buffer.from(nb.cells[1].outputs[2].data['image/jpeg'], 'base64').subarray(0, 2)).toEqual(Buffer.from([0xff, 0xd8]));
    // What the outputs say is content: still there, and said to be.
    expect(result.kept!.some((x) => x.label === 'Local path in an output')).toBe(true);
    expect(result.removed.some((x) => x.label === 'Author')).toBe(true);
    // Jupyter's own layout: one-space indent, a final newline.
    expect(new TextDecoder().decode(result.data)).toMatch(/^\{\n "cells": \[/);
    expect(new TextDecoder().decode(result.data).endsWith('}\n')).toBe(true);
  });

  it('empties the outputs and the execution counts on request', async () => {
    const result = await redactFile(enc(notebook()), 'rapport.ipynb', { clearOutputs: true });
    const nb = JSON.parse(new TextDecoder().decode(result.data));
    expect(nb.cells[1].outputs).toEqual([]);
    expect(nb.cells[1].execution_count).toBeNull();
    expect(result.notes).toContainEqual({ code: 'removed:outputs', detail: '1' });
    expect(result.kept ?? []).toEqual([]);
  });

  it('reads the pictures attached to a Markdown cell', async () => {
    const nb = notebook();
    (nb.cells[0] as Record<string, unknown>).attachments = { 'carte.png': { 'image/png': b64(makePng()) } };
    const f = (await inspectFile(enc(nb), 'a.ipynb')).findings;
    expect(f.some((x) => x.location.startsWith('cells[0].attachments.carte.png → '))).toBe(true);
  });

  it('survives outputs of the wrong type and pictures that are not base64', async () => {
    const nb = { cells: [{ cell_type: 'code', source: 7, metadata: null, outputs: [null, 3, { output_type: 'stream', text: { a: 1 } }, { data: { 'image/png': '%%%' } }] }], metadata: [], nbformat: 4, nbformat_minor: 4 };
    await expect(inspectFile(enc(nb), 'a.ipynb')).resolves.toMatchObject({ format: 'ipynb' });
    await expect(redactFile(enc(nb), 'a.ipynb', { clearOutputs: true })).resolves.toMatchObject({ format: 'ipynb' });
  });
});

describe('[F-2.2] notebooks from the command line', () => {
  it('cleans a notebook, empties its outputs with --clear-outputs, and says so in French', async () => {
    const { mkdtempSync, readFileSync, writeFileSync } = await import('node:fs');
    const { tmpdir } = await import('node:os');
    const { join } = await import('node:path');
    const { runCli } = await import('./helpers/cli.js');
    const dir = mkdtempSync(join(tmpdir(), 'ciirta-nb-'));
    const input = join(dir, 'rapport.ipynb');
    writeFileSync(input, enc(notebook()));
    const inspect = runCli(['inspect', '--lang', 'fr', input]);
    expect(inspect.stdout.toString()).toContain('Chemin local dans une sortie');
    const output = join(dir, 'propre.ipynb');
    const run = runCli(['redact', '--lang', 'fr', '--clear-outputs', input, '-o', output]);
    expect(run.status).toBe(0);
    expect(run.stdout.toString()).toContain('Sorties retirées de 1 cellule');
    const nb = JSON.parse(readFileSync(output, 'utf8'));
    expect(nb.cells[1].outputs).toEqual([]);
  });
});

describe('[F-2.2] notebooks for a model', () => {
  it('gives the sources and what the outputs printed, without the pictures and the escape codes', async () => {
    const { sanitizeForLlm } = await import('../src/core/sanitize.js');
    const result = await sanitizeForLlm(enc(notebook()), 'rapport.ipynb');
    expect(result.format).toBe('ipynb');
    expect(result.text).toContain("df = pd.read_csv('clients.csv')");
    expect(result.text).toContain('Lecture de /home/jdupont/projets/clients/data.csv');
    expect(result.text).not.toContain('\u001b');
    expect(result.text).not.toContain(b64(photo).slice(0, 40));
  });
});
