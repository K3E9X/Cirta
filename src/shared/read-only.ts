/**
 * Formats Ciirta reads and never rewrites, for the interfaces that offer a
 * clean: the page, the Thunderbird add-in. The library refuses them on its
 * own (UnsupportedFormatError); these let an interface not offer what it
 * would only refuse.
 */

/** [F-2.2] Old Office and Outlook. */
export const LEGACY = new Set(['doc', 'xls', 'ppt', 'msg']);
/** [F-P2 2.2] Pictures. */
export const FIXED_PICTURES = new Set(['tiff', 'heic', 'avif']);
/** [F-P3 2.2] Archives. */
export const READ_ONLY_ARCHIVES = new Set(['tar', 'gz', '7z']);

export const isReadOnly = (format: string): boolean => LEGACY.has(format) || FIXED_PICTURES.has(format) || READ_ONLY_ARCHIVES.has(format);
