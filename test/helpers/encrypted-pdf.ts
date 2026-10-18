/**
 * A PDF encrypted the way a "protected against copying" document is: AES-256,
 * standard security handler revision 6 (ISO 32000-2 §7.6.4), with an owner
 * password and a user password that may be empty.
 *
 * Written by hand rather than by a library because pdf-lib cannot encrypt at
 * all, and because the property under test — what a cleaner does with strings
 * and streams it cannot read — needs every string and stream really encrypted,
 * the /Info dictionary included.
 */

import { createCipheriv, createHash, randomBytes } from 'node:crypto';

const enc = new TextEncoder();

/** Algorithm 2.B: the iterated hash revision 6 uses for every password check. */
function hash2B(password: Uint8Array, salt: Uint8Array, userKey: Uint8Array): Buffer {
  let k = createHash('sha256').update(password).update(salt).update(userKey).digest();
  for (let round = 0; ; round++) {
    const k1 = Buffer.concat(Array.from({ length: 64 }, () => Buffer.concat([password, k, userKey])));
    const cipher = createCipheriv('aes-128-cbc', k.subarray(0, 16), k.subarray(16, 32));
    cipher.setAutoPadding(false);
    const e = Buffer.concat([cipher.update(k1), cipher.final()]);
    let sum = 0;
    for (let i = 0; i < 16; i++) sum += e[i]!;
    k = createHash(['sha256', 'sha384', 'sha512'][sum % 3]!).update(e).digest();
    if (round >= 63 && e[e.length - 1]! <= round - 32) break;
  }
  return k.subarray(0, 32);
}

function aesNoPad(key: Uint8Array, data: Uint8Array, mode: 'aes-256-cbc' | 'aes-256-ecb'): Buffer {
  const cipher = createCipheriv(mode, key, mode === 'aes-256-cbc' ? Buffer.alloc(16) : null);
  cipher.setAutoPadding(false);
  return Buffer.concat([cipher.update(data), cipher.final()]);
}

/** Strings and streams under AESV3: a random IV, then AES-256-CBC with PKCS#7 padding. */
function encryptData(fileKey: Uint8Array, data: Uint8Array): Buffer {
  const iv = randomBytes(16);
  const cipher = createCipheriv('aes-256-cbc', fileKey, iv);
  return Buffer.concat([iv, cipher.update(data), cipher.final()]);
}

const hex = (bytes: Uint8Array) => `<${Buffer.from(bytes).toString('hex')}>`;

export interface EncryptedPdfOptions {
  userPassword?: string;
  ownerPassword?: string;
  info?: Record<string, string>;
  text?: string;
}

export function encryptedPdf({
  userPassword = '',
  ownerPassword = 'owner',
  info = { Author: 'Jean Dupont', Title: 'Offre commerciale', Producer: 'Test producer' },
  text = 'Texte visible du document',
}: EncryptedPdfOptions = {}): Uint8Array {
  const fileKey = randomBytes(32);
  const user = enc.encode(userPassword);
  const owner = enc.encode(ownerPassword);

  const uValidation = randomBytes(8);
  const uKey = randomBytes(8);
  const U = Buffer.concat([hash2B(user, uValidation, new Uint8Array()), uValidation, uKey]);
  const UE = aesNoPad(hash2B(user, uKey, new Uint8Array()), fileKey, 'aes-256-cbc');

  const oValidation = randomBytes(8);
  const oKey = randomBytes(8);
  const O = Buffer.concat([hash2B(owner, oValidation, U), oValidation, oKey]);
  const OE = aesNoPad(hash2B(owner, oKey, U), fileKey, 'aes-256-cbc');

  const P = -3904; // print and copy forbidden, the usual "protected" settings
  const perms = Buffer.alloc(16);
  perms.writeInt32LE(P, 0);
  perms.writeUInt32LE(0xffffffff, 4);
  perms.write('Tadb', 8, 'latin1');
  randomBytes(4).copy(perms, 12);
  const Perms = aesNoPad(fileKey, perms, 'aes-256-ecb');

  const content = encryptData(fileKey, enc.encode(`BT /F1 12 Tf 20 100 Td (${text}) Tj ET`));
  const infoEntries = Object.entries(info)
    .map(([key, value]) => `/${key} ${hex(encryptData(fileKey, enc.encode(value)))}`)
    .join(' ');

  const objects: Array<string | Uint8Array[]> = [
    '<</Type/Catalog/Pages 2 0 R>>',
    '<</Type/Pages/Kids[3 0 R]/Count 1>>',
    '<</Type/Page/Parent 2 0 R/MediaBox[0 0 300 200]/Resources<</Font<</F1 5 0 R>>>>/Contents 4 0 R>>',
    [enc.encode(`<</Length ${content.length}>>\nstream\n`), content, enc.encode('\nendstream')],
    '<</Type/Font/Subtype/Type1/BaseFont/Helvetica>>',
    `<<${infoEntries}>>`,
    `<</Filter/Standard/V 5/R 6/Length 256/CF<</StdCF<</AuthEvent/DocOpen/CFM/AESV3/Length 32>>>>/StmF/StdCF/StrF/StdCF` +
      `/O ${hex(O)}/U ${hex(U)}/OE ${hex(OE)}/UE ${hex(UE)}/P ${P}/Perms ${hex(Perms)}>>`,
  ];

  const chunks: Uint8Array[] = [enc.encode('%PDF-1.7\n%\xe2\xe3\xcf\xd3\n')];
  let length = chunks[0]!.length;
  const offsets: number[] = [];
  const push = (bytes: Uint8Array) => {
    chunks.push(bytes);
    length += bytes.length;
  };
  objects.forEach((object, i) => {
    offsets.push(length);
    push(enc.encode(`${i + 1} 0 obj\n`));
    if (typeof object === 'string') push(enc.encode(object));
    else object.forEach(push);
    push(enc.encode('\nendobj\n'));
  });

  const xref = length;
  const id = hex(randomBytes(16));
  push(
    enc.encode(
      `xref\n0 ${objects.length + 1}\n0000000000 65535 f\r\n` +
        offsets.map((o) => `${String(o).padStart(10, '0')} 00000 n\r\n`).join('') +
        `trailer\n<</Size ${objects.length + 1}/Root 1 0 R/Info 6 0 R/Encrypt 7 0 R/ID[${id}${id}]>>\nstartxref\n${xref}\n%%EOF\n`,
    ),
  );
  return Buffer.concat(chunks);
}
