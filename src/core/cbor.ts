/**
 * A CBOR reader, limited to what a C2PA manifest contains.
 *
 * The alternative was scraping printable runs out of the binary, which is what
 * this replaced: on a real signed file that produced
 * "dnamepmake_test_imagesgversionf0.33.1" — the data is in there, but the
 * length prefixes are glued to it because nothing was parsing the structure.
 *
 * Only the major types C2PA uses are handled. Indefinite-length maps, arrays
 * and strings are among them: a real signed claim opens one 172 bytes in, which
 * is how the first version of this reader was caught assuming otherwise.
 */

export type CborValue =
  | number
  | bigint
  | string
  | Uint8Array
  | boolean
  | null
  | undefined
  | CborValue[]
  | { [key: string]: CborValue };

class Reader {
  private offset = 0;

  constructor(private readonly bytes: Uint8Array) {}

  get done(): boolean {
    return this.offset >= this.bytes.length;
  }

  private byte(): number {
    if (this.offset >= this.bytes.length) throw new RangeError('CBOR: unexpected end of input');
    return this.bytes[this.offset++]!;
  }

  private take(length: number): Uint8Array {
    if (this.offset + length > this.bytes.length) throw new RangeError('CBOR: truncated item');
    const slice = this.bytes.subarray(this.offset, this.offset + length);
    this.offset += length;
    return slice;
  }

  /** True at a break stop, which closes an indefinite-length item. */
  private atBreak(): boolean {
    return this.bytes[this.offset] === 0xff;
  }

  /** Argument encoded in the low five bits, or in the following 1/2/4/8 bytes. */
  private argument(info: number): number {
    if (info < 24) return info;
    if (info === 24) return this.byte();
    if (info === 25) return (this.byte() << 8) | this.byte();
    if (info === 26) {
      return ((this.byte() << 24) | (this.byte() << 16) | (this.byte() << 8) | this.byte()) >>> 0;
    }
    if (info === 27) {
      // Manifests do not carry values above 2^53, so a number stays readable.
      let value = 0;
      for (let i = 0; i < 8; i++) value = value * 256 + this.byte();
      return value;
    }
    throw new RangeError(`CBOR: unsupported additional information ${info}`);
  }

  read(): CborValue {
    const initial = this.byte();
    const major = initial >> 5;
    const info = initial & 0x1f;

    switch (major) {
      case 0:
        return this.argument(info);
      case 1:
        return -1 - this.argument(info);
      case 2: {
        // An indefinite-length string is a run of definite chunks until break.
        if (info === 31) {
          const chunks: Uint8Array[] = [];
          while (!this.atBreak()) chunks.push(this.read() as Uint8Array);
          this.byte(); // Consume the break.
          const total = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
          const joined = new Uint8Array(total);
          let at = 0;
          for (const chunk of chunks) {
            joined.set(chunk, at);
            at += chunk.length;
          }
          return joined;
        }
        return this.take(this.argument(info));
      }
      case 3: {
        if (info === 31) {
          let text = '';
          while (!this.atBreak()) text += this.read() as string;
          this.byte();
          return text;
        }
        return new TextDecoder('utf-8', { fatal: false }).decode(this.take(this.argument(info)));
      }
      case 4: {
        const items: CborValue[] = [];
        if (info === 31) {
          while (!this.atBreak()) items.push(this.read());
          this.byte();
          return items;
        }
        const length = this.argument(info);
        for (let i = 0; i < length; i++) items.push(this.read());
        return items;
      }
      case 5: {
        const map: { [key: string]: CborValue } = {};
        // Non-string keys are stringified: C2PA uses text keys, and COSE header
        // labels are small integers that read fine as "1", "33".
        const pair = () => {
          const key = this.read();
          map[typeof key === 'string' ? key : String(key)] = this.read();
        };
        if (info === 31) {
          while (!this.atBreak()) pair();
          this.byte();
          return map;
        }
        const length = this.argument(info);
        for (let i = 0; i < length; i++) pair();
        return map;
      }
      case 6:
        this.argument(info); // Tag number; the tagged item follows.
        return this.read();
      case 7:
        if (info === 31) return undefined; // Break, handled by the callers above.
        if (info === 20) return false;
        if (info === 21) return true;
        if (info === 22) return null;
        if (info === 23) return undefined;
        if (info === 25 || info === 26 || info === 27) {
          this.argument(info === 25 ? 25 : info);
          return 0; // Floats do not appear in the fields read here.
        }
        return undefined;
      default:
        throw new RangeError(`CBOR: unsupported major type ${major}`);
    }
  }
}

/** Decode one CBOR item, returning undefined rather than throwing on malformed input. */
export function decodeCbor(bytes: Uint8Array): CborValue | undefined {
  try {
    return new Reader(bytes).read();
  } catch {
    return undefined;
  }
}

/** Narrowing helper, since manifest fields are read defensively throughout. */
export function asMap(value: CborValue | undefined): { [key: string]: CborValue } | undefined {
  return value && typeof value === 'object' && !Array.isArray(value) && !(value instanceof Uint8Array)
    ? (value as { [key: string]: CborValue })
    : undefined;
}
