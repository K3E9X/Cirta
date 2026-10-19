/**
 * [F-P3 2.2] LZMA and LZMA2 decoding, for 7z archives: 7-Zip compresses
 * both a 7z's header (the file names) and its content with them by default.
 *
 * The algorithm of the LZMA SDK (Igor Pavlov, public domain), written again:
 * a range decoder, adaptive bit probabilities, literals coded against the
 * previous byte and the byte at the last distance, matches and four repeated
 * distances. LZMA2 frames LZMA in chunks that may reset the state, change
 * the properties or carry bytes uncompressed.
 *
 * Output is bounded by the caller, and every stream 7z gives a CRC for is
 * checked against it (sevenzip.ts): a decoding error is a refusal, never a
 * misread file.
 */

export class LzmaError extends Error {}

const PROB_INIT = 1024;
const STATES = 12;
const POS_STATES_MAX = 16;
const END_POS_MODEL_INDEX = 14;
const FULL_DISTANCES = 128;
const ALIGN_BITS = 4;
const MATCH_MIN = 2;

class RangeDecoder {
  private range = 0xffffffff;
  private code = 0;
  constructor(
    private readonly data: Uint8Array,
    private pos: number,
    private readonly end: number,
  ) {
    if (end - pos < 5 || data[pos] !== 0) throw new LzmaError('bad range coder header');
    for (let i = 1; i < 5; i++) this.code = ((this.code << 8) | data[pos + i]!) >>> 0;
    this.pos += 5;
    if (this.code === this.range) throw new LzmaError('bad range coder header');
  }

  private normalize(): void {
    if (this.range < 0x1000000) {
      if (this.pos >= this.end) throw new LzmaError('input ends inside the stream');
      this.range = (this.range << 8) >>> 0;
      this.code = ((this.code << 8) | this.data[this.pos++]!) >>> 0;
    }
  }

  bit(probs: Uint16Array, index: number): number {
    const p = probs[index]!;
    const bound = (this.range >>> 11) * p;
    if (this.code < bound) {
      this.range = bound;
      probs[index] = p + ((2048 - p) >>> 5);
      this.normalize();
      return 0;
    }
    this.range = (this.range - bound) >>> 0;
    this.code = (this.code - bound) >>> 0;
    probs[index] = p - (p >>> 5);
    this.normalize();
    return 1;
  }

  direct(count: number): number {
    let result = 0;
    for (let i = 0; i < count; i++) {
      this.range >>>= 1;
      let bit = 0;
      if (this.code >= this.range) {
        this.code = (this.code - this.range) >>> 0;
        bit = 1;
      }
      result = ((result << 1) | bit) >>> 0;
      this.normalize();
    }
    return result;
  }

  tree(probs: Uint16Array, offset: number, bits: number): number {
    let m = 1;
    for (let i = 0; i < bits; i++) m = (m << 1) | this.bit(probs, offset + m);
    return m - (1 << bits);
  }

  reverse(probs: Uint16Array, offset: number, bits: number): number {
    let m = 1;
    let symbol = 0;
    for (let i = 0; i < bits; i++) {
      const bit = this.bit(probs, offset + m);
      m = (m << 1) | bit;
      symbol |= bit << i;
    }
    return symbol;
  }
}

/** Length coder: choice bits, then 8 low, 8 mid or 256 high lengths. */
class LengthDecoder {
  private readonly choice = new Uint16Array(2).fill(PROB_INIT);
  private readonly low = new Uint16Array(POS_STATES_MAX << 3).fill(PROB_INIT);
  private readonly mid = new Uint16Array(POS_STATES_MAX << 3).fill(PROB_INIT);
  private readonly high = new Uint16Array(256).fill(PROB_INIT);

  decode(rc: RangeDecoder, posState: number): number {
    if (rc.bit(this.choice, 0) === 0) return rc.tree(this.low, posState << 3, 3);
    if (rc.bit(this.choice, 1) === 0) return 8 + rc.tree(this.mid, posState << 3, 3);
    return 16 + rc.tree(this.high, 0, 8);
  }
}

/** One LZMA decoder: probabilities, state and repeated distances, over an output buffer that is its dictionary. */
export class LzmaDecoder {
  private lc = 3;
  private lp = 0;
  private pb = 2;
  private literal!: Uint16Array;
  private isMatch!: Uint16Array;
  private isRep!: Uint16Array;
  private isRepG0!: Uint16Array;
  private isRepG1!: Uint16Array;
  private isRepG2!: Uint16Array;
  private isRep0Long!: Uint16Array;
  private posSlot!: Uint16Array;
  private posSpecial!: Uint16Array;
  private align!: Uint16Array;
  private lengths!: LengthDecoder;
  private repLengths!: LengthDecoder;
  private state = 0;
  private reps = [0, 0, 0, 0];
  /** Where the current dictionary starts in the output (moved by an LZMA2 dictionary reset). */
  private dictionaryStart = 0;

  constructor(
    readonly out: Uint8Array,
    public outPos = 0,
  ) {}

  /** The lc, lp, pb packed into one byte as LZMA writes it. */
  setProperties(byte: number): void {
    if (byte >= 9 * 5 * 5) throw new LzmaError('bad properties');
    this.lc = byte % 9;
    this.lp = Math.floor(byte / 9) % 5;
    this.pb = Math.floor(byte / 45);
  }

  resetState(): void {
    this.literal = new Uint16Array(0x300 << (this.lc + this.lp)).fill(PROB_INIT);
    this.isMatch = new Uint16Array(STATES << 4).fill(PROB_INIT);
    this.isRep = new Uint16Array(STATES).fill(PROB_INIT);
    this.isRepG0 = new Uint16Array(STATES).fill(PROB_INIT);
    this.isRepG1 = new Uint16Array(STATES).fill(PROB_INIT);
    this.isRepG2 = new Uint16Array(STATES).fill(PROB_INIT);
    this.isRep0Long = new Uint16Array(STATES << 4).fill(PROB_INIT);
    this.posSlot = new Uint16Array(4 << 6).fill(PROB_INIT);
    this.posSpecial = new Uint16Array(1 + FULL_DISTANCES - END_POS_MODEL_INDEX).fill(PROB_INIT);
    this.align = new Uint16Array(1 << ALIGN_BITS).fill(PROB_INIT);
    this.lengths = new LengthDecoder();
    this.repLengths = new LengthDecoder();
    this.state = 0;
    this.reps = [0, 0, 0, 0];
  }

  resetDictionary(): void {
    this.dictionaryStart = this.outPos;
  }

  private distance(length: number, rc: RangeDecoder): number {
    const lenState = length < 4 ? length : 3;
    const slot = rc.tree(this.posSlot, lenState << 6, 6);
    if (slot < 4) return slot;
    const directBits = (slot >>> 1) - 1;
    let distance = ((2 | (slot & 1)) << directBits) >>> 0;
    // The same probability layout as the reference: slot s reads cells (distance - s) + 1 … of posSpecial.
    if (slot < END_POS_MODEL_INDEX) return (distance + rc.reverse(this.posSpecial, distance - slot, directBits)) >>> 0;
    distance = (distance + ((rc.direct(directBits - ALIGN_BITS) << ALIGN_BITS) >>> 0)) >>> 0;
    return (distance + rc.reverse(this.align, 0, ALIGN_BITS)) >>> 0;
  }

  /**
   * Decode from `rc` until `limit` bytes are out (or the end marker, when
   * `allowEndMarker`). Returns true if the end marker was met.
   */
  decode(rc: RangeDecoder, limit: number, allowEndMarker = false): boolean {
    const out = this.out;
    const pbMask = (1 << this.pb) - 1;
    const lpMask = (1 << this.lp) - 1;
    while (this.outPos < limit) {
      const posState = this.outPos & pbMask;
      if (rc.bit(this.isMatch, (this.state << 4) + posState) === 0) {
        const previous = this.outPos > this.dictionaryStart ? out[this.outPos - 1]! : 0;
        const base = 0x300 * (((this.outPos & lpMask) << this.lc) + (previous >> (8 - this.lc)));
        let symbol = 1;
        if (this.state >= 7) {
          let match = out[this.outPos - this.reps[0]! - 1]!;
          do {
            const matchBit = (match >> 7) & 1;
            match = (match << 1) & 0xff;
            const bit = rc.bit(this.literal, base + ((1 + matchBit) << 8) + symbol);
            symbol = (symbol << 1) | bit;
            if (matchBit !== bit) break;
          } while (symbol < 0x100);
        }
        while (symbol < 0x100) symbol = (symbol << 1) | rc.bit(this.literal, base + symbol);
        out[this.outPos++] = symbol & 0xff;
        this.state = this.state < 4 ? 0 : this.state < 10 ? this.state - 3 : this.state - 6;
        continue;
      }
      let length: number;
      if (rc.bit(this.isRep, this.state) === 0) {
        this.reps[3] = this.reps[2]!;
        this.reps[2] = this.reps[1]!;
        this.reps[1] = this.reps[0]!;
        length = this.lengths.decode(rc, posState);
        this.state = this.state < 7 ? 7 : 10;
        this.reps[0] = this.distance(length, rc);
        if (this.reps[0] === 0xffffffff) {
          if (allowEndMarker) return true;
          throw new LzmaError('unexpected end marker');
        }
      } else {
        if (this.outPos === this.dictionaryStart) throw new LzmaError('repeat before any output');
        if (rc.bit(this.isRepG0, this.state) === 0) {
          if (rc.bit(this.isRep0Long, (this.state << 4) + posState) === 0) {
            this.state = this.state < 7 ? 9 : 11;
            out[this.outPos] = out[this.outPos - this.reps[0]! - 1]!;
            this.outPos++;
            continue;
          }
        } else {
          let distance: number;
          if (rc.bit(this.isRepG1, this.state) === 0) distance = this.reps[1]!;
          else {
            if (rc.bit(this.isRepG2, this.state) === 0) distance = this.reps[2]!;
            else {
              distance = this.reps[3]!;
              this.reps[3] = this.reps[2]!;
            }
            this.reps[2] = this.reps[1]!;
          }
          this.reps[1] = this.reps[0]!;
          this.reps[0] = distance;
        }
        length = this.repLengths.decode(rc, posState);
        this.state = this.state < 7 ? 8 : 11;
      }
      const distance = this.reps[0]! + 1;
      if (distance > this.outPos - this.dictionaryStart) throw new LzmaError('distance past the start of the dictionary');
      let count = length + MATCH_MIN;
      if (this.outPos + count > limit) throw new LzmaError('match past the declared size');
      for (; count > 0; count--, this.outPos++) out[this.outPos] = out[this.outPos - distance]!;
    }
    return false;
  }
}

/** Raw LZMA as 7z stores it: properties (lc/lp/pb byte, then a 4-byte dictionary size) apart, the size known. */
export function decodeLzma(properties: Uint8Array, data: Uint8Array, size: number): Uint8Array {
  if (properties.length < 5) throw new LzmaError('bad properties');
  const out = new Uint8Array(size);
  const decoder = new LzmaDecoder(out);
  decoder.setProperties(properties[0]!);
  decoder.resetState();
  const rc = new RangeDecoder(data, 0, data.length);
  // An encoder may close with an end marker even when the size is known.
  decoder.decode(rc, size, true);
  if (decoder.outPos !== size) throw new LzmaError('stream shorter than its declared size');
  return out;
}

/** LZMA2: chunks, each uncompressed or LZMA, each perhaps resetting state, properties or dictionary. */
export function decodeLzma2(data: Uint8Array, size: number): Uint8Array {
  const out = new Uint8Array(size);
  const decoder = new LzmaDecoder(out);
  let at = 0;
  let needProperties = true;
  let needDictionaryReset = true;
  for (;;) {
    if (at >= data.length) throw new LzmaError('input ends before the end of the LZMA2 stream');
    const control = data[at++]!;
    if (control === 0x00) break;
    if (control === 0x01 || control === 0x02) {
      if (at + 2 > data.length) throw new LzmaError('truncated chunk header');
      const length = ((data[at]! << 8) | data[at + 1]!) + 1;
      at += 2;
      if (control === 0x01) {
        decoder.resetDictionary();
        needDictionaryReset = false;
      } else if (needDictionaryReset) throw new LzmaError('missing dictionary reset');
      if (at + length > data.length || decoder.outPos + length > size) throw new LzmaError('chunk past its bounds');
      out.set(data.subarray(at, at + length), decoder.outPos);
      decoder.outPos += length;
      at += length;
      continue;
    }
    if (control < 0x80) throw new LzmaError('bad chunk control byte');
    if (at + 4 > data.length) throw new LzmaError('truncated chunk header');
    const unpacked = ((control & 0x1f) << 16) + ((data[at]! << 8) | data[at + 1]!) + 1;
    const packed = ((data[at + 2]! << 8) | data[at + 3]!) + 1;
    at += 4;
    const reset = (control >> 5) & 3;
    if (reset === 3) {
      decoder.resetDictionary();
      needDictionaryReset = false;
    } else if (needDictionaryReset) throw new LzmaError('missing dictionary reset');
    if (reset >= 2) {
      if (at >= data.length) throw new LzmaError('truncated chunk header');
      decoder.setProperties(data[at++]!);
      needProperties = false;
    } else if (needProperties) throw new LzmaError('missing properties');
    if (reset >= 1) decoder.resetState();
    if (at + packed > data.length || decoder.outPos + unpacked > size) throw new LzmaError('chunk past its bounds');
    const rc = new RangeDecoder(data, at, at + packed);
    decoder.decode(rc, decoder.outPos + unpacked);
    at += packed;
  }
  if (decoder.outPos !== size) throw new LzmaError('stream shorter than its declared size');
  return out;
}
