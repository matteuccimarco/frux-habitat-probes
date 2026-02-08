/**
 * Manifest Validator Tests
 *
 * Tests for:
 * 1. Schema validation
 * 2. Admission logic
 * 3. Capability granting (never more than requested)
 * 4. Budget enforcement
 * 5. Quarantine assignment
 */

import { describe, it, expect } from 'vitest';
import type { AgentManifest, WorldPolicy } from './types.js';
import {
  validateManifest,
  performAdmission,
  loadManifest,
  DEFAULT_WORLD_POLICY,
} from './validator.js';

const validManifest: AgentManifest = {
  manifestVersion: '1.0',
  agent: {
    name: 'test-agent',
    kind: 'WASM',
    entry: './agent.wasm',
  },
  requested: {
    capabilities: ['MOVE', 'SENSE'],
  },
};

describe('Manifest Validation', () => {
  it('should accept valid manifest', () => {
    const result = validateManifest(validManifest);
    expect(result.valid).toBe(true);
    expect(result.errors).toHaveLength(0);
  });

  it('should reject non-object manifest', () => {
    const result = validateManifest('not an object');
    expect(result.valid).toBe(false);
    expect(result.errors[0].message).toContain('must be an object');
  });

  it('should reject wrong manifest version', () => {
    const result = validateManifest({ ...validManifest, manifestVersion: '2.0' });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'manifestVersion')).toBe(true);
  });

  it('should reject missing agent section', () => {
    const { agent: _, ...rest } = validManifest;
    const result = validateManifest(rest);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'agent')).toBe(true);
  });

  it('should reject invalid agent name pattern', () => {
    const result = validateManifest({
      ...validManifest,
      agent: { ...validManifest.agent, name: '123-invalid' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'agent.name')).toBe(true);
  });

  it('should reject invalid agent kind', () => {
    const result = validateManifest({
      ...validManifest,
      agent: { ...validManifest.agent, kind: 'DOCKER' },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.path === 'agent.kind')).toBe(true);
  });

  it('should reject empty capabilities array', () => {
    const result = validateManifest({
      ...validManifest,
      requested: { capabilities: [] },
    });
    expect(result.valid).toBe(false);
  });

  it('should reject unknown capabilities', () => {
    const result = validateManifest({
      ...validManifest,
      requested: { capabilities: ['FLY', 'TELEPORT'] },
    });
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.message.includes('Invalid capability'))).toBe(true);
  });

  it('should reject compute budget out of range', () => {
    const result = validateManifest({
      ...validManifest,
      requested: {
        capabilities: ['MOVE'],
        computeBudgetMsPerTick: 1000, // Too high
      },
    });
    expect(result.valid).toBe(false);
  });

  it('should reject noise floor out of range', () => {
    const result = validateManifest({
      ...validManifest,
      requested: {
        capabilities: ['SENSE'],
        observationBudget: { maxCells: 9, maxFields: 12, noiseFloor: 2.0 },
      },
    });
    expect(result.valid).toBe(false);
  });
});

describe('Manifest Loading', () => {
  it('should load valid JSON manifest', () => {
    const json = JSON.stringify(validManifest);
    const result = loadManifest(json);
    expect(result.validation.valid).toBe(true);
    expect(result.manifest).toEqual(validManifest);
  });

  it('should reject invalid JSON', () => {
    const result = loadManifest('{ not valid json }');
    expect(result.validation.valid).toBe(false);
    expect(result.manifest).toBeUndefined();
  });
});

describe('Admission - Capability Granting', () => {
  it('should grant only requested capabilities', () => {
    const manifest: AgentManifest = {
      ...validManifest,
      requested: { capabilities: ['MOVE'] },
    };
    const result = performAdmission(manifest);

    expect(result.admitted).toBe(true);
    expect(result.granted?.capabilities).toEqual(['MOVE']);
  });

  it('should NOT grant capabilities not in policy', () => {
    const manifest: AgentManifest = {
      ...validManifest,
      requested: { capabilities: ['MOVE', 'PROPOSE_PACT'] },
    };
    // Default policy doesn't include PROPOSE_PACT
    const result = performAdmission(manifest);

    expect(result.admitted).toBe(true);
    expect(result.granted?.capabilities).not.toContain('PROPOSE_PACT');
    expect(result.granted?.capabilities).toContain('MOVE');
  });

  it('should never grant more than requested', () => {
    const manifest: AgentManifest = {
      ...validManifest,
      requested: { capabilities: ['SENSE'] },
    };
    const policy: WorldPolicy = {
      ...DEFAULT_WORLD_POLICY,
      maxCapabilities: ['MOVE', 'SENSE', 'GENERATE_TRACE', 'INQUIRY'],
    };
    const result = performAdmission(manifest, policy);

    expect(result.admitted).toBe(true);
    expect(result.granted?.capabilities).toEqual(['SENSE']);
    expect(result.granted?.capabilities).not.toContain('MOVE');
  });
});

describe('Admission - Budget Enforcement', () => {
  it('should grant min of requested and policy max for action rate', () => {
    const manifest: AgentManifest = {
      ...validManifest,
      requested: {
        capabilities: ['MOVE'],
        maxActionsPerWindow: { windowTicks: 100, max: 20 },
      },
    };
    const policy: WorldPolicy = {
      ...DEFAULT_WORLD_POLICY,
      maxActionRate: { windowTicks: 200, max: 5 },
    };
    const result = performAdmission(manifest, policy);

    expect(result.granted?.maxActionsPerWindow).toEqual({
      windowTicks: 200, // Max of requested and policy (longer window)
      max: 5, // Min of requested and policy (stricter limit)
    });
  });

  it('should grant min of requested and policy max for compute', () => {
    const manifest: AgentManifest = {
      ...validManifest,
      requested: {
        capabilities: ['MOVE'],
        computeBudgetMsPerTick: 50,
      },
    };
    const policy: WorldPolicy = {
      ...DEFAULT_WORLD_POLICY,
      maxComputeBudgetMs: 10,
    };
    const result = performAdmission(manifest, policy);

    expect(result.granted?.computeBudgetMsPerTick).toBe(10);
  });

  it('should enforce minimum noise floor', () => {
    const manifest: AgentManifest = {
      ...validManifest,
      requested: {
        capabilities: ['SENSE'],
        observationBudget: { maxCells: 25, maxFields: 20, noiseFloor: 0.05 },
      },
    };
    const policy: WorldPolicy = {
      ...DEFAULT_WORLD_POLICY,
      minObservationNoise: 0.2,
      maxObservationCells: 9,
    };
    const result = performAdmission(manifest, policy);

    expect(result.granted?.observationBudget.noiseFloor).toBe(0.2);
    expect(result.granted?.observationBudget.maxCells).toBe(9);
  });

  it('should cap energy per tick', () => {
    const manifest: AgentManifest = {
      ...validManifest,
      requested: {
        capabilities: ['MOVE'],
        energyBudget: { maxPerTick: 100, maxReserve: 500 },
      },
    };
    const policy: WorldPolicy = {
      ...DEFAULT_WORLD_POLICY,
      maxEnergyPerTick: 20,
    };
    const result = performAdmission(manifest, policy);

    expect(result.granted?.energyBudget.maxPerTick).toBe(20);
  });
});

describe('Admission - Quarantine', () => {
  it('should quarantine third-party WASM agents', () => {
    const manifest: AgentManifest = {
      ...validManifest,
      agent: { ...validManifest.agent, kind: 'WASM' },
    };
    const policy: WorldPolicy = {
      ...DEFAULT_WORLD_POLICY,
      quarantineThirdParty: true,
    };
    const result = performAdmission(manifest, policy);

    expect(result.granted?.inQuarantine).toBe(true);
  });

  it('should quarantine third-party PROCESS agents', () => {
    const manifest: AgentManifest = {
      ...validManifest,
      agent: { ...validManifest.agent, kind: 'PROCESS' },
    };
    const policy: WorldPolicy = {
      ...DEFAULT_WORLD_POLICY,
      quarantineThirdParty: true,
    };
    const result = performAdmission(manifest, policy);

    expect(result.granted?.inQuarantine).toBe(true);
  });

  it('should NOT quarantine BUILTIN agents', () => {
    const manifest: AgentManifest = {
      ...validManifest,
      agent: { name: 'core-agent', kind: 'BUILTIN', entry: 'core' },
    };
    const policy: WorldPolicy = {
      ...DEFAULT_WORLD_POLICY,
      quarantineThirdParty: true,
    };
    const result = performAdmission(manifest, policy);

    expect(result.granted?.inQuarantine).toBe(false);
  });

  it('should assign specified shard when quarantined', () => {
    const manifest: AgentManifest = {
      ...validManifest,
      quarantine: { required: true, shardId: 'shard-experimental' },
    };
    const result = performAdmission(manifest);

    expect(result.granted?.inQuarantine).toBe(true);
    expect(result.granted?.shardId).toBe('shard-experimental');
  });
});

describe('Admission - Version Compatibility', () => {
  it('should reject incompatible habitat version', () => {
    const manifest: AgentManifest = {
      ...validManifest,
      compat: { minHabitatVersion: '1.0.0' },
    };
    const policy: WorldPolicy = {
      ...DEFAULT_WORLD_POLICY,
      habitatVersion: '0.12.0',
    };
    const result = performAdmission(manifest, policy);

    expect(result.admitted).toBe(false);
    expect(result.rejectionReasons?.some((r) => r.includes('version'))).toBe(true);
  });

  it('should accept compatible habitat version', () => {
    const manifest: AgentManifest = {
      ...validManifest,
      compat: { minHabitatVersion: '0.11.0' },
    };
    const policy: WorldPolicy = {
      ...DEFAULT_WORLD_POLICY,
      habitatVersion: '0.12.0',
    };
    const result = performAdmission(manifest, policy);

    expect(result.admitted).toBe(true);
  });
});

describe('Security - Privilege Escalation Prevention', () => {
  it('should not grant capabilities if manifest requests none', () => {
    // Edge case: what if capabilities array is somehow bypassed?
    // The validator should catch this, but admission should also be safe
    const manifest = {
      manifestVersion: '1.0',
      agent: { name: 'evil', kind: 'WASM', entry: './evil.wasm' },
      requested: { capabilities: [] },
    };

    // Validation should fail
    const validation = validateManifest(manifest);
    expect(validation.valid).toBe(false);
  });

  it('should never grant PROPOSE_PACT by default', () => {
    const manifest: AgentManifest = {
      ...validManifest,
      requested: { capabilities: ['MOVE', 'SENSE', 'GENERATE_TRACE', 'PROPOSE_PACT', 'INQUIRY'] },
    };
    // PROPOSE_PACT is not in default policy
    const result = performAdmission(manifest);

    expect(result.granted?.capabilities).not.toContain('PROPOSE_PACT');
  });

  it('should apply defaults when budgets not specified', () => {
    const manifest: AgentManifest = {
      ...validManifest,
      requested: { capabilities: ['MOVE'] },
    };
    const result = performAdmission(manifest);

    // Should have restrictive defaults applied
    expect(result.granted?.computeBudgetMsPerTick).toBeLessThanOrEqual(10);
    expect(result.granted?.observationBudget.noiseFloor).toBeGreaterThanOrEqual(0.2);
  });
});
