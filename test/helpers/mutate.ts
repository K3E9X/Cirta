/**
 * [F-2.8] The mutators of scripts/fuzz.mjs, for fuzzing parsers whose seeds
 * are built by the test helpers. Seeded: a failure names its seed and
 * iteration, and reproduces exactly.
 */

export function rng(seed: number): () => number {
  let state = seed >>> 0 || 0x9e3779b9;
  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;
    return (state >>> 0) / 0x100000000;
  };
}

/** Values that break length arithmetic: zero, the signed and unsigned edges. */
const EDGES = [0, 1, 0x7f, 0x80, 0xff, 0x7fff, 0xffff, 0x7fffffff, 0xffffffff];

type Mutator = (bytes: Uint8Array, random: () => number, corpus: Uint8Array[]) => Uint8Array;

export const MUTATORS: Mutator[] = [
  (bytes, random) => {
    const out = bytes.slice();
    out[Math.floor(random() * out.length)]! ^= 1 << Math.floor(random() * 8);
    return out;
  },
  (bytes, random) => {
    const out = bytes.slice();
    out[Math.floor(random() * out.length)] = Math.floor(random() * 256);
    return out;
  },
  (bytes, random) => bytes.slice(0, Math.floor(random() * bytes.length)),
  (bytes, random) => {
    const start = Math.floor(random() * bytes.length);
    const chunk = bytes.subarray(start, start + Math.floor(random() * 64) + 1);
    const out = new Uint8Array(bytes.length + chunk.length);
    out.set(bytes.subarray(0, start), 0);
    out.set(chunk, start);
    out.set(bytes.subarray(start), start + chunk.length);
    return out;
  },
  (bytes, random) => {
    // A length or an offset set to an edge value, either byte order.
    const out = bytes.slice();
    const at = Math.floor(random() * Math.max(1, out.length - 4));
    if (at + 4 <= out.length) new DataView(out.buffer).setUint32(at, EDGES[Math.floor(random() * EDGES.length)]! >>> 0, random() < 0.5);
    return out;
  },
  (bytes, random, corpus) => {
    const other = corpus[Math.floor(random() * corpus.length)]!;
    const cut = Math.floor(random() * bytes.length);
    const out = new Uint8Array(cut + other.length);
    out.set(bytes.subarray(0, cut), 0);
    out.set(other, cut);
    return out;
  },
  (bytes, random) => {
    // A pointer aimed back at an earlier position: what finds loops in offset-chained formats.
    const out = bytes.slice();
    if (out.length < 8) return out;
    const at = Math.floor(random() * (out.length - 4));
    new DataView(out.buffer).setUint32(at, Math.floor(random() * at), true);
    return out;
  },
];

/** Iterations per target: FUZZ_ITERATIONS for a longer campaign, a short run otherwise. */
export const ITERATIONS = Number(process.env.FUZZ_ITERATIONS ?? 150);
export const SEED = Number(process.env.FUZZ_SEED ?? 20261018);

export function* mutations(corpus: Uint8Array[], seed = SEED, iterations = ITERATIONS): Generator<{ input: Uint8Array; iteration: number }> {
  const random = rng(seed);
  for (let iteration = 0; iteration < iterations; iteration++) {
    const base = corpus[Math.floor(random() * corpus.length)]!;
    const input = MUTATORS[Math.floor(random() * MUTATORS.length)]!(base, random, corpus);
    if (input.length) yield { input, iteration };
  }
}
