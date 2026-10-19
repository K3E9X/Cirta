/**
 * [F-2.1] What an Office document does when it is opened.
 *
 * Macros (a VBA project), a template fetched from a server — the "remote
 * template injection" that needs no macro at all —, DDE fields that run a
 * command, INCLUDEPICTURE and INCLUDETEXT fields that fetch from elsewhere,
 * embedded OLE objects and ActiveX controls, and any part loaded from an
 * external address: each is reported with its target. A UNC or file:// target
 * is opened with the reader's Windows credentials, which is why the existing
 * local-link finding reports those as confirmed.
 *
 * Cleaning takes out what can go without breaking the document: the VBA
 * project, the remote template, the field instructions (the field's last
 * result stays as text). Objects and controls are anchored in the layout;
 * removing them would damage it, so they stay and are named as staying.
 */

import { strFromU8, strToU8 } from 'fflate';
import type { Finding } from './types.js';
import { preview } from './types.js';
import { readVbaProject, summariseVba } from './vba.js';
import { cleanUrl, trackingFinding } from './tracking.js';

type Parts = Record<string, Uint8Array>;

const VBA = /(^|\/)vbaProject\.bin$/i;
const EMBEDDING = /(^|\/)embeddings\/[^/]+$/i;
const ACTIVEX = /(^|\/)activeX\/activeX\d*\.xml$/i;
const REMOTE = /^(?:https?|ftp):\/\//i;

interface Relationship {
  rels: string;
  id: string;
  type: string;
  target: string;
  external: boolean;
}

function relationships(parts: Parts): Relationship[] {
  const out: Relationship[] = [];
  for (const [rels, raw] of Object.entries(parts)) {
    if (!rels.endsWith('.rels')) continue;
    for (const element of strFromU8(raw).match(/<Relationship\b[^>]*\/?>/g) ?? []) {
      const attr = (name: string) => new RegExp(`\\s${name}="([^"]*)"`).exec(element)?.[1] ?? '';
      out.push({
        rels,
        id: attr('Id'),
        type: attr('Type').split('/').pop() ?? '',
        target: attr('Target').replace(/&amp;/g, '&'),
        external: /\sTargetMode="External"/.test(element),
      });
    }
  }
  return out;
}

/** The part a relationship file describes: word/_rels/document.xml.rels → word/document.xml. */
const ownerOf = (rels: string) => rels.replace(/_rels\/([^/]*)\.rels$/, '$1');

function resolve(rels: string, target: string): string {
  if (target.startsWith('/')) return target.slice(1);
  const segments: string[] = [];
  for (const segment of (rels.replace(/_rels\/[^/]*\.rels$/, '') + target).split('/')) {
    if (segment === '.' || segment === '') continue;
    if (segment === '..') segments.pop();
    else segments.push(segment);
  }
  return segments.join('/');
}

/** Field instructions in a Word part, joined across the runs they are split into. */
function fieldInstructions(xml: string): string[] {
  const out: string[] = [];
  let depth = 0;
  let current: string[] = [];
  for (const m of xml.matchAll(/<w:fldChar\b[^>]*w:fldCharType="(begin|separate|end)"|<w:instrText\b[^>]*>([^<]*)<\/w:instrText>|<w:fldSimple\b[^>]*\sw:instr="([^"]*)"/g)) {
    if (m[1] === 'begin') {
      depth++;
      current = [];
    } else if (m[1] === 'separate' || m[1] === 'end') {
      if (current.length) out.push(current.join(''));
      current = [];
      if (m[1] === 'end') depth = Math.max(0, depth - 1);
    } else if (m[2] !== undefined && depth > 0) current.push(m[2]);
    else if (m[3] !== undefined) out.push(m[3]);
  }
  return out.map((i) => i.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/\s+/g, ' ').trim()).filter(Boolean);
}

const DDE = /^(DDEAUTO|DDE)\b/i;
const INCLUDE = /^(INCLUDEPICTURE|INCLUDETEXT|IMPORT|LINK)\s+"?([^"\s]+)/i;
const isRemoteTarget = (target: string) => REMOTE.test(target) || /^\\\\|^file:/i.test(target);

export function activeOfficeFindings(parts: Parts): Finding[] {
  const findings: Finding[] = [];
  const push = (label: string, confidence: Finding['confidence'], location: string, value: string) =>
    findings.push({ kind: 'active-content', confidence, location, label, value: preview(value, 300) });

  for (const path of Object.keys(parts).filter((p) => VBA.test(p)).sort()) {
    const modules = readVbaProject(parts[path]!);
    if (!modules) {
      push('Macros (VBA project)', 'confirmed', path, `${parts[path]!.length} bytes — the project could not be read`);
      continue;
    }
    const summary = summariseVba(modules);
    push('Macros (VBA project)', 'confirmed', path, `${modules.length} module${modules.length > 1 ? 's' : ''}: ${summary.modules.join(', ')}`);
    for (const hit of summary.autoRun) push('Macro that runs on its own', 'confirmed', path, hit);
    if (summary.system.length) push('Macro that reaches the system', 'confirmed', path, summary.system.join(', '));
    for (const address of summary.addresses.slice(0, 20)) push('Address in a macro', 'confirmed', path, address);
  }

  const rels = relationships(parts);
  for (const rel of rels) {
    if (!rel.external) continue;
    if (rel.type === 'hyperlink') {
      const tracked = trackingFinding(rel.target, rel.rels);
      if (tracked) findings.push(tracked);
    }
    if (rel.type === 'attachedTemplate') {
      push('Remote template loaded on opening', isRemoteTarget(rel.target) ? 'confirmed' : 'probable', rel.rels, rel.target);
    } else if (rel.type !== 'hyperlink' && REMOTE.test(rel.target)) {
      // A picture or a frame fetched when the file opens is a read receipt.
      push('Remote resource loaded on opening', 'probable', rel.rels, `${rel.type}: ${rel.target}`);
    }
  }

  for (const [path, raw] of Object.entries(parts)) {
    if (!/^word\/.*\.xml$/.test(path)) continue;
    const xml = strFromU8(raw);
    if (!xml.includes('instrText') && !xml.includes('fldSimple')) continue;
    for (const instruction of fieldInstructions(xml)) {
      if (DDE.test(instruction)) push('DDE field (runs a command)', 'confirmed', path, instruction);
      const include = INCLUDE.exec(instruction);
      if (include && isRemoteTarget(include[2]!.replace(/\\\\/g, '\\'))) push('Field loading a remote resource', 'confirmed', path, instruction);
    }
  }
  for (const [path, raw] of Object.entries(parts)) {
    if (!/^xl\/externalLinks\/externalLink\d+\.xml$/.test(path)) continue;
    const dde = /<ddeLink\b[^>]*ddeService="([^"]*)"[^>]*ddeTopic="([^"]*)"/.exec(strFromU8(raw));
    if (dde) push('DDE field (runs a command)', 'confirmed', path, `${dde[1]} ${dde[2]}`);
  }

  // Embedded objects, with the program each one names to open it.
  const progIds = new Map<string, string>();
  for (const [path, raw] of Object.entries(parts)) {
    if (!path.endsWith('.xml')) continue;
    const xml = strFromU8(raw);
    if (!/progid=/i.test(xml)) continue;
    const owned = rels.filter((r) => ownerOf(r.rels) === path);
    for (const m of xml.matchAll(/<[^>]*\bprogid="([^"]+)"[^>]*>/gi)) {
      const id = /\sr:id="([^"]+)"/.exec(m[0])?.[1];
      const rel = owned.find((r) => r.id === id);
      if (rel) progIds.set(resolve(rel.rels, rel.target), m[1]!);
    }
  }
  for (const path of Object.keys(parts).filter((p) => EMBEDDING.test(p)).sort()) {
    const progId = progIds.get(path);
    // A Package object can hold any file, an executable included.
    push('Embedded object (OLE)', progId === 'Package' ? 'confirmed' : 'probable', path, `${path.split('/').pop()} — ${parts[path]!.length} bytes${progId ? `, ProgID ${progId}` : ''}`);
  }
  for (const path of Object.keys(parts).filter((p) => ACTIVEX.test(p)).sort()) {
    const classid = /classid="([^"]+)"/i.exec(strFromU8(parts[path]!))?.[1] ?? '';
    push('ActiveX control', 'confirmed', path, classid || path);
  }
  return findings;
}

/**
 * Remove what can go without damaging the document. `removePart` drops a
 * part with its content-type override and the relationships pointing at it.
 * Returns how many elements went.
 */
export function stripActiveOffice(parts: Parts, removePart: (parts: Parts, path: string) => void): number {
  let removed = 0;
  for (const path of Object.keys(parts).filter((p) => VBA.test(p) || /(^|\/)vbaData\.xml$/i.test(p))) {
    removePart(parts, path);
    if (VBA.test(path)) removed++;
  }

  // The remote template: the relationship, and the setting that points at it.
  for (const rel of relationships(parts)) {
    if (rel.type !== 'attachedTemplate' || !rel.external) continue;
    const xml = strFromU8(parts[rel.rels]!);
    parts[rel.rels] = strToU8(xml.replace(new RegExp(`<Relationship\\b[^>]*\\sId="${rel.id}"[^>]*/>`), ''));
    const owner = ownerOf(rel.rels);
    if (parts[owner]) {
      parts[owner] = strToU8(strFromU8(parts[owner]!).replace(new RegExp(`<w:attachedTemplate\\b[^>]*r:id="${rel.id}"[^>]*/>`), ''));
    }
    removed++;
  }

  // Field instructions that run or fetch: emptied. Word shows the field's last
  // result, which stays as it was — the text the reader saw.
  for (const [path, raw] of Object.entries(parts)) {
    if (!/^word\/.*\.xml$/.test(path)) continue;
    const xml = strFromU8(raw);
    if (!/DDE|INCLUDEPICTURE|INCLUDETEXT|IMPORT|LINK/i.test(xml)) continue;
    let count = 0;
    let out = xml.replace(/(<w:instrText\b[^>]*>)([^<]*)(<\/w:instrText>)/g, (whole, open: string, text: string, close: string) => {
      const instruction = text.replace(/&quot;/g, '"').trim();
      const include = INCLUDE.exec(instruction);
      if (DDE.test(instruction) || (include && isRemoteTarget(include[2]!.replace(/\\\\/g, '\\')))) {
        count++;
        return `${open}${close}`;
      }
      return whole;
    });
    out = out.replace(/<w:fldSimple\b([^>]*)\sw:instr="([^"]*)"/g, (whole, before: string, instr: string) => {
      const instruction = instr.replace(/&quot;/g, '"').trim();
      const include = INCLUDE.exec(instruction);
      if (DDE.test(instruction) || (include && isRemoteTarget(include[2]!))) {
        count++;
        return `<w:fldSimple${before} w:instr=""`;
      }
      return whole;
    });
    if (count) {
      parts[path] = strToU8(out);
      removed += count;
    }
  }
  return removed;
}

/** [F-2.4] Tracking parameters out of every external hyperlink. Returns how many links changed. */
export function stripTrackingOffice(parts: Parts): number {
  let changed = 0;
  for (const [path, raw] of Object.entries(parts)) {
    if (!path.endsWith('.rels')) continue;
    const xml = strFromU8(raw);
    const out = xml.replace(/<Relationship\b[^>]*\/?>/g, (element) => {
      if (!/\sTargetMode="External"/.test(element) || !/\/hyperlink"/.test(element)) return element;
      return element.replace(/\sTarget="([^"]*)"/, (whole, target: string) => {
        const cleaned = cleanUrl(target.replace(/&amp;/g, '&'));
        if (cleaned === undefined) return whole;
        changed++;
        return ` Target="${cleaned.replace(/&/g, '&amp;')}"`;
      });
    });
    if (out !== xml) parts[path] = strToU8(out);
  }
  return changed;
}
