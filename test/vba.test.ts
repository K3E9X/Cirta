import { describe, expect, it } from 'vitest';
import { readCfb } from '../src/core/cfb.js';
import { decompressVba, readVbaProject } from '../src/core/vba.js';
import { cfbFile, vbaProject } from './helpers/cfb.js';

describe('[F-2.1] compound files and VBA', () => {
  it('decompresses the MS-OVBA worked example', () => {
    const compressed = Uint8Array.from([
      0x01, 0x2f, 0xb0, 0x00, 0x23, 0x61, 0x61, 0x61, 0x62, 0x63, 0x64, 0x65, 0x82, 0x66, 0x00, 0x70, 0x61, 0x67, 0x68, 0x69,
      0x6a, 0x01, 0x38, 0x08, 0x61, 0x6b, 0x6c, 0x00, 0x30, 0x6d, 0x6e, 0x6f, 0x70, 0x06, 0x71, 0x02, 0x70, 0x04, 0x10, 0x72,
      0x73, 0x74, 0x75, 0x76, 0x10, 0x77, 0x78, 0x79, 0x7a, 0x00, 0x3c,
    ]);
    expect(new TextDecoder().decode(decompressVba(compressed))).toBe('#aaabcdefaaaaghijaaaaaklaaamnopqaaaaaaaaaaaarstuvwxyzaaa');
  });

  it('reads streams by path, in storages', () => {
    const cfb = readCfb(cfbFile({ 'A/b': new Uint8Array([1, 2, 3]), c: new Uint8Array(1000).fill(7) }))!;
    expect(cfb.entries.map((e) => e.path).sort()).toEqual(['A', 'A/b', 'c']);
    expect([...cfb.read('a/B')!]).toEqual([1, 2, 3]);
    expect(cfb.read('c')!.length).toBe(1000);
  });

  it('survives a FAT that loops and a directory that points at itself', () => {
    const file = cfbFile({ x: new Uint8Array(2000).fill(1) });
    const view = new DataView(file.buffer);
    view.setUint32(512 + 3 * 4, 3, true); // the stream's first sector points at itself
    view.setUint32(1024 + 0x4c, 0, true); // the root's child is the root
    expect(() => readCfb(file)).not.toThrow();
  });

  it('reads module names and source from a project', () => {
    const modules = readVbaProject(vbaProject({ ThisDocument: 'Sub Document_Open()\r\nEnd Sub', Module1: 'Sub A()\r\nShell "cmd"\r\nEnd Sub' }))!;
    expect(modules.map((m) => m.name)).toEqual(['ThisDocument', 'Module1']);
    expect(modules[1]!.source).toContain('Shell "cmd"');
  });
});
