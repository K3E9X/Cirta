/**
 * Reading a PDF's ToUnicode CMap, which is what makes page text readable.
 *
 * A PDF string operand does not hold Unicode. It holds codes that mean whatever
 * the current font says they mean, and a subset font — which is what any
 * producer embeds once the text uses accents — numbers its glyphs from 1 in the
 * order it happened to encounter them. So a page reading "Réduire les flux"
 * appears in the content stream as `<000100020003…>`, and scanning that for a
 * zero-width space finds nothing, ever.
 *
 * The mapping back is in the file: every such font carries a `/ToUnicode`
 * stream, a small PostScript-flavoured CMap whose whole job is to say which
 * Unicode each code stands for. Parsing it turns "a miss proves nothing" into
 * a real answer.
 *
 * Only the two operators that matter are handled — `bfchar` for single codes
 * and `bfrange` for runs — because that is all a ToUnicode CMap contains.
 */

/** Code point width in bytes, and the code → text mapping itself. */
export interface ToUnicode {
  codeBytes: number;
  map: Map<number, string>;
}

const hexToNumber = (hex: string): number => parseInt(hex, 16);

/**
 * A destination is UTF-16BE, and may be a sequence: one code can stand for a
 * ligature, so `<0066006C>` is "fl" rather than two separate glyphs.
 */
function decodeDestination(hex: string): string {
  const clean = hex.replace(/\s+/g, '');
  let out = '';
  for (let i = 0; i + 4 <= clean.length; i += 4) {
    out += String.fromCharCode(parseInt(clean.slice(i, i + 4), 16));
  }
  return out;
}

const HEX = /<([0-9A-Fa-f\s]*)>/g;

/** Pull every `<...>` token out of a section, in order. */
function hexTokens(section: string): string[] {
  return [...section.matchAll(HEX)].map((match) => (match[1] ?? '').replace(/\s+/g, ''));
}

export function parseToUnicode(cmap: string): ToUnicode | undefined {
  const map = new Map<number, string>();

  // The codespace range states how many bytes a code occupies. Identity-H, the
  // usual choice for a subset font, uses two; a simple font uses one.
  const codespace = /begincodespacerange([\s\S]*?)endcodespacerange/.exec(cmap);
  const firstRange = codespace ? hexTokens(codespace[1] ?? '')[0] : undefined;
  const codeBytes = firstRange && firstRange.length >= 4 ? 2 : 1;

  for (const section of cmap.matchAll(/beginbfchar([\s\S]*?)endbfchar/g)) {
    const tokens = hexTokens(section[1] ?? '');
    for (let i = 0; i + 1 < tokens.length; i += 2) {
      map.set(hexToNumber(tokens[i]!), decodeDestination(tokens[i + 1]!));
    }
  }

  for (const section of cmap.matchAll(/beginbfrange([\s\S]*?)endbfrange/g)) {
    const body = section[1] ?? '';
    // Two shapes: `<lo> <hi> <dst>` walks the destination upward, and
    // `<lo> <hi> [<d1> <d2> …]` lists one destination per code.
    for (const entry of body.matchAll(/<([0-9A-Fa-f\s]*)>\s*<([0-9A-Fa-f\s]*)>\s*(\[[\s\S]*?\]|<[0-9A-Fa-f\s]*>)/g)) {
      const lo = hexToNumber((entry[1] ?? '').replace(/\s+/g, ''));
      const hi = hexToNumber((entry[2] ?? '').replace(/\s+/g, ''));
      const destination = entry[3] ?? '';
      if (!Number.isFinite(lo) || !Number.isFinite(hi) || hi < lo) continue;
      // A crafted file can claim an enormous range; the cap keeps that bounded.
      const end = Math.min(hi, lo + 65535);

      if (destination.startsWith('[')) {
        const list = hexTokens(destination);
        for (let code = lo; code <= end && code - lo < list.length; code++) {
          map.set(code, decodeDestination(list[code - lo]!));
        }
      } else {
        const base = decodeDestination(destination.slice(1, -1));
        if (!base) continue;
        const last = base.charCodeAt(base.length - 1);
        for (let code = lo; code <= end; code++) {
          map.set(code, base.slice(0, -1) + String.fromCharCode(last + (code - lo)));
        }
      }
    }
  }

  return map.size ? { codeBytes, map } : undefined;
}

/** Turn a run of raw string bytes into text, using the font's own mapping. */
export function decodeWithToUnicode(bytes: Uint8Array, table: ToUnicode): string {
  let out = '';
  const step = table.codeBytes;
  for (let i = 0; i + step <= bytes.length; i += step) {
    const code = step === 2 ? (bytes[i]! << 8) | bytes[i + 1]! : bytes[i]!;
    // An unmapped code contributes nothing rather than a wrong character: this
    // feeds a scanner, and inventing a letter here would invent a finding.
    out += table.map.get(code) ?? '';
  }
  return out;
}
