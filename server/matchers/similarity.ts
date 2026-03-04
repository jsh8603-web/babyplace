/**
 * String similarity utilities for place name matching.
 * Implements Dice coefficient over bigrams — no external libraries.
 *
 * Usage:
 *   similarity('코코몽 에코파크', 'Coconmong Ecopark') → 0.0 (different script)
 *   similarity('코코몽 에코파크', '코코몽에코파크') → 1.0 (same after normalize)
 */

/**
 * Normalizes a place name for comparison:
 * - Strips whitespace
 * - Removes special characters (keeps Korean, alphanumeric)
 * - Lowercases
 */
export function normalizePlaceName(name: string): string {
  return name
    .replace(/\s+/g, '')
    .replace(/[^가-힣a-zA-Z0-9]/g, '')
    .toLowerCase()
}

/**
 * Extracts all consecutive character bigrams from a string.
 * Example: 'abc' → ['ab', 'bc']
 */
function bigrams(s: string): string[] {
  if (s.length < 2) return [s] // single char treated as its own token
  const result: string[] = []
  for (let i = 0; i < s.length - 1; i++) {
    result.push(s.slice(i, i + 2))
  }
  return result
}

/**
 * Computes Dice coefficient similarity between two strings after normalization.
 *
 * Returns a score in [0, 1]:
 *   1.0 = exact match (after normalization)
 *   0.9 = one contains the other
 *   <1  = bigram-level Dice coefficient
 */
export function similarity(a: string, b: string): number {
  const na = normalizePlaceName(a)
  const nb = normalizePlaceName(b)

  if (na === '' && nb === '') return 1.0
  if (na === '' || nb === '') return 0.0

  // Exact match after normalization
  if (na === nb) return 1.0

  // Substring containment (e.g. "코코몽" ⊂ "코코몽에코파크")
  // Guard: short substrings (chain name only) fall through to Dice
  if (na.includes(nb) || nb.includes(na)) {
    const ratio = Math.min(na.length, nb.length) / Math.max(na.length, nb.length)
    if (ratio >= 0.6) return 0.9
    // Short name (e.g. "미도인" vs "미도인왕십리역사") → let Dice evaluate
  }

  // Dice coefficient over bigrams
  const bigramsA = bigrams(na)
  const bigramsB = bigrams(nb)

  if (bigramsA.length === 0 && bigramsB.length === 0) return 1.0

  // Use a frequency map for bigramsA to handle repeated bigrams correctly
  const freqA = new Map<string, number>()
  for (const bg of bigramsA) {
    freqA.set(bg, (freqA.get(bg) ?? 0) + 1)
  }

  const freqB = new Map<string, number>()
  for (const bg of bigramsB) {
    freqB.set(bg, (freqB.get(bg) ?? 0) + 1)
  }

  let intersection = 0
  for (const [bg, countA] of freqA) {
    const countB = freqB.get(bg) ?? 0
    intersection += Math.min(countA, countB)
  }

  const dice = (2 * intersection) / (bigramsA.length + bigramsB.length)
  return Math.round(dice * 1000) / 1000 // round to 3 decimal places
}

