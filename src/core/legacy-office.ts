/**
 * [F-2.2] Legacy Office — .doc, .xls, .ppt — read, never rewritten.
 *
 * These are compound files (OLE2). What they say about their author sits in
 * two property-set streams, the same fields a .docx keeps in docProps/: the
 * author, the last person to save, the company, the manager, the template
 * with its path, the editing time. Macros sit in a VBA storage (.doc, .xls)
 * or compressed inside the document stream (.ppt); embedded objects in their
 * own storages, a Packager object with the paths of the file it carries.
 *
 * Cleaning is refused, deliberately. Removing a stream from a compound file
 * means rewriting its FAT, its directory and, for Word, the offsets in the
 * FIB that point into the other streams; blanking a property set in place
 * leaves the document readable but Office rewrites it from its own state on
 * the next save. Neither is something this tool can verify it did without
 * damage, and "Refuser plutôt qu'abîmer" decides it: the file is inspected,
 * and the reader is told to save it as .docx/.xlsx/.pptx and clean that.
 */

import { unzlibSync } from 'fflate';
import { readCfb, type Cfb } from './cfb.js';
import { readPropertySet, FMTID_SUMMARY, FMTID_DOC_SUMMARY, FMTID_USER_DEFINED } from './ole-props.js';
import { readVbaStorage, summariseVba } from './vba.js';
import { fingerprint } from './fingerprint.js';
import { byConfidence, type Confidence, type Finding, type InspectOptions, type InspectResult } from './types.js';
import { ARCHIVE_SEPARATOR } from './archive.js';
import { fileNameFindings } from './filenames.js';

export type LegacyKind = 'doc' | 'xls' | 'ppt';

/** What a compound file is, from the streams at its root. */
export function compoundKind(cfb: Cfb): LegacyKind | 'msg' | undefined {
  const root = new Set(cfb.entries.filter((e) => !e.path.includes('/')).map((e) => e.name.toLowerCase()));
  if (root.has('worddocument')) return 'doc';
  if (root.has('workbook') || root.has('book')) return 'xls';
  if (root.has('powerpoint document')) return 'ppt';
  if (root.has('__properties_version1.0') || [...root].some((name) => name.startsWith('__substg1.0_'))) return 'msg';
  return undefined;
}

interface Field {
  /** The property's name in MS-OLEPS, used as its location: an identifier, the same in every language. */
  pid: string;
  label: string;
  kind: Finding['kind'];
  confidence: Confidence;
}

/** The same labels as a .docx's docProps/, so a field reads the same in both. */
const SUMMARY_FIELDS: Record<number, Field> = {
  2: { pid: 'PIDSI_TITLE', label: 'Title', kind: 'identity', confidence: 'probable' },
  3: { pid: 'PIDSI_SUBJECT', label: 'Subject', kind: 'identity', confidence: 'probable' },
  4: { pid: 'PIDSI_AUTHOR', label: 'Author', kind: 'identity', confidence: 'confirmed' },
  5: { pid: 'PIDSI_KEYWORDS', label: 'Keywords', kind: 'identity', confidence: 'probable' },
  6: { pid: 'PIDSI_COMMENTS', label: 'Description', kind: 'identity', confidence: 'probable' },
  7: { pid: 'PIDSI_TEMPLATE', label: 'Template', kind: 'environment', confidence: 'confirmed' },
  8: { pid: 'PIDSI_LASTAUTHOR', label: 'Last modified by', kind: 'identity', confidence: 'confirmed' },
  9: { pid: 'PIDSI_REVNUMBER', label: 'Revision number', kind: 'timestamp', confidence: 'probable' },
  10: { pid: 'PIDSI_EDITTIME', label: 'Total editing time', kind: 'timestamp', confidence: 'probable' },
  11: { pid: 'PIDSI_LASTPRINTED', label: 'Last printed', kind: 'timestamp', confidence: 'probable' },
  12: { pid: 'PIDSI_CREATE_DTM', label: 'Created', kind: 'timestamp', confidence: 'probable' },
  13: { pid: 'PIDSI_LASTSAVE_DTM', label: 'Modified', kind: 'timestamp', confidence: 'probable' },
  18: { pid: 'PIDSI_APPNAME', label: 'Producing application', kind: 'provenance', confidence: 'informational' },
};

const DOC_SUMMARY_FIELDS: Record<number, Field> = {
  2: { pid: 'PIDDSI_CATEGORY', label: 'Category', kind: 'identity', confidence: 'probable' },
  14: { pid: 'PIDDSI_MANAGER', label: 'Manager', kind: 'identity', confidence: 'confirmed' },
  15: { pid: 'PIDDSI_COMPANY', label: 'Company', kind: 'identity', confidence: 'confirmed' },
};

/** The fields of both property-set streams, located by stream and field. */
export function propertyFindings(cfb: Cfb, prefix = ''): Finding[] {
  const findings: Finding[] = [];
  for (const stream of ['\x05SummaryInformation', '\x05DocumentSummaryInformation']) {
    const bytes = cfb.read(`${prefix}${stream}`);
    if (!bytes) continue;
    const where = `${prefix}${stream.slice(1)}`;
    for (const section of readPropertySet(bytes)) {
      if (section.fmtid === FMTID_USER_DEFINED) {
        for (const [id, value] of section.properties) {
          const name = section.names.get(id) ?? `#${id}`;
          findings.push({ kind: 'identity', confidence: 'confirmed', location: `${where}:${name}`, label: `Custom property: ${name}`, value: String(value) });
        }
        continue;
      }
      const fields = section.fmtid === FMTID_SUMMARY ? SUMMARY_FIELDS : section.fmtid === FMTID_DOC_SUMMARY ? DOC_SUMMARY_FIELDS : {};
      for (const [id, value] of section.properties) {
        const field = fields[id];
        // Writers fill fields they have nothing for: a revision "0", an editing time of no minutes.
        if (!field || typeof value === 'boolean' || value === 0 || value === '0' || value === '0 min') continue;
        findings.push({ kind: field.kind, confidence: field.confidence, location: `${where}:${field.pid}`, label: field.label, value: String(value) });
      }
    }
  }
  return findings;
}

const active = (confidence: Confidence, location: string, label: string, value: string): Finding => ({
  kind: 'active-content',
  confidence,
  location,
  label,
  value,
});

function macroFindings(cfb: Cfb, location: string): Finding[] {
  const modules = readVbaStorage(cfb);
  if (!modules) return [];
  const summary = summariseVba(modules);
  const out = [active('confirmed', location, 'Macros (VBA project)', `${modules.length} module${modules.length > 1 ? 's' : ''}: ${summary.modules.join(', ')}`)];
  for (const hit of summary.autoRun) out.push(active('confirmed', location, 'Macro that runs on its own', hit));
  if (summary.system.length) out.push(active('confirmed', location, 'Macro that reaches the system', summary.system.join(', ')));
  for (const address of summary.addresses.slice(0, 20)) out.push(active('confirmed', location, 'Address in a macro', address));
  return out;
}

const latin = new TextDecoder('windows-1252');

/** A NUL-terminated ANSI string at `at`, and where the next field starts. */
function zString(data: Uint8Array, at: number, max = 4096): [string, number] {
  let end = at;
  while (end < data.length && end - at < max && data[end] !== 0) end++;
  return [latin.decode(data.subarray(at, end)), end + 1];
}

/** MS-OLEDS 2.3.8: the user type ("Microsoft Excel Worksheet") and the ProgID, when they read. */
export function readCompObj(data: Uint8Array | undefined): { userType?: string; progId?: string } {
  if (!data || data.length < 32) return {};
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  const lengthPrefixed = (at: number): [string | undefined, number] => {
    if (at + 4 > data.length) return [undefined, data.length];
    const length = view.getUint32(at, true);
    if (length === 0 || length > 4096 || at + 4 + length > data.length) return [undefined, at + 4];
    return [latin.decode(data.subarray(at + 4, at + 4 + length)).replace(/\0[\s\S]*$/, ''), at + 4 + length];
  };
  const [userType, afterType] = lengthPrefixed(28);
  if (afterType + 4 > data.length) return { userType };
  // The clipboard format: none, a standard format number, or a name.
  const marker = view.getUint32(afterType, true);
  let next = afterType + 4;
  if (marker === 0xfffffffe || marker === 0xffffffff) next += 4;
  else if (marker > 0) next += Math.min(marker, 4096);
  const [progId] = lengthPrefixed(next);
  return { userType: userType || undefined, progId: progId || undefined };
}

/** MS-OLEDS 2.3.6 Ole10Native as the Packager writes it: label, source path, temporary path, the file. */
export function readOle10Native(data: Uint8Array | undefined): { label: string; source: string; temp: string; file: Uint8Array } | undefined {
  if (!data || data.length < 12) return undefined;
  const view = new DataView(data.buffer, data.byteOffset, data.byteLength);
  if (view.getUint16(4, true) !== 2) return undefined;
  const [label, afterLabel] = zString(data, 6);
  const [source, afterSource] = zString(data, afterLabel);
  const at = afterSource + 4;
  if (at + 4 > data.length) return undefined;
  const [temp] = zString(data, at + 4, Math.min(view.getUint32(at, true), 4096));
  const sizeAt = at + 4 + Math.min(view.getUint32(at, true), 4096);
  if (sizeAt + 4 > data.length) return undefined;
  const size = Math.min(view.getUint32(sizeAt, true), data.length - sizeAt - 4);
  return { label, source, temp, file: data.subarray(sizeAt + 4, sizeAt + 4 + size) };
}

const prefix = (findings: Finding[], where: string): Finding[] =>
  findings.map((finding) => ({ ...finding, location: `${where}${ARCHIVE_SEPARATOR}${finding.location}` }));

/**
 * One embedded object: what program opens it, and for a Packager object the
 * file it carries, with the paths that file had on the author's machine. The
 * carried file is inspected in turn, as an attachment would be.
 */
export async function objectFindings(
  location: string,
  read: (name: string) => Uint8Array | undefined,
  inspectMember: InspectOptions['inspectMember'],
  className?: string,
): Promise<Finding[]> {
  const compObj = readCompObj(read('\x01CompObj'));
  const userType = compObj.userType;
  // [F-P2 2.2] An RTF object names its class beside the data, an OLE1 Package carries no CompObj.
  const progId = compObj.progId ?? className;
  const native = readOle10Native(read('\x01Ole10Native'));
  const isPackage = progId === 'Package' || native !== undefined;
  const what = native
    ? `${native.label || 'unnamed file'} — ${native.file.length} bytes`
    : (userType ?? 'object');
  const out: Finding[] = [
    active(isPackage ? 'confirmed' : 'probable', location, 'Embedded object (OLE)', `${what}${progId ? `, ProgID ${progId}` : ''}`),
  ];
  if (!native) return out;
  if (native.label) out.push(...fileNameFindings(native.label, location));
  for (const [field, path] of [['source', native.source], ['temp', native.temp]] as const) {
    if (!path) continue;
    out.push({ kind: 'environment', confidence: 'confirmed', location: `${location}:${field}`, label: 'Path of the embedded file on the author’s machine', value: path });
  }
  if (inspectMember && native.file.length) {
    try {
      const name = native.label || 'embedded file';
      out.push(...prefix((await inspectMember(native.file, name)).findings, `${location}${ARCHIVE_SEPARATOR}${name}`));
    } catch {
      // A file no parser claims is still named above.
    }
  }
  return out;
}

const MAX_RECORDS = 200_000;
const MAX_INFLATED = 16 * 1024 * 1024;

/**
 * MS-PPT 2.10.34: the ExOleObjStg records of a PowerPoint document stream,
 * each a compound file of its own — a VBA project or an embedded object —,
 * zlib-compressed when the record's instance is 1.
 */
export function pptStorages(stream: Uint8Array): Uint8Array[] {
  const view = new DataView(stream.buffer, stream.byteOffset, stream.byteLength);
  const out: Uint8Array[] = [];
  let at = 0;
  for (let n = 0; n < MAX_RECORDS && at + 8 <= stream.length; n++) {
    const verInstance = view.getUint16(at, true);
    const type = view.getUint16(at + 2, true);
    const length = view.getUint32(at + 4, true);
    // A container's records follow its header: read into it.
    if ((verInstance & 0x0f) === 0x0f) {
      at += 8;
      continue;
    }
    const body = stream.subarray(at + 8, Math.min(at + 8 + length, stream.length));
    if (type === 0x1011) {
      if (verInstance >> 4 === 1) {
        const size = body.length >= 4 ? new DataView(body.buffer, body.byteOffset).getUint32(0, true) : 0;
        if (size > 0 && size <= MAX_INFLATED) {
          try {
            out.push(unzlibSync(body.subarray(4), { out: new Uint8Array(size) }));
          } catch {
            // A record that does not inflate is skipped.
          }
        }
      } else out.push(body);
    }
    at += 8 + length;
  }
  return out;
}

export async function inspectLegacyOffice(cfb: Cfb, kind: LegacyKind, options: InspectOptions): Promise<InspectResult> {
  const findings: Finding[] = propertyFindings(cfb);

  if (kind === 'ppt') {
    const storages = pptStorages(cfb.read('PowerPoint Document') ?? new Uint8Array());
    for (const [index, bytes] of storages.entries()) {
      const inner = readCfb(bytes);
      if (!inner) continue;
      const location = `PowerPoint Document${ARCHIVE_SEPARATOR}object ${index + 1}`;
      const macros = macroFindings(inner, location);
      findings.push(...(macros.length ? macros : await objectFindings(location, (name) => inner.read(name), options.inspectMember)));
    }
  } else {
    const vba = cfb.entries.find((e) => e.type === 'stream' && /(^|\/)VBA\/dir$/i.test(e.path));
    if (vba) findings.push(...macroFindings(cfb, vba.path.slice(0, -'/dir'.length)));
    // Word keeps each object in a storage of ObjectPool; Excel in a root storage named MBD followed by hex.
    const storages = cfb.entries.filter(
      (e) => e.type === 'storage' && (/^ObjectPool\/[^/]+$/i.test(e.path) || /^MBD[0-9A-F]{8}$/i.test(e.path)),
    );
    for (const storage of storages.sort((a, b) => a.path.localeCompare(b.path))) {
      findings.push(...(await objectFindings(storage.path, (name) => cfb.read(`${storage.path}/${name}`), options.inspectMember)));
    }
  }

  return {
    format: kind,
    findings: [...findings, ...fingerprint(findings)].sort(byConfidence),
    notes: [{ code: 'scope:legacy-office' }],
  };
}
