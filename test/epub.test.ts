import { describe, expect, it } from 'vitest';
import { strFromU8, strToU8, unzipSync, zipSync } from 'fflate';
import { detectFormat, inspectFile, redactFile, UnsupportedFormatError } from '../src/core/index.js';
import { errorText } from '../src/shared/french.js';
import { makeJpeg } from './fixtures.js';

const OPF = `<?xml version="1.0" encoding="UTF-8"?>
<package xmlns="http://www.idpf.org/2007/opf" version="3.0" unique-identifier="uid">
  <metadata xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:opf="http://www.idpf.org/2007/opf">
    <dc:identifier id="uid">urn:uuid:7f9b7746-eaa4-4454-9edb-73fa9e2e5d56</dc:identifier>
    <dc:title>Rapport annuel</dc:title>
    <dc:language>fr</dc:language>
    <dc:creator id="auteur" opf:file-as="Dupont, Jeanne">Jeanne Dupont</dc:creator>
    <meta refines="#auteur" property="role" scheme="marc:relators">aut</meta>
    <dc:contributor opf:role="bkp">calibre (6.5.0) [https://calibre-ebook.com]</dc:contributor>
    <dc:publisher>Cabinet Dupont</dc:publisher>
    <dc:date>2024-03-05T10:20:00+00:00</dc:date>
    <meta property="dcterms:modified">2024-03-06T09:05:00Z</meta>
    <meta name="calibre:timestamp" content="2024-03-05T10:21:00+00:00"/>
    <meta name="generator" content="Sigil 1.9.30"/>
  </metadata>
  <manifest>
    <item id="c1" href="texte/ch1.xhtml" media-type="application/xhtml+xml"/>
    <item id="p" href="images/p.jpg" media-type="image/jpeg"/>
  </manifest>
  <spine><itemref idref="c1"/></spine>
</package>`;

const NCX = `<?xml version="1.0" encoding="UTF-8"?>
<ncx xmlns="http://www.daisy.org/z3986/2005/ncx/" version="2005-1"><head><meta name="dtb:uid" content="urn:uuid:7f9b7746-eaa4-4454-9edb-73fa9e2e5d56"/></head>
<docTitle><text>Rapport annuel</text></docTitle><docAuthor><text>Jeanne Dupont</text></docAuthor><navMap/></ncx>`;

const CHAPTER = `<?xml version="1.0" encoding="UTF-8"?>
<html xmlns="http://www.w3.org/1999/xhtml"><head><title>Chapitre</title><meta name="generator" content="Pages 13.2"/></head>
<body><p>Bon​jour, voir <a href="https://e.example/?utm_source=lettre">le site</a>.</p><img src="../images/p.jpg" alt=""/></body></html>`;

function epub(extra: Record<string, Uint8Array> = {}): Uint8Array {
  return zipSync({
    mimetype: [strToU8('application/epub+zip'), { level: 0 }],
    'META-INF/container.xml': strToU8('<?xml version="1.0"?><container version="1.0" xmlns="urn:oasis:names:tc:opendocument:xmlns:container"><rootfiles><rootfile full-path="OEBPS/content.opf" media-type="application/oebps-package+xml"/></rootfiles></container>'),
    'OEBPS/content.opf': strToU8(OPF),
    'OEBPS/toc.ncx': strToU8(NCX),
    'OEBPS/texte/ch1.xhtml': strToU8(CHAPTER),
    'OEBPS/images/p.jpg': makeJpeg(),
    'META-INF/calibre_bookmarks.txt': strToU8('encoding=json+base64:\neyJwb3MiOiAxfQ=='),
    ...extra,
  });
}

const find = <T extends { label: string }>(findings: T[], label: string) => findings.find((f) => f.label === label);

describe('[F-P2 2.2] EPUB', () => {
  it('is told from a plain archive by its mimetype', () => {
    expect(detectFormat(epub())).toBe('epub');
  });

  it('reports the package metadata, the NCX author, each page through the HTML pass, the pictures and calibre’s bookmarks', async () => {
    const result = await inspectFile(epub(), 'livre.epub');
    expect(result.format).toBe('epub');
    const f = result.findings;
    expect(f.filter((x) => x.label === 'Author').map((x) => `${x.location}: ${x.value}`)).toEqual([
      'OEBPS/content.opf:dc:creator: Jeanne Dupont',
      'OEBPS/toc.ncx:docAuthor: Jeanne Dupont',
    ]);
    expect(find(f, 'Publisher')?.value).toBe('Cabinet Dupont');
    expect(find(f, 'Book identifier')?.value).toBe('urn:uuid:7f9b7746-eaa4-4454-9edb-73fa9e2e5d56');
    expect(find(f, 'Created')?.value).toBe('2024-03-05T10:20:00+00:00');
    expect(find(f, 'Modified')?.value).toBe('2024-03-06T09:05:00Z');
    expect(f.filter((x) => x.label === 'Producing application').map((x) => x.value)).toEqual(expect.arrayContaining(['calibre (6.5.0) [https://calibre-ebook.com]', 'Sigil 1.9.30']));
    expect(find(f, 'Calibre metadata')?.value).toBe('calibre:timestamp: 2024-03-05T10:21:00+00:00');
    expect(find(f, 'Reading position saved by calibre')?.location).toBe('META-INF/calibre_bookmarks.txt');
    expect(f.some((x) => x.location.startsWith('OEBPS/texte/ch1.xhtml → ') && x.kind === 'invisible-character')).toBe(true);
    expect(f.some((x) => x.location.startsWith('OEBPS/texte/ch1.xhtml → ') && x.label === 'Tracking parameters in a link')).toBe(true);
    expect(f.some((x) => x.location.startsWith('OEBPS/images/p.jpg') && x.label === 'Exif with GPS coordinates')).toBe(true);
    expect(find(f, 'Title')?.confidence).toBe('informational');
  });

  it('cleans every part, keeps the title and the language, and gives the same bytes twice', async () => {
    const first = await redactFile(epub(), 'livre.epub');
    const second = await redactFile(epub(), 'livre.epub');
    expect(Buffer.from(first.data!).equals(Buffer.from(second.data!))).toBe(true);
    const parts = unzipSync(first.data!);
    // mimetype first, stored.
    expect(strFromU8(first.data!.subarray(30, 38))).toBe('mimetype');
    expect(new DataView(first.data!.buffer, first.data!.byteOffset).getUint16(8, true)).toBe(0);
    const opf = strFromU8(parts['OEBPS/content.opf']!);
    expect(opf).not.toMatch(/Jeanne|calibre|Cabinet|Sigil|2024-03|7f9b7746|refines="#auteur"/);
    expect(opf).toContain('<dc:title>Rapport annuel</dc:title>');
    expect(opf).toContain('<dc:language>fr</dc:language>');
    const uid = /<dc:identifier id="uid">(urn:uuid:[0-9a-f-]{36})<\/dc:identifier>/.exec(opf)?.[1];
    expect(uid).toBeDefined();
    expect(strFromU8(parts['OEBPS/toc.ncx']!)).toContain(`content="${uid}"`);
    expect(strFromU8(parts['OEBPS/toc.ncx']!)).not.toContain('Jeanne');
    expect(strFromU8(parts['OEBPS/texte/ch1.xhtml']!)).toContain('Bonjour');
    expect(parts['META-INF/calibre_bookmarks.txt']).toBeUndefined();
    const after = (await inspectFile(first.data!, 'livre.epub')).findings.filter((x) => x.confidence === 'confirmed');
    expect(after).toEqual([]);
  });

  it('refuses to rewrite a book under DRM, and says why', async () => {
    const drm = epub({ 'META-INF/encryption.xml': strToU8('<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.w3.org/2001/04/xmlenc#aes128-cbc"/><enc:CipherData><enc:CipherReference URI="OEBPS/texte/ch1.xhtml"/></enc:CipherData></enc:EncryptedData></encryption>') });
    expect(find((await inspectFile(drm, 'a.epub')).findings, 'Encrypted content (DRM)')?.value).toBe('OEBPS/texte/ch1.xhtml');
    const error = await redactFile(drm, 'a.epub').catch((e: unknown) => e);
    expect(error).toBeInstanceOf(UnsupportedFormatError);
    expect((error as UnsupportedFormatError).code).toBe('epub-encrypted');
    expect(errorText(error, 'fr')).toMatch(/DRM/);
  });

  it('still cleans a book whose only encryption is font obfuscation', async () => {
    const fonts = epub({ 'META-INF/encryption.xml': strToU8('<encryption xmlns="urn:oasis:names:tc:opendocument:xmlns:container" xmlns:enc="http://www.w3.org/2001/04/xmlenc#"><enc:EncryptedData><enc:EncryptionMethod Algorithm="http://www.idpf.org/2008/embedding"/><enc:CipherData><enc:CipherReference URI="OEBPS/f.otf"/></enc:CipherData></enc:EncryptedData></encryption>') });
    const result = await redactFile(fonts, 'a.epub');
    expect(unzipSync(result.data!)['META-INF/encryption.xml']).toBeDefined();
  });
});
