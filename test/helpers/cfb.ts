/**
 * Compound files written by hand, for tests: a VBA project, an Outlook
 * message, a legacy Office file. 512-byte sectors, every stream in the FAT
 * (the header's mini-stream cutoff is 0, which readers honour), siblings
 * chained to the right — a degenerate but valid tree.
 */

const END = 0xfffffffe;
const FREE = 0xffffffff;
const NONE = 0xffffffff;

interface Node {
  name: string;
  type: 1 | 2 | 5;
  data?: Uint8Array;
  children: Node[];
}

export function cfbFile(streams: Record<string, Uint8Array>): Uint8Array {
  const root: Node = { name: 'Root Entry', type: 5, children: [] };
  for (const [path, data] of Object.entries(streams)) {
    const parts = path.split('/');
    let node = root;
    for (const [i, part] of parts.entries()) {
      let child = node.children.find((c) => c.name === part);
      if (!child) {
        child = i === parts.length - 1 ? { name: part, type: 2, data, children: [] } : { name: part, type: 1, children: [] };
        node.children.push(child);
      }
      node = child;
    }
  }
  const order: Node[] = [];
  const visit = (node: Node) => {
    order.push(node);
    node.children.forEach(visit);
  };
  visit(root);

  const dirSectors = Math.ceil((order.length * 128) / 512);
  let next = 1 + dirSectors;
  const starts = new Map<Node, number>();
  for (const node of order) {
    if (node.type !== 2 || !node.data?.length) continue;
    starts.set(node, next);
    next += Math.ceil(node.data.length / 512);
  }
  if (next > 128) throw new Error('test compound file too large for one FAT sector');

  const fat = new Array<number>(128).fill(FREE);
  fat[0] = 0xfffffffd;
  for (let s = 1; s <= dirSectors; s++) fat[s] = s === dirSectors ? END : s + 1;
  for (const [node, start] of starts) {
    const n = Math.ceil(node.data!.length / 512);
    for (let i = 0; i < n; i++) fat[start + i] = i === n - 1 ? END : start + i + 1;
  }

  const out = new Uint8Array(512 * (next + 1));
  const view = new DataView(out.buffer);
  [0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1].forEach((b, i) => (out[i] = b));
  view.setUint16(0x18, 0x3e, true);
  view.setUint16(0x1a, 3, true);
  view.setUint16(0x1c, 0xfffe, true);
  view.setUint16(0x1e, 9, true);
  view.setUint16(0x20, 6, true);
  view.setUint32(0x2c, 1, true);
  view.setUint32(0x30, 1, true);
  view.setUint32(0x38, 0, true);
  view.setUint32(0x3c, END, true);
  view.setUint32(0x44, END, true);
  for (let i = 0; i < 109; i++) view.setUint32(0x4c + i * 4, i === 0 ? 0 : FREE, true);
  fat.forEach((v, i) => view.setUint32(512 + i * 4, v, true));

  const index = new Map(order.map((n, i) => [n, i]));
  const right = new Map<Node, Node>();
  for (const node of order) node.children.forEach((child, k) => node.children[k + 1] && right.set(child, node.children[k + 1]!));
  order.forEach((node, i) => {
    const at = 512 * 2 + i * 128;
    const name = node.name.slice(0, 31);
    for (let j = 0; j < name.length; j++) view.setUint16(at + j * 2, name.charCodeAt(j), true);
    view.setUint16(at + 0x40, (name.length + 1) * 2, true);
    out[at + 0x42] = node.type;
    out[at + 0x43] = 1;
    view.setUint32(at + 0x44, NONE, true);
    view.setUint32(at + 0x48, right.has(node) ? index.get(right.get(node)!)! : NONE, true);
    view.setUint32(at + 0x4c, node.children.length ? index.get(node.children[0]!)! : NONE, true);
    view.setUint32(at + 0x74, starts.get(node) ?? END, true);
    view.setUint32(at + 0x78, node.data?.length ?? 0, true);
  });
  for (const [node, start] of starts) out.set(node.data!, 512 * (start + 1));
  return out;
}

/** MS-OVBA compression with literal tokens only: valid, if not small. */
export function ovbaLiteral(data: Uint8Array): Uint8Array {
  const out = [0x01];
  for (let at = 0; at < data.length || at === 0; at += 3640) {
    const chunk = data.subarray(at, at + 3640);
    const body: number[] = [];
    for (let i = 0; i < chunk.length; i += 8) body.push(0x00, ...chunk.subarray(i, i + 8));
    const header = ((body.length + 2 - 3) & 0x0fff) | 0x3000 | 0x8000;
    out.push(header & 0xff, header >> 8, ...body);
    if (!data.length) break;
  }
  return new Uint8Array(out);
}

const latin = (text: string) => Uint8Array.from([...text].map((c) => c.charCodeAt(0) & 0xff));
const record = (id: number, body: Uint8Array) => {
  const head = new Uint8Array(6);
  new DataView(head.buffer).setUint16(0, id, true);
  new DataView(head.buffer).setUint32(2, body.length, true);
  return [...head, ...body];
};

/** A vbaProject.bin holding these modules' source, with no p-code before it. */
export function vbaProject(modules: Record<string, string>): Uint8Array {
  const version = [0x09, 0x00, 0x04, 0x00, 0x00, 0x00, 0x01, 0x00, 0x00, 0x00, 0x00, 0x00];
  const dir: number[] = [...version];
  const streams: Record<string, Uint8Array> = {};
  for (const [name, source] of Object.entries(modules)) {
    const offset = new Uint8Array(4);
    dir.push(...record(0x0019, latin(name)), ...record(0x001a, latin(name)), ...record(0x0031, offset), ...record(0x002b, new Uint8Array()));
    streams[`VBA/${name}`] = ovbaLiteral(latin(source));
  }
  streams['VBA/dir'] = ovbaLiteral(new Uint8Array(dir));
  streams.PROJECT = latin(`ID="{00000000-0000-0000-0000-000000000000}"\r\n${Object.keys(modules).map((m) => `Module=${m}`).join('\r\n')}\r\n`);
  return cfbFile(streams);
}
