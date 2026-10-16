/**
 * A JPEG carrying a real Exif preview in IFD1.
 *
 * Written by hand because every offset inside a TIFF block is relative to the
 * block's own start, and a fixture that gets one of them wrong proves only that
 * the parser rejects malformed input — which is not the thing under test.
 */

interface Size {
  width: number;
  height: number;
}

function be16(value: number): number[] {
  return [(value >> 8) & 0xff, value & 0xff];
}

function le32(value: number): number[] {
  return [value & 0xff, (value >> 8) & 0xff, (value >> 16) & 0xff, (value >>> 24) & 0xff];
}

/** SOI, a start-of-frame stating the size, then an end marker. */
function minimalJpeg({ width, height }: Size, withScan = false): number[] {
  const sof = [0xff, 0xc0, ...be16(11), 8, ...be16(height), ...be16(width), 1, 0x11, 0x00];
  const scan = withScan ? [0xff, 0xda, ...be16(8), 1, 1, 0x00, 0x00, 0x3f, 0x00, 0x00] : [];
  return [0xff, 0xd8, ...sof, ...scan, 0xff, 0xd9];
}

/** IFD entry: tag, type, count 1, value left-justified in the 4-byte field. */
function entry(tag: number, type: 3 | 4, value: number): number[] {
  const little = (n: number) => [n & 0xff, (n >> 8) & 0xff];
  return [
    ...little(tag),
    ...little(type),
    ...le32(1),
    // A SHORT occupies the first two bytes of the value field; a LONG all four.
    ...(type === 3 ? [...little(value), 0, 0] : le32(value)),
  ];
}

/**
 * A JPEG of `picture` size whose Exif carries a preview of `preview` size.
 * Pass no preview for a file with Exif and no IFD1 at all.
 */
export function jpegWithPreview(picture: Size, preview?: Size): Uint8Array {
  const thumb = preview ? minimalJpeg(preview) : [];

  // IFD0: one entry and the pointer to IFD1, so IFD1 starts 18 bytes later.
  const ifd0At = 8;
  const ifd1At = ifd0At + 2 + 12 + 4;
  // IFD1: three entries and a null next-pointer, so the preview follows it.
  const thumbAt = ifd1At + 2 + 12 * 3 + 4;

  const tiff = [
    0x49, 0x49, 0x2a, 0x00, // "II", 42: little-endian TIFF
    ...le32(ifd0At),
    // IFD0
    1, 0,
    ...entry(0x010e, 3, 0), // ImageDescription, present only to be walked past
    ...le32(preview ? ifd1At : 0),
  ];

  if (preview) {
    tiff.push(
      3, 0, // IFD1 entry count
      ...entry(0x0103, 3, 6), // Compression: JPEG
      ...entry(0x0201, 4, thumbAt),
      ...entry(0x0202, 4, thumb.length),
      ...le32(0), // no further directory
      ...thumb,
    );
  }

  const body = [...[0x45, 0x78, 0x69, 0x66, 0x00, 0x00], ...tiff]; // "Exif\0\0"
  const app1 = [0xff, 0xe1, ...be16(body.length + 2), ...body];
  const image = minimalJpeg(picture, true);

  // SOI, then APP1, then the rest of the picture.
  return new Uint8Array([...image.slice(0, 2), ...app1, ...image.slice(2)]);
}
