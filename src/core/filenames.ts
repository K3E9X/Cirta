/**
 * [F-P2 2.1] File names that lie: the names of archive members, mail and
 * Outlook attachments and embedded files, read for the tricks that make a
 * program look like a document.
 *
 *   - A right-to-left override reverses what follows it on screen:
 *     "invoice‮fdp.exe" displays as "invoiceexe.pdf".
 *   - A double extension shows the first and runs the last: "facture.pdf.exe",
 *     or the same with enough spaces to push ".exe" out of view.
 *   - Invisible characters, and a word mixing two alphabets ("pаypal" with a
 *     Cyrillic "а"), make a name look like another.
 *   - An archive member named "../../x" or "/etc/x" is written outside the
 *     folder it is extracted to ("zip slip"). Cirta never extracts; the name
 *     is reported for whoever will.
 */

import type { Finding } from './types.js';

/** Extensions Windows runs, or hands to something that runs them. */
const PROGRAM = /^(?:exe|scr|com|pif|bat|cmd|msi|msp|cpl|hta|jar|js|jse|vbs|vbe|wsf|wsh|ps1|psm1|lnk|reg|iso|img|vhd|vhdx|appx|msix|dll|sys|gadget|application|chm|url)$/i;
/** Extensions people trust to be documents. */
const DOCUMENT = /^(?:pdf|docx?|xlsx?|pptx?|odt|ods|odp|rtf|txt|csv|jpe?g|png|gif|bmp|heic|mp3|mp4|mov|zip|html?|eml|msg)$/i;

const BIDI = /[‎‏‪-‮⁦-⁩]/;
const INVISIBLE = /[­͏؜ᅟᅠ឴឵᠎​-‍⁠-⁤ㅤ﻿ﾠ]/u;

const codePoint = (c: string) => `U+${c.codePointAt(0)!.toString(16).toUpperCase().padStart(4, '0')}`;

/** What a name looks like once a right-to-left override has reversed what follows it, to the next isolate or the end. */
function displayed(name: string): string {
  const at = name.search(/[‮⁧]/);
  if (at < 0) return name;
  const rest = name.slice(at + 1);
  const end = rest.search(/[‬⁩]/);
  const reversed = [...(end < 0 ? rest : rest.slice(0, end))].reverse().join('');
  return name.slice(0, at) + reversed + (end < 0 ? '' : rest.slice(end + 1));
}

const SCRIPTS: Array<[string, RegExp]> = [
  ['Latin', /\p{Script=Latin}/u],
  ['Cyrillic', /\p{Script=Cyrillic}/u],
  ['Greek', /\p{Script=Greek}/u],
];

const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;

export function fileNameFindings(path: string, location: string): Finding[] {
  const findings: Finding[] = [];
  const push = (label: string, value: string, confidence: Finding['confidence'] = 'confirmed') =>
    findings.push({ kind: 'deceptive-name', confidence, location, label, value });
  const name = baseName(path);

  const bidi = name.match(BIDI);
  if (bidi) {
    const shown = displayed(name);
    const real = /\.([^.\s]+)$/.exec(name.replace(new RegExp(BIDI.source, 'g'), ''))?.[1];
    push('File name with a direction control', `shown as “${shown.replace(new RegExp(BIDI.source, 'g'), '')}”, really ends in .${real ?? '?'} (${codePoint(bidi[0])})`);
  }

  const clean = name.replace(new RegExp(BIDI.source, 'g'), '');
  const double = /\.([A-Za-z0-9]{2,5})[\s.]*\.([A-Za-z0-9]{2,12})\s*$/.exec(clean);
  if (double && DOCUMENT.test(double[1]!) && PROGRAM.test(double[2]!)) {
    push('Double extension hiding a program', `${clean.replace(/\s{2,}/g, ' … ')} — opens as .${double[2]!.toLowerCase()}, not .${double[1]!.toLowerCase()}`);
  }

  const invisible = name.match(INVISIBLE);
  if (invisible) push('Invisible character in a file name', `${codePoint(invisible[0])} in “${name.replace(new RegExp(INVISIBLE.source, 'gu'), '·')}”`, 'probable');

  const stem = clean.replace(/\.[^.]*$/, '');
  for (const word of stem.split(/[^\p{L}]+/u)) {
    const used = SCRIPTS.filter(([, pattern]) => pattern.test(word)).map(([script]) => script);
    if (used.length > 1) {
      push('File name mixing two alphabets', `“${word}” mixes ${used.join(' and ')}`, 'probable');
      break;
    }
  }

  // A path that climbs out of the extraction folder, or starts at a root.
  if (/(?:^|[\\/])\.\.(?:[\\/]|$)/.test(path) || /^[\\/]/.test(path) || /^[A-Za-z]:[\\/]/.test(path)) {
    push('Archive member written outside its folder', path);
  }
  return findings;
}
