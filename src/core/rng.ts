/**
 * Probe Agents Kit - Seeded RNG
 *
 * Mulberry32 PRNG for deterministic agent behavior.
 * Each agent gets its own seeded instance.
 */

export class SeededRNG {
  private state: number;

  constructor(seed: number) {
    this.state = seed;
  }

  /**
   * Generate next random number in [0, 1)
   */
  next(): number {
    let t = (this.state += 0x6d2b79f5);
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  }

  /**
   * Generate random integer in [min, max] (inclusive)
   */
  nextInt(min: number, max: number): number {
    return Math.floor(this.next() * (max - min + 1)) + min;
  }

  /**
   * Generate random boolean with given probability
   */
  nextBool(probability: number = 0.5): boolean {
    return this.next() < probability;
  }

  /**
   * Pick random element from array
   */
  pick<T>(array: T[]): T | undefined {
    if (array.length === 0) return undefined;
    return array[this.nextInt(0, array.length - 1)];
  }

  /**
   * Shuffle array in place (Fisher-Yates)
   */
  shuffle<T>(array: T[]): T[] {
    for (let i = array.length - 1; i > 0; i--) {
      const j = this.nextInt(0, i);
      [array[i], array[j]] = [array[j]!, array[i]!];
    }
    return array;
  }

  /**
   * Generate random hex string
   */
  nextHex(length: number): string {
    let result = '';
    for (let i = 0; i < length; i++) {
      result += this.nextInt(0, 15).toString(16);
    }
    return result;
  }

  /**
   * Pick random tokens from vocabulary
   */
  pickTokens(vocab: readonly string[], count: number): string[] {
    const shuffled = this.shuffle([...vocab]);
    return shuffled.slice(0, Math.min(count, shuffled.length));
  }
}

// ============================================================================
// SLIM-PYRAMID VOCABULARY
// ============================================================================

export const INTENT_TOKENS = ['∇obs', '∇exp', '∇cmp', '∇mut', '∇drf', '∇ctr', '∇prv', '∇shd'] as const;
export const CORE_TOKENS = ['Δent', '⊗mem', '↯irr', '∥loc', '∴rel', '≋eco', '≠div', '⟂unk', '⌁drf', '⧗tmp', '◌nul', '⛓anc'] as const;
export const SHAPE_TOKENS = ['lin', 'brn', 'cyc', 'spr', 'dns', 'sym'] as const;
