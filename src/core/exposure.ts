/**
 * How much a local report can conclude about a statistical watermark.
 *
 * This module deliberately does not detect anything. Reading a keyed watermark
 * requires the vendor's secret key, so no local verdict exists and none is
 * offered here.
 *
 * What it does instead is report the one variable that actually governs whether
 * such a mark is readable at all: length. Detection is a hypothesis test over
 * token choices, and its statistical power grows with the number of tokens
 * observed. That makes "we found nothing" mean very different things at 80
 * tokens and at 8000, and a report that does not say which one it is invites
 * the reader to over-conclude.
 *
 * The bands come from published measurements:
 *   - Kirchenbauer et al., ICLR 2024, found that after sustained human
 *     paraphrasing a watermark remained detectable at a 1e-5 false-positive
 *     rate once roughly 800 tokens had been observed.
 *   - Anthropic's own documentation states that short passages may not contain
 *     enough signal for a reliable result.
 *
 * The purpose is calibration, not targeting. This says what a silent report is
 * worth; it does not tell anyone what length to aim for.
 */

/**
 * Token counts are model-specific and no tokenizer ships with this package, so
 * the estimate is derived from script-aware character density and reported as a
 * range rather than a number pretending to precision.
 */
export interface TokenEstimate {
  characters: number;
  words: number;
  /** Lower and upper bounds of the estimate. */
  low: number;
  high: number;
}

const CJK = /[぀-ヿ㐀-䶿一-鿿豈-﫿]/;

export function estimateTokens(text: string): TokenEstimate {
  const characters = [...text].length;
  const words = text.split(/\s+/).filter(Boolean).length;

  // CJK packs far more information per character, so the ratio differs sharply.
  // Latin scripts land near 3.5-4.5 characters per token across tokenizers.
  const dense = CJK.test(text);
  const low = Math.round(characters / (dense ? 2 : 4.5));
  const high = Math.round(characters / (dense ? 1 : 3.2));

  return { characters, words, low, high };
}

export type ExposureBand = 'too-short' | 'uncertain' | 'ample';

export interface Exposure extends TokenEstimate {
  band: ExposureBand;
}

/**
 * Thresholds in tokens. Deliberately coarse: the precise cut-off depends on the
 * scheme, the key and the false-positive rate the verifier chooses, none of
 * which are knowable from here.
 */
const SHORT_LIMIT = 200;
const AMPLE_LIMIT = 800;

export function exposure(text: string): Exposure {
  const estimate = estimateTokens(text);
  // Judge on the low bound, so the band is not overstated by a generous estimate.
  const band: ExposureBand =
    estimate.low < SHORT_LIMIT ? 'too-short' : estimate.low < AMPLE_LIMIT ? 'uncertain' : 'ample';
  return { ...estimate, band };
}

export const EXPOSURE_THRESHOLDS = { short: SHORT_LIMIT, ample: AMPLE_LIMIT } as const;
