import { describe, expect, it } from 'vitest';
import { strFromU8, unzipSync } from 'fflate';
import { detectFormat, inspectFile, redactFile } from '../src/core/index.js';
import { makeJpeg } from './fixtures.js';
import { vsdx } from './helpers/visio.js';

const find = <T extends { label: string }>(findings: T[], label: string) => findings.find((f) => f.label === label);

const drawing = () =>
  vsdx({
    creator: 'Jeanne Dupont',
    company: 'Cabinet Dupont',
    pageText: 'Ser\u200bveur',
    hyperlink: 'file:///C:/Users/jdupont/Plans/reseau.vsdx',
    comments: [{ name: 'Marc Leroy', initials: 'ML' }],
    connection: 'Provider=Microsoft.ACE.OLEDB.12.0;User ID=admin;Password=secret;Data Source=C:\\Users\\jdupont\\Documents\\parc.xlsx',
    media: makeJpeg(),
  });

describe('[F-P2 2.2] Visio (.vsdx)', () => {
  it('is told by its visio/document.xml', () => {
    expect(detectFormat(drawing())).toBe('vsdx');
  });

  it('reports the package properties, comment authors, data connections, shape links, page text and pictures', async () => {
    const result = await inspectFile(drawing(), 'plan.vsdx');
    expect(result.format).toBe('vsdx');
    const f = result.findings;
    expect(find(f, 'Author')?.value).toBe('Jeanne Dupont');
    expect(find(f, 'Company')?.value).toBe('Cabinet Dupont');
    expect(find(f, 'Comment authors')?.value).toBe('Marc Leroy');
    expect(find(f, 'Comment author account')?.value).toBe('S::ml@example.com::0');
    expect(find(f, 'Data connection')?.value).toContain('Data Source=C:\\Users\\jdupont');
    expect(find(f, 'Data connection')?.value).not.toContain('secret');
    expect(find(f, 'Password stored in a connection')?.value).toContain('Password=••••••••');
    expect(f.filter((x) => x.label === 'Link to a local or network path').map((x) => `${x.location}: ${x.value}`)).toEqual(
      expect.arrayContaining(['visio/pages/page1.xml: file:///C:/Users/jdupont/Plans/reseau.vsdx', 'visio/data/connections.xml: C:\\Users\\jdupont\\Documents\\parc.xlsx']),
    );
    expect(f.some((x) => x.location.startsWith('visio/pages/page1.xml') && x.kind === 'invisible-character')).toBe(true);
    expect(f.some((x) => x.location.startsWith('visio/media/image1.jpeg') && x.label === 'Exif with GPS coordinates')).toBe(true);
  });

  it('cleans the properties, the comment authors, the page text and the pictures; what is the drawing’s own stays and is named', async () => {
    const result = await redactFile(drawing(), 'plan.vsdx');
    const parts = unzipSync(result.data!);
    expect(strFromU8(parts['docProps/core.xml']!)).not.toContain('Jeanne');
    expect(strFromU8(parts['docProps/app.xml']!)).not.toContain('Cabinet');
    const comments = strFromU8(parts['visio/comments.xml']!);
    expect(comments).not.toMatch(/Marc|ML|example\.com/);
    expect(comments).toContain('À revoir');
    expect(strFromU8(parts['visio/pages/page1.xml']!)).toContain('<Text>Serveur</Text>');
    const after = (await inspectFile(result.data!, 'plan.vsdx')).findings;
    expect(after.some((x) => x.location.startsWith('visio/media/'))).toBe(false);
    expect((result.kept ?? []).map((x) => x.label)).toEqual(expect.arrayContaining(['Data connection', 'Link to a local or network path']));
  });
});
