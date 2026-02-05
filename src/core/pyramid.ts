/**
 * Probe Agents Kit - Pyramid Generator
 *
 * Utility to generate valid SLIM-Pyramid structures.
 */

import type { TraceDraft, MutationType } from './types.js';
import { SeededRNG, INTENT_TOKENS, CORE_TOKENS, SHAPE_TOKENS } from './rng.js';

export interface PyramidOptions {
  zone: 'FLUX' | 'FORGE';
  parentTraceIds?: string[];
  depth?: number;
  nodes?: number;
  permanence?: number;
  opacity?: number;
  mutation?: MutationType;
  forceJointCapable?: boolean;
}

export function generateTraceDraft(rng: SeededRNG, options: PyramidOptions): TraceDraft {
  const {
    zone,
    parentTraceIds = [],
    depth = rng.nextInt(1, 5),
    nodes = rng.nextInt(2, 6),
    permanence = rng.nextInt(1, 5),
    opacity = rng.nextInt(1, 9),
    mutation = 'none',
    forceJointCapable = false,
  } = options;

  // Pick random tokens
  let intents = rng.pickTokens(INTENT_TOKENS, rng.nextInt(1, 3));
  let cores = rng.pickTokens(CORE_TOKENS, rng.nextInt(2, 4));
  const shapes = rng.pickTokens(SHAPE_TOKENS, rng.nextInt(1, 2));

  // Force joint-capable if requested
  if (forceJointCapable) {
    // Must have ∇prv, ∇cmp, or ∇drf
    const jointIntents = ['∇prv', '∇cmp', '∇drf'];
    if (!intents.some(i => jointIntents.includes(i))) {
      intents = [...intents, rng.pick(jointIntents)!];
    }
    // Must have ⛓anc
    if (!cores.includes('⛓anc')) {
      cores = [...cores, '⛓anc'];
    }
  }

  // Ensure permanence respects zone limits
  const maxPermanence = zone === 'FLUX' ? 3 : 5;
  const finalPermanence = Math.min(permanence, maxPermanence);

  return {
    zone,
    L1: { intent: intents },
    L2: { shape: shapes },
    L3: {
      topology: {
        depth: forceJointCapable ? Math.max(depth, 2) : depth,
        nodes: forceJointCapable ? Math.max(nodes, 3) : nodes,
        symmetry: rng.nextBool(0.5) ? 1 : 0 as 0 | 1,
      },
    },
    L4: { core: cores },
    L6: { rel: { derives_from: parentTraceIds, mutation } },
    L7: { permanence: forceJointCapable ? Math.max(finalPermanence, 3) : finalPermanence },
    L8: { opacity },
  };
}

export function generateCreateDraft(
  rng: SeededRNG,
  options: Omit<PyramidOptions, 'zone' | 'mutation'>
): TraceDraft {
  return generateTraceDraft(rng, {
    ...options,
    zone: 'FLUX',
    mutation: 'none',
  });
}

export function generateDeriveDraft(
  rng: SeededRNG,
  parentTraceId: string,
  mutation: MutationType = 'partial'
): TraceDraft {
  return generateTraceDraft(rng, {
    zone: 'FORGE',
    parentTraceIds: [parentTraceId],
    depth: rng.nextInt(2, 6),
    nodes: rng.nextInt(3, 7),
    permanence: rng.nextInt(2, 5),
    mutation,
  });
}

export function generateJointCapableDraft(
  rng: SeededRNG,
  parentTraceIds: string[] = []
): TraceDraft {
  return generateTraceDraft(rng, {
    zone: 'FLUX',
    parentTraceIds,
    forceJointCapable: true,
    permanence: rng.nextInt(3, 5), // 3-5, capped at 3 for FLUX
    nodes: rng.nextInt(3, 5),
    mutation: 'none',
  });
}

// Legacy exports for backward compatibility
export const generatePyramid = generateTraceDraft;
export const generateDerivationPyramid = (rng: SeededRNG, _did: string, parentTraceIds: string[]): TraceDraft => {
  return generateDeriveDraft(rng, parentTraceIds[0], 'partial');
};
export const generateJointCapablePyramid = (rng: SeededRNG, _did: string, parentTraceIds: string[] = []): TraceDraft => {
  return generateJointCapableDraft(rng, parentTraceIds);
};
