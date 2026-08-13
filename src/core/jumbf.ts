/**
 * JUMBF box parsing, which is how C2PA stores a manifest inside a file.
 *
 * The structure is ISO base-media style: every box is a 4-byte big-endian
 * length, a 4-byte type, then its payload. A `jumb` superbox opens with a
 * `jumd` description box naming what it contains, and the rest of its payload
 * is more boxes. That nesting is the whole format — walk it and the manifest,
 * the claim and the signature are each just a box you can address by name.
 */

const HEADER = 8;

export interface JumbfBox {
  /** Four-character box type, e.g. `jumb`, `jumd`, `cbor`. */
  type: string;
  /** Label from the sibling `jumd` box, for boxes that carry one. */
  label?: string;
  payload: Uint8Array;
  children: JumbfBox[];
}

const ascii = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes);

function readUint32(bytes: Uint8Array, offset: number): number {
  return (
    ((bytes[offset]! << 24) | (bytes[offset + 1]! << 16) | (bytes[offset + 2]! << 8) | bytes[offset + 3]!) >>>
    0
  );
}

/**
 * Read the label out of a description box.
 *
 * A `jumd` payload is a 16-byte type UUID, a one-byte toggle set, then the
 * optional NUL-terminated label. The label is what distinguishes one assertion
 * from another, so it is the part worth recovering.
 */
function describeLabel(payload: Uint8Array): string | undefined {
  if (payload.length < 17) return undefined;
  const toggles = payload[16]!;
  if ((toggles & 0x02) === 0) return undefined; // No label present.
  const end = payload.indexOf(0, 17);
  const label = ascii(payload.subarray(17, end === -1 ? payload.length : end)).trim();
  return label || undefined;
}

/** Walk a run of sibling boxes. Depth is capped: a crafted file can nest forever. */
export function parseBoxes(bytes: Uint8Array, depth = 0): JumbfBox[] {
  if (depth > 12) return [];
  const boxes: JumbfBox[] = [];
  let offset = 0;

  while (offset + HEADER <= bytes.length) {
    let length = readUint32(bytes, offset);
    const type = ascii(bytes.subarray(offset + 4, offset + 8));
    // Length 0 means "runs to the end"; 1 would mean a 64-bit size, which a
    // manifest never needs.
    if (length === 0) length = bytes.length - offset;
    if (length < HEADER || offset + length > bytes.length) break;

    const payload = bytes.subarray(offset + HEADER, offset + length);
    const box: JumbfBox = { type, payload, children: [] };

    if (type === 'jumb') {
      box.children = parseBoxes(payload, depth + 1);
      box.label = box.children.find((child) => child.type === 'jumd')?.label;
    } else if (type === 'jumd') {
      box.label = describeLabel(payload);
    }

    boxes.push(box);
    offset += length;
  }

  return boxes;
}

/** Depth-first search for the first box whose label matches. */
export function findByLabel(boxes: JumbfBox[], predicate: (label: string) => boolean): JumbfBox | undefined {
  for (const box of boxes) {
    if (box.label && predicate(box.label)) return box;
    const nested = findByLabel(box.children, predicate);
    if (nested) return nested;
  }
  return undefined;
}

/** Collect every label in the tree, which enumerates a manifest's assertions. */
export function collectLabels(boxes: JumbfBox[]): string[] {
  const labels: string[] = [];
  for (const box of boxes) {
    if (box.label) labels.push(box.label);
    labels.push(...collectLabels(box.children));
  }
  return labels;
}

/**
 * The content payload of a superbox: everything after its description box.
 *
 * C2PA stores a claim as a `cbor` box and a signature as a `c2cs` box inside
 * the labelled superbox, so this is what the caller actually wants to decode.
 */
export function contentOf(box: JumbfBox, type: string): Uint8Array | undefined {
  return box.children.find((child) => child.type === type)?.payload;
}

/**
 * Locate the C2PA superbox inside a raw segment or chunk.
 *
 * A JPEG APP11 segment prefixes the box with a "JP" common identifier and two
 * counters, and a PNG caBX chunk carries the box directly. Rather than encode
 * both layouts, the scan finds where the outer `jumb` header actually begins.
 */
export function findManifest(bytes: Uint8Array): JumbfBox | undefined {
  for (let offset = 0; offset + HEADER <= bytes.length && offset < 64; offset++) {
    if (ascii(bytes.subarray(offset + 4, offset + 8)) !== 'jumb') continue;
    const [box] = parseBoxes(bytes.subarray(offset), 0);
    if (box?.type === 'jumb') return box;
  }
  return undefined;
}
